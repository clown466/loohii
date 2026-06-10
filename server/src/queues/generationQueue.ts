import type { ImageGenerationInput, ImageGenerationResult } from "../ai/index.js";
import type { GenerationRealtimeEvent } from "../events/index.js";

type DynamicImport = <T = Record<string, unknown>>(specifier: string) => Promise<T>;

const loadModule = new Function(
  "specifier",
  "return import(specifier)",
) as DynamicImport;

export const generationQueueName = "generation";

export interface GenerationJobData extends ImageGenerationInput {
  generationId: string;
}

export interface GenerationJobResult extends ImageGenerationResult {
  storageKey?: string;
  assetUrl?: string;
}

export interface GenerationQueueOptions {
  connection: unknown;
  queueName?: string;
  defaultJobOptions?: Record<string, unknown>;
}

export interface GenerationWorkerOptions extends GenerationQueueOptions {
  concurrency?: number;
  processor: (job: GenerationJobLike) => Promise<GenerationJobResult>;
  onEvent?: (event: GenerationRealtimeEvent) => void;
}

export interface GenerationJobLike {
  id?: string;
  name: string;
  data: GenerationJobData;
  updateProgress(progress: number | object): Promise<void>;
}

export interface QueueLike {
  add(
    name: string,
    data: GenerationJobData,
    options?: Record<string, unknown>,
  ): Promise<GenerationJobLike>;
}

export interface WorkerLike {
  on(event: string, handler: (...args: unknown[]) => void): WorkerLike;
  close(): Promise<void>;
}

export async function createGenerationQueue(
  options: GenerationQueueOptions,
): Promise<QueueLike> {
  const { Queue } = await loadModule<{ Queue: new (...args: unknown[]) => QueueLike }>(
    "bullmq",
  );

  return new Queue(options.queueName ?? generationQueueName, {
    connection: options.connection,
    defaultJobOptions: options.defaultJobOptions ?? {
      attempts: 2,
      removeOnComplete: true,
      removeOnFail: false,
    },
  });
}

export async function enqueueGeneration(
  queue: QueueLike,
  data: GenerationJobData,
  options: Record<string, unknown> = {},
): Promise<GenerationJobLike> {
  return queue.add("generate-image", data, {
    jobId: data.generationId,
    ...options,
  });
}

export async function createGenerationWorker(
  options: GenerationWorkerOptions,
): Promise<WorkerLike> {
  const { Worker } = await loadModule<{ Worker: new (...args: unknown[]) => WorkerLike }>(
    "bullmq",
  );

  const worker = new Worker(
    options.queueName ?? generationQueueName,
    async (job: GenerationJobLike) => {
      options.onEvent?.({
        generationId: job.data.generationId,
        projectId: job.data.projectId,
        userId: job.data.userId,
        status: "active",
        startedAt: new Date().toISOString(),
      });

      const result = await options.processor(job);

      options.onEvent?.({
        generationId: job.data.generationId,
        projectId: job.data.projectId,
        userId: job.data.userId,
        status: "completed",
        assetUrl: result.assetUrl,
        storageKey: result.storageKey,
        completedAt: new Date().toISOString(),
      });

      return result;
    },
    {
      connection: options.connection,
      concurrency: options.concurrency ?? 1,
    },
  );

  worker.on("failed", (job: unknown, error: unknown) => {
    const data = getJobData(job);
    if (!data) {
      return;
    }

    options.onEvent?.({
      generationId: data.generationId,
      projectId: data.projectId,
      userId: data.userId,
      status: "failed",
      error: error instanceof Error ? error.message : "Generation failed",
      failedAt: new Date().toISOString(),
    });
  });

  return worker;
}

function getJobData(job: unknown): GenerationJobData | undefined {
  if (!job || typeof job !== "object") {
    return undefined;
  }

  const data = (job as { data?: GenerationJobData }).data;
  return data?.generationId ? data : undefined;
}
