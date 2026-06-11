import { createServer } from "node:http";
import { config } from "./config";
import { createHttpApp } from "./http";
import { createRealtimeServer } from "./realtime";

async function main() {
  const app = createHttpApp(config.corsOrigins, config.nodeEnv);
  const httpServer = createServer(app);

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

