import assert from "node:assert/strict";
import test from "node:test";
import { generationListWhere } from "./generations";

test("generation list where filters out CANCELED (soft-deleted) records", () => {
  const where = generationListWhere("user-1");
  assert.equal(where.userId, "user-1");
  assert.deepEqual(where.status, { not: "CANCELED" });
  assert.ok(!("projectId" in where));
});

test("generation list where keeps project scoping alongside CANCELED filter", () => {
  const where = generationListWhere("user-1", "project-9");
  assert.deepEqual(where, {
    userId: "user-1",
    status: { not: "CANCELED" },
    projectId: "project-9",
  });
});
