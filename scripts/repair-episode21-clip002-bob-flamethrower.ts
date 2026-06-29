import { prisma } from "../server/src/lib/prisma";
import { buildClipPositioningBoardPrompt } from "../server/src/lib/workflowPositioningBoards";
import { workflowMaintenanceInternals } from "../server/src/routes/workflows";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = process.argv[3] || "episode-021";
const clipId = process.argv[4] || "clip-002";

type CanvasNode = Record<string, unknown> & {
  id?: string;
  type?: string;
  parentId?: string;
  position?: { x?: number; y?: number };
  style?: Record<string, unknown>;
  data?: Record<string, unknown>;
};

type CanvasEdge = Record<string, unknown> & {
  id?: string;
  source?: string;
  target?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value: unknown): string {
  return stringValue(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function publicImageUrl(value: unknown): string {
  const text = stringValue(value).trim();
  return /^https?:\/\//i.test(text) || text.startsWith("/api/uploads/") ? text : "";
}

function assetName(asset: Record<string, unknown>): string {
  return stringValue(asset.name) || stringValue(asset.title);
}

function assetUrl(asset: Record<string, unknown>): string {
  return publicImageUrl(asset.referenceImageUrl) || publicImageUrl(asset.generatedImageUrl);
}

function stableCanvasIdPart(value: unknown, fallback = "item"): string {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || fallback;
}

function edgeId(prefix: string, source: string, target: string): string {
  return `${prefix}-${source}-${target}`.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function replaceBobGunWithFlamethrower(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/\bBob grips gun\b/gi, "Bob grips flamethrower")
      .replace(/\bBob grips a gun\b/gi, "Bob grips the flamethrower")
      .replace(/\bBob grips his gun\b/gi, "Bob grips his flamethrower")
      .replace(/\bBob gripping gun\b/gi, "Bob gripping flamethrower")
      .replace(/\bBob holds gun\b/gi, "Bob holds flamethrower")
      .replace(/\bBob holds a gun\b/gi, "Bob holds the flamethrower")
      .replace(/\bBob holds his gun\b/gi, "Bob holds his flamethrower")
      .replace(/\bgripping gun\b/gi, "gripping flamethrower")
      .replace(/\bgrips gun\b/gi, "grips flamethrower")
      .replace(/\bholds gun\b/gi, "holds flamethrower")
      .replace(/\bgun white-knuckled\b/gi, "flamethrower white-knuckled")
      .replace(/\bgripping a gun\b/gi, "gripping the flamethrower")
      .replace(/\bgrips a gun\b/gi, "grips the flamethrower")
      .replace(/\bholds a gun\b/gi, "holds the flamethrower")
      .replace(/\bBob Gun\b/g, "Flamethrower")
      .replace(/\bBob's Gun\b/g, "Bob's Flamethrower");
  }
  if (Array.isArray(value)) return value.map(replaceBobGunWithFlamethrower);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceBobGunWithFlamethrower(item)]));
  }
  return value;
}

function hasClip(node: CanvasNode, clipIdValue: string): boolean {
  const data = isRecord(node.data) ? node.data : {};
  return stringValue(data.clipId) === clipIdValue
    || stringValue(data.targetClipId) === clipIdValue
    || stringValue(data.sourceClipId) === clipIdValue
    || stringValue(node.id).includes(clipIdValue);
}

function upsertNode(nodes: CanvasNode[], node: CanvasNode): CanvasNode[] {
  const index = nodes.findIndex((item) => item.id === node.id);
  if (index < 0) return [...nodes, node];
  return nodes.map((item, itemIndex) => itemIndex === index
    ? { ...item, ...node, data: { ...(isRecord(item.data) ? item.data : {}), ...(isRecord(node.data) ? node.data : {}) } }
    : item);
}

function upsertEdge(edges: CanvasEdge[], edge: CanvasEdge): CanvasEdge[] {
  if (edges.some((item) => item.id === edge.id || (item.source === edge.source && item.target === edge.target))) return edges;
  return [...edges, edge];
}

const project = await prisma.project.findUnique({
  where: { id: projectId },
  select: { id: true, name: true, aspectRatio: true, settings: true, metadata: true },
});

if (!project) throw new Error(`Project not found: ${projectId}`);

const metadata = isRecord(project.metadata) ? project.metadata : {};
const workflow = workflowMaintenanceInternals.getWorkflowState(metadata, episodeId);
const clip = workflow.clips.find((item) => item.id === clipId);
if (!clip) throw new Error(`Clip not found: ${episodeId}/${clipId}`);

const shotIds = new Set(clip.shotIds);
const nextBreakdownScenes = workflow.breakdownScenes.map((shot) => (
  shotIds.has(shot.id) ? replaceBobGunWithFlamethrower(shot) : shot
)) as typeof workflow.breakdownScenes;

