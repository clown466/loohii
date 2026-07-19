import type { RemakeJobStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { prismaStageFromSlug, slugFromPrismaStage } from "./stage";
import { enqueueRemakeJob } from "../queues/remakeQueue";
import { buildRemakeUpdatedEvent, type RemakeProgress, type RemakeUpdatedEvent } from "./events";
import { runRemakeAdapt, type RemakeScript, type TextModelCaller } from "./adapt";
import { runRemakeAnalyze, shouldForceAnalyzeGate } from "./analyze";
import { chargeRemakeStage, loadRemakePlatform, refundRemakeStage, remakeBillingAttempt } from "./billing";
import { runRemakeGenerate } from "./generateShots";
import { nextStageAfterSuccess, shouldPauseForGate } from "./stateMachine";
import type { RemakeBreakdown, RemakeGates, RemakeStageSlug } from "./types";
import { isRemakeStage } from "./types";
import { callConfiguredTextModel } from "../ai/textModel";
import type { OnceCharge } from "../lib/platformBilling";

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

function createDefaultTextModelCaller(): TextModelCaller | undefined {
  return async (messages) => {
    const result = await callConfiguredTextModel(messages);
    return { rawText: result.rawText };
  };
}

export function createAdaptStageRunner(opts?: { callTextModel?: TextModelCaller }): StageRunner {
  return async (job) => {
    const full = await prisma.remakeJob.findUnique({ where: { id: job.id } });
    const breakdown = full?.breakdown as RemakeBreakdown | null;
    if (!breakdown?.shots?.length) {
      return { ok: false, error: "缺少拆解结果，请先完成 analyze" };
    }

    let charge: OnceCharge | null = null;
    const platform = await loadRemakePlatform(job.userId);
    if (platform) {
      try {
        charge = await chargeRemakeStage(platform, job.id, "adapt", "loohii_text", 1);
      } catch (error) {
        const message = error instanceof Error ? error.message : "改编阶段扣点失败";
        return { ok: false, error: message };
      }
    }

    try {
      const callTextModel = opts?.callTextModel ?? createDefaultTextModelCaller();
      const remakeScript = await runRemakeAdapt({ breakdown, callTextModel });
      await prisma.remakeJob.update({
        where: { id: job.id },
        data: { remakeScript },
      });
      return {
        ok: true,
        progress: { percent: 100, message: "改编完成", shotTotal: remakeScript.shots.length },
      };
    } catch (error) {
      if (charge) await refundRemakeStage(charge);
      const message = error instanceof Error ? error.message : "改编阶段失败";
      return { ok: false, error: message };
    }
  };
}

export function createGenerateStageRunner(): StageRunner {
  return async (job) => {
    const full = await prisma.remakeJob.findUnique({
      where: { id: job.id },
      include: { source: true },
    });
    const remakeScript = full?.remakeScript as RemakeScript | null;
    if (!remakeScript?.shots?.length) {
      return { ok: false, error: "缺少改编脚本，请先完成 adapt" };
    }

    const refImages =
      (full?.breakdown as RemakeBreakdown | null)?.shots
        ?.flatMap((shot) => shot.keyframeUrls)
        .filter((url): url is string => typeof url === "string" && /^https?:\/\//i.test(url)) ?? [];

    const platform = await loadRemakePlatform(job.userId);
    const shotCharges = new Map<number, OnceCharge>();
    const existingClips = await prisma.remakeShotClip.findMany({
      where: { jobId: job.id },
    });
    const existingShots = Object.fromEntries(
      existingClips.map((clip: { shotIndex: number; status: string; retryCount: number }) => [
        clip.shotIndex,
        { status: clip.status, retryCount: clip.retryCount },
      ]),
    );

    const result = await runRemakeGenerate({
      jobId: job.id,
      script: remakeScript,
      refImages,
      existingShots,
      chargeShot: platform
        ? async (shotIndex, retryCount) => {
            const attempt = remakeBillingAttempt(retryCount);
            const charge = await chargeRemakeStage(
              platform,
              job.id,
              "generate",
              "loohii_video",
              1,
              shotIndex,
              attempt,
            );
            shotCharges.set(shotIndex, charge);
          }
        : undefined,
      refundShot: platform
        ? async (shotIndex) => {
            const charge = shotCharges.get(shotIndex);
            if (charge) {
              await refundRemakeStage(charge);
              shotCharges.delete(shotIndex);
            }
          }
        : undefined,
      upsertShot: async (jobId, shotIndex, data) => {
        const existing = await prisma.remakeShotClip.findUnique({
          where: { jobId_shotIndex: { jobId, shotIndex } },
        });
        const retryCount =
          data.status === "failed"
            ? (existing?.retryCount ?? 0) + (data.retryCount ?? 1)
            : existing?.retryCount ?? 0;
        await prisma.remakeShotClip.upsert({
          where: { jobId_shotIndex: { jobId, shotIndex } },
          create: {
            jobId,
            shotIndex,
            status: data.status,
            prompt: data.prompt ?? null,
            durationMs: data.durationMs ?? null,
            resultUrl: data.resultUrl ?? null,
            resultKey: data.resultKey ?? null,
            errorMessage: data.errorMessage ?? null,
            retryCount,
          },
          update: {
            status: data.status,
            ...(data.prompt !== undefined ? { prompt: data.prompt } : {}),
            ...(data.durationMs !== undefined ? { durationMs: data.durationMs } : {}),
            ...(data.resultUrl !== undefined ? { resultUrl: data.resultUrl } : {}),
            ...(data.resultKey !== undefined ? { resultKey: data.resultKey } : {}),
            ...(data.errorMessage !== undefined ? { errorMessage: data.errorMessage } : {}),
            retryCount,
          },
        });
      },
    });

    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
        progress: result.progress,
      };
    }

    return {
      ok: true,
      progress: result.progress,
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
    adapt: createAdaptStageRunner(),
    generate: createGenerateStageRunner(),
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
