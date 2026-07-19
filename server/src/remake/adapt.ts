import type { RemakeBreakdown } from "./types";

export function buildRemakeScriptFromBreakdown(
  breakdown: RemakeBreakdown,
  localizedLines: string[],
): {
  styleLock: string;
  shots: Array<{
    index: number;
    prompt: string;
    durationMs: number;
    dialogue: string;
    refShotId: number;
  }>;
} {
  return {
    styleLock: "cinematic vertical short drama, consistent characters, soft key light",
    shots: breakdown.shots.map((s, i) => ({
      index: s.index,
      durationMs: s.endMs - s.startMs,
      dialogue: localizedLines[i] ?? s.transcript,
      refShotId: s.index,
      prompt: [
        `Shot ${s.index + 1}, ${s.shotType}`,
        s.visualSummary || "follow source blocking",
        `Action and emotion matching: ${localizedLines[i] ?? s.transcript}`,
      ].join(". "),
    })),
  };
}
