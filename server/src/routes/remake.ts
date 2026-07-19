import { Router } from "express";
import type { RemakeStage } from "@prisma/client";
import { asyncRoute } from "../lib/asyncRoute";
import { HttpError, notFound, routeParam } from "../lib/httpErrors";
import { prisma } from "../lib/prisma";
import { created, ok } from "../lib/response";
import { requireAuth } from "../middleware/auth";
import { gateForStage, nextStageAfterSuccess } from "../remake/stateMachine";
import {
  prismaStageFromSlug as prismaStageFromSlugCore,
  slugFromPrismaStage as slugFromPrismaStageCore,
} from "../remake/stage";
import type { RemakeGates, RemakeStageSlug } from "../remake/types";
import { enqueueRemakeJob } from "../queues/remakeQueue";

const GATE_TO_STAGE: Record<keyof RemakeGates, RemakeStageSlug> = {
  a: "analyze",
  b: "adapt",
  c: "assemble",
};

export const remakeRouter = Router();
remakeRouter.use(requireAuth);

remakeRouter.post(
  "/jobs",
  asyncRoute(async (req, res) => {
    const userId = req.user!.id;
    const body = (req.body ?? {}) as {
      sourceUrl?: string;
      videoKey?: string;
      coverKey?: string;
      gates?: Partial<RemakeGates>;
    };
    validateCreateBody(body);
    const job = await prisma.remakeJob.create({
      data: buildCreateJobData(userId, body),
      include: jobInclude(),
    });
    await enqueueRemakeJob({ jobId: job.id, stage: "ingest" });
    created(res, job);
  }),
);

remakeRouter.get(
  "/jobs",
  asyncRoute(async (req, res) => {
    const requestedLimit = Number(req.query.limit);
    const take = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(100, Math.floor(requestedLimit)))
      : 50;
    const jobs = await prisma.remakeJob.findMany({
      where: { userId: req.user!.id },
      include: jobInclude(),
      orderBy: { createdAt: "desc" },
      take,
    });
    ok(res, jobs);
  }),
);

remakeRouter.get(
  "/jobs/:id",
  asyncRoute(async (req, res) => {
    const job = await loadOwnedJob(req.user!.id, routeParam(req.params.id, "id"));
    ok(res, job);
  }),
);

remakeRouter.patch(
  "/jobs/:id/breakdown",
  asyncRoute(async (req, res) => {
    const jobId = routeParam(req.params.id, "id");
    const existing = await loadOwnedJob(req.user!.id, jobId);
    assertWaitingGateAtStage(existing, "analyze");
    const breakdown = (req.body ?? {}).breakdown;
    if (!breakdown || typeof breakdown !== "object") {
      throw new HttpError(400, "请提供 breakdown 对象");
    }
    const updated = await prisma.remakeJob.update({
      where: { id: jobId },
      data: { breakdown },
      include: jobInclude(),
    });
    ok(res, updated);
  }),
);

remakeRouter.patch(
  "/jobs/:id/script",
  asyncRoute(async (req, res) => {
    const jobId = routeParam(req.params.id, "id");
    const existing = await loadOwnedJob(req.user!.id, jobId);
    assertWaitingGateAtStage(existing, "adapt");
    const remakeScript = (req.body ?? {}).remakeScript;
    if (!remakeScript || typeof remakeScript !== "object") {
      throw new HttpError(400, "请提供 remakeScript 对象");
    }
    const updated = await prisma.remakeJob.update({
      where: { id: jobId },
      data: { remakeScript },
      include: jobInclude(),
    });
    ok(res, updated);
  }),
);

remakeRouter.post(
  "/jobs/:id/gates/:gate/approve",
  asyncRoute(async (req, res) => {
    const jobId = routeParam(req.params.id, "id");
    const gate = parseGate(routeParam(req.params.gate, "gate"));
    const existing = await loadOwnedJob(req.user!.id, jobId);
    assertGateMatchesJob(existing, gate);
    const stageSlug = slugFromPrismaStage(existing.stage);
    const update = buildApproveJobUpdate(stageSlug);
    const updated = await prisma.remakeJob.update({
      where: { id: jobId },
      data: {
        status: update.status,
        stage: update.stage,
        errorMessage: null,
      },
      include: jobInclude(),
    });
    await enqueueRemakeJob({ jobId, stage: update.enqueueStage });
    ok(res, updated);
  }),
);

remakeRouter.post(
  "/jobs/:id/gates/:gate/reject",
  asyncRoute(async (req, res) => {
    const jobId = routeParam(req.params.id, "id");
    const gate = parseGate(routeParam(req.params.gate, "gate"));
    const existing = await loadOwnedJob(req.user!.id, jobId);
    assertGateMatchesJob(existing, gate);
    const update = buildRejectJobUpdate(gate);
    const updated = await prisma.remakeJob.update({
      where: { id: jobId },
      data: {
        status: update.status,
        stage: update.stage,
        errorMessage: null,
        ...(update.breakdown !== undefined ? { breakdown: update.breakdown } : {}),
        ...(update.remakeScript !== undefined ? { remakeScript: update.remakeScript } : {}),
        ...(update.finalVideoKey !== undefined ? { finalVideoKey: update.finalVideoKey } : {}),
        ...(update.finalVideoUrl !== undefined ? { finalVideoUrl: update.finalVideoUrl } : {}),
      },
      include: jobInclude(),
    });
    await enqueueRemakeJob({ jobId, stage: update.enqueueStage });
    ok(res, updated);
  }),
);

