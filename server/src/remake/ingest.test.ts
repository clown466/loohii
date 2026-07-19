import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTikTokUrl, createMockIngestProvider } from "./ingest";

test("normalizeTikTokUrl extracts id-ish path", () => {
  const n = normalizeTikTokUrl("https://www.tiktok.com/@u/video/7123456789012345678?lang=en");
  assert.equal(n.externalId, "7123456789012345678");
  assert.ok(n.canonicalUrl.includes("7123456789012345678"));
});

test("mock provider returns video bytes meta", async () => {
  const p = createMockIngestProvider();
  const r = await p.fetch("https://www.tiktok.com/@u/video/7123456789012345678");
  assert.equal(r.platform, "tiktok");
  assert.ok(r.videoBuffer.byteLength > 0);
  assert.ok(r.durationMs > 0);
});
