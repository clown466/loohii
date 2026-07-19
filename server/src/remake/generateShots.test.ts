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

test("runRemakeGenerate skips succeeded shots on retry", async () => {
  const processed: number[] = [];
  const result = await runRemakeGenerate({
    jobId: "job3",
    script,
    refImages: [],
    existingShots: {
      0: { status: "succeeded", retryCount: 0 },
      1: { status: "pending", retryCount: 2 },
    },
    generateClip: async () => ({ resultUrl: "https://mock/1.mp4" }),
    upsertShot: async (_jobId, shotIndex, data) => {
      if (data.status === "running") processed.push(shotIndex);
    },
    concurrency: 2,
  });

  assert.deepEqual(processed, [1]);
  assert.equal(result.ok, true);
  assert.equal(result.failedCount, 0);
  assert.equal(result.succeededCount, 2);
});

test("runRemakeGenerate passes retryCount to chargeShot for billing rotation", async () => {
  const charges: Array<{ shotIndex: number; retryCount: number }> = [];
  await runRemakeGenerate({
    jobId: "job4",
    script,
    refImages: [],
    existingShots: {
      0: { status: "succeeded", retryCount: 0 },
      1: { status: "pending", retryCount: 2 },
    },
    generateClip: async () => ({ resultUrl: "https://mock/1.mp4" }),
    upsertShot: async () => {},
    chargeShot: async (shotIndex, retryCount) => {
      charges.push({ shotIndex, retryCount });
    },
    concurrency: 2,
  });

  assert.deepEqual(charges, [{ shotIndex: 1, retryCount: 2 }]);
});
