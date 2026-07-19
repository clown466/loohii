import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRemakeBreakdown,
  computeAnalysisConfidence,
  enrichShotsWithVision,
  splitShotsByDuration,
} from "./analyze";

test("splitShotsByDuration caps shot count", () => {
  const shots = splitShotsByDuration({
    durationMs: 30000,
    windowMs: 3000,
    maxShots: 8,
    transcriptSegments: [{ startMs: 0, endMs: 30000, text: "你好世界" }],
  });
  assert.ok(shots.length <= 8);
  assert.equal(shots[0].hookRole, "hook");
  assert.equal(shots[0].index, 0);
});

test("analysisConfidence is below 0.5 when transcript is empty", () => {
  const confidence = computeAnalysisConfidence({
    transcriptSegments: [],
    shots: splitShotsByDuration({
      durationMs: 15000,
      windowMs: 5000,
      maxShots: 8,
      transcriptSegments: [],
    }),
  });
  assert.ok(confidence < 0.5);
});

test("buildRemakeBreakdown produces low confidence without ASR transcript", async () => {
  const breakdown = await buildRemakeBreakdown({
    durationMs: 15000,
    maxShots: 8,
    transcriptSegments: [],
    keyframeBuffers: [Buffer.from("frame0")],
  });
  assert.ok(breakdown.analysisConfidence < 0.5);
  assert.equal(breakdown.fullTranscript, "");
  assert.ok(breakdown.shots.length >= 1);
  assert.ok(breakdown.shots[0].visualSummary.length > 0);
});

test("enrichShotsWithVision fills visualSummary from placeholder enricher", async () => {
  const shots = splitShotsByDuration({
    durationMs: 10000,
    windowMs: 5000,
    maxShots: 4,
    transcriptSegments: [],
  });
  const enriched = await enrichShotsWithVision(shots, [Buffer.from("kf")]);
  assert.match(enriched[0].visualSummary, /镜头 1/);
});
