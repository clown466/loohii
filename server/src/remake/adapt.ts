import type { RemakeBreakdown } from "./types";

export interface RemakeScript {
  styleLock: string;
  shots: Array<{
    index: number;
    prompt: string;
    durationMs: number;
    dialogue: string;
    refShotId: number;
  }>;
}

export function buildRemakeScriptFromBreakdown(
  breakdown: RemakeBreakdown,
  localizedLines: string[],
): RemakeScript {
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

export type TextModelCaller = (
  messages: Array<{ role: "system" | "user"; content: string }>,
) => Promise<{ rawText: string }>;

export function buildAdaptLocalizationPrompt(breakdown: RemakeBreakdown): string {
  const lines = breakdown.shots.map(
    (shot, i) =>
      `${i + 1}. [${shot.startMs}-${shot.endMs}ms] ${shot.shotType}: ${shot.transcript || "(无对白)"}`,
  );
  return [
    "你是短视频本地化编剧。将下列分镜对白改写为自然的中文口播台词，保持情绪与节奏。",
    "只输出 JSON 数组，每项为字符串，顺序与分镜一致，不要 markdown 代码块。",
    "",
    ...lines,
  ].join("\n");
}

export function parseLocalizedLines(rawText: string, shotCount: number): string[] {
  const trimmed = rawText.trim();
  const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, shotCount)
      .map((line) => (typeof line === "string" ? line.trim() : ""));
  } catch {
    return [];
  }
}

export async function runRemakeAdapt(input: {
  breakdown: RemakeBreakdown;
  callTextModel?: TextModelCaller;
}): Promise<RemakeScript> {
  const { breakdown, callTextModel } = input;
  let localizedLines: string[] = [];

  if (callTextModel) {
    try {
      const result = await callTextModel([
        { role: "system", content: "你是专业的短视频中文本地化编剧。" },
        { role: "user", content: buildAdaptLocalizationPrompt(breakdown) },
      ]);
      localizedLines = parseLocalizedLines(result.rawText, breakdown.shots.length);
    } catch {
      localizedLines = [];
    }
  }

  if (localizedLines.length < breakdown.shots.length) {
    localizedLines = breakdown.shots.map(
      (shot, i) => localizedLines[i]?.trim() || shot.transcript || "",
    );
  }

  return buildRemakeScriptFromBreakdown(breakdown, localizedLines);
}
