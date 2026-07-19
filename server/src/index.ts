import { createServer } from "node:http";
import { config } from "./config";
import { createHttpApp } from "./http";
import { createRealtimeServer } from "./realtime";
import { createRedisConnection, createRemakeWorker } from "./queues/remakeQueue";
import { installVncUpgradeProxy } from "./vncProxy";
import { fetchPlatformMe } from "./lib/aijiekou";
import { startBillingReconciliation } from "./lib/billingReconciliation";
import { resolveLocalUser } from "./lib/shadowUser";

async function main() {
  const app = createHttpApp(config.corsOrigins);
  const httpServer = createServer(app);
  installVncUpgradeProxy(httpServer);

  const realtime = await createRealtimeServer(httpServer, {
    corsOrigin: config.corsOrigins,
    // socket 握手带平台 token 时验真并入 user 房间；不带 token 仍可订阅项目房间（现状兼容）
    authenticate: async (socket) => {
      const token = socket.handshake?.auth?.token;
      if (typeof token !== "string" || !token) return null;
      try {
        const me = await fetchPlatformMe(token);
        if (!me) return null;
        const local = await resolveLocalUser(me, token);
        return { userId: local.id, token };
      } catch {
        return null;
      }
    },
  });

  app.set("realtime", realtime);

  await startRemakeWorkerIfAvailable(realtime);

  httpServer.listen(config.port, () => {
    console.log(`Loohii backend listening on http://localhost:${config.port}`);
  });

  // P3-B：计费对账 sweep（refundPending 兜底退点），进程内定时，unref 不阻塞退出
  startBillingReconciliation();
}

async function startRemakeWorkerIfAvailable(
  realtime: Awaited<ReturnType<typeof createRealtimeServer>>,
): Promise<void> {
  if (!config.redisUrl) {
    console.warn("Remake worker skipped: REDIS_URL not configured");
    return;
  }
  try {
    const connection = await createRedisConnection();
    await createRemakeWorker({
      connection,
      onEvent: (event) => {
        realtime.emitRemakeUpdated(event);
      },
    });
    console.log("Remake worker started");
  } catch (error) {
    console.warn("Remake worker failed to start (continuing without queue):", error);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