remakeRouter.post(
  "/jobs/:id/retry-failed-shots",
  asyncRoute(async (req, res) => {
    const jobId = routeParam(req.params.id, "id");
    const existing = await loadOwnedJob(req.user!.id, jobId);
    const failedShots = existing.shots.filter((shot: { status: string }) => shot.status === "failed");
    if (failedShots.length === 0) {
      throw new HttpError(400, "没有可重试的失败镜头");
    }
    await prisma.remakeShotClip.updateMany({
      where: {
        jobId,
        status: "failed",
      },
      data: {
        status: "pending",
        errorMessage: null,
        retryCount: { increment: 1 },
      },
    });
    const updated = await prisma.remakeJob.update({
      where: { id: jobId },
      data: {
        status: "RUNNING",
        stage: "GENERATE",
        errorMessage: null,
      },
      include: jobInclude(),
    });
    await enqueueRemakeJob({ jobId, stage: "generate" });
    ok(res, updated);
  }),
);

export function slugFromPrismaStage(stage: string): RemakeStageSlug {
  try {
    return slugFromPrismaStageCore(stage);
  } catch {
    throw new HttpError(400, `未知阶段: ${stage}`);
  }
}

export function prismaStageFromSlug(slug: RemakeStageSlug): RemakeStage {
  try {
    return prismaStageFromSlugCore(slug);
  } catch {
    throw new HttpError(400, `未知阶段: ${slug}`);
  }
}

export function gateStageSlug(gate: string): RemakeStageSlug | null {
  if (gate === "a" || gate === "b" || gate === "c") {
    return GATE_TO_STAGE[gate];
  }
  return null;
}

export function normalizeGates(gates?: Partial<RemakeGates>): RemakeGates {
  return {
    a: gates?.a ?? true,
    b: gates?.b ?? true,
    c: gates?.c ?? true,
  };
}

export function validateCreateBody(body: { sourceUrl?: string; videoKey?: string }) {
  if (!body.sourceUrl && !body.videoKey) {
    throw new HttpError(400, "请提供 TikTok 链接或已上传的 videoKey");
  }
}

export function buildCreateJobData(
  userId: string,
  body: {
    sourceUrl?: string;
    videoKey?: string;
    coverKey?: string;
    gates?: Partial<RemakeGates>;
  },
) {
  const { sourceUrl, videoKey, coverKey, gates } = body;
  return {
    userId,
    sourceUrl: sourceUrl ?? null,
    status: "PENDING" as const,
    stage: "INGEST" as const,
    gatesEnabled: normalizeGates(gates),
    ...(videoKey
      ? {
          source: {
            create: {
              platform: "upload",
              videoKey,
              coverKey: coverKey ?? null,
              sourceUrl: null,
            },
          },
        }
      : {}),
  };
}

export function buildApproveJobUpdate(stageSlug: RemakeStageSlug) {
  const nextSlug = nextStageAfterSuccess(stageSlug);
  if (!nextSlug) {
    throw new HttpError(400, "当前阶段无法继续审批");
  }
  return {
    status: "RUNNING" as const,
    stage: prismaStageFromSlug(nextSlug),
    enqueueStage: nextSlug,
  };
}

export interface RejectJobUpdate {
  status: "RUNNING";
  stage: RemakeStage;
  enqueueStage: RemakeStageSlug;
  breakdown?: null;
  remakeScript?: null;
  finalVideoKey?: null;
  finalVideoUrl?: null;
}

export function buildRejectJobUpdate(gate: keyof RemakeGates): RejectJobUpdate {
  const stageSlug = GATE_TO_STAGE[gate];
  const base = {
    status: "RUNNING" as const,
    stage: prismaStageFromSlug(stageSlug),
    enqueueStage: stageSlug,
  };
  if (gate === "a") {
    return {
      ...base,
      breakdown: null,
      remakeScript: null,
      finalVideoKey: null,
      finalVideoUrl: null,
    };
  }
  if (gate === "b") {
    return {
      ...base,
      remakeScript: null,
      finalVideoKey: null,
      finalVideoUrl: null,
    };
  }
  return {
    ...base,
    finalVideoKey: null,
    finalVideoUrl: null,
  };
}

function jobInclude() {
  return {
    source: true,
    shots: { orderBy: { shotIndex: "asc" as const } },
  };
}

type OwnedJob = Awaited<ReturnType<typeof loadOwnedJob>>;

async function loadOwnedJob(userId: string, jobId: string) {
  const job = await prisma.remakeJob.findFirst({
    where: { id: jobId, userId },
    include: jobInclude(),
  });
  if (!job) notFound("Remake 任务不存在");
  return job;
}

function parseGate(value: string): keyof RemakeGates {
  if (value === "a" || value === "b" || value === "c") return value;
  throw new HttpError(400, "gate 必须是 a、b 或 c");
}

function assertWaitingGateAtStage(job: OwnedJob, expectedStage: RemakeStageSlug) {
  if (job.status !== "WAITING_GATE") {
    throw new HttpError(409, "任务当前不在卡点等待状态");
  }
  if (slugFromPrismaStage(job.stage) !== expectedStage) {
    throw new HttpError(409, "当前阶段不允许此编辑操作");
  }
}

function assertGateMatchesJob(job: OwnedJob, gate: keyof RemakeGates) {
  if (job.status !== "WAITING_GATE") {
    throw new HttpError(409, "任务当前不在卡点等待状态");
  }
  const stageSlug = slugFromPrismaStage(job.stage);
  const expectedGate = gateForStage(stageSlug);
  if (!expectedGate || expectedGate !== gate) {
    throw new HttpError(409, "当前阶段与 gate 不匹配");
  }
}
