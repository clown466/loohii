import assert from "node:assert/strict";
import test from "node:test";
import { canvasNodePromptText as utilsCanvasNodePromptText } from "./canvasUtils";

const readers = [
  ["canvasUtils", utilsCanvasNodePromptText],
] as const;

for (const [name, canvasNodePromptText] of readers) {
  test(`${name} prefers videoPrompt over stale seedancePrompt for video nodes`, () => {
    const prompt = canvasNodePromptText({
      type: "video",
      data: {
        prompt: "fallback prompt",
        seedancePrompt: "old seedance prompt",
        videoPrompt: "current video prompt",
      },
    });

    assert.equal(prompt, "current video prompt");
  });

  test(`${name} uses generic prompt before legacy seedancePrompt for video nodes`, () => {
    const prompt = canvasNodePromptText({
      type: "video",
      data: {
        prompt: "fallback prompt",
        seedancePrompt: "legacy seedance prompt",
      },
    });

    assert.equal(prompt, "fallback prompt");
  });

  test(`${name} keeps legacy seedancePrompt fallback for old video nodes`, () => {
    const prompt = canvasNodePromptText({
      type: "video",
      data: {
        seedancePrompt: "legacy seedance prompt",
      },
    });

    assert.equal(prompt, "legacy seedance prompt");
  });
}
