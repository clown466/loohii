import assert from "node:assert/strict";
import test from "node:test";
import { generationRecordsFingerprint } from "./generationRecordsFingerprint";

test("same records produce same fingerprint", () => {
  const a = [{ id: "r1", updatedAt: "2026-07-05T00:00:00Z", status: "succeeded" }];
  const b = [{ id: "r1", updatedAt: "2026-07-05T00:00:00Z", status: "succeeded" }];
  assert.equal(generationRecordsFingerprint(a), generationRecordsFingerprint(b));
});

test("changed updatedAt changes fingerprint", () => {
  const a = [{ id: "r1", updatedAt: "2026-07-05T00:00:00Z", status: "running" }];
  const b = [{ id: "r1", updatedAt: "2026-07-05T00:01:00Z", status: "running" }];
  assert.notEqual(generationRecordsFingerprint(a), generationRecordsFingerprint(b));
});

test("changed status changes fingerprint", () => {
  const a = [{ id: "r1", updatedAt: "2026-07-05T00:00:00Z", status: "running" }];
  const b = [{ id: "r1", updatedAt: "2026-07-05T00:00:00Z", status: "succeeded" }];
  assert.notEqual(generationRecordsFingerprint(a), generationRecordsFingerprint(b));
});

test("different order changes fingerprint (order matters for rendering)", () => {
  const r1 = { id: "r1", updatedAt: "t", status: "s" };
  const r2 = { id: "r2", updatedAt: "t", status: "s" };
  assert.notEqual(generationRecordsFingerprint([r1, r2]), generationRecordsFingerprint([r2, r1]));
});

test("missing fields are tolerated", () => {
  assert.equal(typeof generationRecordsFingerprint([{}]), "string");
  assert.equal(generationRecordsFingerprint([]), "");
});
