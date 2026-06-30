import assert from "node:assert/strict";
import test from "node:test";
import { sceneImageModeInstruction } from "./sceneImageMode";

test("sceneImageModeInstruction returns no extra rule for default single scene images", () => {
  assert.equal(sceneImageModeInstruction(undefined), "");
  assert.equal(sceneImageModeInstruction("single"), "");
});

test("sceneImageModeInstruction adds four-panel same-location rules for quad-grid scenes", () => {
  const instruction = sceneImageModeInstruction("quad-grid");

  assert.match(instruction, /2x2 four-panel multi-camera environment board/i);
  assert.match(instruction, /SAME location/i);
  assert.match(instruction, /four camera angles/i);
  assert.match(instruction, /not a storyboard/i);
  assert.match(instruction, /No characters/i);
});
