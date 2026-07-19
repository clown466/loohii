import assert from "node:assert/strict";
import test from "node:test";
import { splitShotsByDuration } from "./analyze";

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