const shotsById = new Map(nextBreakdownScenes.map((shot) => [shot.id, shot]));
const nextShots = clip.shotIds.map((shotId) => shotsById.get(shotId)).filter((shot): shot is NonNullable<typeof shot> => Boolean(shot));
const nextClipInput = replaceBobGunWithFlamethrower({
  ...clip,
  startState: [
    replaceBobGunWithFlamethrower(clip.startState),
    "Bob carries the same flamethrower established in the previous action; do not show Bob with a handgun, pistol, revolver, or generic small firearm.",
  ].filter(Boolean).join("; "),
  layoutMemory: [
    replaceBobGunWithFlamethrower(clip.layoutMemory),
    "Bob prop continuity: Bob holds/carries the Flamethrower, not Bob Gun, not handgun, not pistol.",
  ].filter(Boolean).join("\n"),
  endState: replaceBobGunWithFlamethrower(clip.endState),
}) as typeof clip;
const regenerated = workflowMaintenanceInternals.regenerateWorkflowClipSeedancePrompt(project, {
  ...workflow,
  breakdownScenes: nextBreakdownScenes,
}, nextClipInput, nextShots);

const nextClip = replaceBobGunWithFlamethrower({
  ...clip,
  ...nextClipInput,
  ...regenerated,
  seedancePrompt: [
    replaceBobGunWithFlamethrower(regenerated.seedancePrompt),
    "Prop continuity: Bob is holding/carrying his Flamethrower. Do not show Bob with a handgun, pistol, revolver, or generic small firearm.",
  ].filter(Boolean).join("\n"),
}) as typeof clip;

const nextClips = workflow.clips.map((item) => item.id === clipId ? nextClip : item);
const nextWorkflow = {
  ...workflow,
  breakdownScenes: nextBreakdownScenes,
  clips: nextClips,
  updatedAt: new Date().toISOString(),
  lastRun: {
    status: "episode21-clip002-bob-flamethrower-repaired",
    stage: "storyboard-video",
    completedAt: new Date().toISOString(),
  },
};

let nextMetadata = workflowMaintenanceInternals.writeWorkflowEpisode(metadata, episodeId, nextWorkflow, true);
const canvasScenes = isRecord(nextMetadata.canvasScenes) ? nextMetadata.canvasScenes : {};
const scene = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] : {};
let nodes = arrayValue(scene.nodes).filter(isRecord) as CanvasNode[];
let edges = arrayValue(scene.edges).filter(isRecord) as CanvasEdge[];

const assets = workflow.assets || {};
const props = arrayValue(assets.props).filter(isRecord);
const flamethrower = props.find((asset) => normalizeText(assetName(asset)) === "flamethrower")
  ?? props.find((asset) => normalizeText(assetName(asset)).includes("flamethrower"));
const flamethrowerUrl = flamethrower ? assetUrl(flamethrower) : "";
const flamethrowerName = flamethrower ? assetName(flamethrower) : "Flamethrower";
const flamethrowerAssetId = flamethrower ? stringValue(flamethrower.id) : "";

const clipNodes = nodes.filter((node) => hasClip(node, clipId));
const boardNodeId = `clip-position-board-gen-${episodeId}-${clipId}`;
const boardNode = nodes.find((node) => node.id === boardNodeId);
const videoNodeId = `episode-sync-video-node-${episodeId}-${clipId}`;
const boardSectionId = `clip-position-board-${episodeId}-${clipId}`;
const videoSectionId = `episode-sync-video-${episodeId}-${clipId}`;
const boardPrompt = buildClipPositioningBoardPrompt({
  projectName: project.name || "美式漫剧",
  clip: nextClip,
  shots: nextShots,
  referenceLabels: [
    "Bob",
    "Chloe",
    "Leo",
    "Omega Executive Elevator",
    flamethrowerName,
  ],
  visibleCharacterNames: ["Bob", "Chloe", "Leo"],
  sceneLockName: nextClip.setting,
  sceneVisualLock: nextShots.map((shot) => stringValue(shot.sceneVisualLock)).find(Boolean),
  mode: "storyboard",
});

