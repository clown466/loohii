import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildRemakeAssetKey,
  LOCAL_UPLOAD_ROOT,
} from "../storage/localUploads";

export interface IngestFetchResult {
  platform: "tiktok";
  externalId: string;
  sourceUrl: string;
  videoBuffer: Buffer;
  coverBuffer?: Buffer;
  durationMs: number;
  width?: number;
  height?: number;
  rawMeta?: Record<string, unknown>;
}

export interface IngestProvider {
  fetch(url: string): Promise<IngestFetchResult>;
}

export interface IngestSourcePayload {
  platform: "tiktok" | "upload";
  externalId?: string;
  sourceUrl?: string;
  videoKey: string;
  coverKey?: string;
  durationMs?: number;
  width?: number;
  height?: number;
  rawMeta?: Record<string, unknown>;
}

export function normalizeTikTokUrl(input: string): { canonicalUrl: string; externalId: string } {
  const u = new URL(input);
  const m = u.pathname.match(/\/video\/(\d+)/);
  if (!m) throw new Error("无法解析 TikTok 视频 ID，请检查链接或改用上传");
  return {
    externalId: m[1],
    canonicalUrl: `https://www.tiktok.com${u.pathname.split("?")[0]}`,
  };
}

/** Phase 0：默认可切换的 mock；真实供应商实现同接口后注入 env。 */
export function createMockIngestProvider(): IngestProvider {
  return {
    async fetch(url: string) {
      const { canonicalUrl, externalId } = normalizeTikTokUrl(url);
      const videoBuffer = Buffer.from("mock-mp4");
      return {
        platform: "tiktok",
        externalId,
        sourceUrl: canonicalUrl,
        videoBuffer,
        durationMs: 15000,
        width: 1080,
        height: 1920,
        rawMeta: { mock: true },
      };
    },
  };
}

export function createHttpIngestProvider(opts: {
  endpoint: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): IngestProvider {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    async fetch(url: string) {
      const { canonicalUrl, externalId } = normalizeTikTokUrl(url);
      const res = await fetchImpl(opts.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({ url: canonicalUrl }),
      });
      if (!res.ok) throw new Error(`解析服务失败: HTTP ${res.status}`);
      const data = (await res.json()) as {
        downloadUrl: string;
        coverUrl?: string;
        durationMs?: number;
        width?: number;
        height?: number;
      };
      const videoRes = await fetchImpl(data.downloadUrl);
      if (!videoRes.ok) throw new Error("下载解析后的视频失败");
      const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
      return {
        platform: "tiktok",
        externalId,
        sourceUrl: canonicalUrl,
        videoBuffer,
        durationMs: data.durationMs ?? 0,
        width: data.width,
        height: data.height,
        rawMeta: data as unknown as Record<string, unknown>,
      };
    },
  };
}

/** 上传路径：客户端 presign 完成后传入 videoKey。 */
export function ingestFromUpload(params: {
  videoKey: string;
  coverKey?: string;
  durationMs?: number;
  width?: number;
  height?: number;
}): IngestSourcePayload {
  const videoKey = params.videoKey?.trim();
  if (!videoKey) throw new Error("缺少 videoKey，请先上传视频");
  return {
    platform: "upload",
    videoKey,
    coverKey: params.coverKey,
    durationMs: params.durationMs,
    width: params.width,
    height: params.height,
  };
}

export interface IngestPersistResult {
  videoKey: string;
  coverKey?: string;
}

export type IngestPersistFn = (result: IngestFetchResult) => Promise<IngestPersistResult>;

export function createDefaultIngestProvider(): IngestProvider {
  const apiUrl = process.env.REMAKE_INGEST_API_URL?.trim();
  const apiKey = process.env.REMAKE_INGEST_API_KEY?.trim();
  if (apiUrl && apiKey) {
    return createHttpIngestProvider({ endpoint: apiUrl, apiKey });
  }
  return createMockIngestProvider();
}

export function createDefaultIngestPersist(jobId: string, uploadRoot = LOCAL_UPLOAD_ROOT): IngestPersistFn {
  return async (result) => {
    const videoKey = buildRemakeAssetKey(jobId, "source.mp4");
    const videoPath = path.join(uploadRoot, videoKey);
    await mkdir(path.dirname(videoPath), { recursive: true });
    await writeFile(videoPath, result.videoBuffer);
    let coverKey: string | undefined;
    if (result.coverBuffer) {
      coverKey = buildRemakeAssetKey(jobId, "cover.jpg");
      await writeFile(path.join(uploadRoot, coverKey), result.coverBuffer);
    }
    return { videoKey, coverKey };
  };
}

export interface RunIngestStageInput {
  jobId: string;
  sourceUrl?: string | null;
  existingVideoKey?: string | null;
  provider?: IngestProvider;
  persist?: IngestPersistFn;
  saveSource?: (payload: IngestSourcePayload) => Promise<void>;
}

export async function runIngestStage(
  input: RunIngestStageInput,
): Promise<{ ok: boolean; error?: string }> {
  if (input.existingVideoKey) {
    return { ok: true };
  }
  if (!input.sourceUrl) {
    return { ok: false, error: "缺少 TikTok 链接或上传视频" };
  }
  try {
    const provider = input.provider ?? createDefaultIngestProvider();
    const persist = input.persist ?? createDefaultIngestPersist(input.jobId);
    const payload = await ingestFromUrl(input.sourceUrl, provider, persist);
    await input.saveSource?.(payload);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "素材拉取失败";
    return { ok: false, error: message };
  }
}

/** 链接路径：通过可插拔 provider 拉取并持久化视频。 */
export async function ingestFromUrl(
  url: string,
  provider: IngestProvider,
  persist: (result: IngestFetchResult) => Promise<{ videoKey: string; coverKey?: string }>,
): Promise<IngestSourcePayload> {
  const fetched = await provider.fetch(url);
  const stored = await persist(fetched);
  return {
    platform: "tiktok",
    externalId: fetched.externalId,
    sourceUrl: fetched.sourceUrl,
    videoKey: stored.videoKey,
    coverKey: stored.coverKey,
    durationMs: fetched.durationMs,
    width: fetched.width,
    height: fetched.height,
    rawMeta: fetched.rawMeta,
  };
}
