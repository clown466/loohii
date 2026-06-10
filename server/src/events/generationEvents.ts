export type GenerationStatus =
  | "queued"
  | "active"
  | "progress"
  | "completed"
  | "failed";

export interface GenerationQueuedEvent {
  generationId: string;
  projectId?: string;
  userId?: string;
  status: "queued";
  queuedAt: string;
}

export interface GenerationActiveEvent {
  generationId: string;
  projectId?: string;
  userId?: string;
  status: "active";
  startedAt: string;
}

export interface GenerationProgressEvent {
  generationId: string;
  projectId?: string;
  userId?: string;
  status: "progress";
  progress: number;
  message?: string;
  updatedAt: string;
}

export interface GenerationCompletedEvent {
  generationId: string;
  projectId?: string;
  userId?: string;
  status: "completed";
  assetUrl?: string;
  storageKey?: string;
  completedAt: string;
}

export interface GenerationFailedEvent {
  generationId: string;
  projectId?: string;
  userId?: string;
  status: "failed";
  error: string;
  failedAt: string;
}

export type GenerationRealtimeEvent =
  | GenerationQueuedEvent
  | GenerationActiveEvent
  | GenerationProgressEvent
  | GenerationCompletedEvent
  | GenerationFailedEvent;

export const generationEventNames = {
  queued: "generation:queued",
  active: "generation:active",
  progress: "generation:progress",
  completed: "generation:completed",
  failed: "generation:failed",
} as const;

export function generationRoom(generationId: string): string {
  return `generation:${generationId}`;
}

export function projectRoom(projectId: string): string {
  return `project:${projectId}`;
}

export function userRoom(userId: string): string {
  return `user:${userId}`;
}

