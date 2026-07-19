import assert from "node:assert/strict";
import test from "node:test";
import { runRemakeStage } from "./orchestrator";
import type { RemakeJobSnapshot, RunRemakeStageDeps } from "./orchestrator";

function baseJob(overrides: Partial<RemakeJobSnapshot> = {}): RemakeJobSnapshot {
  return {
    id: "job1",
    userId: "user1",
    stage: "analyze",
    status: "RUNNING",
    gatesEnabled: { a: true, b: true, c: true },
    ...overrides,
  };
}

function createDeps(
  job: RemakeJobSnapshot,
  overrides: Partial<RunRemakeStageDeps> = {},
): RunRemakeStageDeps {
  let saved = { ...job };
  return {
    loadJob: async () => saved,
    saveJob: async (_jobId, update) => {
      saved = { ...saved, ...update };
      return saved;
    },
    runners: {
      analyze: async () => ({ ok: true }),
    },
    ...overrides,
  };
}

test("stops at gate after analyze when gates.a true", async () => {
  const result = await runRemakeStage("job1", createDeps(baseJob()));
  assert.equal(result.status, "WAITING_GATE");
  assert.equal(result.stage, "analyze");
});

test("low analysis confidence forces WAITING_GATE when gate a disabled", async () => {
  const result = await runRemakeStage(
    "job1",
    createDeps(baseJob({ gatesEnabled: { a: false, b: true, c: true } }), {
      runners: {
        analyze: async () => ({
          ok: true,
          breakdown: {
            language: "unknown",
            fullTranscript: "",
            shots: [],
            charactersDraft: [],
            scenesDraft: [],
            analysisConfidence: 0.3,
          },
        }),
      },
    }),
  );
  assert.equal(result.status, "WAITING_GATE");
  assert.equal(result.stage, "analyze");
});

test("advances to next stage when gate disabled", async () => {
  const enqueued: Array<{ jobId: string; stage: string }> = [];
  const result = await runRemakeStage(
    "job1",
    createDeps(baseJob({ gatesEnabled: { a: false, b: true, c: true } }), {
      enqueueNext: async (jobId, stage) => {
        enqueued.push({ jobId, stage });
      },
    }),
  );
  assert.equal(result.status, "RUNNING");
  assert.equal(result.stage, "adapt");
  assert.deepEqual(enqueued, [{ jobId: "job1", stage: "adapt" }]);
});

test("marks FAILED when runner throws", async () => {
  const result = await runRemakeStage(
    "job1",
    createDeps(baseJob(), {
      runners: {
        analyze: async () => ({ ok: false, error: "ASR failed" }),
      },
    }),
  );
  assert.equal(result.status, "FAILED");
  assert.equal(result.errorMessage, "ASR failed");
});

test("deliver success completes job", async () => {
  const result = await runRemakeStage(
    "job1",
    createDeps(
      baseJob({ stage: "deliver", gatesEnabled: { a: false, b: false, c: false } }),
      {
        runners: {
          deliver: async () => ({ ok: true, progress: { percent: 100, message: "done" } }),
        },
      },
    ),
  );
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.stage, "deliver");
});
