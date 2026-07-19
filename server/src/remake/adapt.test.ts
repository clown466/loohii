import assert from "node:assert/strict";
import test from "node:test";
import { buildRemakeScriptFromBreakdown } from "./adapt";
import type { RemakeBreakdown } from "./types";

test("buildRemakeScriptFromBreakdown maps shots with localized lines", () => {
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
  const result = buildRemakeScriptFromBreakdown(breakdown, ["Hello"]);
  assert.equal(result.shots.length, 1);
  assert.equal(result.shots[0].dialogue, "Hello");
  assert.ok(result.shots[0].prompt.includes("Shot 1"));
  assert.ok(result.styleLock.length > 0);
});
