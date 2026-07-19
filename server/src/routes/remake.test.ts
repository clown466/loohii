import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { createApiRouter } from "./index";
import { errorHandler } from "../middleware/errorHandler";
import {
  buildApproveJobUpdate,
  buildCreateJobData,
  buildRejectJobUpdate,
  gateStageSlug,
  normalizeGates,
  prismaStageFromSlug,
  slugFromPrismaStage,
  validateCreateBody,
  type RejectJobUpdate,
} from "./remake";

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", createApiRouter());
  app.use(errorHandler);
  return app;
}

async function request(
  app: express.Express,
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

test("POST /api/remake/jobs without auth returns 401", async () => {
  const app = createTestApp();
  const res = await request(app, "POST", "/api/remake/jobs", {
    body: { sourceUrl: "https://www.tiktok.com/@u/video/7123456789012345678" },
  });
  assert.equal(res.status, 401);
});

test("stage slug converts at API boundary", () => {
  assert.equal(slugFromPrismaStage("INGEST"), "ingest");
  assert.equal(prismaStageFromSlug("adapt"), "ADAPT");
});

test("gate stage mapping", () => {
  assert.equal(gateStageSlug("a"), "analyze");
  assert.equal(gateStageSlug("b"), "adapt");
  assert.equal(gateStageSlug("c"), "assemble");
  assert.equal(gateStageSlug("x"), null);
});

test("normalizeGates defaults all enabled", () => {
  assert.deepEqual(normalizeGates(), { a: true, b: true, c: true });
  assert.deepEqual(normalizeGates({ a: false }), { a: false, b: true, c: true });
});

test("validateCreateBody requires sourceUrl or videoKey", () => {
  assert.throws(() => validateCreateBody({}), /TikTok|videoKey/);
  assert.doesNotThrow(() => validateCreateBody({ sourceUrl: "https://example.com" }));
  assert.doesNotThrow(() => validateCreateBody({ videoKey: "uploads/v.mp4" }));
});

test("buildCreateJobData for upload path", () => {
  const data = buildCreateJobData("user-1", {
    videoKey: "uploads/v.mp4",
    coverKey: "uploads/c.jpg",
    gates: { a: false, b: true, c: true },
  });
  assert.equal(data.userId, "user-1");
  assert.equal(data.stage, "INGEST");
  assert.equal(data.status, "PENDING");
  assert.deepEqual(data.gatesEnabled, { a: false, b: true, c: true });
  assert.ok(data.source?.create);
  assert.equal(data.source.create.videoKey, "uploads/v.mp4");
  assert.equal(data.source.create.coverKey, "uploads/c.jpg");
});

test("buildCreateJobData for TikTok link path", () => {
  const data = buildCreateJobData("user-1", {
    sourceUrl: "https://www.tiktok.com/@u/video/1",
  });
  assert.equal(data.sourceUrl, "https://www.tiktok.com/@u/video/1");
  assert.equal(data.source, undefined);
});

test("approve gate a advances to adapt", () => {
  const update = buildApproveJobUpdate("analyze");
  assert.equal(update.stage, "ADAPT");
  assert.equal(update.status, "RUNNING");
  assert.equal(update.enqueueStage, "adapt");
});

test("reject gate b clears script and re-runs adapt", () => {
  const update: RejectJobUpdate = buildRejectJobUpdate("b");
  assert.equal(update.stage, "ADAPT");
  assert.equal(update.status, "RUNNING");
  assert.equal(update.enqueueStage, "adapt");
  assert.equal(update.remakeScript, null);
  assert.equal(update.breakdown, undefined);
});
