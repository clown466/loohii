import express, { Router } from "express";
import type { Request, Response } from "express";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { config } from "../config";
import { asyncRoute } from "../lib/asyncRoute";
import { badRequest, notFound } from "../lib/httpErrors";
import { generateImageThumbnails, logThumbnailError } from "../lib/imageThumbnails";
import { ok } from "../lib/response";
import { requireAuth } from "../middleware/auth";
import { createR2PresignService } from "../storage";

const router = Router();
const LOCAL_UPLOAD_ROOT = process.env.LOCAL_UPLOAD_ROOT || "/var/lib/loohii/uploads";

const presignSchema = z.object({
  key: z.string().min(1).max(512),
  contentType: z.string().min(1).max(120),
});

const localImageSchema = z.object({
  key: z.string().min(1).max(512),
  imageDataUrl: z.string().min(32).max(9_000_000),
  contentType: z.string().min(1).max(120).optional(),
});

const localFileQuerySchema = z.object({
  key: z.string().min(1).max(512),
});

const LOCAL_FILE_UPLOAD_LIMIT_BYTES = 60 * 1024 * 1024;
const DOWNLOAD_IMAGE_TIMEOUT_MS = 60_000;
const DOWNLOAD_IMAGE_RETRY_COUNT = 3;

const downloadImageSchema = z.object({
  url: z.string().url().max(4000),
  filename: z.string().min(1).max(160).optional(),
});

router.get(
  /^\/public\/(.+)$/,
  asyncRoute(async (req, res) => {
    const relativeKey = safeRelativeKey(String(req.params[0] ?? ""));
    const filePath = path.join(LOCAL_UPLOAD_ROOT, relativeKey);
    const rootPath = path.resolve(LOCAL_UPLOAD_ROOT);
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(`${rootPath}${path.sep}`)) {
      notFound("Upload not found");
    }

    let file: Buffer;
    try {
      const contentType = contentTypeFromFilename(resolvedPath);
      if (contentType.startsWith("video/") || contentType.startsWith("audio/")) {
        await sendLocalMediaFile(req, res, resolvedPath, contentType);
        return;
      }
      file = await readFile(resolvedPath);
    } catch {
      notFound("Upload not found");
    }

    res.setHeader("Content-Type", contentTypeFromFilename(resolvedPath));
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(file);
  }),
);

async function sendLocalMediaFile(req: Request, res: Response, filePath: string, contentType: string) {
  const info = await stat(filePath);
  const size = info.size;
  const range = req.headers.range;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Accept-Ranges", "bytes");
  if (!range) {
    res.setHeader("Content-Length", size);
    res.sendFile(filePath);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.status(416).setHeader("Content-Range", `bytes */${size}`).end();
    return;
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    res.status(416).setHeader("Content-Range", `bytes */${size}`).end();
    return;
  }

  const clampedEnd = Math.min(end, size - 1);
  res.status(206);
  res.setHeader("Content-Range", `bytes ${start}-${clampedEnd}/${size}`);
  res.setHeader("Content-Length", clampedEnd - start + 1);
  createReadStream(filePath, { start, end: clampedEnd }).pipe(res);
}

router.post(
  "/presign",
  requireAuth,
  asyncRoute(async (req, res) => {
    const input = presignSchema.parse(req.body);
    if (!config.r2.accountId || !config.r2.accessKeyId || !config.r2.secretAccessKey || !config.r2.bucket) {
      badRequest("R2 storage is not configured");
    }

    const service = createR2PresignService({
      accountId: config.r2.accountId,
      accessKeyId: config.r2.accessKeyId,
      secretAccessKey: config.r2.secretAccessKey,
      bucket: config.r2.bucket,
      publicBaseUrl: config.r2.publicBaseUrl,
    });

    const result = await service.presignPutObject({
      key: `${req.user!.id}/${input.key.replace(/^\/+/, "")}`,
      contentType: input.contentType,
    });
    ok(res, result);
  }),
);

