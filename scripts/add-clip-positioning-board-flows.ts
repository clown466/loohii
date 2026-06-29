import { prisma } from "../server/src/lib/prisma";
import { buildClipPositioningBoardPrompt } from "../server/src/lib/workflowPositioningBoards";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = process.argv[3] || "episode-001";
const POSITIONING_BOARD_SECTION_WIDTH = 1180;
const POSITIONING_BOARD_REFERENCE_NODE_WIDTH = 220;
const POSITIONING_BOARD_REFERENCE_NODE_HEIGHT = 180;
const POSITIONING_BOARD_REFERENCE_NODE_GAP_X = 18;
const POSITIONING_BOARD_REFERENCE_NODE_GAP_Y = 16;
const POSITIONING_BOARD_REFERENCE_COLUMNS = 3;
const POSITIONING_BOARD_GENERATION_NODE_WIDTH = 420;
const POSITIONING_BOARD_GENERATION_NODE_HEIGHT = 560;
const POSITIONING_BOARD_GENERATION_NODE_X =
  12 +
  POSITIONING_BOARD_REFERENCE_COLUMNS * POSITIONING_BOARD_REFERENCE_NODE_WIDTH +
  Math.max(0, POSITIONING_BOARD_REFERENCE_COLUMNS - 1) * POSITIONING_BOARD_REFERENCE_NODE_GAP_X +
  18;