nodes = nodes.map((node) => {
  if (!hasClip(node, clipId)) return node;
  const data = isRecord(node.data) ? node.data : {};
  const nextData = replaceBobGunWithFlamethrower(data) as Record<string, unknown>;
  if (node.id === boardNodeId) {
    return {
      ...node,
      data: {
        ...nextData,
        prompt: boardPrompt,
        finalPrompt: boardPrompt,
        storyboardPrompt: boardPrompt,
        status: "waiting",
        outputImage: "",
        outputImageAssetId: "",
        outputImages: [],
        error: "",
        generationStartedAt: "",
        manualFinalPrompt: true,
      },
    };
  }
  if (node.id === videoNodeId) {
    return {
      ...node,
      data: {
        ...nextData,
        prompt: nextClip.seedancePrompt,
        seedancePrompt: nextClip.seedancePrompt,
        videoPrompt: nextClip.seedancePrompt,
      },
    };
  }
  return { ...node, data: nextData };
});

if (flamethrowerUrl) {
  const boardRefId = `clip-position-board-ref-${episodeId}-${clipId}-props-${stableCanvasIdPart(flamethrowerAssetId || flamethrowerName, "flamethrower")}`;
  const videoRefId = `episode-sync-video-ref-${episodeId}-${clipId}-asset-${stableCanvasIdPart(flamethrowerAssetId || flamethrowerName, "flamethrower")}`;
  nodes = upsertNode(nodes, {
    id: boardRefId,
    type: "imageInput",
    parentId: boardSectionId,
    position: { x: 12, y: 612 },
    style: { width: 220 },
    data: {
      label: `道具 · ${flamethrowerName}`,
      imageUrl: flamethrowerUrl,
      imageAspectRatio: 1.45,
      fileName: `${flamethrowerName}.png`,
      uploadStatus: "linked",
      sourcePrompt: `${flamethrowerName}，用于 ${nextClip.title} 的 Bob 道具连续性参考。Bob must hold this flamethrower, not a handgun or pistol.`,
      assetKind: "props",
      assetName: flamethrowerName,
      assetId: flamethrowerAssetId,
      sourceClipId: clipId,
      targetClipId: clipId,
      sourceEpisodeId: episodeId,
      positioningBoardFlow: true,
      lightweightReference: true,
      episodeCanvasSync: true,
      clipSyncRole: `positioning-ref:props:${flamethrowerAssetId || normalizeText(flamethrowerName)}`,
      clipSyncAssetId: flamethrowerAssetId,
      clipSyncUrl: flamethrowerUrl,
    },
  });
  nodes = upsertNode(nodes, {
    id: videoRefId,
    type: "imageInput",
    parentId: videoSectionId,
    position: { x: 12, y: 808 },
    style: { width: 260 },
    data: {
      label: `道具参考: ${flamethrowerName}`,
      imageUrl: flamethrowerUrl,
      imageAspectRatio: 1.45,
      fileName: `${flamethrowerName}.png`,
      uploadStatus: "linked",
      sourcePrompt: `${flamethrowerName}，用于 ${nextClip.title} 视频连续性参考。Bob must hold this flamethrower, not a handgun or pistol.`,
      assetKind: "props",
      assetName: flamethrowerName,
      assetId: flamethrowerAssetId,
      sourceEpisodeId: episodeId,
      episodeCanvasSync: true,
      clipSyncRole: `video-asset:${flamethrowerAssetId || normalizeText(flamethrowerName)}`,
      clipSyncAssetId: flamethrowerAssetId,
      clipSyncUrl: flamethrowerUrl,
    },
  });
  edges = upsertEdge(edges, {
    id: edgeId("clip-position-board-ref", boardRefId, boardNodeId),
    source: boardRefId,
    target: boardNodeId,
    type: "smoothstep",
  });
  edges = upsertEdge(edges, {
    id: edgeId("episode-video-ref", videoRefId, videoNodeId),
    source: videoRefId,
    target: videoNodeId,
    type: "smoothstep",
  });
}

nextMetadata = {
  ...nextMetadata,
  canvasScenes: {
    ...canvasScenes,
    [episodeId]: {
      ...scene,
      nodes,
      edges,
      updatedAt: new Date().toISOString(),
    },
  },
};

await prisma.project.update({
  where: { id: projectId },
  data: { metadata: nextMetadata },
});

const allClipText = JSON.stringify({
  clip: nextClip,
  shots: nextShots,
  boardPrompt,
  clipNodes: clipNodes.map((node) => node.data),
});

console.log(JSON.stringify({
  projectId,
  episodeId,
  clipId,
  fixedShots: nextShots.length,
  boardPromptLength: boardPrompt.length,
  videoPromptLength: nextClip.seedancePrompt.length,
  flamethrowerConnected: Boolean(flamethrowerUrl),
  flamethrowerUrl,
  remainingBobGunPhrases: (allClipText.match(/\bBob (?:grips|holds|gripping|holding) (?:a |his )?gun\b/gi) || []).length,
  remainingHandgunPistol: (allClipText.match(/\b(?:handgun|pistol|revolver)\b/gi) || []).length,
}, null, 2));

await prisma.$disconnect();
