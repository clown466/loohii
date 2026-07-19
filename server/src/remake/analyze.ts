import type { TranscriptSegment } from "./asr";
import { transcribeAudio } from "./asr";
import type { RemakeBreakdown, RemakeShotBreakdown } from "./types";

const DEFAULT_WINDOW_MS = 5000;
const LOW_CONFIDENCE_THRESHOLD = 0.5;

export function splitShotsByDuration(input: {
  durationMs: number;
  windowMs: number;
  maxShots: number;
  transcriptSegments: Array<{ startMs: number; endMs: number; text: string }>;
}): RemakeShotBreakdown[] {
  const windowMs = Math.max(1000, input.windowMs);
  const rawCount = Math.ceil(input.durationMs / windowMs);
  const count = Math.min(Math.max(rawCount, 1), input.maxShots);
  const slice = Math.ceil(input.durationMs / count);
  const shots: RemakeShotBreakdown[] = [];
  for (let i = 0; i < count; i++) {
    const startMs = i * slice;
    const endMs = Math.min(input.durationMs, (i + 1) * slice);
    const transcript = input.transcriptSegments
      .filter((s) => s.startMs < endMs && s.endMs > startMs)
      .map((s) => s.text)
      .join(" ")
      .trim();
    shots.push({
      index: i,
      startMs,
      endMs,
      transcript,
      visualSummary: "",
      shotType: "medium",
      subjects: [],
      hookRole: i === 0 ? "hook" : i === count - 1 ? "cta" : "build",
      keyframeUrls: [],
    });
  }
  return shots;
}

export function computeAnalysisConfidence(input: {
  transcriptSegments: Array<{ text: string }>;
  shots: RemakeShotBreakdown[];
}): number {
  const fullTranscript = input.transcriptSegments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!fullTranscript) {
    return 0.3;
  }
  const coveredShots = input.shots.filter((shot) => shot.transcript.trim().length > 0).length;
  const coverage = input.shots.length > 0 ? coveredShots / input.shots.length : 0;
  return Math.min(0.95, 0.55 + coverage * 0.4);
}

export type VisionEnricher = (
  shot: RemakeShotBreakdown,
  keyframe?: Buffer,
) => Promise<string>;

function placeholderVisionEnricher(shot: RemakeShotBreakdown): Promise<string> {
  return Promise.resolve(
    `镜头 ${shot.index + 1}（${shot.startMs}-${shot.endMs}ms）画面待确认`,
  );
}

export async function enrichShotsWithVision(
  shots: RemakeShotBreakdown[],
  keyframeBuffers: Buffer[],
  enricher: VisionEnricher = placeholderVisionEnricher,
): Promise<RemakeShotBreakdown[]> {
  return Promise.all(
    shots.map(async (shot) => ({
      ...shot,
      visualSummary: await enricher(shot, keyframeBuffers[shot.index]),
    })),
  );
}

export function shouldForceAnalyzeGate(breakdown: RemakeBreakdown): boolean {
  return breakdown.analysisConfidence < LOW_CONFIDENCE_THRESHOLD;
}

export async function buildRemakeBreakdown(input: {
  durationMs: number;
  maxShots: number;
  windowMs?: number;
  transcriptSegments?: TranscriptSegment[];
  keyframeBuffers?: Buffer[];
  visionEnricher?: VisionEnricher;
}): Promise<RemakeBreakdown> {
  const transcriptSegments = input.transcriptSegments ?? [];
  const shots = splitShotsByDuration({
    durationMs: input.durationMs,
    windowMs: input.windowMs ?? DEFAULT_WINDOW_MS,
    maxShots: input.maxShots,
    transcriptSegments,
  });
  const enrichedShots = await enrichShotsWithVision(
    shots,
    input.keyframeBuffers ?? [],
    input.visionEnricher,
  );
  const fullTranscript = transcriptSegments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  return {
    language: fullTranscript ? "auto" : "unknown",
    fullTranscript,
    shots: enrichedShots,
    charactersDraft: [],
    scenesDraft: [],
    analysisConfidence: computeAnalysisConfidence({
      transcriptSegments,
      shots: enrichedShots,
    }),
  };
}

export async function runRemakeAnalyze(input: {
  videoPath: string;
  durationMs: number;
  maxShots: number;
  windowMs?: number;
  visionEnricher?: VisionEnricher;
}): Promise<RemakeBreakdown> {
  const transcriptSegments = await transcribeAudio(input.videoPath);
  return buildRemakeBreakdown({
    durationMs: input.durationMs,
    maxShots: input.maxShots,
    windowMs: input.windowMs,
    transcriptSegments,
    keyframeBuffers: [Buffer.from(`keyframe:${input.videoPath}`)],
    visionEnricher: input.visionEnricher,
  });
}
