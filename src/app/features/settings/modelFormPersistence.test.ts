import assert from "node:assert/strict";
import test from "node:test";
import { findRemovedModelConfigIds } from "./modelFormPersistence";

test("findRemovedModelConfigIds returns persisted model ids removed from the edit form", () => {
  const removed = findRemovedModelConfigIds(
    [
      { configId: "db-sonnet", model: "claude-sonnet-4-6", modality: "text" },
      { configId: "db-flash", model: "deepseek-4-flash", modality: "text" },
      { configId: "db-falbe", model: "claude-falbe-5(1m)", modality: "text" },
    ],
    [
      { configId: "db-flash", model: "deepseek-4-flash", modality: "text" },
      { model: "new-model", modality: "text" },
    ],
  );

  assert.deepEqual(removed, ["db-sonnet", "db-falbe"]);
});

test("findRemovedModelConfigIds does not disable models that remain by model name and modality", () => {
  const removed = findRemovedModelConfigIds(
    [{ configId: "db-sonnet", model: "claude-sonnet-4-6", modality: "text" }],
    [{ model: "claude-sonnet-4-6", modality: "text" }],
  );

  assert.deepEqual(removed, []);
});