type CanvasNode = {
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

type CanvasEdge = {
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

function stableIdPart(value: unknown, fallback: string): string {
  const raw = String(value || fallback).trim().toLowerCase();
  return raw
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || fallback;
}

function upsertNode(nodes: CanvasNode[], node: CanvasNode): CanvasNode[] {
  const index = nodes.findIndex((item) => item.id === node.id);
  if (index < 0) return [...nodes, node];
  const previous = nodes[index];
  const next = [...nodes];
  next[index] = {
    ...previous,
    ...node,
    data: {
      ...(previous.data ?? {}),
      ...(node.data ?? {}),
    },
    style: {
      ...(previous.style ?? {}),
      ...(node.style ?? {}),
    },
  };
  return next;
}

function upsertEdge(edges: CanvasEdge[], edge: CanvasEdge): CanvasEdge[] {
  const index = edges.findIndex((item) => item.id === edge.id || (item.source === edge.source && item.target === edge.target));
  if (index < 0) return [...edges, edge];
  const next = [...edges];
  next[index] = {
    ...next[index],
    ...edge,
  };
  return next;
}

function workflowAssetName(asset: unknown): string {
  const record = isRecord(asset) ? asset : {};
  return String(record.name || record.title || record.assetName || "").trim();
}

function clipShots(clip: Record<string, unknown>, breakdownScenes: Record<string, unknown>[]) {
  const shotIds = new Set(Array.isArray(clip.shotIds) ? clip.shotIds.map(String) : []);
  return breakdownScenes.filter((shot) => shotIds.has(String(shot.id || "")));
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
  }
  return output;
}

function normalizedText(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function searchableClipText(clip: Record<string, unknown>, shots: Record<string, unknown>[]): string {
  const values = [
    clip.title,
    clip.setting,
    clip.summary,
    clip.description,
    clip.startState,
    clip.endState,
    ...shots.flatMap((shot) => [
      shot.title,
      shot.setting,
      shot.action,
      shot.description,
      shot.visualPrompt,
      shot.references,
      shot.dialogue,
    ]),
  ];
  return normalizedText(values.filter(Boolean).join("\n"));
}

function cleanInlineText(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function stripBoardNoise(value: unknown): string {
  return cleanInlineText(value)
    .replace(/\bShow the listener's reaction, speaker's expression, and body language as the line lands\.?/gi, "")
    .replace(/\bHold the same scene geography and shift to a natural reaction or angle change\.?/gi, "")
    .replace(/\bUse linked references;?\s*/gi, "")
    .replace(/\bUse [^.]* linked (character )?images\.?/gi, "")
    .replace(/\bExaggerated American cartoon reaction;?\s*/gi, "")
    .replace(/\bChloe still wet\b/gi, "fresh spill residue is visible on Chloe only in this immediate spill moment")
    .replace(/\bBob guarded;\s*fresh spill residue is visible on Chloe only in this immediate spill moment\b/gi, "Bob guarded; Chloe has fresh spill residue only for this immediate spill moment")
    .replace(/\bChloe stands,\s*green stain still visible\b/gi, "Chloe stands")
    .replace(/\bChloe['’]s earlier green stain remains\b/gi, "")
    .replace(/\bher earlier green stain remains\b/gi, "")
    .replace(/\bgreen stain still (?:sticky|visible)\b/gi, "")
    .replace(/\bgreen sludge still (?:sticky|visible|dripping)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function withoutTrailingPunctuation(value: string): string {
  return value.replace(/[。.!?;,，；：:]+$/g, "").trim();
}

function sentenceValue(value: unknown): string {
  const clean = stripBoardNoise(value);
  return withoutTrailingPunctuation(clean);
}

function countVisibleNameMentions(text: string, names: string[]): number {
  const lowerText = text.toLowerCase();
  return names.reduce((count, name) => {
    const lowerName = name.toLowerCase();
    return lowerName && lowerText.includes(lowerName) ? count + 1 : count;
  }, 0);
}

function shotBoardScore(
  shot: Record<string, unknown>,
  visibleCharacterNames: string[],
  index: number,
  total: number,
): number {
  const action = stripBoardNoise(shot.action || shot.description || shot.visualPrompt || shot.title);
  const refs = stripBoardNoise(shot.references);
  const dialogue = cleanInlineText(shot.dialogue);
  const text = `${action} ${refs} ${dialogue}`;
  let score = 0;
  score += Math.min(action.length, 180) / 4;
  score += countVisibleNameMentions(text, visibleCharacterNames) * 28;
  if (dialogue) score += 12;
  if (/\b(left|right|center|foreground|midground|background|screen|facing|stands?|sits?|points?|holds?|clutches?|wears?|bound|restrained)\b/i.test(text)) {
    score += 36;
  }
  if (/\bshow the listener|hold the same scene|reaction or angle change\b/i.test(text)) score -= 28;
  const middleBias = total > 1 ? 1 - Math.abs(index / Math.max(total - 1, 1) - 0.45) : 1;
  score += middleBias * 14;
  return score;
}

function selectAnchorShot(shots: Record<string, unknown>[], visibleCharacterNames: string[]): Record<string, unknown> | null {
  if (!shots.length) return null;
  return shots
    .map((shot, index) => ({ shot, score: shotBoardScore(shot, visibleCharacterNames, index, shots.length) }))
    .sort((a, b) => b.score - a.score)[0]?.shot ?? shots[0];
}

function compactBoardCues(shots: Record<string, unknown>[], visibleCharacterNames: string[]): string[] {
  const cues: string[] = [];
  for (const shot of shots) {
    const action = stripBoardNoise(shot.action || shot.description || shot.visualPrompt);
    const refs = stripBoardNoise(shot.references);
    const combined = [action, refs].filter(Boolean).join(" ");
    if (!combined) continue;
    if (
      visibleCharacterNames.length > 0
      && countVisibleNameMentions(combined, visibleCharacterNames) === 0
      && !/\b(left|right|center|foreground|midground|background|screen|facing|holds?|wears?|bound|restrained|cup|box|door|hall|altar|circle)\b/i.test(combined)
    ) {
      continue;
    }
    cues.push(combined.length > 180 ? `${combined.slice(0, 177).trim()}...` : combined);
  }
  return uniqueStrings(cues).slice(0, 5);
}

function speakerFromDialogue(value: unknown): string {
  const dialogue = cleanInlineText(value);
  const match = dialogue.match(/^([^:：]{1,40})[:：]/);
  return match ? match[1].trim() : "";
}

const project = await prisma.project.findUnique({
  where: { id: projectId },
  select: { id: true, name: true, metadata: true },
});

if (!project) {
  console.error(`Project not found: ${projectId}`);
  process.exit(1);
}

const metadata = isRecord(project.metadata) ? project.metadata : {};
const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : {};
const scene = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] : null;
if (!scene) {
  console.error(`Canvas scene not found: ${episodeId}`);
  process.exit(1);
}

const workflow = isRecord(metadata.episodes)
  && isRecord(metadata.episodes[episodeId])
  && isRecord((metadata.episodes[episodeId] as Record<string, unknown>).workflowCenter)
  ? (metadata.episodes[episodeId] as Record<string, unknown>).workflowCenter as Record<string, unknown>
  : isRecord(metadata.workflowCenter)
    ? metadata.workflowCenter as Record<string, unknown>
    : {};

const clips = Array.isArray(workflow.clips) ? workflow.clips.filter(isRecord) : [];
const breakdownScenes = Array.isArray(workflow.breakdownScenes) ? workflow.breakdownScenes.filter(isRecord) : [];
const nodes = Array.isArray(scene.nodes) ? scene.nodes.filter(isRecord) as CanvasNode[] : [];
const edges = Array.isArray(scene.edges) ? scene.edges.filter(isRecord) as CanvasEdge[] : [];

let nextNodes = nodes;
let nextEdges = edges;
let createdSections = 0;
let createdGenerationNodes = 0;
let createdReferenceNodes = 0;
let createdEdges = 0;

for (let index = 0; index < clips.length; index += 1) {
  const clip = clips[index];
  const clipId = String(clip.id || `clip-${String(index + 1).padStart(3, "0")}`);
  const clipKey = stableIdPart(clipId, `clip-${index + 1}`);
  const shots = clipShots(clip, breakdownScenes);
  const videoSection = nextNodes.find((node) => node.type === "section" && node.data?.sectionKind === "clip-video-assets" && node.data?.clipId === clipId);
  const baseY = Number(videoSection?.position?.y ?? (120 + index * 1104));
  const sectionId = `clip-position-board-${episodeId}-${clipKey}`;
  const generationNodeId = `clip-position-board-gen-${episodeId}-${clipKey}`;
  const videoRefs = nextNodes
    .filter((node) => node.parentId === videoSection?.id && node.type === "imageInput")
    .filter((node) => {
      const kind = String(node.data?.assetKind || "");
      return kind === "characters" || kind === "scenes" || kind === "props";
    });
  const uniqueRefs = new Map<string, CanvasNode>();
  for (const ref of videoRefs) {
    const key = `${String(ref.data?.assetKind || "")}:${String(ref.data?.assetName || ref.data?.label || ref.id)}`;
    if (!uniqueRefs.has(key)) uniqueRefs.set(key, ref);
  }
  const refs = Array.from(uniqueRefs.values()).slice(0, 12);
  const visibleCharacterNames = refs
    .filter((ref) => String(ref.data?.assetKind || "") === "characters")
    .map((ref) => String(ref.data?.assetName || ref.data?.label || "").trim())
    .filter(Boolean);
  const referenceRows = Math.ceil(refs.length / POSITIONING_BOARD_REFERENCE_COLUMNS);
  const referenceHeight = referenceRows > 0
    ? referenceRows * POSITIONING_BOARD_REFERENCE_NODE_HEIGHT + Math.max(0, referenceRows - 1) * POSITIONING_BOARD_REFERENCE_NODE_GAP_Y
    : 0;
  const sectionHeight = Math.max(
    360,
    42 + Math.max(referenceHeight, POSITIONING_BOARD_GENERATION_NODE_HEIGHT) + 12,
  );
  const sectionX = -760;
  const sectionY = baseY;
  const generationX = POSITIONING_BOARD_GENERATION_NODE_X;
  const generationY = 42;
  const referenceLabels = refs.map((ref) => String(ref.data?.assetName || ref.data?.label || "参考图")).filter(Boolean);
  const prompt = buildClipPositioningBoardPrompt({
    clip,
    shots,
    referenceLabels,
    visibleCharacterNames,
    projectName: project.name,
  });
  const existingGenerationNode = nextNodes.find((node) => node.id === generationNodeId);
  const existingGenerationData = isRecord(existingGenerationNode?.data) ? existingGenerationNode.data : {};
  const hasExistingGeneration = Boolean(existingGenerationNode);
  const existingOutputImages = Array.isArray(existingGenerationData.outputImages) ? existingGenerationData.outputImages : [];
  const hasGeneratedOutput = Boolean(existingGenerationData.outputImage || existingOutputImages.length > 0);
  const shouldResetFailedEmptyState = hasExistingGeneration && existingGenerationData.status === "failed" && !hasGeneratedOutput;

  nextNodes = upsertNode(nextNodes, {
    id: sectionId,
    type: "section",
    position: { x: sectionX, y: sectionY },
    style: { width: POSITIONING_BOARD_SECTION_WIDTH, height: sectionHeight },
    zIndex: 0,
    data: {
      title: `${String(clip.title || `Clip ${index + 1}`)} · 定位板图片流程`,
      description: "为本 Clip 生成场景与角色站位定位板；仅新增图片流程，不覆盖视频流程。",
      tone: "emerald",
      itemCount: refs.length + 1,
      clipId,
      clipOrder: index + 1,
      sourceEpisodeId: episodeId,
      sectionKind: "clip-positioning-board",
      positioningBoardFlow: true,
    },
  });
  createdSections += 1;

  nextNodes = upsertNode(nextNodes, {
    id: generationNodeId,
    type: "generation",
    parentId: sectionId,
    extent: "parent",
    expandParent: false,
    position: { x: generationX, y: generationY },
    style: { width: POSITIONING_BOARD_GENERATION_NODE_WIDTH },
    zIndex: 1,
    data: {
      mode: "standalone",
      title: `${String(clip.title || clipId)} 定位板`,
      description: `生成本 Clip 的场景/角色定位板，已接入 ${refs.length} 张场景和资产参考。`,
      prompt,
      finalPrompt: prompt,
      manualFinalPrompt: true,
      status: shouldResetFailedEmptyState ? "waiting" : hasExistingGeneration ? existingGenerationData.status : "waiting",
      error: shouldResetFailedEmptyState ? "" : hasExistingGeneration ? existingGenerationData.error : "",
      outputImage: hasExistingGeneration ? existingGenerationData.outputImage : "",
      outputImageAssetId: hasExistingGeneration ? existingGenerationData.outputImageAssetId : "",
      outputImages: hasExistingGeneration ? existingOutputImages : [],
      generationStartedAt: hasExistingGeneration ? existingGenerationData.generationStartedAt : "",
      size: "16:9",
      resolution: "2k",
      quality: "high",
      format: "png",
      clipId,
      clipTitle: String(clip.title || clipId),
      clipNodeKind: "positioning-board",
      sourceEpisodeId: episodeId,
      positioningBoardFlow: true,
      lightweightGeneration: true,
    },
  });
  createdGenerationNodes += 1;

  refs.forEach((sourceRef, refIndex) => {
    const sourceData = isRecord(sourceRef.data) ? sourceRef.data : {};
    const refNodeId = `clip-position-board-ref-${episodeId}-${clipKey}-${stableIdPart(sourceData.assetKind || "asset", "asset")}-${stableIdPart(sourceData.assetName || sourceData.label || refIndex, `ref-${refIndex}`)}`;
    const column = refIndex % POSITIONING_BOARD_REFERENCE_COLUMNS;
    const row = Math.floor(refIndex / POSITIONING_BOARD_REFERENCE_COLUMNS);
    nextNodes = upsertNode(nextNodes, {
      id: refNodeId,
      type: "imageInput",
      parentId: sectionId,
      extent: "parent",
      expandParent: false,
      position: {
        x: 12 + column * (POSITIONING_BOARD_REFERENCE_NODE_WIDTH + POSITIONING_BOARD_REFERENCE_NODE_GAP_X),
        y: 42 + row * (POSITIONING_BOARD_REFERENCE_NODE_HEIGHT + POSITIONING_BOARD_REFERENCE_NODE_GAP_Y),
      },
      style: {
        width: POSITIONING_BOARD_REFERENCE_NODE_WIDTH,
        height: POSITIONING_BOARD_REFERENCE_NODE_HEIGHT,
      },
      zIndex: 1,
      data: {
        ...sourceData,
        label: `${sourceData.assetKind === "scenes" ? "场景" : sourceData.assetKind === "props" ? "道具" : "角色"} · ${String(sourceData.assetName || sourceData.label || "参考")}`,
        sourceClipId: clipId,
        targetClipId: clipId,
        sourceEpisodeId: episodeId,
        positioningBoardFlow: true,
        lightweightReference: true,
        sourceReferenceNodeId: sourceRef.id,
      },
    });
    createdReferenceNodes += 1;

    const edgeId = `clip-position-board-ref-edge-${refNodeId}-${generationNodeId}`;
    const before = nextEdges.length;
    nextEdges = upsertEdge(nextEdges, {
      id: edgeId,
      source: refNodeId,
      sourceHandle: null,
      target: generationNodeId,
      targetHandle: null,
      type: "smoothstep",
    });
    if (nextEdges.length > before) createdEdges += 1;
  });
}

const nextScene = {
  ...scene,
  nodes: nextNodes,
  edges: nextEdges,
  updatedAt: new Date().toISOString(),
};
const nextMetadata = {
  ...metadata,
  canvasScenes: {
    ...canvasScenes,
    [episodeId]: nextScene,
  },
};

await prisma.project.update({
  where: { id: projectId },
  data: { metadata: nextMetadata },
});

console.log(JSON.stringify({
  projectId,
  episodeId,
  clips: clips.length,
  createdSections,
  createdGenerationNodes,
  createdReferenceNodes,
  createdEdges,
  nodes: nextNodes.length,
  edges: nextEdges.length,
}, null, 2));

await prisma.$disconnect();