router.post(
  "/local-image",
  requireAuth,
  asyncRoute(async (req, res) => {
    const input = localImageSchema.parse(req.body);
    const parsed = parseImageDataUrl(input.imageDataUrl);
    const contentType = normalizeImageContentType(input.contentType || parsed.contentType);
    const relativeKey = safeRelativeKey(`${req.user!.id}/${input.key}`);
    const finalKey = ensureImageExtension(relativeKey, contentType);
    const filePath = path.join(LOCAL_UPLOAD_ROOT, finalKey);
    const rootPath = path.resolve(LOCAL_UPLOAD_ROOT);
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(`${rootPath}${path.sep}`)) {
      badRequest("Invalid upload key");
    }

    await mkdir(path.dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, parsed.buffer);
    void generateImageThumbnails(resolvedPath).catch((err) => logThumbnailError(resolvedPath, err));

    ok(res, {
      key: finalKey,
      publicUrl: publicUploadUrl(req, finalKey),
      contentType,
      sizeBytes: parsed.buffer.length,
    });
  }),
);

router.post(
  "/local-file",
  requireAuth,
  express.raw({ type: ["image/*", "audio/*", "application/octet-stream"], limit: "60mb" }),
  asyncRoute(async (req, res) => {
    const input = localFileQuerySchema.parse(req.query);
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (buffer.length === 0) badRequest("Empty file data");
    if (buffer.length > LOCAL_FILE_UPLOAD_LIMIT_BYTES) badRequest("文件超过 60MB，本地公开上传暂不支持。");

    const requestContentType = String(req.get("content-type") || "").split(";")[0]?.trim().toLowerCase();
    const contentType = normalizeLocalFileContentType(requestContentType || contentTypeFromFilename(input.key));
    const relativeKey = safeRelativeKey(`${req.user!.id}/${input.key}`);
    const finalKey = ensureLocalFileExtension(relativeKey, contentType);
    const filePath = path.join(LOCAL_UPLOAD_ROOT, finalKey);
    const rootPath = path.resolve(LOCAL_UPLOAD_ROOT);
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(`${rootPath}${path.sep}`)) {
      badRequest("Invalid upload key");
    }

    await mkdir(path.dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, buffer);
    void generateImageThumbnails(resolvedPath).catch((err) => logThumbnailError(resolvedPath, err));

    ok(res, {
      key: finalKey,
      publicUrl: publicUploadUrl(req, finalKey),
      contentType,
      sizeBytes: buffer.length,
    });
  }),
);

router.post(
  "/download-image",
  requireAuth,
  asyncRoute(async (req, res) => {
    const input = downloadImageSchema.parse(req.body);
    const url = new URL(input.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      badRequest("Only http(s) images can be downloaded");
    }

    let upstream: globalThis.Response;
    try {
      upstream = await fetchDownloadImage(url);
    } catch (error) {
      console.warn(`[image-download] ${url.hostname} fetch failed: ${error instanceof Error ? error.message : String(error)}`);
      badRequest("图片下载失败，源图片暂时不可访问。");
    }

    if (!upstream.ok) {
      badRequest(`图片下载失败，源站返回 ${upstream.status}`);
    }

    const contentType = upstream.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "image/png";
    if (!contentType.startsWith("image/") && contentType !== "application/octet-stream") {
      badRequest("源地址不是图片文件。");
    }

    const contentLength = Number(upstream.headers.get("content-length") || 0);
    if (contentLength > 60 * 1024 * 1024) {
      badRequest("图片超过 60MB，无法下载。");
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length === 0) badRequest("图片内容为空。");
    if (buffer.length > 60 * 1024 * 1024) badRequest("图片超过 60MB，无法下载。");

    const requestedFilename = safeDownloadFilename(input.filename || path.basename(url.pathname) || "image");
    const effectiveContentType = contentType === "application/octet-stream" ? contentTypeFromFilename(requestedFilename) : contentType;
    const filename = ensureImageExtension(requestedFilename, effectiveContentType);
    res.setHeader("Content-Type", effectiveContentType);
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Cache-Control", "private, max-age=0, no-store");
    res.setHeader("Content-Disposition", contentDispositionAttachment(filename));
    res.send(buffer);
  }),
);

export const uploadsRouter = router;

function parseImageDataUrl(value: string): { contentType: string; buffer: Buffer } {
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!match) badRequest("Invalid image data URL");
  const contentType = normalizeImageContentType(match[1]);
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (buffer.length === 0) badRequest("Empty image data");
  if (buffer.length > 6_500_000) badRequest("图片超过 6MB，本地公开上传暂不支持。");
  return { contentType, buffer };
}

function normalizeImageContentType(value: string): string {
  const contentType = value.toLowerCase();
  if (["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"].includes(contentType)) {
    return contentType === "image/jpg" ? "image/jpeg" : contentType;
  }
  badRequest("Unsupported image content type");
}

