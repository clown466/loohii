import { prisma } from "../server/src/lib/prisma";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = process.argv[3] || "episode-001";

type NodeLike = {
  id: string;
  type?: string;
  parentId?: string;
  extent?: string;
  expandParent?: boolean;
  position?: { x?: number; y?: number };
  style?: Record<string, unknown>;
  zIndex?: number;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

type EdgeLike = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalized(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function stableIdPart(value: unknown, fallback: string): string {
  const raw = String(value || fallback).trim().toLowerCase();
  return raw
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || fallback;
}

function upsertNode(nodes: NodeLike[], node: NodeLike): NodeLike[] {
  const index = nodes.findIndex((item) => item.id === node.id);
  if (index < 0) return [...nodes, node];
  const current = nodes[index];
  const next = [...nodes];
  next[index] = {
    ...current,
    ...node,
    data: { ...(current.data ?? {}), ...(node.data ?? {}) },
    style: { ...(current.style ?? {}), ...(node.style ?? {}) },
  };
  return next;
}

function upsertEdge(edges: EdgeLike[], edge: EdgeLike): EdgeLike[] {
  const index = edges.findIndex((item) => item.id === edge.id || (item.source === edge.source && item.target === edge.target));
  if (index < 0) return [...edges, edge];
  const next = [...edges];
  next[index] = { ...next[index], ...edge };
  return next;
}

function assetImageUrl(asset: Record<string, unknown>): string {
  return String(asset.referenceImageUrl || asset.generatedImageUrl || "").trim();
}

function assetImageAssetId(asset: Record<string, unknown>): string {
  return String(asset.referenceImageAssetId || asset.generatedImageAssetId || asset.id || "").trim();
}

function assetName(asset: Record<string, unknown>): string {
  return String(asset.name || asset.title || "").trim();
}

function findAssetByName(assets: Record<string, unknown>[], name: string): Record<string, unknown> | undefined {
  const key = normalized(name);
  return assets.find((asset) => normalized(assetName(asset)) === key)
    ?? assets.find((asset) => {
      const assetKey = normalized(assetName(asset));
      return Boolean(assetKey && (assetKey.includes(key) || key.includes(assetKey)));
    });
}

function clipShots(clip: Record<string, unknown>, scenes: Record<string, unknown>[]): Record<string, unknown>[] {
  const shotIds = new Set(Array.isArray(clip.shotIds) ? clip.shotIds.map(String) : []);
  return scenes.filter((scene) => shotIds.has(String(scene.id || "")));
}

function primarySceneName(clip: Record<string, unknown>, shots: Record<string, unknown>[]): string {
  const text = normalized([
    clip.title,
    clip.setting,
    clip.plotGoal,
    clip.startState,
    clip.endState,
    ...shots.flatMap((shot) => [
      shot.title,
      shot.setting,
      shot.description,
      shot.action,
      shot.visualPrompt,
      shot.references,
    ]),
  ].filter(Boolean).join("\n"));
  if (/underground loading dock|地下装卸|地下卸货/.test(text)) return "Underground Loading Dock";
  if (/frozen meat section|冷冻肉|冻肉区/.test(text)) return "Frozen Meat Section";
  if (/labor purification route|劳动净化路线|净化路线/.test(text)) return "Labor Purification Route";
  if (/labor purification zone|劳动净化区|净化区/.test(text)) return "Labor Purification Zone";
  const settingText = normalized([clip.setting, ...shots.map((shot) => shot.setting)].filter(Boolean).join("\n"));
  if (/sanctuary superstore center|superstore meditation circle|meditation circle|trial circle|圣所超市|超市中心|冥想圈|审判圈/.test(settingText || text)) return "Superstore Meditation Circle";
  if (/shipping pallet altar|pallet altar|托盘祭坛|货盘祭坛/.test(settingText)) return "Shipping Pallet Altar";
  return String(clip.setting || "").trim();
}

function childNodes(nodes: NodeLike[], parentId: string, type?: string): NodeLike[] {
  return nodes.filter((node) => node.parentId === parentId && (!type || node.type === type));
}

function removeExtraSceneRefs(input: {
  nodes: NodeLike[];
  edges: EdgeLike[];
  sectionId: string;
  keepNodeId: string;
}) {
  const removeIds = new Set(childNodes(input.nodes, input.sectionId, "imageInput")
    .filter((node) => String(node.data?.assetKind || "") === "scenes" && node.id !== input.keepNodeId)
    .map((node) => node.id));
  return {
    nodes: input.nodes.filter((node) => !removeIds.has(node.id)),
    edges: input.edges.filter((edge) => !removeIds.has(edge.source) && !removeIds.has(edge.target)),
    removed: removeIds.size,
  };
}

const project = await prisma.project.findUnique({
  where: { id: projectId },
  select: { metadata: true },
});

if (!project || !isRecord(project.metadata)) {
  throw new Error(`Project not found or invalid metadata: ${projectId}`);
}

const metadata = project.metadata;
const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : {};
const canvasScene = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] : null;
if (!canvasScene) throw new Error(`Canvas scene not found: ${episodeId}`);

const workflow = isRecord(metadata.episodes)
  && isRecord(metadata.episodes[episodeId])
  && isRecord((metadata.episodes[episodeId] as Record<string, unknown>).workflowCenter)
  ? (metadata.episodes[episodeId] as Record<string, unknown>).workflowCenter as Record<string, unknown>
  : isRecord(metadata.workflowCenter)
    ? metadata.workflowCenter as Record<string, unknown>
    : {};

const clips = Array.isArray(workflow.clips) ? workflow.clips.filter(isRecord) : [];
const breakdownScenes = Array.isArray(workflow.breakdownScenes) ? workflow.breakdownScenes.filter(isRecord) : [];
const assets = isRecord(workflow.assets) ? workflow.assets : {};
const sceneAssets = Array.isArray(assets.scenes) ? assets.scenes.filter(isRecord) : [];
let nodes = Array.isArray(canvasScene.nodes) ? canvasScene.nodes.filter(isRecord) as NodeLike[] : [];
let edges = Array.isArray(canvasScene.edges) ? canvasScene.edges.filter(isRecord) as EdgeLike[] : [];

let videoSceneNodesAdded = 0;
let videoSceneEdgesAdded = 0;
let positioningSceneNodesAdded = 0;
let removedExtraPositioningScenes = 0;

for (const [index, clip] of clips.entries()) {
  const clipId = String(clip.id || `clip-${index + 1}`);
  const shots = clipShots(clip, breakdownScenes);
  const sceneName = primarySceneName(clip, shots);
  const sceneAsset = findAssetByName(sceneAssets, sceneName);
  if (!sceneAsset) continue;
  const imageUrl = assetImageUrl(sceneAsset);
  if (!imageUrl) continue;
  const assetId = assetImageAssetId(sceneAsset);
  const clipKey = stableIdPart(clipId, `clip-${index + 1}`);
  const sceneKey = stableIdPart(sceneName, "scene");
  const data = {
    label: `场景 · ${sceneName}`,
    imageUrl,
    imageAspectRatio: 1.45,
    fileName: `${sceneName}.png`,
    uploadStatus: "linked",
    sourcePrompt: `主场景参考: ${sceneName}，用于 ${String(clip.title || clipId)} 视频连续性参考`,
    uploadError: "",
    imageLoadError: false,
    assetKind: "scenes",
    assetName: sceneName,
    assetId,
    sourceEpisodeId: episodeId,
    targetClipId: clipId,
  };

  const videoSection = nodes.find((node) => node.type === "section" && node.data?.sectionKind === "clip-video-assets" && node.data?.clipId === clipId);
  const videoNode = videoSection ? childNodes(nodes, videoSection.id, "video")[0] : undefined;
  if (videoSection && videoNode) {
    const existing = childNodes(nodes, videoSection.id, "imageInput")
      .find((node) => String(node.data?.assetKind || "") === "scenes" && normalized(node.data?.assetName) === normalized(sceneName));
    const refId = existing?.id || `clip-video-scene-ref-${episodeId}-${clipKey}-${sceneKey}`;
    const existingRefs = childNodes(nodes, videoSection.id, "imageInput");
    const refIndex = Math.max(0, existingRefs.length);
    nodes = upsertNode(nodes, {
      id: refId,
      type: "imageInput",
      parentId: videoSection.id,
      extent: "parent",
      expandParent: false,
      position: existing?.position ?? { x: 12 + (refIndex % 2) * 352, y: 42 + Math.floor(refIndex / 2) * 258 },
      style: existing?.style ?? { width: 340, height: 248 },
      zIndex: 1,
      data,
    });
    if (!existing) videoSceneNodesAdded += 1;
    const beforeEdges = edges.length;
    edges = upsertEdge(edges, {
      id: `clip-video-scene-ref-edge-${refId}-${videoNode.id}`,
      source: refId,
      sourceHandle: null,
      target: videoNode.id,
      targetHandle: null,
      type: "smoothstep",
    });
    if (edges.length > beforeEdges) videoSceneEdgesAdded += 1;
    const removed = removeExtraSceneRefs({ nodes, edges, sectionId: videoSection.id, keepNodeId: refId });
    nodes = removed.nodes;
    edges = removed.edges;
  }

  const positioningSection = nodes.find((node) => node.type === "section" && node.data?.sectionKind === "clip-positioning-board" && node.data?.clipId === clipId);
  const positioningNode = positioningSection ? childNodes(nodes, positioningSection.id, "generation")[0] : undefined;
  if (positioningSection && positioningNode) {
    const existing = childNodes(nodes, positioningSection.id, "imageInput")
      .find((node) => String(node.data?.assetKind || "") === "scenes" && normalized(node.data?.assetName) === normalized(sceneName));
    const refId = existing?.id || `clip-position-board-ref-${episodeId}-${clipKey}-scenes-${sceneKey}`;
    nodes = upsertNode(nodes, {
      id: refId,
      type: "imageInput",
      parentId: positioningSection.id,
      extent: "parent",
      expandParent: false,
      position: existing?.position ?? { x: 12, y: 42 },
      style: existing?.style ?? { width: 170 },
      zIndex: 1,
      data: {
        ...data,
        label: `场景 · ${sceneName}`,
        sourceClipId: clipId,
        positioningBoardFlow: true,
      },
    });
    if (!existing) positioningSceneNodesAdded += 1;
    edges = upsertEdge(edges, {
      id: `clip-position-board-ref-edge-${refId}-${positioningNode.id}`,
      source: refId,
      sourceHandle: null,
      target: positioningNode.id,
      targetHandle: null,
      type: "smoothstep",
    });
    const removed = removeExtraSceneRefs({ nodes, edges, sectionId: positioningSection.id, keepNodeId: refId });
    nodes = removed.nodes;
    edges = removed.edges;
    removedExtraPositioningScenes += removed.removed;
  }
}

const nextScene = {
  ...canvasScene,
  nodes,
  edges,
  updatedAt: new Date().toISOString(),
};

await prisma.project.update({
  where: { id: projectId },
  data: {
    metadata: {
      ...metadata,
      canvasScenes: {
        ...canvasScenes,
        [episodeId]: nextScene,
      },
    },
  },
});

console.log(JSON.stringify({
  projectId,
  episodeId,
  clips: clips.length,
  videoSceneNodesAdded,
  videoSceneEdgesAdded,
  positioningSceneNodesAdded,
  removedExtraPositioningScenes,
  nodes: nodes.length,
  edges: edges.length,
}, null, 2));

await prisma.$disconnect();
