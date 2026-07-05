import type { Application } from "express";
import { projectRoom, userRoom } from "./index.js";

export interface GenerationUpdatedPayload {
  projectId?: string | null;
  userId?: string | null;
  generationId?: string;
  status?: string;
}

interface RealtimeLike {
  io: { to(room: string): { emit(event: string, payload: unknown): void } };
}

export function notifyGenerationUpdated(app: Application, payload: GenerationUpdatedPayload): void {
  try {
    const realtime = app.get("realtime") as RealtimeLike | undefined;
    if (!realtime?.io) return;
    const body = {
      projectId: payload.projectId ?? undefined,
      generationId: payload.generationId,
      status: payload.status,
    };
    if (payload.projectId) realtime.io.to(projectRoom(payload.projectId)).emit("generation:updated", body);
    if (payload.userId) realtime.io.to(userRoom(payload.userId)).emit("generation:updated", body);
  } catch {
    // 实时通知失败绝不阻塞主流程
  }
}
