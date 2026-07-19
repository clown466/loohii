export interface RemakeProgress {
  percent?: number;
  message?: string;
  shotIndex?: number;
  shotTotal?: number;
}

export interface RemakeUpdatedEvent {
  jobId: string;
  userId: string;
  status: string;
  stage: string;
  progress?: RemakeProgress | null;
  errorMessage?: string | null;
  updatedAt: string;
}

export const remakeEventNames = {
  updated: "remake:updated",
} as const;

export function remakeRoom(jobId: string): string {
  return `remake:${jobId}`;
}

export function buildRemakeUpdatedEvent(
  job: {
    id: string;
    userId: string;
    status: string;
    stage: string;
    progress?: RemakeProgress | null;
    errorMessage?: string | null;
  },
): RemakeUpdatedEvent {
  return {
    jobId: job.id,
    userId: job.userId,
    status: job.status,
    stage: job.stage,
    progress: job.progress ?? null,
    errorMessage: job.errorMessage ?? null,
    updatedAt: new Date().toISOString(),
  };
}
