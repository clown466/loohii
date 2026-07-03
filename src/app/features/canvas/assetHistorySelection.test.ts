import assert from "node:assert/strict";
import test from "node:test";
import { orderedReusableAssetHistoryImages } from "./assetHistorySelection";
import type { WorkflowAssetImageHistoryItem } from "@/lib/api/types";

const image = (id: string, isCurrent = false): WorkflowAssetImageHistoryItem => ({
  id,
  url: `/api/uploads/${id}.png`,
  isCurrent,
});

test("orderedReusableAssetHistoryImages prefers non-current history images for bulk reuse", () => {
  const ordered = orderedReusableAssetHistoryImages("props", [
    image("current-wrong-binding", true),
    image("older-valid-history"),
  ], (value) => String(value || ""));

  assert.deepEqual(ordered.map((item) => item.id), [
    "older-valid-history",
    "current-wrong-binding",
  ]);
});

test("orderedReusableAssetHistoryImages still keeps current image as fallback", () => {
  const ordered = orderedReusableAssetHistoryImages("props", [
    image("current-only", true),
  ], (value) => String(value || ""));

  assert.deepEqual(ordered.map((item) => item.id), ["current-only"]);
});
