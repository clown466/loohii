import path from "node:path";
import sharp from "sharp";

export const THUMBNAIL_WIDTHS = [300, 1024] as const;
export type ThumbnailWidth = (typeof THUMBNAIL_WIDTHS)[number];

const IMAGE_EXTENSION_RE = /\.(png|jpe?g|webp|gif)$/i;

export function thumbnailPathFor(filePath: string, width: ThumbnailWidth): string {
  return `${filePath}.thumb${width}.webp`;
}

export function isThumbnailableImagePath(filePath: string): boolean {
  return IMAGE_EXTENSION_RE.test(filePath) && !/\.thumb(300|1024)\.webp$/i.test(filePath);
}

export async function generateImageThumbnails(filePath: string): Promise<void> {
  if (!isThumbnailableImagePath(filePath)) return;
  for (const width of THUMBNAIL_WIDTHS) {
    await sharp(filePath, { animated: false })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(thumbnailPathFor(filePath, width));
  }
}

export function logThumbnailError(filePath: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[thumbnails] failed for ${path.basename(filePath)}: ${message}`);
}
