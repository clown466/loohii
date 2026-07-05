import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  generateImageThumbnails,
  isThumbnailableImagePath,
  thumbnailPathFor,
  THUMBNAIL_WIDTHS,
} from "../server/src/lib/imageThumbnails";

const ROOT = process.env.LOCAL_UPLOAD_ROOT || "/var/lib/loohii/uploads";

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

async function needsThumbnails(filePath: string): Promise<boolean> {
  for (const width of THUMBNAIL_WIDTHS) {
    try {
      await stat(thumbnailPathFor(filePath, width));
    } catch {
      return true;
    }
  }
  return false;
}

async function main() {
  let done = 0;
  let skipped = 0;
  let failed = 0;
  for await (const file of walk(ROOT)) {
    if (!isThumbnailableImagePath(file)) continue;
    if (!(await needsThumbnails(file))) {
      skipped += 1;
      continue;
    }
    try {
      await generateImageThumbnails(file);
      done += 1;
      if (done % 100 === 0) console.log(`progress: ${done} generated`);
    } catch (error) {
      failed += 1;
      console.warn(`failed: ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`backfill complete: generated=${done} skipped=${skipped} failed=${failed}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
