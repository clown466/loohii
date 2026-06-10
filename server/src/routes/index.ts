import { Router } from "express";
import { config } from "../config";
import { prisma } from "../lib/prisma";
import { agentRouter } from "./agent";
import { authRouter } from "./auth";
import { billingRouter } from "./billing";
import { canvasRouter } from "./canvas";
import { charactersRouter } from "./characters";
import { generationsRouter } from "./generations";
import { modelsRouter } from "./models";
import { projectsRouter } from "./projects";
import { scenesRouter } from "./scenes";
import { uploadsRouter } from "./uploads";
import { workflowsRouter } from "./workflows";

export function createApiRouter() {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "loohii-api",
      databaseConfigured: Boolean(config.databaseUrl),
      time: new Date().toISOString(),
    });
  });

  router.get("/health/ready", async (_req, res) => {
    if (!config.databaseUrl) {
      res.status(503).json({
        ok: false,
        message: "DATABASE_URL is not configured.",
      });
      return;
    }

    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true });
    } catch (error) {
      res.status(503).json({
        ok: false,
        message: error instanceof Error ? error.message : "Database is not ready.",
      });
    }
  });
  router.use("/auth", authRouter);
  router.use("/projects", projectsRouter);
  router.use("/canvas", canvasRouter);
  router.use("/agent", agentRouter);
  router.use("/generations", generationsRouter);
  router.use("/generation-records", generationsRouter);
  router.use("/models", modelsRouter);
  router.use("/model-configs", modelsRouter);
  router.use("/billing", billingRouter);
  router.use("/uploads", uploadsRouter);
  router.use("/workflows", workflowsRouter);
  router.use(scenesRouter);
  router.use(charactersRouter);

  return router;
}
