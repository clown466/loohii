import assert from "node:assert/strict";
import test from "node:test";
import { runRemakeGenerate } from "./generateShots";
import type { RemakeScript } from "./adapt";

const script: RemakeScript = {
  styleLock: "test style",
  shots: [
    { index: 0, prompt: "shot 0", durationMs: 3000, dialogue: "line 0", refShotId: 0 },
    { index: 1, prompt: "shot 1", durationMs: 3000, dialogue: "line 1", refShotId: 1 },
  ],
};

test("runRemakeGenerate increments retryCount on shot failure", async () => {
  const updates: Array<{ shotIndex: number; status: string; retryCount: number }> = [];
  const result = await runRemakeGenerate({
    jobId: "job1",
    script,
    refImages: [],
    generateClip: async ({ prompt }) => {
      if (prompt.includes("shot 1")) throw new Error("model failed");
      return { resultUrl: "https://mock/0.mp4" };
    },
    upsertShot: async (_jobId, shotIndex, data) => {
      updates.push({ shotIndex, status: data.status, retryCount: data.retryCount ?? 0 });
    },
    concurrency: 2,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failedCount, 1);
  const failed = updates.find((u) => u.shotIndex === 1 && u.status === "failed");
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.retryCount, 1);
});

test("runRemakeGenerate succeeds when all shots complete", async () => {
  const result = await runRemakeGenerate({
    jobId: "job2",
    script,
    refImages: [],
    generateClip: async ({ prompt }) => ({ resultUrl: `https://mock/${prompt}.mp4` }),
    upsertShot: async () => {},
    concurrency: 2,
  });

  assert.equal(result.ok, true);
  assert.equal(result.failedCount, 0);
  assert.equal(result.succeededCount, 2);
});
