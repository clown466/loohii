import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

function getRealtimeSocket(): Socket {
  if (!socket) {
    // 同源连接；path 用 socket.io 默认 /socket.io（服务端未自定义 path）。
    // websocket 优先，nginx 未配 upgrade 时自动回退 long-polling。
    socket = io({ transports: ["websocket", "polling"] });
  }
  return socket;
}

/** 订阅某项目的生成更新；返回取消函数。断线重连后自动重新入房。 */
export function subscribeProjectGenerationUpdates(
  projectId: string,
  onUpdate: (payload: { projectId?: string; generationId?: string; status?: string }) => void,
): () => void {
  const s = getRealtimeSocket();
  const subscribe = () => s.emit("project:subscribe", { projectId });
  const handler = (payload: unknown) => {
    const p = payload as { projectId?: string };
    if (p?.projectId === projectId) onUpdate(p);
  };
  subscribe();
  s.on("connect", subscribe);
  s.on("generation:updated", handler);
  return () => {
    s.off("connect", subscribe);
    s.off("generation:updated", handler);
  };
}
