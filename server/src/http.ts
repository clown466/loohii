import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { createApiRouter } from "./routes";
import { errorHandler } from "./middleware/errorHandler";
import { installVncHttpProxy } from "./vncProxy";

export function createHttpApp(corsOrigins: string[]) {
  const app = express();

  installVncHttpProxy(app);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        connectSrc: ["'self'", "http:", "https:", "ws:", "wss:"],
        imgSrc: ["'self'", "data:", "blob:", "http:", "https:"],
        mediaSrc: ["'self'", "data:", "blob:", "http:", "https:"],
        upgradeInsecureRequests: null,
      },
    },
  }));
  app.use(
    cors({
      origin: (origin, callback) => {
        if (isAllowedCorsOrigin(origin, corsOrigins)) {
          callback(null, true);
          return;
        }
        callback(new Error(`CORS blocked origin: ${origin}`));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "10mb" }));
  app.use(morgan("dev"));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "loohii-backend", time: new Date().toISOString() });
  });
  app.use("/api", createApiRouter());

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const staticDir = path.resolve(__dirname, "../../dist");
  app.use(express.static(staticDir));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) return next();
    res.sendFile(path.join(staticDir, "index.html"));
  });

  app.use(errorHandler);

  return app;
}

function isAllowedCorsOrigin(origin: string | undefined, corsOrigins: string[]): boolean {
  if (!origin) return true;
  if (corsOrigins.includes("*") || corsOrigins.includes(origin)) return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return ["localhost", "127.0.0.1", "loohii-app"].includes(url.hostname);
  } catch {
    return false;
  }
}
