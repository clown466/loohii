import type { RemakeGates, RemakeStageSlug } from "./types";

const NEXT: Record<RemakeStageSlug, RemakeStageSlug | null> = {
  ingest: "analyze",
  analyze: "adapt",
  adapt: "generate",
  generate: "assemble",
  assemble: "deliver",
  deliver: null,
};

const GATE: Partial<Record<RemakeStageSlug, keyof RemakeGates>> = {
  analyze: "a",
  adapt: "b",
  assemble: "c",
};

export function nextStageAfterSuccess(stage: RemakeStageSlug): RemakeStageSlug | null {
  return NEXT[stage];
}

export function gateForStage(stage: RemakeStageSlug): keyof RemakeGates | null {
  return GATE[stage] ?? null;
}

export function shouldPauseForGate(stage: RemakeStageSlug, gates: RemakeGates): boolean {
  const g = gateForStage(stage);
  return g ? gates[g] === true : false;
}
