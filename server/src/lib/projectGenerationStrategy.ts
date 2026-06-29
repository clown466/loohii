import { isRecord } from "./mappers";

const SEEDANCE_MULTI_REFERENCE_STRATEGY = "seedance-multi-ref";

export function metadataWithProjectSettings(metadata: unknown, settings: unknown): Record<string, unknown> {
  const meta = isRecord(metadata) ? metadata : {};
  const projectSettings = isRecord(settings) ? settings : {};
  const metadataSetup = isRecord(meta.setupSettings) ? meta.setupSettings : {};
  const settingsSetup = isRecord(projectSettings.setupSettings) ? projectSettings.setupSettings : {};
  return {
    ...meta,
    ...(typeof projectSettings.globalPrompt === "string" && !meta.globalPrompt ? { globalPrompt: projectSettings.globalPrompt } : {}),
    setupSettings: {
      ...metadataSetup,
      ...settingsSetup,
    },
  };
}

export function projectGenerationStrategyFromMetadata(metadata: unknown): string {
  const record = isRecord(metadata) ? metadata : {};
  const setupSettings = isRecord(record.setupSettings) ? record.setupSettings : {};
  return stringValue(setupSettings.generationStrategy) || projectGenerationStrategyFromPrompt(record.globalPrompt);
}

export function isSeedanceMultiReferenceStrategy(value: unknown): boolean {
  const normalized = stringValue(value).trim();
  return normalized === SEEDANCE_MULTI_REFERENCE_STRATEGY || normalized === "Seedance 多参";
}

function projectGenerationStrategyFromPrompt(value: unknown): string {
  const stored = firstPromptLine(value, "Default generation strategy:");
  if (stored === SEEDANCE_MULTI_REFERENCE_STRATEGY || stored === "Seedance 多参") return SEEDANCE_MULTI_REFERENCE_STRATEGY;
  if (stored === "chapter-board" || stored === "章节导演板") return "chapter-board";
  return stored;
}

function firstPromptLine(value: unknown, label: string): string {
  const line = stringValue(value).split("\n").find((item) => item.trim().startsWith(label));
  return line?.slice(label.length).trim() || "";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
