import { prisma } from "../server/src/lib/prisma";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const contaminatedUrlNeedle = "asset-cmqpklndm000lmv0ttr9comk4.png";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function episodeNumber(episodeId: string): number {
  return Number(episodeId.match(/(\d+)/)?.[1] || 0);
}

function containsContaminatedUrl(value: unknown): boolean {
  if (typeof value === "string") return value.includes(contaminatedUrlNeedle);
  if (!value || typeof value !== "object") return false;
  return JSON.stringify(value).includes(contaminatedUrlNeedle);
}

function scenePromptFor(asset: Record<string, unknown>, episodeId: string): string {
  const name = stringValue(asset.name) || stringValue(asset.title) || "Scene";
  const lock = stringValue(asset.sceneVisualLock);
  const base = [
    "Style: 3D American cartoon dark comedy, cinematic lighting, consistent scene design.",
    "Asset kind: scenes",
    `Asset name: ${name}`,
    `Episode: ${episodeId}`,
    "Create a clean empty environment reference image. No characters, no creatures, no readable text, no UI, no watermark.",
  ];
  if (/overpass|bridge|viaduct/i.test(name)) {
    base.push(
      "Scene requirement: ruined night overpass / underpass roadway, broken concrete supports, dark asphalt, cold blue-black night palette, harsh headlight spill, distant horde movement only if needed.",
      "Do not use warm sunset, desert daylight, straight empty desert highway, or golden sky.",
    );
  } else if (/highway|road|interstate/i.test(name)) {
    base.push(
      "Scene requirement: night wasteland highway or roadway matching this episode, cold moonlit asphalt, black-blue sky, dead roadside, cracked pavement, dark horizon continuity.",
      "Do not use warm sunset, golden dusk, orange desert daylight, or unrelated empty desert highway plate.",
    );
  } else {
    base.push(
      "Scene requirement: follow the current episode location and visual lock exactly; preserve time of day, palette, fixed landmarks, materials, and geography.",
      "Do not reuse a generic warm sunset highway unless this specific asset explicitly says warm sunset highway.",
    );
  }
  if (lock) base.push(`Scene visual lock: ${lock}`);
  const description = stringValue(asset.description) || stringValue(asset.summary);
  if (description) base.push(`Scene description: ${description}`);
  return base.join("\n");
}

function clearAssetImage(asset: Record<string, unknown>, episodeId: string) {
  const before: Record<string, unknown> = {};
  for (const field of ["generatedImageUrl", "referenceImageUrl", "imageUrl", "outputImage"]) {
    if (containsContaminatedUrl(asset[field])) {
      before[field] = asset[field];
      delete asset[field];
    }
  }
  for (const field of ["generatedImageAssetId", "referenceImageAssetId", "imageAssetId", "outputImageAssetId"]) {
    if (asset[field]) delete asset[field];
  }
  if (Object.keys(before).length === 0) return null;
  asset.generatedImagePrompt = scenePromptFor(asset, episodeId);
  asset.referenceAnalysisStatus = "needs-regeneration";
  asset.visualAuthority = "needs-regeneration-contaminated-scene-reference";
  asset.imageStatus = "missing";
  asset.imageError = "Cleared contaminated warm dusk highway reference; regenerate this scene for its own episode/location/time.";
  return before;
}

function clearNodeImage(data: Record<string, unknown>) {
  let changed = false;
  for (const field of ["imageUrl", "clipSyncUrl", "referenceImageUrl", "generatedImageUrl", "outputImage"]) {
    if (containsContaminatedUrl(data[field])) {
      data[field] = "";
      changed = true;
    }
  }
  for (const field of ["assetId", "clipSyncAssetId", "imageAssetId", "outputImageAssetId"]) {
    if (data[field]) {
      data[field] = "";
      changed = true;
    }
  }
  for (const field of ["referenceImageUrls", "referenceImages"]) {
    if (!Array.isArray(data[field])) continue;
    const next = (data[field] as unknown[]).filter((item) => !containsContaminatedUrl(item));
    if (next.length !== (data[field] as unknown[]).length) {
      data[field] = next;
      changed = true;
    }
  }
  if (changed) {
    data.uploadStatus = "missing";
    data.uploadError = "错误复用的黄昏公路参考图已清空，请重新生成/绑定本集场景图。";
    data.imageLoadError = false;
  }
  return changed;
}