function normalizeLocalFileContentType(value: string): string {
  const contentType = value.toLowerCase();
  if (contentType.startsWith("image/")) return normalizeImageContentType(contentType);
  if (["audio/mpeg", "audio/mp3"].includes(contentType)) return "audio/mpeg";
  if (["audio/wav", "audio/x-wav", "audio/wave"].includes(contentType)) return "audio/wav";
  if (["audio/mp4", "audio/x-m4a"].includes(contentType)) return "audio/mp4";
  if (contentType === "audio/aac") return "audio/aac";
  if (contentType === "audio/ogg") return "audio/ogg";
  if (contentType === "audio/webm") return "audio/webm";
  if (contentType === "audio/flac") return "audio/flac";
  badRequest("Unsupported file content type");
}

function safeRelativeKey(value: string): string {
  const cleaned = value
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join("/");
  if (!cleaned || cleaned.includes("..")) badRequest("Invalid upload key");
  return cleaned.slice(0, 700);
}

function ensureImageExtension(key: string, contentType: string): string {
  if (/\.(png|jpe?g|webp|gif)$/i.test(key)) return key;
  const extension = contentType === "image/jpeg" ? "jpg" : contentType.replace("image/", "");
  return `${key}.${extension}`;
}

function ensureLocalFileExtension(key: string, contentType: string): string {
  if (contentType.startsWith("image/")) return ensureImageExtension(key, contentType);
  if (/\.(mp3|wav|m4a|aac|ogg|opus|webm|flac)$/i.test(key)) return key;
  if (contentType === "audio/mpeg") return `${key}.mp3`;
  if (contentType === "audio/wav") return `${key}.wav`;
  if (contentType === "audio/mp4") return `${key}.m4a`;
  if (contentType === "audio/aac") return `${key}.aac`;
  if (contentType === "audio/ogg") return `${key}.ogg`;
  if (contentType === "audio/webm") return `${key}.webm`;
  if (contentType === "audio/flac") return `${key}.flac`;
  return key;
}

function contentTypeFromFilename(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".mp4") return "video/mp4";
  if (extension === ".mov") return "video/quicktime";
  if (extension === ".webm") return "video/webm";
  if (extension === ".mp3") return "audio/mpeg";
  if (extension === ".wav") return "audio/wav";
  if (extension === ".m4a") return "audio/mp4";
  if (extension === ".aac") return "audio/aac";
  if (extension === ".ogg" || extension === ".opus") return "audio/ogg";
  if (extension === ".flac") return "audio/flac";
  return "image/png";
}

function publicUploadUrl(req: Request, key: string): string {
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = req.get("x-forwarded-host")?.split(",")[0]?.trim() || req.get("host");
  if (!host) badRequest("Missing request host");
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) {
    return `https://loohii.com/api/uploads/public/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
  const proto = forwardedProto || (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host) ? req.protocol : "https");
  return `${proto}://${host}/api/uploads/public/${key.split("/").map(encodeURIComponent).join("/")}`;
}

async function fetchDownloadImage(url: URL): Promise<globalThis.Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= DOWNLOAD_IMAGE_RETRY_COUNT; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_IMAGE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: imageDownloadHeaders(),
      });

      if (response.ok || !shouldRetryImageDownloadStatus(response.status) || attempt === DOWNLOAD_IMAGE_RETRY_COUNT) {
        return response;
      }

      if (response.body) {
        await response.body.cancel().catch(() => undefined);
      }
    } catch (error) {
      lastError = error;
      if (attempt === DOWNLOAD_IMAGE_RETRY_COUNT) throw error;
    } finally {
      clearTimeout(timeout);
    }

    await delay(500 * attempt);
  }

  throw lastError instanceof Error ? lastError : new Error("Image download failed");
}

function imageDownloadHeaders(): HeadersInit {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36 Loohii/1.0",
    Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    Referer: "https://loohii.com/",
  };
}

function shouldRetryImageDownloadStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeDownloadFilename(value: string): string {
  const filename = path.basename(value)
    .replace(/[/\\]/g, "-")
    .replace(/[\r\n"<>:|?*\x00-\x1f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return (filename || "image").slice(0, 160);
}

function contentDispositionAttachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]+/g, "_").replace(/["\\]/g, "_") || "image.png";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
