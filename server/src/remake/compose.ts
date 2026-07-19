import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { isRemakeMockVideoEnabled } from "./generateShots";

const execFileAsync = promisify(execFile);

const VERTICAL_SCALE_FILTER =
  "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2";

export function buildConcatDemuxerList(paths: string[]): string {
  return paths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
}

export function buildSubtitleBurnFilter(srtPath: string): string {
  const escaped = srtPath.replace(/\\/g, "/").replace(/:/g, "\\:");
  return `subtitles='${escaped}'`;
}

export function buildVideoFilter(srtPath?: string): string {
  if (srtPath) {
    return `${buildSubtitleBurnFilter(srtPath)},${VERTICAL_SCALE_FILTER}`;
  }
  return VERTICAL_SCALE_FILTER;
}

export interface RemakeFinalVideoPaths {
  outputPath: string;
  finalVideoKey: string;
  finalVideoUrl: string;
}

export function buildRemakeFinalVideoPaths(
  jobId: string,
  baseDir = "uploads/remake",
): RemakeFinalVideoPaths {
  const finalVideoKey = join(baseDir, jobId, "final.mp4").replace(/\\/g, "/");
  return {
    outputPath: finalVideoKey,
    finalVideoKey,
    finalVideoUrl: `/local/${finalVideoKey}`,
  };
}

export interface ComposeFinalVideoInput {
  clipPaths: string[];
  srtPath?: string;
  outputPath: string;
}

export async function isFfmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

export async function composeFinalVideo(input: ComposeFinalVideoInput): Promise<void> {
  const { clipPaths, srtPath, outputPath } = input;
  if (clipPaths.length === 0) {
    throw new Error("至少需要一个镜头片段");
  }

  await mkdir(dirname(outputPath), { recursive: true });

  if (isRemakeMockVideoEnabled()) {
    await writeFile(outputPath, Buffer.from("mock-final-mp4"));
    return;
  }

  const tmpDir = await mkdtemp(join(tmpdir(), "remake-compose-"));
  const listFile = join(tmpDir, "concat.txt");

  try {
    await writeFile(listFile, buildConcatDemuxerList(clipPaths), "utf8");

    const args = [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFile,
      "-vf",
      buildVideoFilter(srtPath),
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      outputPath,
    ];

    await execFileAsync("ffmpeg", args);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

export interface AssembleClipRef {
  shotIndex: number;
  resultKey?: string | null;
  resultUrl?: string | null;
}

export function resolveClipLocalPath(clip: AssembleClipRef): string | null {
  if (clip.resultKey && !/^https?:\/\//i.test(clip.resultKey)) {
    return clip.resultKey;
  }
  if (clip.resultUrl?.startsWith("file://")) {
    return clip.resultUrl.slice("file://".length);
  }
  if (clip.resultUrl && !/^https?:\/\//i.test(clip.resultUrl)) {
    return clip.resultUrl;
  }
  return null;
}

export interface RunRemakeAssembleInput {
  jobId: string;
  clips: AssembleClipRef[];
  srtPath?: string;
  baseDir?: string;
  compose?: (input: ComposeFinalVideoInput) => Promise<void>;
}

export interface RunRemakeAssembleResult {
  ok: boolean;
  finalVideoKey?: string;
  finalVideoUrl?: string;
  error?: string;
}

export async function runRemakeAssemble(
  input: RunRemakeAssembleInput,
): Promise<RunRemakeAssembleResult> {
  const sorted = [...input.clips].sort((a, b) => a.shotIndex - b.shotIndex);
  if (sorted.length === 0) {
    return { ok: false, error: "没有可成片的镜头" };
  }

  let clipPaths: string[];
  if (isRemakeMockVideoEnabled()) {
    clipPaths = sorted.map((clip) => `mock-clip-${clip.shotIndex}.mp4`);
  } else {
    clipPaths = [];
    for (const clip of sorted) {
      const localPath = resolveClipLocalPath(clip);
      if (!localPath) {
        return { ok: false, error: `镜头 ${clip.shotIndex + 1} 缺少本地视频文件` };
      }
      if (!existsSync(localPath)) {
        return { ok: false, error: `镜头 ${clip.shotIndex + 1} 视频文件不存在` };
      }
      clipPaths.push(localPath);
    }
  }

  const { outputPath, finalVideoKey, finalVideoUrl } = buildRemakeFinalVideoPaths(
    input.jobId,
    input.baseDir,
  );
  const compose = input.compose ?? composeFinalVideo;

  try {
    await compose({ clipPaths, srtPath: input.srtPath, outputPath });
    return { ok: true, finalVideoKey, finalVideoUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : "成片合成失败";
    return { ok: false, error: message };
  }
}
