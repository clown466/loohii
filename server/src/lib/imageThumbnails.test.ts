import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { generateImageThumbnails, thumbnailPathFor } from "./imageThumbnails";

// Windows: libvips 的文件缓存会持有文件句柄，导致临时目录清理时 EBUSY。
sharp.cache(false);

test("thumbnailPathFor appends suffix without replacing extension", () => {
  assert.equal(thumbnailPathFor("/a/b/c.png", 300), "/a/b/c.png.thumb300.webp");
  assert.equal(thumbnailPathFor("/a/b/c.jpg", 1024), "/a/b/c.jpg.thumb1024.webp");
});

test("generateImageThumbnails creates both webp thumbnails", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "thumbs-"));
  try {
    const src = path.join(dir, "source.png");
    await sharp({ create: { width: 2000, height: 1200, channels: 3, background: { r: 200, g: 100, b: 50 } } })
      .png()
      .toFile(src);
    await generateImageThumbnails(src);
    const t300 = await sharp(thumbnailPathFor(src, 300)).metadata();
    const t1024 = await sharp(thumbnailPathFor(src, 1024)).metadata();
    assert.equal(t300.format, "webp");
    assert.equal(t300.width, 300);
    assert.equal(t1024.format, "webp");
    assert.equal(t1024.width, 1024);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generateImageThumbnails does not enlarge small images", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "thumbs-"));
  try {
    const src = path.join(dir, "small.png");
    await sharp({ create: { width: 200, height: 150, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .png()
      .toFile(src);
    await generateImageThumbnails(src);
    const t300 = await sharp(thumbnailPathFor(src, 300)).metadata();
    assert.equal(t300.width, 200);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generateImageThumbnails skips non-image extensions", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "thumbs-"));
  try {
    const src = path.join(dir, "video.mp4");
    await generateImageThumbnails(src); // 不应抛错、不应产文件
    await assert.rejects(stat(thumbnailPathFor(src, 300)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
