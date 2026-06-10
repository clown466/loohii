import {
  generationEventNames,
  generationRoom,
  projectRoom,
  userRoom,
  type GenerationRealtimeEvent,
} from "../events/index.js";

type DynamicImport = <T = Record<string, unknown>>(specifier: string) => Promise<T>;

const loadModule = new Function(
  "specifier",
  "return import(specifier)",
) as DynamicImport;

export interface RealtimeAuthContext {
  userId?: string;
  projectIds?: string[];
  token?: string;
}

export interface RealtimeSocketLike {
  id: string;
  handshake?: {
    auth?: Record<string, unknown>;
    headers?: Record<string, unknown>;
  };
  data: Record<string, unknown>;
  join(room: string): Promise<void> | void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  emit(event: string, payload?: unknown): void;
}

export interface RealtimeServerLike {
  on(event: string, handler: (...args: unknown[]) => void): void;
  to(room: string): {
    emit(event: string, payload: unknown): void;
  };
  emit(event: string, payload: unknown): void;
}

export interface CreateRealtimeServerOptions {
  corsOrigin?: string | string[];
  path?: string;
  authenticate?: (
    socket: RealtimeSocketLike,
  ) => Promise<RealtimeAuthContext | null> | RealtimeAuthContext | null;
}

export interface RealtimeServerHandle {
  io: RealtimeServerLike;
  emitGenerationEvent(event: GenerationRealtimeEvent): void;
}

export async function createRealtimeServer(
  httpServer: unknown,
  options: CreateRealtimeServerOptions = {},
): Promise<RealtimeServerHandle> {
  const { Server } = await loadModule<{ Server: new (...args: unknown[]) => RealtimeServerLike }>(
    "socket.io",
  );

  const io = new Server(httpServer, {
    cors: { origin: options.corsOrigin ?? "*" },
    path: options.path,
  });

  io.on("connection", (socketValue: unknown) => {
    void handleConnection(socketValue as RealtimeSocketLike, options);
  });

  return {
    io,
    emitGenerationEvent(event) {
      emitGenerationEvent(io, event);
    },
  };
}

async function handleConnection(
  socket: RealtimeSocketLike,
  options: CreateRealtimeServerOptions,
): Promise<void> {
  const authContext = options.authenticate
    ? await options.authenticate(socket)
    : defaultAuthContext(socket);

  if (authContext?.userId) {
    socket.data.userId = authContext.userId;
    await socket.join(userRoom(authContext.userId));
  }

  for (const projectId of authContext?.projectIds ?? []) {
    await socket.join(projectRoom(projectId));
  }

  socket.on("generation:subscribe", (payload: unknown) => {
    void handleGenerationSubscribe(socket, payload);
  });

  socket.emit("realtime:ready", {
    socketId: socket.id,
    userId: authContext?.userId,
  });
}

async function handleGenerationSubscribe(
  socket: RealtimeSocketLike,
  payload: unknown,
): Promise<void> {
  const generationId = getStringField(payload, "generationId");
  if (generationId) {
    await socket.join(generationRoom(generationId));
  }
}

export function emitGenerationEvent(
  io: RealtimeServerLike,
  event: GenerationRealtimeEvent,
): void {
  const eventName = generationEventNames[event.status];

  io.to(generationRoom(event.generationId)).emit(eventName, event);

  if (event.projectId) {
    io.to(projectRoom(event.projectId)).emit(eventName, event);
  }

  if (event.userId) {
    io.to(userRoom(event.userId)).emit(eventName, event);
  }
}

function defaultAuthContext(socket: RealtimeSocketLike): RealtimeAuthContext {
  return {
    token: getStringField(socket.handshake?.auth, "token"),
    userId: getStringField(socket.handshake?.auth, "userId"),
  };
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}
