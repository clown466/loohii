import { prisma } from "../server/src/lib/prisma";
import { workflowMaintenanceInternals } from "../server/src/routes/workflows";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";

type AssetKind = "props";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeCompareText(value: unknown): string {
  return stringValue(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    output.push(trimmed);
  }
  return output;
}

function assetName(item: Record<string, unknown>): string {
  return stringValue(item.name) || stringValue(item.title);
}

function assetAliases(item: Record<string, unknown>): string[] {
  return uniqueStrings([
    assetName(item),
    stringValue(item.title),
    ...arrayValue(item.aliases).map(stringValue),
  ]).filter(Boolean);
}

function propCanonicalSignature(value: string): string {
  const text = normalizeCompareText(value).replace(/[-_]+/g, " ");
  if (!text) return "";
  const hasPanWord = /\b(pan|skillet)\b/.test(text);
  const isIronPan = hasPanWord && (
    /\bcast\s+iron\b/.test(text) ||
    /\biron\s+(?:frying\s+)?pan\b/.test(text) ||
    /\biron\s+skillet\b/.test(text) ||
    /^skillet$/.test(text)
  );
  return isIronPan ? "prop:iron-pan" : "";
}

function assetSignature(kind: AssetKind, item: Record<string, unknown>): string {
  if (kind !== "props") return "";
  for (const alias of assetAliases(item)) {
    const signature = propCanonicalSignature(alias);
    if (signature) return signature;
  }
  return "";
}

function hasImage(item: Record<string, unknown>): boolean {
  return Boolean(
    stringValue(item.referenceImageUrl) ||
      stringValue(item.generatedImageUrl) ||
      stringValue(item.referenceImageAssetId) ||
      stringValue(item.generatedImageAssetId),
  );
}

function mergeDescription(a: unknown, b: unknown): string {
  const first = stringValue(a);
  const second = stringValue(b);
  if (!first) return second;
  if (!second) return first;
  const firstKey = normalizeCompareText(first);
  const secondKey = normalizeCompareText(second);
  if (firstKey.includes(secondKey)) return first;
  if (secondKey.includes(firstKey)) return second;
  return `${first}; ${second}`.slice(0, 360);
}

function mergeIntoCanonical(canonical: Record<string, unknown>, duplicate: Record<string, unknown>): Record<string, unknown> {
  const imageSource = hasImage(canonical) ? canonical : duplicate;
  const merged: Record<string, unknown> = {
    ...duplicate,
    ...canonical,
    name: assetName(canonical) || assetName(duplicate),
    title: stringValue(canonical.title) || assetName(canonical) || assetName(duplicate),
    description: mergeDescription(canonical.description, duplicate.description),
    aliases: uniqueStrings([
      ...assetAliases(canonical),
      ...assetAliases(duplicate),
      assetName(duplicate),
    ].filter((item) => normalizeCompareText(item) !== normalizeCompareText(assetName(canonical)))),
  };

  for (const key of [
    "referenceImageUrl",
    "referenceImageAssetId",
    "generatedImageUrl",
    "generatedImageAssetId",
    "visualAuthority",
    "referenceAnalysisStatus",
    "imageAnalysis",
    "generatedImagePrompt",
    "generatedImageRevisedPrompt",
    "generatedImageAt",
    "generationId",
    "imageGenerationModel",
  ]) {
    if (imageSource[key] !== undefined && imageSource[key] !== null && imageSource[key] !== "") merged[key] = imageSource[key];
  }

  return merged;
}

const project = await prisma.project.findUnique({
  where: { id: projectId },
  select: { id: true, metadata: true },
});

if (!project) {
  console.error(`Project not found: ${projectId}`);
  process.exit(1);
}

const metadata = isRecord(project.metadata) ? project.metadata : {};
const episodes = Object.entries(isRecord(metadata.episodes) ? metadata.episodes : {})
  .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
  .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }));

const canonicalBySignature = new Map<string, Record<string, unknown>>();
let changedEpisodes = 0;
let mergedProps = 0;
let nextMetadata = metadata;

for (const [episodeId, episode] of episodes) {
  const workflow = workflowMaintenanceInternals.getWorkflowState(nextMetadata, episodeId);
  const assets = isRecord(workflow.assets) ? workflow.assets : {};
  const props = arrayValue(assets.props).filter(isRecord);
  let changed = false;

  const nextProps = props.map((prop) => {
    const signature = assetSignature("props", prop);
    if (!signature) return prop;
    const canonical = canonicalBySignature.get(signature);
    if (!canonical) {
      canonicalBySignature.set(signature, prop);
      return prop;
    }
    const merged = mergeIntoCanonical(canonical, prop);
    canonicalBySignature.set(signature, merged);
    if (JSON.stringify(merged) !== JSON.stringify(prop)) {
      mergedProps += 1;
      changed = true;
      return merged;
    }
    return merged;
  });

  if (changed) {
    const nextWorkflow = {
      ...workflow,
      assets: {
        ...assets,
        props: nextProps,
      },
      updatedAt: new Date().toISOString(),
    };
    nextMetadata = workflowMaintenanceInternals.writeWorkflowEpisode(nextMetadata, episodeId, nextWorkflow, false);
    changedEpisodes += 1;
  }
}

if (changedEpisodes > 0) {
  await prisma.project.update({
    where: { id: projectId },
    data: { metadata: nextMetadata },
  });
}

console.log(JSON.stringify({
  projectId,
  changedEpisodes,
  mergedProps,
}, null, 2));

await prisma.$disconnect();