function clearGeneratedBoard(data: Record<string, unknown>) {
  const hadOutput = Boolean(data.outputImage || (Array.isArray(data.outputImages) && data.outputImages.length) || data.outputImageAssetId);
  if (!hadOutput && data.status === "idle") return false;
  delete data.outputImage;
  data.outputImages = [];
  delete data.outputImageAssetId;
  delete data.revisedPrompt;
  data.status = "idle";
  data.error = "";
  data.description = `${stringValue(data.description) || ""} Contaminated scene reference cleared; regenerate this board.`.trim();
  return true;
}

async function main() {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { metadata: true } });
  if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);
  const metadata = project.metadata as Record<string, unknown>;
  const episodes = isRecord(metadata.episodes) ? metadata.episodes : {};
  const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : {};
  const report: Record<string, unknown[]> = {
    clearedAssets: [],
    clearedNodes: [],
    clearedBoards: [],
  };

  for (const [episodeId, episode] of Object.entries(episodes)) {
    if (episodeNumber(episodeId) < 18 || !isRecord(episode)) continue;
    const workflow = isRecord(episode.workflowCenter) ? episode.workflowCenter : undefined;
    const assets = isRecord(workflow?.assets) ? workflow.assets : undefined;
    const scenes = Array.isArray(assets?.scenes) ? assets.scenes as Record<string, unknown>[] : [];
    for (const asset of scenes) {
      const before = clearAssetImage(asset, episodeId);
      if (before) report.clearedAssets.push({ episodeId, id: asset.id, name: asset.name, before });
    }
  }

  for (const [episodeId, scene] of Object.entries(canvasScenes)) {
    if (episodeNumber(episodeId) < 18 || !isRecord(scene) || !Array.isArray(scene.nodes)) continue;
    const nodes = scene.nodes as Record<string, unknown>[];
    const contaminatedClipIds = new Set<string>();
    for (const node of nodes) {
      const data = isRecord(node.data) ? node.data : {};
      const wasContaminated = containsContaminatedUrl(data);
      if (clearNodeImage(data)) {
        report.clearedNodes.push({ episodeId, nodeId: node.id, type: node.type, label: data.label, assetName: data.assetName });
        const clipId = stringValue(data.targetClipId) || stringValue(data.sourceClipId) || stringValue(data.clipId);
        if (clipId) contaminatedClipIds.add(clipId);
      } else if (wasContaminated) {
        const clipId = stringValue(data.clipId) || stringValue(data.targetClipId) || stringValue(data.sourceClipId);
        if (clipId) contaminatedClipIds.add(clipId);
      }
    }
    for (const node of nodes) {
      const data = isRecord(node.data) ? node.data : {};
      const clipId = stringValue(data.clipId);
      const isBoard = node.type === "generation" && (data.positioningBoardFlow || stringValue(node.id).includes("clip-position-board-gen"));
      if (isBoard && clipId && contaminatedClipIds.has(clipId) && clearGeneratedBoard(data)) {
        report.clearedBoards.push({ episodeId, nodeId: node.id, clipId });
      }
    }
    scene.updatedAt = new Date().toISOString();
  }

  metadata.updatedAt = new Date().toISOString();
  await prisma.project.update({ where: { id: projectId }, data: { metadata } });
  console.log(JSON.stringify({
    projectId,
    contaminatedUrlNeedle,
    counts: Object.fromEntries(Object.entries(report).map(([key, value]) => [key, value.length])),
    report,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
