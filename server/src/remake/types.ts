export const REMAKE_STAGES = [
  "ingest", "analyze", "adapt", "generate", "assemble", "deliver",
] as const;

export type RemakeStageSlug = (typeof REMAKE_STAGES)[number];

export function isRemakeStage(value: string): value is RemakeStageSlug {
  return (REMAKE_STAGES as readonly string[]).includes(value);
}

export interface RemakeGates {
  a: boolean;
  b: boolean;
  c: boolean;
}

export interface RemakeShotBreakdown {
  index: number;
  startMs: number;
  endMs: number;
  transcript: string;
  visualSummary: string;
  shotType: string;
  subjects: string[];
  hookRole: "hook" | "build" | "payoff" | "cta" | "other";
  keyframeUrls: string[];
}

export interface RemakeBreakdown {
  language: string;
  fullTranscript: string;
  shots: RemakeShotBreakdown[];
  charactersDraft: string[];
  scenesDraft: string[];
  analysisConfidence: number;
}
