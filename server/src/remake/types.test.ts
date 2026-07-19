import assert from "node:assert/strict";
import test from "node:test";
import { isRemakeStage, REMAKE_STAGES } from "./types";

test("REMAKE_STAGES order matches pipeline", () => {
  assert.deepEqual([...REMAKE_STAGES], [
    "ingest", "analyze", "adapt", "generate", "assemble", "deliver",
  ]);
});

test("isRemakeStage rejects unknown", () => {
  assert.equal(isRemakeStage("ingest"), true);
  assert.equal(isRemakeStage("nope"), false);
});
