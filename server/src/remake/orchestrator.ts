import type { RemakeJobStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { prismaStageFromSlug, slugFromPrismaStage } from "./stage";
import { enqueueRemakeJob } from "../queues/remakeQueue";
import { buildRemakeUpdatedEvent, type RemakeProgress, type RemakeUpdatedEvent } from "./events";
import { runRemakeAnalyze, shouldForceAnalyzeGate } from "./analyze";
import { nextStageAfterSuccess, shouldPauseForGate } from "./stateMachine";
import type { RemakeBreakdown, RemakeGates, RemakeStageSlug } from "./types";
import { isRemakeStage } from "./types";

export interface RemakeJobSnapshot {
  id: string;
  userId: string;
  status: string;
  stage: RemakeStageSlug;
  gatesEnabled: RemakeGates;
  errorMessage?: string | null;
  progress?: RemakeProgress | null;
}

export interface StageRunnerResult {
  ok: boolean;
  error?: string;
  progress?: RemakeProgress;
  breakdown?: RemakeBreakdown;
}

export type StageRunner = (job: RemakeJobSnapshot) => Promise<StageRunnerResult>;
export type StageRunners = Partial<Record<RemakeStageSlug, StageRunner>>;

export interface RunRemakeStageDeps {
  loadJob: (jobId: string) => Promise<RemakeJobSnapshot | null>;
  saveJob: (
    jobId: string,
    update: {
      status?: string;
      stage?: RemakeStageSlug;
      errorMessage?: string | null;
      progress?: RemakeProgress | null;
      breakdown?: RemakeBreakdown | null;
    },
  ) => Promise<RemakeJobSnapshot>;
  runners: StageRunners;
  enqueueNext?: (jobId: string, stage: RemakeStageSlug) => Promise<void>;
  emitUpdated?: (event: RemakeUpdatedEvent) => void;
}

export interface RunRemakeStageResult {
  jobId: string;
  userId: string;
  status: string;
  stage: RemakeStageSlug;
  progress?: RemakeProgress | null;
  errorMessage?: string | null;
}

export interface RunRemakeStageOptions {
  stage?: RemakeStageSlug;
}

export async function runRemakeStage(
  jobId: string,
  deps: RunRemakeStageDeps,
  options: RunRemakeStageOptions = {},
): Promise<RunRemakeStageResult> {
  const loaded = await deps.loadJob(jobId);
  if (!loaded) {
    throw new Error(`Remake job not found: ${jobId}`);
  }

  const stage = options.stage ?? loaded.stage;
  const runner = deps.runners[stage];
  if (!runner) {
    throw new Error(`No runner configured for stage: ${stage}`);
  }

  let current = await deps.saveJob(jobId, { status: "RUNNING", stage });
  emit(deps, current);

  const runnerResult = await runner({ ...loaded, stage });
  if (!runnerResult.ok) {
    current = await deps.saveJob(jobId, {
      status: "FAILED",
      stage,
      errorMessage: runnerResult.error ?? "阶段执行失败",
      progress: runnerResult.progress ?? loaded.progress ?? null,
    });
    emit(deps, current);
    return toResult(current);
  }

  const forceAnalyzeGate =
    stage === "analyze" &&
    runnerResult.breakdown != null &&
    shouldForceAnalyzeGate(runnerResult.breakdown);

  if (shouldPauseForGate(stage, loaded.gatesEnabled) || forceAnalyzeGate) {
    current = await deps.saveJob(jobId, {
      status: "WAITING_GATE",
      stage,
      errorMessage: null,
      progress: runnerResult.progress ?? loaded.progress ?? null,
      breakdown: runnerResult.breakdown,
    });
    emit(deps, current);
    return toResult(current);
  }

  const nextStage = nextStageAfterSuccess(stage);
  if (!nextStage) {
    current = await deps.saveJob(jobId, {
      status: "SUCCEEDED",
      stage,
      errorMessage: null,
      progress: runnerResult.progress ?? { percent: 100, message: "完成" },
    });
    emit(deps, current);
    return toResult(current);
  }

  current = await deps.saveJob(jobId, {
    status: "RUNNING",
    stage: nextStage,
    errorMessage: null,
    progress: runnerResult.progress ?? loaded.progress ?? null,
  });
  emit(deps, current);
  await deps.enqueueNext?.(jobId, nextStage);
  return toResult(current);
}

function emit(deps: RunRemakeStageDeps, job: RemakeJobSnapshot): void {
  deps.emitUpdated?.(buildRemakeUpdatedEvent(job));
}

function toResult(job: RemakeJobSnapshot): RunRemakeStageResult {
  return {
    jobId: job.id,
    userId: job.userId,
    status: job.status,
    stage: job.stage,
    progress: job.progress ?? null,
    errorMessage: job.errorMessage ?? null,
  };
}

function parseGates(value: unknown): RemakeGates {
  if (!value || typeof value !== "object") {
    return { a: true, b: true, c: true };
  }
  const gates = value as Partial<RemakeGates>;
  return {
    a: gates.a ?? true,
    b: gates.b ?? true,
    c: gates.c ?? true,
  };
}

export function createAnalyzeStageRunner(): StageRunner {
  return async (job) => {
    const full = await prisma.remakeJob.findUnique({
      where: { id: job.id },
      include: { source: true },
    });
    if (!full?.source?.videoKey) {
      return { ok: false, error: "缺少源视频，请先完成 ingest" };
    }
    const breakdown = await runRemakeAnalyze({
      videoPath: full.source.videoKey,
      durationMs: full.source.durationMs ?? full.maxDurationMs,
      maxShots: full.maxShots,
    });
    await prisma.remakeJob.update({
      where: { id: job.id },
      data: { breakdown },
    });
    return {
      ok: true,
      progress: { percent: 100, message: "拆解完成", shotTotal: breakdown.shots.length },
      breakdown,
    };
  };
}

export function createStubStageRunners(): StageRunners {
  const stub: StageRunner = async (job) => ({
    ok: true,
    progress: { percent: 100, message: `${job.stage} 阶段完成（stub）` },
  });
  return {
    ingest: stub,
    analyze: createAnalyzeStageRunner(),
    adapt: stub,
    generate: stub,
    assemble: stub,
    deliver: stub,
  };
}

export function createDefaultOrchestratorDeps(
  onEvent?: (event: RemakeUpdatedEvent) => void,
): RunRemakeStageDeps {
  return {
    loadJob: async (jobId) => {
      const job = await prisma.remakeJob.findUnique({ where: { id: jobId } });
      if (!job) return null;
      return {
        id: job.id,
        userId: job.userId,
        status: job.status,
        stage: slugFromPrismaStage(job.stage),
        gatesEnabled: parseGates(job.gatesEnabled),
        errorMessage: job.errorMessage,
        progress: (job.progress as RemakeProgress | null) ?? null,
      };
    },
    saveJob: async (jobId, update) => {
      const data: {
        status?: RemakeJobStatus;
        stage?: ReturnType<typeof prismaStageFromSlug>;
        errorMessage?: string | null;
        progress?: RemakeProgress | null;
        breakdown?: RemakeBreakdown | null;
      } = {};
      if (update.status) {
        data.status = update.status as RemakeJobStatus;
      }
      if (update.stage) {
        data.stage = prismaStageFromSlug(update.stage);
      }
      if (update.errorMessage !== undefined) {
        data.errorMessage = update.errorMessage;
      }
      if (update.progress !== undefined) {
        data.progress = update.progress;
      }
      if (update.breakdown !== undefined) {
        data.breakdown = update.breakdown;
      }
      const job = await prisma.remakeJob.update({
        where: { id: jobId },
        data,
      });
      return {
        id: job.id,
        userId: job.userId,
        status: job.status,
        stage: slugFromPrismaStage(job.stage),
        gatesEnabled: parseGates(job.gatesEnabled),
        errorMessage: job.errorMessage,
        progress: (job.progress as RemakeProgress | null) ?? null,
      };
    },
    runners: createStubStageRunners(),
    enqueueNext: async (jobId, stage) => {
      await enqueueRemakeJob({ jobId, stage });
    },
    emitUpdated: onEvent,
  };
}

export function resolveRequestedStage(
  requested: string | undefined,
  fallback: RemakeStageSlug,
): RemakeStageSlug {
  if (requested && isRemakeStage(requested)) {
    return requested;
  }
  return fallback;
}
