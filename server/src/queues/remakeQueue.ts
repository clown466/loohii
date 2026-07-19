import { config } from "../config";
import type { RemakeUpdatedEvent } from "../remake/events";
import {
  createDefaultOrchestratorDeps,
  resolveRequestedStage,
  runRemakeStage,
} from "../remake/orchestrator";
import type { RemakeStageSlug } from "../remake/types";

type DynamicImport = <T = Record<string, unknown>>(specifier: string) => Promise<T>;

const loadModule = new Function(
  "specifier",
  "return import(specifier)",
) as DynamicImport;

export const remakeQueueName = "remake";

export interface RemakeJobData {
  jobId: string;
  stage?: string;
}

export interface RemakeQueueOptions {
  connection: unknown;
  queueName?: string;
  defaultJobOptions?: Record<string, unknown>;
}

export interface RemakeWorkerOptions extends RemakeQueueOptions {
  concurrency?: number;
  onEvent?: (event: RemakeUpdatedEvent) => void;
  createDeps?: () => ReturnType<typeof createDefaultOrchestratorDeps>;
}

export interface RemakeJobLike {
  id?: string;
  name: string;
  data: RemakeJobData;
  updateProgress(progress: number | object): Promise<void>;
}

export interface QueueLike {
  add(
    name: string,
    data: RemakeJobData,
    options?: Record<string, unknown>,
  ): Promise<RemakeJobLike>;
}

export interface WorkerLike {
  on(event: string, handler: (...args: unknown[]) => void): WorkerLike;
  close(): Promise<void>;
}

let queuePromise: Promise<QueueLike> | null = null;
let redisConnectionPromise: Promise<unknown> | null = null;

export async function createRedisConnection(): Promise<unknown> {
  if (!redisConnectionPromise) {
    redisConnectionPromise = (async () => {
      const { Redis } = await loadModule<{ Redis: new (...args: unknown[]) => unknown }>("ioredis");
      return new Redis(config.redisUrl, {
        maxRetriesPerRequest: null,
        lazyConnect: true,
      });
    })();
  }
  return redisConnectionPromise;
}

export async function createRemakeQueue(options: RemakeQueueOptions): Promise<QueueLike> {
  const { Queue } = await loadModule<{ Queue: new (...args: unknown[]) => QueueLike }>("bullmq");
  return new Queue(options.queueName ?? remakeQueueName, {
    connection: options.connection,
    defaultJobOptions: options.defaultJobOptions ?? {
      attempts: 2,
      removeOnComplete: true,
      removeOnFail: false,
    },
  });
}

export async function getRemakeQueue(): Promise<QueueLike> {
  if (!queuePromise) {
    queuePromise = createRemakeQueue({
      connection: await createRedisConnection(),
    });
  }
  return queuePromise;
}

export async function enqueueRemakeJob(data: RemakeJobData): Promise<void> {
  if (!config.redisUrl) {
    console.warn("Remake queue skipped: REDIS_URL not configured");
    return;
  }
  try {
    const queue = await getRemakeQueue();
    await queue.add("remake-stage", data, {
      jobId: `${data.jobId}:${data.stage ?? "auto"}-${Date.now()}`,
    });
  } catch (error) {
    console.warn("Failed to enqueue remake job:", error);
  }
}

export async function createRemakeWorker(options: RemakeWorkerOptions): Promise<WorkerLike> {
  const { Worker } = await loadModule<{ Worker: new (...args: unknown[]) => WorkerLike }>("bullmq");
  const createDeps = options.createDeps ?? (() => createDefaultOrchestratorDeps(options.onEvent));

  const worker = new Worker(
    options.queueName ?? remakeQueueName,
    async (job: RemakeJobLike) => {
      const deps = createDeps();
      const loaded = await deps.loadJob(job.data.jobId);
      if (!loaded) {
        throw new Error(`Remake job not found: ${job.data.jobId}`);
      }
      const stage = resolveRequestedStage(job.data.stage, loaded.stage);
      await runRemakeStage(job.data.jobId, deps, { stage });
    },
    {
      connection: options.connection,
      concurrency: options.concurrency ?? 1,
    },
  );

  worker.on("failed", (jobValue: unknown, error: unknown) => {
    const data = getJobData(jobValue);
    if (!data) return;
    options.onEvent?.({
      jobId: data.jobId,
      userId: "",
      status: "FAILED",
      stage: data.stage ?? "ingest",
      errorMessage: error instanceof Error ? error.message : "Remake stage failed",
      updatedAt: new Date().toISOString(),
    });
  });

  return worker;
}

function getJobData(job: unknown): RemakeJobData | undefined {
  if (!job || typeof job !== "object") {
    return undefined;
  }
  const data = (job as { data?: RemakeJobData }).data;
  return data?.jobId ? data : undefined;
}

export function resetRemakeQueueForTests(): void {
  queuePromise = null;
  redisConnectionPromise = null;
}
