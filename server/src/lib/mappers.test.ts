import assert from "node:assert/strict";
import test from "node:test";
import { mapUser, mapProject, avatarFor, isRecord } from "./mappers";

test("mapUser uses displayName when available", () => {
  const result = mapUser({
    id: "u1",
    email: "alice@example.com",
    displayName: "Alice",
    avatarUrl: "https://example.com/alice.png",
    creditBalance: 500,
  });

  assert.equal(result.id, "u1");
  assert.equal(result.name, "Alice");
  assert.equal(result.email, "alice@example.com");
  assert.equal(result.avatar, "https://example.com/alice.png");
  assert.equal(result.credits, 500);
});

test("mapUser falls back to email prefix when displayName is null", () => {
  const result = mapUser({
    id: "u2",
    email: "bob@example.com",
    displayName: null,
    avatarUrl: null,
    creditBalance: 0,
  });

  assert.equal(result.name, "bob");
  assert.match(result.avatar, /dicebear/);
  assert.match(result.avatar, /bob%40example\.com/);
});

test("mapProject returns default values for missing settings", () => {
  const result = mapProject({
    id: "p1",
    name: "Test Project",
    aspectRatio: "16:9",
    description: null,
    settings: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
  });

  assert.equal(result.id, "p1");
  assert.equal(result.title, "Test Project");
  assert.equal(result.ratio, "16:9");
  assert.equal(result.style, "动漫风");
  assert.match(result.cover, /unsplash/);
  assert.equal(result.description, undefined);
  assert.equal(result.globalPrompt, undefined);
  assert.equal(result.negativePrompt, undefined);
  assert.equal(result.setupSettings, undefined);
  assert.equal(result.scenes, 0);
  assert.equal(result.completedScenes, 0);
  assert.equal(result.createdAt, "2025-01-01T00:00:00.000Z");
});

test("mapProject extracts settings from valid record", () => {
  const result = mapProject({
    id: "p2",
    name: "Styled",
    aspectRatio: "9:16",
    description: "A test",
    settings: {
      style: "赛博朋克",
      cover: "https://example.com/cover.jpg",
      globalPrompt: "cinematic style",
      negativePrompt: "no blur",
      setupSettings: { resolution: "4k" },
      completedScenes: 3,
    },
    createdAt: new Date("2025-06-01T12:00:00Z"),
    coverAsset: { url: "https://example.com/asset-cover.jpg" },
    _count: { scenes: 5 },
  });

  assert.equal(result.style, "赛博朋克");
  assert.equal(result.cover, "https://example.com/asset-cover.jpg");
  assert.equal(result.description, "A test");
  assert.equal(result.globalPrompt, "cinematic style");
  assert.equal(result.negativePrompt, "no blur");
  assert.deepEqual(result.setupSettings, { resolution: "4k" });
  assert.equal(result.scenes, 5);
  assert.equal(result.completedScenes, 3);
});

test("mapProject coverAsset takes priority over settings.cover", () => {
  const result = mapProject({
    id: "p3",
    name: "Cover Test",
    aspectRatio: "1:1",
    description: null,
    settings: { cover: "https://settings-cover.com/img.jpg" },
    createdAt: new Date("2025-01-01"),
    coverAsset: { url: "https://asset-cover.com/img.jpg" },
  });

  assert.equal(result.cover, "https://asset-cover.com/img.jpg");
});

test("avatarFor generates dicebear URL", () => {
  const url = avatarFor("test-seed");
  assert.match(url, /dicebear/);
  assert.match(url, /test-seed/);
});

test("avatarFor encodes special characters", () => {
  const url = avatarFor("hello world@test");
  assert.match(url, /hello%20world%40test/);
});

test("isRecord returns true for plain objects", () => {
  assert.equal(isRecord({}), true);
  assert.equal(isRecord({ a: 1 }), true);
});

test("isRecord returns false for non-objects", () => {
  assert.equal(isRecord(null), false);
  assert.equal(isRecord(undefined), false);
  assert.equal(isRecord("string"), false);
  assert.equal(isRecord(42), false);
  assert.equal(isRecord([1, 2]), false);
  assert.equal(isRecord(true), false);
});
