import { createServer } from "node:http";
import { config } from "./config";
import { createHttpApp } from "./http";
import { createRealtimeServer } from "./realtime";
import { installVncUpgradeProxy } from "./vncProxy";

async function main() {
  const app = createHttpApp(config.corsOrigins);
  const httpServer = createServer(app);
  installVncUpgradeProxy(httpServer);

  const realtime = await createRealtimeServer(httpServer, {
    corsOrigin: config.corsOrigins,
  });

  app.set("realtime", realtime);

  httpServer.listen(config.port, () => {
    console.log(`Loohii backend listening on http://localhost:${config.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
