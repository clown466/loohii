import assert from "node:assert/strict";
import test from "node:test";
import { shouldFitViewAfterCanvasLoad } from "./canvasUtils";

test("shouldFitViewAfterCanvasLoad fits when a blank canvas receives remote nodes", () => {
  assert.equal(shouldFitViewAfterCanvasLoad(0, 213), true);
});

test("shouldFitViewAfterCanvasLoad does not refit existing visible canvases", () => {
  assert.equal(shouldFitViewAfterCanvasLoad(12, 213), false);
  assert.equal(shouldFitViewAfterCanvasLoad(0, 0), false);
});
