import { prisma } from "../server/src/lib/prisma";
import { buildEpisodeCanvasSyncScene, writeEpisodeCanvasSyncMetadata } from "../server/src/lib/episodeCanvasSync";
import { workflowMaintenanceInternals } from "../server/src/routes/workflows";
import { metadataWithProjectSettings, projectGenerationStrategyFromMetadata } from "../server/src/lib/projectGenerationStrategy";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = process.argv[3] || "episode-012";

const LIVING_VINE_CANONICAL_ID = "scene-1-living-vine-hospital-bed";
const LIVING_VINE_LOCK = [
  "Scene visual authority: Living Vine Hospital Bed.",
  "Maintain: Interior ritual chamber; sickly green ritual light with dim clinical highlights; green vine glow, bone white, damp dark plant fibers, translucent tubing; botanical ritual treatment chamber; living vines, root restraints, tendrils, bone needle, clear plastic tubing, damp organic bed frame.",
  "Fixed landmarks: living vine hospital bed, root restraints, bone needle, clear plastic tubing, tendril canopy.",
  "Do not change the time of day, palette, building type, materials, or fixed landmarks unless the source explicitly moves to a different canonical scene.",
  "Continuity lock: Keep the same canonical scene identity for Living Vine Hospital Bed: Interior ritual chamber, green vine glow, bone white, damp dark plant fibers, translucent tubing, botanical ritual treatment chamber, living vines, root restraints, tendrils, bone needle, clear plastic tubing, damp organic bed frame. It must not become a different warehouse, night setting, palette, or unrelated building.",
].join(" ");

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value: unknown): string {
  return stringValue(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function isLivingVineSetting(value: unknown): boolean {
  return /living vine hospital bed|vine hospital bed|living vine bed|vine bed|ritual bed|hospital bed|operation bed|operating bed|restraint bed|藤蔓病床|活体藤蔓|藤蔓床|仪式病床|仪式床|手术床|束缚床/.test(normalize(value));
}

function cleanFrozenLockFromPrompt(value: unknown): string {
  const text = stringValue(value);
  if (!text) return "";
  return text
    .replace(/^Scene visual continuity lock:\s*Scene visual authority:\s*Frozen Meat Section\.[^\n]*\n?/gim, "")
    .replace(/\bScene visual authority:\s*Frozen Meat Section\.[^.\n]*(?:\.[^\n]*)?/gi, "")
    .replace(/\bCurrent zone:\s*Living Vine Hospital Bed,\s*inside the same canonical scene\.\s*/gi, "")
    .replace(/\bfreezer aisle|frozen meat section|freezer cases|cold tile|dark freezer wall\b/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function withLivingVineLock(prompt: unknown): string {
  const cleaned = cleanFrozenLockFromPrompt(prompt);
  if (!cleaned) return cleaned;
  const lines = cleaned.split("\n");
  const sceneIndex = lines.findIndex((line) => /^Scene:/i.test(line));
  const lockLine = `Scene visual continuity lock: ${LIVING_VINE_LOCK}`;
  if (lines.some((line) => line.includes("Scene visual authority: Living Vine Hospital Bed"))) return cleaned;
  if (sceneIndex >= 0) {
    lines.splice(sceneIndex + 1, 0, lockLine);
    return lines.join("\n");
  }
  return [lockLine, cleaned].join("\n");
}

function patchLivingVineRecord<T extends Record<string, unknown>>(record: T): T {
  const text = [record.name, record.title, record.setting, record.description, record.action, record.visualPrompt, record.references].map(stringValue).join("\n");
  if (!isLivingVineSetting(text)) return record;
  return {
    ...record,
    canonicalSceneId: LIVING_VINE_CANONICAL_ID,
    sceneZone: "",
    sceneAnchors: ["living vine hospital bed", "root restraints", "bone needle", "clear plastic tubing", "tendril canopy"],
    sceneVisualLock: LIVING_VINE_LOCK,
  };
}

async function main() {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, aspectRatio: true, settings: true, metadata: true },
  });

  if (!project || !isRecord(project.metadata)) {
    console.error(`Project not found or invalid metadata: ${projectId}`);
    process.exit(1);
  }

  const baseMetadata = project.metadata;
  const metadata = metadataWithProjectSettings(baseMetadata, project.settings);
  const workflow = workflowMaintenanceInternals.getWorkflowState(metadata, episodeId);
  let patchedScenes = 0;
  let patchedAssets = 0;
  let patchedClips = 0;

  const nextBreakdownScenes = workflow.breakdownScenes.map((shot) => {
    const patched = patchLivingVineRecord(shot as Record<string, unknown>);
    if (patched !== shot) patchedScenes += 1;
    return patched;
  });
  const shotsById = new Map(nextBreakdownScenes.map((shot) => [stringValue(shot.id), shot]));

  const nextAssets = {
    ...workflow.assets,
    scenes: Array.isArray(workflow.assets?.scenes)
      ? workflow.assets.scenes.map((asset: unknown) => {
          if (!isRecord(asset)) return asset;
          const patched = patchLivingVineRecord(asset);
          if (patched !== asset) patchedAssets += 1;
          return patched;
        })
      : workflow.assets?.scenes,
  };

  const workflowForGeneration = {
    ...workflow,
    breakdownScenes: nextBreakdownScenes,
    assets: nextAssets,
  };

  const nextClips = workflow.clips.map((clip) => {
    const clipShots = (clip.shotIds ?? []).map((shotId) => shotsById.get(stringValue(shotId))).filter(Boolean);
    const livingVineClip = isLivingVineSetting(clip.setting) || clipShots.some((shot) => isLivingVineSetting((shot as Record<string, unknown>).setting));
    if (!livingVineClip) return clip;
    const generated = workflowMaintenanceInternals.regenerateWorkflowClipSeedancePrompt(project, workflowForGeneration, {
      ...clip,
      setting: "Living Vine Hospital Bed",
      seedancePrompt: withLivingVineLock(clip.seedancePrompt),
    }, clipShots as any);
    patchedClips += 1;
    return {
      ...clip,
      ...generated,
      setting: "Living Vine Hospital Bed",
      startState: stringValue(clip.startState).replace(/Frozen Meat Section/gi, "Living Vine Hospital Bed"),
      endState: stringValue(clip.endState).replace(/Frozen Meat Section/gi, "Living Vine Hospital Bed"),
    };
  });

  const nextWorkflow = {
    ...workflow,
    assets: nextAssets,
    breakdownScenes: nextBreakdownScenes,
    clips: nextClips,
    updatedAt: new Date().toISOString(),
    lastRun: {
      ...(isRecord(workflow.lastRun) ? workflow.lastRun : {}),
      status: "episode-012-living-vine-scene-lock-repaired",
      stage: "scene-visual-lock",
      completedAt: new Date().toISOString(),
    },
  };

  let nextMetadata = workflowMaintenanceInternals.writeWorkflowEpisode(baseMetadata, episodeId, nextWorkflow, true);
  const canvasScenes = isRecord(baseMetadata.canvasScenes) ? baseMetadata.canvasScenes : {};
  const existingScene = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] as { nodes?: unknown[]; edges?: unknown[] } : undefined;
  const sync = buildEpisodeCanvasSyncScene({
    metadata: nextMetadata,
    episodeId,
    generationStrategy: projectGenerationStrategyFromMetadata(metadata),
    existingScene,
    now: new Date().toISOString(),
  });
  nextMetadata = writeEpisodeCanvasSyncMetadata({ metadata: nextMetadata, sync, makeActive: true });

  await prisma.project.update({
    where: { id: projectId },
    data: { metadata: nextMetadata },
  });

  console.log(JSON.stringify({
    projectId,
    episodeId,
    patchedScenes,
    patchedAssets,
    patchedClips,
    canvasNodes: sync.nodes.length,
    canvasEdges: sync.edges.length,
  }, null, 2));
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
