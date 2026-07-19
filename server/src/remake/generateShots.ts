import {
  callDreaminaWebVideoModel,
  queryDreaminaWebVideoModel,
} from "../ai/dreaminaWebBridge";
import type { RemakeScript } from "./adapt";
import type { RemakeProgress } from "./events";

export interface GenerateShotClipInput {
  prompt: string;
  refImages: string[];
  durationMs: number;
}

export interface GenerateShotClipResult {
  resultUrl: string;
  resultKey?: string;
  submitId?: string;
}

export type ShotClipGenerator = (input: GenerateShotClipInput) => Promise<GenerateShotClipResult>;

export interface ShotRowUpdate {
  status: string;
  prompt?: string;
  durationMs?: number;
  resultUrl?: string | null;
  resultKey?: string | null;
  errorMessage?: string | null;
  retryCount?: number;
}

export interface ExistingShotState {
  status: string;
  retryCount?: number;
}

export interface RunRemakeGenerateInput {
  jobId: string;
  script: RemakeScript;
  refImages: string[];
  generateClip?: ShotClipGenerator;
  existingShots?: Record<number, ExistingShotState>;
  upsertShot: (jobId: string, shotIndex: number, data: ShotRowUpdate) => Promise<void>;
  chargeShot?: (shotIndex: number, retryCount: number) => Promise<void>;
  refundShot?: (shotIndex: number) => Promise<void>;
  concurrency?: number;
}

export interface RunRemakeGenerateResult {
  ok: boolean;
  failedCount: number;
  succeededCount: number;
  progress: RemakeProgress;
  error?: string;
}

const DEFAULT_CONCURRENCY = 2;
const MOCK_VIDEO_FLAG = process.env.REMAKE_MOCK_VIDEO === "1";

export function isRemakeMockVideoEnabled(): boolean {
  return MOCK_VIDEO_FLAG;
}

export async function generateShotClip(
  input: GenerateShotClipInput,
  generator?: ShotClipGenerator,
): Promise<GenerateShotClipResult> {
  if (generator) {
    return generator(input);
  }
  if (MOCK_VIDEO_FLAG) {
    const slug = encodeURIComponent(input.prompt.slice(0, 32));
    return {
      resultUrl: `https://mock.loohii.local/remake/${slug}.mp4`,
      resultKey: `mock/remake/${slug}.mp4`,
    };
  }
  const refImages = input.refImages.filter((url) => /^https?:\/\//i.test(url));
  if (refImages.length === 0) {
    throw new Error("视频生成需要至少 1 张公网参考图");
  }
  const durationSeconds = Math.max(1, Math.min(10, Math.ceil(input.durationMs / 1000)));
  const submit = await callDreaminaWebVideoModel({
    prompt: input.prompt,
    referenceImageUrls: refImages.slice(0, 4),
    durationSeconds,
    ratio: "9:16",
    resolution: "720p",
  });
  if (submit.videoUrl) {
    return {
      resultUrl: submit.videoUrl,
      submitId: submit.submitId,
    };
  }
  if (!submit.submitId) {
    throw new Error("Dreamina 视频提交失败");
  }
  const polled = await queryDreaminaWebVideoModel(submit.submitId, {
    existingVideoUrls: [],
  });
  if (!polled.videoUrl) {
    throw new Error(`Dreamina 视频生成未完成: ${polled.genStatus ?? "unknown"}`);
  }
  return {
    resultUrl: polled.videoUrl,
    submitId: polled.submitId ?? submit.submitId,
  };
}

export async function runRemakeGenerate(input: RunRemakeGenerateInput): Promise<RunRemakeGenerateResult> {
  const { jobId, script, refImages, generateClip, upsertShot, chargeShot, refundShot, existingShots } =
    input;
  const concurrency = Math.max(1, input.concurrency ?? DEFAULT_CONCURRENCY);
  const shots = script.shots;
  let succeededCount = Object.values(existingShots ?? {}).filter(
    (shot) => shot.status === "succeeded",
  ).length;
  let failedCount = 0;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < shots.length) {
      const shot = shots[cursor];
      cursor += 1;
      const shotIndex = shot.index;
      const existing = existingShots?.[shotIndex];
      if (existing?.status === "succeeded") {
        continue;
      }
      const retryCount = existing?.retryCount ?? 0;
      await upsertShot(jobId, shotIndex, {
        status: "running",
        prompt: shot.prompt,
        durationMs: shot.durationMs,
        errorMessage: null,
      });
      try {
        await chargeShot?.(shotIndex, retryCount);
        const clip = await generateShotClip(
          {
            prompt: `${script.styleLock}. ${shot.prompt}`,
            refImages,
            durationMs: shot.durationMs,
          },
          generateClip,
        );
        await upsertShot(jobId, shotIndex, {
          status: "succeeded",
          resultUrl: clip.resultUrl,
          resultKey: clip.resultKey ?? null,
          errorMessage: null,
        });
        succeededCount += 1;
      } catch (error) {
        failedCount += 1;
        await refundShot?.(shotIndex);
        const message = error instanceof Error ? error.message : "镜头生成失败";
        await upsertShot(jobId, shotIndex, {
          status: "failed",
          errorMessage: message,
          retryCount: 1,
        });
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, shots.length) }, () => worker());
  await Promise.all(workers);

  const shotTotal = shots.length;
  const progress: RemakeProgress = {
    percent: shotTotal > 0 ? Math.round((succeededCount / shotTotal) * 100) : 100,
    message:
      failedCount > 0
        ? `生成完成，${failedCount} 个镜头失败`
        : "全部镜头生成完成",
    shotIndex: shotTotal > 0 ? shotTotal - 1 : undefined,
    shotTotal,
  };

  if (failedCount > 0) {
    return {
      ok: false,
      failedCount,
      succeededCount,
      progress,
      error: `${failedCount} 个镜头生成失败，可重试失败镜头`,
    };
  }

  return {
    ok: true,
    failedCount: 0,
    succeededCount,
    progress,
  };
}
