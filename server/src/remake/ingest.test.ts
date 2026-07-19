import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createMockIngestProvider,
  ingestFromUrl,
  normalizeTikTokUrl,
  runIngestStage,
} from "./ingest";

test("normalizeTikTokUrl extracts id-ish path", () => {
  const n = normalizeTikTokUrl("https://www.tiktok.com/@u/video/7123456789012345678?lang=en");
  assert.equal(n.externalId, "7123456789012345678");
  assert.ok(n.canonicalUrl.includes("7123456789012345678"));
});

test("ingestFromUrl persists via injected persist fn", async () => {
  const dir = await mkdtemp(join(tmpdir(), "remake-ingest-"));
  try {
    const provider = createMockIngestProvider();
    const payload = await ingestFromUrl(
      "https://www.tiktok.com/@u/video/7123456789012345678",
      provider,
      async (result) => {
        const videoKey = `uploads/remake/job-test/source.mp4`;
        const filePath = join(dir, videoKey);
        await import("node:fs/promises").then(({ mkdir, writeFile }) =>
          mkdir(join(dir, "uploads/remake/job-test"), { recursive: true }).then(() =>
            writeFile(filePath, result.videoBuffer),
          ),
        );
        return { videoKey };
      },
    );
    assert.equal(payload.platform, "tiktok");
    assert.equal(payload.externalId, "7123456789012345678");
    assert.equal(payload.videoKey, "uploads/remake/job-test/source.mp4");
    const bytes = await readFile(join(dir, payload.videoKey));
    assert.ok(bytes.byteLength > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runIngestStage no-ops when videoKey already present", async () => {
  let called = false;
  const result = await runIngestStage({
    jobId: "job1",
    existingVideoKey: "uploads/remake/job1/source.mp4",
    sourceUrl: "https://www.tiktok.com/@u/video/1",
    provider: createMockIngestProvider(),
    saveSource: async () => {
      called = true;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(called, false);
});

test("runIngestStage fetches link and calls saveSource", async () => {
  const dir = await mkdtemp(join(tmpdir(), "remake-ingest-run-"));
  const saved: Array<{ videoKey: string }> = [];
  try {
    const result = await runIngestStage({
      jobId: "job-link",
      sourceUrl: "https://www.tiktok.com/@u/video/7999888777666555444",
      provider: createMockIngestProvider(),
      persist: async (fetchResult) => {
        const videoKey = "uploads/remake/job-link/source.mp4";
        const filePath = join(dir, videoKey);
        const { mkdir, writeFile } = await import("node:fs/promises");
        await mkdir(join(dir, "uploads/remake/job-link"), { recursive: true });
        await writeFile(filePath, fetchResult.videoBuffer);
        return { videoKey };
      },
      saveSource: async (payload) => {
        saved.push({ videoKey: payload.videoKey });
      },
    });
    assert.equal(result.ok, true);
    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.videoKey, "uploads/remake/job-link/source.mp4");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
