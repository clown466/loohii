import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRemakeScriptFromBreakdown,
  parseLocalizedLines,
  runRemakeAdapt,
} from "./adapt";
import type { RemakeBreakdown } from "./types";

const breakdown: RemakeBreakdown = {
  language: "zh",
  fullTranscript: "你好世界",
  shots: [
    {
      index: 0,
      startMs: 0,
      endMs: 3000,
      transcript: "你好",
      visualSummary: "close-up face",
      shotType: "close",
      subjects: [],
      hookRole: "hook",
      keyframeUrls: [],
    },
  ],
  charactersDraft: [],
  scenesDraft: [],
  analysisConfidence: 0.9,
};

test("buildRemakeScriptFromBreakdown maps shots with localized lines", () => {
  const result = buildRemakeScriptFromBreakdown(breakdown, ["Hello"]);
  assert.equal(result.shots.length, 1);
  assert.equal(result.shots[0].dialogue, "Hello");
  assert.ok(result.shots[0].prompt.includes("Shot 1"));
  assert.ok(result.styleLock.length > 0);
});

test("parseLocalizedLines extracts JSON array", () => {
  const lines = parseLocalizedLines('["你好","世界"]', 2);
  assert.deepEqual(lines, ["你好", "世界"]);
});

test("runRemakeAdapt falls back to transcript when text model unavailable", async () => {
  const script = await runRemakeAdapt({
    breakdown,
    callTextModel: async () => {
      throw new Error("no api key");
    },
  });
  assert.equal(script.shots[0].dialogue, "你好");
});
