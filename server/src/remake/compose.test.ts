import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  buildConcatDemuxerList,
  buildRemakeFinalVideoPaths,
  buildSubtitleBurnFilter,
  composeFinalVideo,
  isFfmpegAvailable,
  runRemakeAssemble,
} from "./compose";

const execFileAsync = promisify(execFile);

test("buildConcatDemuxerList escapes single quotes", () => {
  const list = buildConcatDemuxerList(["/tmp/a's.mp4", "/tmp/b.mp4"]);
  assert.ok(list.includes("a'\\''s.mp4"));
  assert.ok(list.includes("file '/tmp/b.mp4'"));
});

test("buildSubtitleBurnFilter escapes windows paths", () => {
  const filter = buildSubtitleBurnFilter("C:\\sub\\title.srt");
  assert.ok(filter.includes("subtitles="));
  assert.ok(filter.includes("C\\:/sub/title.srt"));
});

test("buildRemakeFinalVideoPaths uses job-scoped local storage", () => {
  const paths = buildRemakeFinalVideoPaths("job-abc");
  assert.equal(paths.finalVideoKey, "uploads/remake/job-abc/final.mp4");
  assert.ok(paths.outputPath.replace(/\\/g, "/").endsWith("uploads/remake/job-abc/final.mp4"));
  assert.equal(paths.finalVideoUrl, "/api/uploads/public/uploads/remake/job-abc/final.mp4");
});

test("runRemakeAssemble writes stub output in mock mode", async () => {
  const prev = process.env.REMAKE_MOCK_VIDEO;
  process.env.REMAKE_MOCK_VIDEO = "1";
  const baseDir = await mkdtemp(join(tmpdir(), "remake-assemble-mock-"));
  try {
    const result = await runRemakeAssemble({
      jobId: "job-mock",
      clips: [{ shotIndex: 0, resultUrl: "https://mock/0.mp4" }],
      baseDir,
    });
    assert.equal(result.ok, true);
    assert.ok(result.finalVideoKey?.endsWith("final.mp4"));
    assert.ok(result.finalVideoUrl?.includes("job-mock"));
    assert.ok(existsSync(join(baseDir, "job-mock", "final.mp4")));
  } finally {
    if (prev === undefined) delete process.env.REMAKE_MOCK_VIDEO;
    else process.env.REMAKE_MOCK_VIDEO = prev;
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("runRemakeAssemble fails when no clips", async () => {
  const result = await runRemakeAssemble({ jobId: "job-empty", clips: [] });
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /没有可成片的镜头/);
});

test("composeFinalVideo concat clips when ffmpeg available", async (t) => {
  if (!(await isFfmpegAvailable())) {
    t.skip("ffmpeg not installed");
    return;
  }

  const workDir = await mkdtemp(join(tmpdir(), "remake-compose-int-"));
  const clipA = join(workDir, "a.mp4");
  const clipB = join(workDir, "b.mp4");
  const outputPath = join(workDir, "final.mp4");

  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=108x192:d=0.3",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      clipA,
    ]);
    await execFileAsync("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=108x192:d=0.3",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      clipB,
    ]);

    await composeFinalVideo({ clipPaths: [clipA, clipB], outputPath });

    assert.ok(existsSync(outputPath));
    const buf = await readFile(outputPath);
    assert.ok(buf.length > 100);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});
