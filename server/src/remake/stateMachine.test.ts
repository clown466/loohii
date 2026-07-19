import assert from "node:assert/strict";
import test from "node:test";
import { gateForStage, nextStageAfterSuccess, shouldPauseForGate } from "./stateMachine";

test("analyze success pauses at gate A when enabled", () => {
  assert.equal(gateForStage("analyze"), "a");
  assert.equal(shouldPauseForGate("analyze", { a: true, b: true, c: true }), true);
  assert.equal(shouldPauseForGate("analyze", { a: false, b: true, c: true }), false);
});

test("pipeline order after gate approve", () => {
  assert.equal(nextStageAfterSuccess("ingest"), "analyze");
  assert.equal(nextStageAfterSuccess("analyze"), "adapt");
  assert.equal(nextStageAfterSuccess("adapt"), "generate");
  assert.equal(nextStageAfterSuccess("generate"), "assemble");
  assert.equal(nextStageAfterSuccess("assemble"), "deliver");
  assert.equal(nextStageAfterSuccess("deliver"), null);
});
