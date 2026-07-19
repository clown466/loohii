import type { RemakeShotBreakdown } from "./types";

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
