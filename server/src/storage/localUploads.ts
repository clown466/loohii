import path from "node:path";

export const LOCAL_UPLOAD_ROOT = process.env.LOCAL_UPLOAD_ROOT || "/var/lib/loohii/uploads";

export function buildRemakeAssetKey(
  jobId: string,
  filename: string,
  baseDir = "uploads/remake",
): string {
  return `${baseDir}/${jobId}/${filename}`.replace(/\\/g, "/");
}

export function resolveLocalUploadPath(relativeKey: string): string {
  const cleaned = relativeKey.replace(/\\/g, "/");
  const filePath = path.join(LOCAL_UPLOAD_ROOT, cleaned);
  const rootPath = path.resolve(LOCAL_UPLOAD_ROOT);
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(`${rootPath}${path.sep}`) && resolvedPath !== rootPath) {
    throw new Error("Invalid upload key");
  }
  return resolvedPath;
}

export function buildPublicUploadUrl(relativeKey: string): string {
  const encoded = relativeKey
    .replace(/\\/g, "/")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return `/api/uploads/public/${encoded}`;
}
