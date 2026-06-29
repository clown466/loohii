import { isRecord } from "./mappers";
import {
  ensureClipStoryboardBoardLayoutPrompt,
  finalizeClipStoryboardImagePrompt,
  hasLegacyClipStoryboardImageLayoutPrompt,
} from "./storyboardPrompt";

type CanvasNode = Record<string, unknown> & {
  id: string;
  type?: string;
  data?: Record<string, unknown>;
  parentId?: string;
  position?: { x?: number; y?: number };
  style?: Record<string, unknown>;
  zIndex?: number;
  extent?: unknown;
  expandParent?: boolean;
};

type CanvasEdge = Record<string, unknown> & {
  id?: string;
  source?: string;
  target?: string;
  sourceHandle?: unknown;
  targetHandle?: unknown;
};

type WorkflowClip = {
  id: string;
  title: string;
  setting?: string;
  characters?: string[];
  shotIds?: string[];
  plotGoal?: string;
  startState?: string;
  endState?: string;
  layoutMemory?: string;
  storyboardPrompt?: string;
  seedancePrompt?: string;
};

export type StoryboardReference = {
  clipId: string;
  clipTitle: string;
  title: string;
  url: string;
  assetId: string;
  prompt?: string;
  nodeId?: string;
  sourceEpisode?: string;
  sourceEpisodeId?: string;
  sourceClip: WorkflowClip;
};

export type CanvasStoryboardGenerationRecord = {
  prompt?: string | null;
  input?: unknown;
  parameters?: unknown;
  status?: string | null;
  queuedAt?: Date | string | null;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  assets?: Array<{
    id?: string | null;
    type?: string | null;
    title?: string | null;
    url?: string | null;
    metadata?: unknown;
  }>;
};

const CANVAS_SECTION_PADDING_X = 12;
const CANVAS_SECTION_HEADER_HEIGHT = 42;
const CANVAS_SECTION_PADDING_BOTTOM = 12;
const CANVAS_REFERENCE_NODE_WIDTH = 340;
const CANVAS_REFERENCE_NODE_HEIGHT = 248;
const CANVAS_REFERENCE_NODE_GAP_X = 12;
const CANVAS_REFERENCE_NODE_GAP_Y = 10;
const CANVAS_REFERENCE_ROWS_PER_COLUMN = 4;
const CANVAS_TARGET_SECTION_GAP = 18;
const CANVAS_GENERATION_NODE_HEIGHT = 560;
const CANVAS_VIDEO_NODE_HEIGHT = 620;

export function normalizeCanvasStoryboardReferencesForScene(
  rawNodes: unknown[],
  rawEdges: unknown[],
  metadata: unknown,
  storyboardGenerationRefs: StoryboardReference[] = [],
  episodeId = "",
): { nodes: CanvasNode[]; edges: CanvasEdge[]; changed: boolean } {
  let nodes = rawNodes.filter(isCanvasNode);
  const edges = rawEdges.filter(isCanvasEdge);
  const clips = workflowClipsFromMetadata(metadata, episodeId);
  if (clips.length === 0 || nodes.length === 0) {
    return { nodes, edges, changed: nodes.length !== rawNodes.length || edges.length !== rawEdges.length };
  }

  const recoveredStoryboards = recoverCanvasStoryboardImagesFromReferences(nodes, clips, storyboardGenerationRefs);
  nodes = recoveredStoryboards.nodes;
  const patches = new Map<string, Partial<CanvasNode>>();
  const additions: CanvasNode[] = [];
  const removeNodeIds = new Set<string>();
  let nextEdges = edges;
  let changed = nodes.length !== rawNodes.length || edges.length !== rawEdges.length || recoveredStoryboards.changed;

  const patchNode = (nodeId: string, patch: Partial<CanvasNode>) => {
    const current = patches.get(nodeId) ?? {};
    patches.set(nodeId, { ...current, ...patch });
    changed = true;
  };

  const addEdgeIfMissing = (source: string, target: string) => {
    if (hasCanvasConnection(nextEdges, source, target)) return;
    nextEdges = [
      ...nextEdges,
      {
        id: canvasAutoEdgeId("storyboard-ref", source, target),
        source,
        target,
        sourceHandle: null,
        targetHandle: null,
      },
    ];
    changed = true;
  };

  for (const clip of clips) {
    const storyNode = findClipStoryboardGenerationNode(nodes, clip);
    const stableStoryboardUrls = new Set<string>();
    const storyUrl = storyNode ? canvasNodeReferenceUrl(storyNode) : "";
    if (storyUrl) stableStoryboardUrls.add(storyUrl);
    for (const node of nodes) {
      if (isStoryboardSlotNodeForClip(node, clip)) {
        const slotUrl = canvasNodeReferenceUrl(node);
        if (slotUrl) stableStoryboardUrls.add(slotUrl);
      }
    }
    if (stableStoryboardUrls.size === 0) continue;
    for (const node of nodes) {
      if (!isAutoVideoStoryboardReferenceNode(node)) continue;
      if (!isClipStoryboardNodeForClip(node, clip)) continue;
      const url = canvasNodeReferenceUrl(node);
      if (!url || !stableStoryboardUrls.has(url)) continue;
      removeNodeIds.add(node.id);
      changed = true;
    }
  }

  for (const section of nodes.filter(isClipStoryboardAssetSection)) {
    const clip = clips.find((item) => item.id === stringValue(section.data?.clipId));
    if (!clip) continue;

    const currentNodes = [...nodes, ...additions].filter((node) => !removeNodeIds.has(node.id));
    const childNodes = currentNodes.filter((node) => node.parentId === section.id);
    const childOrder = new Map(childNodes.map((node, index) => [node.id, index]));
    const generationNode = childNodes.find((node) => node.type === "generation" && isClipStoryboardNodeForClip(node, clip));
    if (!generationNode) continue;
    const generationIsRunning = isActiveCanvasGenerationStatus(generationNode.data?.status);

    const previousRef = findPreviousClipStoryboardReference(clip, clips, currentNodes);
    const staleChildIds = new Set<string>();

    const preferredPreviousNodeId = preferredStoryboardReferenceNodeId(childNodes, previousRef, clip);
    for (const child of childNodes) {
      if (child.type !== "imageInput") continue;
      const assetKind = stringValue(child.data?.assetKind);
      const childUrl = canvasNodeReferenceUrl(child);
      if (assetKind === "scenes") {
        staleChildIds.add(child.id);
      } else if (isStoryboardReferenceInputNode(child) && (!previousRef?.url || childUrl !== previousRef.url)) {
        staleChildIds.add(child.id);
      } else if (isStoryboardReferenceInputNode(child) && preferredPreviousNodeId && child.id !== preferredPreviousNodeId) {
        staleChildIds.add(child.id);
      }
    }

    for (const nodeId of staleChildIds) {
      removeNodeIds.add(nodeId);
      changed = true;
    }

    let previousNode = childNodes.find((node) => (
      !staleChildIds.has(node.id) &&
      isStoryboardReferenceInputNode(node) &&
      Boolean(previousRef?.url) &&
      canvasNodeReferenceUrl(node) === previousRef?.url
    ));

    if (previousRef?.url && !previousNode) {
      const nodeId = uniqueCanvasNodeId(
        `storyboard-prev-${generationNode.id}-${previousRef.assetId || previousRef.sourceClip.id || previousRef.clipId || "ref"}`,
        [...nodes, ...additions],
      );
      previousNode = {
        id: nodeId,
        type: "imageInput",
        parentId: section.id,
        extent: "parent",
        expandParent: false,
        position: { x: CANVAS_SECTION_PADDING_X, y: CANVAS_SECTION_HEADER_HEIGHT },
        style: { width: CANVAS_REFERENCE_NODE_WIDTH },
        zIndex: 1,
        data: {
          label: `上一个故事板: ${previousRef.sourceClip.title || previousRef.clipTitle || previousRef.title || "上一段"}`,
          imageUrl: previousRef.url,
          imageAspectRatio: 1.78,
          fileName: `${previousRef.title || previousRef.sourceClip.title || "previous-storyboard"}.png`,
          uploadStatus: "linked",
          sourcePrompt: `上一个故事板，用于延续 ${clip.title || "Clip"} 的场景和角色位置`,
          uploadError: "",
          imageLoadError: false,
          clipNodeKind: "storyboard-reference",
          storyboardForClip: false,
          sourceClipId: previousRef.sourceClip.id || previousRef.clipId || "",
          sourceClipTitle: previousRef.sourceClip.title || previousRef.clipTitle || "",
          targetClipId: clip.id,
          assetId: previousRef.assetId || "",
        },
      };
      additions.push(previousNode);
      changed = true;
    }

    if (previousNode) addEdgeIfMissing(previousNode.id, generationNode.id);

    const nextPrompt = replacePreviousStoryboardContinuityPrompt(
      finalizeClipStoryboardImagePrompt(
        generationNode.data?.finalPrompt || generationNode.data?.prompt || "",
        positiveNumber(generationNode.data?.storyboardPanelCount) ?? positiveNumber(generationNode.data?.panelCount) ?? undefined,
      ),
      previousRef,
    );
    if (!generationIsRunning && nextPrompt && (generationNode.data?.prompt !== nextPrompt || generationNode.data?.finalPrompt !== nextPrompt)) {
      patchNode(generationNode.id, {
        data: {
          ...generationNode.data,
          prompt: nextPrompt,
          finalPrompt: nextPrompt,
          manualFinalPrompt: true,
          previousStoryboardAssetId: previousRef?.assetId || "",
        },
      });
    }

    const referenceNodes = childNodes
      .filter((node) => node.type === "imageInput" && !staleChildIds.has(node.id))
      .concat(previousNode && !childNodes.some((node) => node.id === previousNode?.id) ? [previousNode] : [])
      .filter((node, index, list) => list.findIndex((item) => item.id === node.id) === index)
      .sort((a, b) => {
        const aPrev = isStoryboardReferenceInputNode(a) ? 0 : 1;
        const bPrev = isStoryboardReferenceInputNode(b) ? 0 : 1;
        if (aPrev !== bPrev) return aPrev - bPrev;
        return (childOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (childOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER);
      });

    const referenceGrid = canvasReferenceGridMetrics(referenceNodes.length);
    const referenceAreaWidth = referenceNodes.length ? referenceGrid.width : 0;
    const generationPosition = {
      x: CANVAS_SECTION_PADDING_X + (referenceNodes.length ? referenceAreaWidth + CANVAS_TARGET_SECTION_GAP : 0),
      y: CANVAS_SECTION_HEADER_HEIGHT,
    };

    for (const [index, refNode] of referenceNodes.entries()) {
      const position = canvasReferenceGridPosition({ x: CANVAS_SECTION_PADDING_X, y: CANVAS_SECTION_HEADER_HEIGHT }, index);
      const imageAspectRatio = isStoryboardReferenceInputNode(refNode) ? 1.78 : positiveNumber(refNode.data?.imageAspectRatio) ?? 1.45;
      const nextData: Record<string, unknown> = {
        ...(refNode.data ?? {}),
        imageAspectRatio,
      };
      if (isStoryboardReferenceInputNode(refNode)) {
        delete nextData.assetKind;
        delete nextData.assetName;
      }
      const nextStyle = {
        ...(refNode.style ?? {}),
        width: preferredImageInputNodeWidth(nextData),
        height: preferredImageInputNodeHeight(nextData),
      };
      if (
        numberValue(refNode.position?.x) !== position.x ||
        numberValue(refNode.position?.y) !== position.y ||
        refNode.parentId !== section.id ||
        refNode.zIndex !== 1 ||
        !sameJson(refNode.style ?? {}, nextStyle) ||
        refNode.data?.imageAspectRatio !== imageAspectRatio
      ) {
        patchNode(refNode.id, {
          parentId: section.id,
          extent: "parent",
          expandParent: false,
          position,
          style: nextStyle,
          zIndex: 1,
          data: nextData,
        });
      }
    }

    const sectionWidth = CANVAS_SECTION_PADDING_X * 2 + (referenceNodes.length ? referenceAreaWidth + CANVAS_TARGET_SECTION_GAP : 0) + 380;
    const sectionHeight = CANVAS_SECTION_HEADER_HEIGHT + Math.max(referenceGrid.height, CANVAS_GENERATION_NODE_HEIGHT) + CANVAS_SECTION_PADDING_BOTTOM;
    if (
      numberValue(generationNode.position?.x) !== generationPosition.x ||
      numberValue(generationNode.position?.y) !== generationPosition.y ||
      generationNode.parentId !== section.id ||
      generationNode.zIndex !== 1
    ) {
      patchNode(generationNode.id, {
        parentId: section.id,
        extent: "parent",
        expandParent: false,
        position: generationPosition,
        zIndex: 1,
      });
    }

    const generationDescription = referenceNodes.length
      ? `Clip 级导演故事板生图节点，已接入 ${referenceNodes.length} 张参考图${previousNode ? "，含上一个故事板" : ""}`
      : "Clip 级导演故事板生图节点，当前没有匹配到可用资产参考图";
    if (
      generationNode.data?.description !== generationDescription ||
      generationNode.data?.previousStoryboardAssetId !== (previousRef?.assetId || previousRef?.nodeId || "")
    ) {
      patchNode(generationNode.id, {
        data: {
          ...(generationNode.data ?? {}),
          description: generationDescription,
          previousStoryboardAssetId: previousRef?.assetId || previousRef?.nodeId || "",
        },
      });
    }

    const sectionDescription = "角色参考和上一个故事板连到右侧故事板生图；道具由角色图承载";
    if (
      numericCanvasSize(section.style?.width) !== sectionWidth ||
      numericCanvasSize(section.style?.height) !== sectionHeight ||
      section.data?.description !== sectionDescription
    ) {
      patchNode(section.id, {
        style: { ...(section.style ?? {}), width: sectionWidth, height: sectionHeight },
        data: {
          ...(section.data ?? {}),
          description: sectionDescription,
        },
      });
    }
  }

  for (const [index, clip] of clips.entries()) {
    const visibleNodes = [...nodes, ...additions].filter((node) => !removeNodeIds.has(node.id));
    const storyNode = findClipStoryboardGenerationNode(visibleNodes, clip);
    const videoNode = findClipVideoNode(visibleNodes, clip);
    const videoSection = videoNode?.parentId ? visibleNodes.find((node) => node.id === videoNode.parentId && isClipVideoAssetSection(node)) : null;
    if (storyNode && videoNode) {
      if (videoSection) {
        let slotNode = visibleNodes.find((node) => isStoryboardSlotNodeForClip(node, clip) && node.parentId === videoSection.id);
        if (!slotNode) {
          slotNode = {
            id: uniqueCanvasNodeId(`episode-sync-video-storyboard-slot-${clip.id || clip.title || "clip"}`, [...nodes, ...additions]),
            type: "imageInput",
            parentId: videoSection.id,
            extent: "parent",
            expandParent: false,
            position: { x: CANVAS_SECTION_PADDING_X, y: CANVAS_SECTION_HEADER_HEIGHT },
            style: { width: CANVAS_REFERENCE_NODE_WIDTH, height: preferredImageInputNodeHeight({ imageAspectRatio: 1.78, fileName: `${clip.title || "Clip"}-storyboard.png` }) },
            zIndex: 1,
            data: storyboardSlotData(clip, storyNode),
          };
          additions.push(slotNode);
          changed = true;
        } else {
          const nextSlotData = storyboardSlotData(clip, storyNode, slotNode.data);
          const nextSlotStyle = {
            ...(slotNode.style ?? {}),
            width: CANVAS_REFERENCE_NODE_WIDTH,
            height: preferredImageInputNodeHeight(nextSlotData),
          };
          if (
            slotNode.parentId !== videoSection.id ||
            slotNode.zIndex !== 1 ||
            !sameJson(slotNode.style ?? {}, nextSlotStyle) ||
            !sameJson(slotNode.data ?? {}, nextSlotData)
          ) {
            patchNode(slotNode.id, {
              parentId: videoSection.id,
              extent: "parent",
              expandParent: false,
              style: nextSlotStyle,
              zIndex: 1,
              data: nextSlotData,
            });
          }
        }

        if (slotNode) {
          addEdgeIfMissing(storyNode.id, slotNode.id);
          addEdgeIfMissing(slotNode.id, videoNode.id);
          normalizeVideoSectionStoryboardSlotLayout(videoSection, videoNode, slotNode, visibleNodes, patchNode);
          const prunedDirectEdges = nextEdges.filter((edge) => !(edge.source === storyNode.id && edge.target === videoNode.id));
          if (prunedDirectEdges.length !== nextEdges.length) {
            nextEdges = prunedDirectEdges;
            changed = true;
          }
        }
      }
    }

    const previousClip = index > 0 ? clips[index - 1] : null;
    const previousStoryNode = previousClip ? findClipStoryboardGenerationNode(visibleNodes, previousClip) : null;
    if (previousStoryNode && storyNode) addEdgeIfMissing(previousStoryNode.id, storyNode.id);
  }

  if (removeNodeIds.size > 0) {
    const prunedEdges = nextEdges.filter((edge) => !removeNodeIds.has(stringValue(edge.source)) && !removeNodeIds.has(stringValue(edge.target)));
    if (prunedEdges.length !== nextEdges.length) {
      nextEdges = prunedEdges;
      changed = true;
    }
  }

  if (!changed) return { nodes, edges, changed: false };

  const nextNodes = recalculateCanvasSectionItemCounts([
    ...nodes
      .filter((node) => !removeNodeIds.has(node.id))
      .map((node) => ({ ...node, ...(patches.get(node.id) ?? {}) })),
    ...additions
      .filter((node) => !removeNodeIds.has(node.id))
      .map((node) => ({ ...node, ...(patches.get(node.id) ?? {}) })),
  ]);
  return { nodes: nextNodes, edges: nextEdges, changed: true };
}

export function storyboardReferencesFromGenerationRecords(
  records: CanvasStoryboardGenerationRecord[],
  metadata: unknown,
  episodeId = "",
): StoryboardReference[] {
  const clips = workflowClipsFromMetadata(metadata, episodeId);
  if (clips.length === 0) return [];

  const refs: StoryboardReference[] = [];
  const seen = new Set<string>();
  const seenMatchedClips = new Set<string>();
  const orderedRecords = [...records].sort((a, b) => generationRecordTime(b) - generationRecordTime(a));

  for (const record of orderedRecords) {
    if (episodeId && !generationRecordBelongsToEpisode(record, episodeId, metadata)) continue;
    if (record.status !== "SUCCEEDED") continue;
    if (generationRecordInputKind(record) !== "canvas-image-generation") continue;
    const image = generationRecordImage(record);
    if (!image?.url) continue;

    const searchable = storyboardRecordOwnershipText(record, image);
    if (!looksLikeStoryboardPrompt(searchable)) continue;
    if (hasLegacyClipStoryboardImageLayoutPrompt(record.prompt)) continue;

    const explicitClip = generationRecordExplicitStoryboardClip(record, clips);
    const searchableWithoutPreviousRef = stripPreviousStoryboardContinuityText(record.prompt).replace(/\s+/g, " ").trim();
    const matchedClip = explicitClip ?? clips.find((clip) => recordHasExplicitClipAnchor(searchableWithoutPreviousRef, clip));
    if (!matchedClip) continue;
    if (seenMatchedClips.has(matchedClip.id)) continue;

    const key = `${matchedClip.id}:${image.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    seenMatchedClips.add(matchedClip.id);

    refs.push({
      clipId: matchedClip.id,
      clipTitle: matchedClip.title,
      title: `${matchedClip.title || "Clip"} 故事板`,
      url: image.url,
      assetId: image.assetId || "",
      prompt: stringValue(record.prompt),
      sourceEpisode: generationRecordSourceEpisode(record),
      sourceEpisodeId: generationRecordSourceEpisodeId(record),
      sourceClip: matchedClip,
    });
  }

  return refs;
}

export function preserveExistingClipStoryboardSections(
  incomingRawNodes: unknown[],
  incomingRawEdges: unknown[],
  existingRawNodes: unknown[],
  existingRawEdges: unknown[],
  explicitDeletedNodeIds: string[] = [],
): { nodes: CanvasNode[]; edges: CanvasEdge[]; changed: boolean } {
  const incomingNodes = incomingRawNodes.filter(isCanvasNode);
  const incomingEdges = incomingRawEdges.filter(isCanvasEdge);
  const existingNodes = existingRawNodes.filter(isCanvasNode);
  const existingEdges = existingRawEdges.filter(isCanvasEdge);
  if (existingNodes.length === 0) return { nodes: incomingNodes, edges: incomingEdges, changed: false };

  const deletedIds = new Set(explicitDeletedNodeIds.filter(Boolean));
  const nodeIds = new Set(incomingNodes.map((node) => node.id));
  const nextNodes = [...incomingNodes];
  let changed = false;

  for (const section of existingNodes.filter(isClipStoryboardAssetSection)) {
    if (deletedIds.has(section.id)) continue;
    const descendants = collectCanvasSectionDescendantIds(existingNodes, section.id);
    const protectedIds = new Set([section.id, ...descendants]);
    for (const node of existingNodes) {
      if (deletedIds.has(node.id)) continue;
      if (!protectedIds.has(node.id) || nodeIds.has(node.id)) continue;
      nextNodes.push(node);
      nodeIds.add(node.id);
      changed = true;
    }
  }

  if (!changed) return { nodes: incomingNodes, edges: incomingEdges, changed: false };

  const nextNodeIds = new Set(nextNodes.map((node) => node.id));
  const nextEdges = [...incomingEdges];
  const edgeKeys = new Set(nextEdges.map(canvasEdgeKey));
  for (const edge of existingEdges) {
    if (!edge.source || !edge.target) continue;
    if (!nextNodeIds.has(edge.source) || !nextNodeIds.has(edge.target)) continue;
    const key = canvasEdgeKey(edge);
    if (edgeKeys.has(key)) continue;
    nextEdges.push(edge);
    edgeKeys.add(key);
  }

  return { nodes: nextNodes, edges: nextEdges, changed: true };
}

export function removeCanvasStoryboardNodesForMultiReference(
  rawNodes: unknown[],
  rawEdges: unknown[],
): { nodes: CanvasNode[]; edges: CanvasEdge[]; changed: boolean } {
  const nodes = rawNodes.filter(isCanvasNode);
  const edges = rawEdges.filter(isCanvasEdge);
  const removeNodeIds = new Set<string>();

  for (const node of nodes) {
    if (isMultiReferenceStoryboardNode(node)) {
      removeNodeIds.add(node.id);
    }
  }

  let changed = nodes.length !== rawNodes.length || edges.length !== rawEdges.length || removeNodeIds.size > 0;
  if (!removeNodeIds.size) return { nodes, edges, changed };

  let foundDescendant = true;
  while (foundDescendant) {
    foundDescendant = false;
    for (const node of nodes) {
      if (removeNodeIds.has(node.id)) continue;
      if (node.parentId && removeNodeIds.has(node.parentId)) {
        removeNodeIds.add(node.id);
        foundDescendant = true;
      }
    }
  }

  const nextNodes = nodes.filter((node) => !removeNodeIds.has(node.id));
  const nextNodeIds = new Set(nextNodes.map((node) => node.id));
  const nextEdges = edges.filter((edge) => edge.source && edge.target && nextNodeIds.has(edge.source) && nextNodeIds.has(edge.target));
  if (nextEdges.length !== edges.length) changed = true;

  return { nodes: nextNodes, edges: nextEdges, changed };
}

function isCanvasNode(value: unknown): value is CanvasNode {
  return isRecord(value) && typeof value.id === "string";
}

function isCanvasEdge(value: unknown): value is CanvasEdge {
  return isRecord(value) && typeof value.source === "string" && typeof value.target === "string";
}

function isMultiReferenceStoryboardNode(node: CanvasNode): boolean {
  const data = node.data ?? {};
  const role = stringValue(data.clipSyncRole);
  const nodeId = stringValue(node.id);
  return (
    isClipStoryboardAssetSection(node) ||
    isStoryboardSlotLikeNode(node) ||
    role === "storyboard" ||
    role === "storyboard-slot" ||
    role.startsWith("previous:") ||
    data.storyboardForClip === true ||
    data.storyboardSlotForClip === true ||
    data.clipNodeKind === "storyboard" ||
    data.clipNodeKind === "storyboard-reference" ||
    nodeId.startsWith("episode-sync-storyboard-") ||
    nodeId.startsWith("episode-sync-story-ref-") ||
    nodeId.startsWith("episode-sync-video-storyboard-slot-")
  );
}

function isStoryboardSlotLikeNode(node: CanvasNode): boolean {
  return node.type === "imageInput" && (
    node.data?.storyboardSlotForClip === true ||
    node.data?.clipSyncRole === "storyboard-slot"
  );
}

function workflowClipsFromMetadata(metadata: unknown, episodeId = ""): WorkflowClip[] {
  const workflowCenter = workflowCenterFromMetadata(metadata, episodeId);
  if (!isRecord(workflowCenter) || !Array.isArray(workflowCenter.clips)) return [];
  return workflowCenter.clips
    .map((clip, index): WorkflowClip | null => {
      if (!isRecord(clip)) return null;
      const fallbackId = `clip-${String(index + 1).padStart(3, "0")}`;
      const fallbackTitle = `Clip ${String(index + 1).padStart(2, "0")}`;
      return {
        id: stringValue(clip.id) || fallbackId,
        title: stringValue(clip.title) || fallbackTitle,
        setting: stringValue(clip.setting),
        characters: Array.isArray(clip.characters) ? clip.characters.map(stringValue).filter(Boolean) : [],
        shotIds: Array.isArray(clip.shotIds) ? clip.shotIds.map(stringValue).filter(Boolean) : [],
        plotGoal: stringValue(clip.plotGoal),
        startState: stringValue(clip.startState),
        endState: stringValue(clip.endState),
        layoutMemory: stringValue(clip.layoutMemory),
        storyboardPrompt: stringValue(clip.storyboardPrompt),
        seedancePrompt: stringValue(clip.seedancePrompt),
      };
    })
    .filter((clip): clip is WorkflowClip => Boolean(clip?.id));
}

function recoverCanvasStoryboardImagesFromReferences(
  nodes: CanvasNode[],
  clips: WorkflowClip[],
  refs: StoryboardReference[],
): { nodes: CanvasNode[]; changed: boolean } {
  if (refs.length === 0) return { nodes, changed: false };
  const refByClipId = new Map(refs.filter((ref) => ref.clipId && ref.url).map((ref) => [ref.clipId, ref]));
  if (refByClipId.size === 0) return { nodes, changed: false };

  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (node.type !== "generation") return node;
    const clip = clips.find((item) => isClipStoryboardNodeForClip(node, item));
    if (!clip) return node;
    const ref = refByClipId.get(clip.id);
    if (!ref?.url) return node;
    if (isActiveCanvasGenerationStatus(node.data?.status)) return node;

    const currentOutput = stringValue(node.data?.outputImage);
    const currentAssetId = stringValue(node.data?.outputImageAssetId);
    const nextAssetId = ref.assetId || currentAssetId;
    const nextSubmittedPrompt = ref.prompt || stringValue(node.data?.submittedPrompt);
    const nextData = {
      ...(node.data ?? {}),
      status: "completed",
      outputImage: ref.url,
      outputImageAssetId: nextAssetId,
      submittedPrompt: nextSubmittedPrompt,
      error: "已关联本 Clip 的故事板生成记录。",
      generationStartedAt: "",
      clipSyncUrl: ref.url,
    };
    if (
      currentOutput === ref.url &&
      node.data?.status === "completed" &&
      currentAssetId === nextAssetId &&
      stringValue(node.data?.submittedPrompt) === nextSubmittedPrompt &&
      stringValue(node.data?.clipSyncUrl) === ref.url
    ) {
      return node;
    }

    changed = true;
    return {
      ...node,
      data: nextData,
    };
  });

  return { nodes: nextNodes, changed };
}

function isActiveCanvasGenerationStatus(value: unknown): boolean {
  const status = stringValue(value).toLowerCase();
  return status === "generating" || status === "running" || status === "queued";
}

function findClipStoryboardGenerationNode(nodes: CanvasNode[], clip: WorkflowClip): CanvasNode | null {
  return nodes.find((node) => node.type === "generation" && isClipStoryboardNodeForClip(node, clip)) ?? null;
}

function findClipVideoNode(nodes: CanvasNode[], clip: WorkflowClip): CanvasNode | null {
  return nodes.find((node) => {
    const data = node.data ?? {};
    if (stringValue(data.clipId) !== clip.id) return false;
    return node.type === "video" || data.workflowKind === "video" || data.kind === "video";
  }) ?? null;
}

function storyboardSlotData(clip: WorkflowClip, storyNode: CanvasNode, existing: Record<string, unknown> = {}): Record<string, unknown> {
  const storyUrl = canvasNodeReferenceUrl(storyNode);
  const imageUrl = storyUrl || stringValue(existing.imageUrl);
  const assetId = stringValue(storyNode.data?.outputImageAssetId) || stringValue(storyNode.data?.assetId) || stringValue(existing.assetId);
  return {
    ...existing,
    label: "对应故事板",
    imageUrl,
    imageAspectRatio: 1.78,
    fileName: `${clip.title || "Clip"}-storyboard.png`,
    uploadStatus: imageUrl ? "linked" : "waiting",
    sourcePrompt: stringValue(storyNode.data?.submittedPrompt) || stringValue(storyNode.data?.finalPrompt) || stringValue(storyNode.data?.prompt) || stringValue(existing.sourcePrompt),
    uploadError: "",
    imageLoadError: false,
    clipId: clip.id,
    clipNodeKind: "storyboard",
    storyboardForClip: true,
    storyboardSlotForClip: true,
    sourceClipId: clip.id,
    sourceClipTitle: clip.title,
    targetClipId: clip.id,
    assetId,
    clipSyncRole: "storyboard-slot",
    clipSyncAssetId: assetId,
    clipSyncUrl: imageUrl,
  };
}

function normalizeVideoSectionStoryboardSlotLayout(
  section: CanvasNode,
  videoNode: CanvasNode,
  slotNode: CanvasNode,
  visibleNodes: CanvasNode[],
  patchNode: (nodeId: string, patch: Partial<CanvasNode>) => void,
): void {
  const childNodes = visibleNodes.filter((node) => node.parentId === section.id && node.id !== videoNode.id);
  const sortedRefs = [
    slotNode,
    ...childNodes
      .filter((node) => node.id !== slotNode.id && node.type === "imageInput")
      .sort((a, b) => numberValue(a.position?.y) - numberValue(b.position?.y) || numberValue(a.position?.x) - numberValue(b.position?.x)),
  ].filter((node, index, list) => list.findIndex((item) => item.id === node.id) === index);
  const grid = canvasReferenceGridMetrics(sortedRefs.length);
  const referenceAreaWidth = sortedRefs.length ? grid.width + CANVAS_TARGET_SECTION_GAP : 0;

  for (const [index, refNode] of sortedRefs.entries()) {
    const position = canvasReferenceGridPosition({ x: CANVAS_SECTION_PADDING_X, y: CANVAS_SECTION_HEADER_HEIGHT }, index);
    const imageAspectRatio = isStoryboardSlotNodeForClip(refNode, { id: stringValue(section.data?.clipId), title: stringValue(section.data?.title) }) ? 1.78 : positiveNumber(refNode.data?.imageAspectRatio) ?? 1.45;
    const nextData = { ...(refNode.data ?? {}), imageAspectRatio };
    const nextStyle = {
      ...(refNode.style ?? {}),
      width: preferredImageInputNodeWidth(nextData),
      height: preferredImageInputNodeHeight(nextData),
    };
    if (
      refNode.parentId !== section.id ||
      numberValue(refNode.position?.x) !== position.x ||
      numberValue(refNode.position?.y) !== position.y ||
      refNode.zIndex !== 1 ||
      !sameJson(refNode.style ?? {}, nextStyle) ||
      !sameJson(refNode.data ?? {}, nextData)
    ) {
      patchNode(refNode.id, {
        parentId: section.id,
        extent: "parent",
        expandParent: false,
        position,
        style: nextStyle,
        zIndex: 1,
        data: nextData,
      });
    }
  }

  const videoPosition = {
    x: CANVAS_SECTION_PADDING_X + referenceAreaWidth,
    y: CANVAS_SECTION_HEADER_HEIGHT,
  };
  if (
    videoNode.parentId !== section.id ||
    numberValue(videoNode.position?.x) !== videoPosition.x ||
    numberValue(videoNode.position?.y) !== videoPosition.y ||
    videoNode.zIndex !== 1
  ) {
    patchNode(videoNode.id, {
      parentId: section.id,
      extent: "parent",
      expandParent: false,
      position: videoPosition,
      zIndex: 1,
    });
  }

  const sectionWidth = CANVAS_SECTION_PADDING_X * 2 + referenceAreaWidth + 540;
  const sectionHeight = CANVAS_SECTION_HEADER_HEIGHT + Math.max(grid.height, CANVAS_VIDEO_NODE_HEIGHT) + CANVAS_SECTION_PADDING_BOTTOM;
  const sectionDescription = `当前集自动同步的视频生成任务，已保留对应故事板坑位。`;
  if (
    numericCanvasSize(section.style?.width) !== sectionWidth ||
    numericCanvasSize(section.style?.height) !== sectionHeight ||
    section.data?.description !== sectionDescription
  ) {
    patchNode(section.id, {
      style: { ...(section.style ?? {}), width: sectionWidth, height: sectionHeight },
      data: {
        ...(section.data ?? {}),
        description: sectionDescription,
      },
    });
  }
}

function isClipStoryboardAssetSection(node: CanvasNode): boolean {
  return node.type === "section" && node.data?.sectionKind === "clip-storyboard-assets" && typeof node.data?.clipId === "string";
}

function isClipVideoAssetSection(node: CanvasNode): boolean {
  return node.type === "section" && node.data?.sectionKind === "clip-video-assets" && typeof node.data?.clipId === "string";
}

function isStoryboardReferenceInputNode(node: CanvasNode): boolean {
  return node.type === "imageInput" && node.data?.clipNodeKind === "storyboard-reference";
}

function preferredStoryboardReferenceNodeId(nodes: CanvasNode[], previousRef: StoryboardReference | null, clip: WorkflowClip): string {
  if (!previousRef?.url) return "";
  const previousUrl = canvasNodeReferenceUrlKey(previousRef.url);
  const sourceClipId = previousRef.sourceClip.id || previousRef.clipId || "";
  const candidates = nodes.filter((node) => {
    if (!isStoryboardReferenceInputNode(node)) return false;
    if (canvasNodeReferenceUrlKey(canvasNodeReferenceUrl(node)) !== previousUrl) return false;
    const targetClipId = stringValue(node.data?.targetClipId);
    const nodeSourceClipId = stringValue(node.data?.sourceClipId);
    if (targetClipId && targetClipId !== clip.id) return false;
    if (sourceClipId && nodeSourceClipId && nodeSourceClipId !== sourceClipId) return false;
    return true;
  });
  if (!candidates.length) return "";
  candidates.sort((left, right) => storyboardReferenceNodePriority(left) - storyboardReferenceNodePriority(right));
  return candidates[0].id;
}

function storyboardReferenceNodePriority(node: CanvasNode): number {
  const id = node.id || "";
  if (id.startsWith("episode-sync-story-ref-")) return 0;
  if (id.startsWith("storyboard-prev-")) return 1;
  return 2;
}

function isStoryboardSlotNodeForClip(node: CanvasNode, clip: WorkflowClip): boolean {
  return node.type === "imageInput" &&
    (node.data?.storyboardSlotForClip === true || node.data?.clipSyncRole === "storyboard-slot") &&
    stringValue(node.data?.clipId) === clip.id;
}

function isAutoVideoStoryboardReferenceNode(node: CanvasNode): boolean {
  return node.id.startsWith("storyboard-ref-") &&
    node.type === "imageInput" &&
    node.data?.clipNodeKind === "storyboard" &&
    node.data?.storyboardForClip === true;
}

function isClipStoryboardNodeForClip(node: CanvasNode, clip: WorkflowClip): boolean {
  const data = node.data ?? {};
  if (node.type !== "generation" && node.type !== "imageInput") return false;
  const searchable = [
    data.title,
    data.label,
    data.description,
    data.sourcePrompt,
    data.prompt,
    data.finalPrompt,
    data.submittedPrompt,
  ].filter(Boolean).join("\n");
  if (looksLikeCharacterReferenceSheet(searchable)) return false;
  const dataClipId = stringValue(data.clipId);
  if (dataClipId && dataClipId === clip.id) {
    return data.clipNodeKind === "storyboard" || data.storyboardForClip === true || /故事板|storyboard/i.test(stringValue(data.title) || stringValue(data.description));
  }
  if (dataClipId && dataClipId !== clip.id) return false;
  const clipTitle = normalizeCompareText(clip.title);
  const title = normalizeCompareText(stringValue(data.title));
  return Boolean(clipTitle && title.includes(clipTitle) && /故事板|storyboard/i.test(stringValue(data.title) || stringValue(data.description)));
}

function looksLikeCharacterReferenceSheet(value: unknown): boolean {
  const text = stringValue(value);
  return /character reference sheet|角色设定图|角色参考图/i.test(text) && !/故事板|storyboard/i.test(text);
}

function collectClipStoryboardImageReferences(clip: WorkflowClip, nodes: CanvasNode[]): StoryboardReference[] {
  const refs: StoryboardReference[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    if (!isClipStoryboardNodeForClip(node, clip)) continue;
    if (node.type === "generation" && node.data?.status && node.data.status !== "completed") continue;
    const url = canvasNodeReferenceUrl(node);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    refs.push({
      clipId: clip.id,
      clipTitle: clip.title,
      title: stringValue(node.data?.title) || `${clip.title || "Clip"} 故事板`,
      url,
      assetId: stringValue(node.data?.outputImageAssetId) || stringValue(node.data?.assetId),
      nodeId: node.id,
      sourceClip: clip,
    });
  }
  return refs.slice(0, 6);
}

function findPreviousClipStoryboardReference(clip: WorkflowClip, clips: WorkflowClip[], nodes: CanvasNode[]): StoryboardReference | null {
  const clipIndex = clips.findIndex((item) => item.id === clip.id);
  if (clipIndex <= 0) return null;
  const previousClip = clips[clipIndex - 1];
  const imageRef = collectClipStoryboardImageReferences(previousClip, nodes)[0];
  if (imageRef) return imageRef;
  const previousNode = findClipStoryboardGenerationNode(nodes, previousClip);
  if (!previousNode) return null;
  return {
    clipId: previousClip.id,
    clipTitle: previousClip.title,
    title: stringValue(previousNode.data?.title) || `${previousClip.title || "Clip"} 故事板`,
    url: canvasNodeReferenceUrl(previousNode),
    assetId: stringValue(previousNode.data?.outputImageAssetId) || stringValue(previousNode.data?.assetId),
    nodeId: previousNode.id,
    sourceClip: previousClip,
  };
}

function canvasNodeReferenceUrl(node: CanvasNode): string {
  if (node.type === "imageInput") return stringValue(node.data?.imageUrl);
  if (node.type === "character") return stringValue(node.data?.avatar);
  if (node.type === "generation") return stringValue(node.data?.outputImage);
  return "";
}

function canvasNodeReferenceUrlKey(value: string): string {
  return value.trim();
}

function stripPreviousStoryboardContinuityText(value: unknown): string {
  return stringValue(value)
    .replace(/Use the linked previous storyboard image[\s\S]*?as the continuity reference for scene layout[\s\S]*?(?:resetting the scene\.|character positions\.?)\s*/gi, " ")
    .replace(/Previous Clip end state to continue from:[\s\S]*?(?=(?:Reference image map:|Create one|Create a|Required continuity characters:|Character reference lock:|Dialogue lock:|Panel\s+\d+:|$))/gi, " ")
    .replace(/(^|\n)\s*上一个故事板[:：][^\n。.]*(?:[。.])?\s*(?=\n|$)/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function replaceLegacyContinuityCastRule(prompt: unknown): string {
  return stringValue(prompt).replace(
    /Wide\/establishing storyboard panels should include the required continuity characters when they are present in the scene, even if some are silent or edge-of-frame\./gi,
    "This is continuity context, not a requirement to draw every listed character in every panel. Use each panel's visible cast and framing note to decide who is actually on screen.",
  );
}

function generationRecordInputKind(record: CanvasStoryboardGenerationRecord): string {
  const input = generationRecordObject(record.input);
  return stringValue(input.kind);
}

function generationRecordImage(record: CanvasStoryboardGenerationRecord): { url: string; assetId: string; title: string } | null {
  const assets = Array.isArray(record.assets) ? record.assets : [];
  const asset = assets.find((item) => stringValue(item.url) && stringValue(item.type).toUpperCase() === "IMAGE")
    ?? assets.find((item) => stringValue(item.url));
  const url = publicStoryboardImageUrl(asset?.url);
  if (!url) return null;
  return {
    url,
    assetId: stringValue(asset?.id),
    title: stringValue(asset?.title),
  };
}

function publicStoryboardImageUrl(value: unknown): string {
  const url = stringValue(value);
  const localPublicPath = localPublicUploadPath(url);
  if (localPublicPath) return `https://loohii.com${localPublicPath}`;
  if (/^https?:\/\//i.test(url) || /^\/api\/uploads\/public\//i.test(url)) return url;
  return "";
}

function localPublicUploadPath(value: string): string {
  if (/^\/api\/uploads\/public\//i.test(value)) return value;
  try {
    const url = new URL(value);
    if (/^(localhost|127\.0\.0\.1)$/i.test(url.hostname) && /^\/api\/uploads\/public\//i.test(url.pathname)) {
      return `${url.pathname}${url.search}`;
    }
  } catch {
    return "";
  }
  return "";
}

function generationRecordSourceEpisode(record: CanvasStoryboardGenerationRecord): string {
  for (const metadata of generationRecordMetadataObjects(record)) {
    const sourceEpisode = stringValue(metadata.sourceEpisode);
    if (sourceEpisode) return sourceEpisode;
  }
  return "";
}

function generationRecordSourceEpisodeId(record: CanvasStoryboardGenerationRecord): string {
  for (const metadata of generationRecordMetadataObjects(record)) {
    const sourceEpisodeId = stringValue(metadata.sourceEpisodeId);
    if (sourceEpisodeId) return sourceEpisodeId;
    const sourceEpisode = stringValue(metadata.sourceEpisode);
    if (isWorkflowEpisodeId(sourceEpisode)) return sourceEpisode;
  }
  return "";
}

function generationRecordBelongsToEpisode(record: CanvasStoryboardGenerationRecord, episodeId: string, metadata: unknown): boolean {
  const expectedEpisodeId = episodeId.trim();
  const recordEpisodeId = generationRecordSourceEpisodeId(record);
  if (expectedEpisodeId && recordEpisodeId) {
    return normalizeCompareText(recordEpisodeId) === normalizeCompareText(expectedEpisodeId);
  }

  const recordEpisodeTitle = generationRecordSourceEpisode(record);
  if (recordEpisodeTitle) {
    if (expectedEpisodeId && normalizeCompareText(recordEpisodeTitle) === normalizeCompareText(expectedEpisodeId)) return true;
    const expectedTitle = workflowEpisodeTitleFromMetadata(metadata, expectedEpisodeId);
    return Boolean(expectedTitle) && normalizeCompareText(recordEpisodeTitle) === normalizeCompareText(expectedTitle);
  }

  // Older generations had no episode metadata. Keep them only for the legacy first episode.
  return normalizeCompareText(expectedEpisodeId || "episode-001") === "episode-001";
}

function isWorkflowEpisodeId(value: string): boolean {
  return /^episode(?:-|$)/i.test(value.trim());
}

function generationRecordTime(record: CanvasStoryboardGenerationRecord): number {
  for (const value of [record.completedAt, record.updatedAt, record.createdAt, record.startedAt, record.queuedAt]) {
    const time = dateTimeValue(value);
    if (time > 0) return time;
  }
  return 0;
}

function dateTimeValue(value: unknown): number {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : 0;
  }
  const parsed = Date.parse(stringValue(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function generationRecordObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function generationRecordMetadataObjects(record: CanvasStoryboardGenerationRecord): Record<string, unknown>[] {
  const input = generationRecordObject(record.input);
  const inputMetadata = generationRecordObject(input.metadata);
  const assetMetadata = (record.assets ?? [])
    .map((asset) => generationRecordObject(asset.metadata))
    .filter((metadata) => Object.keys(metadata).length > 0);
  return [
    ...(Object.keys(inputMetadata).length > 0 ? [inputMetadata] : []),
    ...assetMetadata,
  ];
}

function workflowCenterFromMetadata(metadata: unknown, episodeId = ""): unknown {
  const record = isRecord(metadata) ? metadata : {};
  const resolvedEpisodeId = resolveWorkflowEpisodeId(record, episodeId);
  const episodes = getWorkflowEpisodes(record);
  const episode = resolvedEpisodeId ? episodes[resolvedEpisodeId] : undefined;
  if (isRecord(episode) && isRecord(episode.workflowCenter)) return episode.workflowCenter;
  if (isRecord(record.workflowCenter)) return record.workflowCenter;
  return {};
}

function workflowEpisodeTitleFromMetadata(metadata: unknown, episodeId: string): string {
  const record = isRecord(metadata) ? metadata : {};
  const resolvedEpisodeId = resolveWorkflowEpisodeId(record, episodeId);
  const episodes = getWorkflowEpisodes(record);
  const episode = resolvedEpisodeId ? episodes[resolvedEpisodeId] : undefined;
  if (isRecord(episode)) return stringValue(episode.title);
  const workflowCenter = workflowCenterFromMetadata(record, resolvedEpisodeId);
  return isRecord(workflowCenter) ? stringValue(workflowCenter.selectedEpisode) : "";
}

function getWorkflowEpisodes(metadata: unknown): Record<string, Record<string, unknown>> {
  if (!isRecord(metadata) || !isRecord(metadata.episodes)) return {};
  const result: Record<string, Record<string, unknown>> = {};
  for (const [id, value] of Object.entries(metadata.episodes)) {
    if (id && isRecord(value)) result[id] = value;
  }
  return result;
}

function resolveWorkflowEpisodeId(metadata: unknown, episodeIdOrTitle: string): string {
  const requested = episodeIdOrTitle.trim();
  if (!requested) return "";
  const episodes = getWorkflowEpisodes(metadata);
  if (episodes[requested]) return requested;
  const requestedKey = normalizeCompareText(requested);
  for (const [id, episode] of Object.entries(episodes)) {
    const workflowCenter = isRecord(episode.workflowCenter) ? episode.workflowCenter : {};
    if (
      normalizeCompareText(id) === requestedKey ||
      normalizeCompareText(episode.title) === requestedKey ||
      normalizeCompareText(workflowCenter.selectedEpisode) === requestedKey
    ) {
      return id;
    }
  }
  return requested;
}

function readMetadataBoolean(metadata: Record<string, unknown>, key: string): boolean | undefined {
  const value = metadata[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return undefined;
}

function metadataLooksLikeClipStoryboard(metadata: Record<string, unknown>): boolean {
  const storyboardForClip = readMetadataBoolean(metadata, "storyboardForClip");
  if (storyboardForClip === false) return false;
  const clipNodeKind = stringValue(metadata.clipNodeKind);
  if (clipNodeKind && clipNodeKind !== "storyboard") return false;
  if (clipNodeKind === "storyboard" || storyboardForClip === true) return true;
  const text = [stringValue(metadata.title), stringValue(metadata.clipTitle)].join(" ");
  return /故事板|storyboard/i.test(text);
}

function generationRecordExplicitStoryboardClip(record: CanvasStoryboardGenerationRecord, clips: WorkflowClip[]): WorkflowClip | null {
  for (const metadata of generationRecordMetadataObjects(record)) {
    if (!metadataLooksLikeClipStoryboard(metadata)) continue;
    const clipId = stringValue(metadata.clipId);
    if (clipId) {
      const byId = clips.find((clip) => clip.id === clipId);
      if (byId) return byId;
    }
    const clipTitle = normalizedClipNodeTitle(stringValue(metadata.clipTitle) || stringValue(metadata.title));
    if (clipTitle) {
      const byTitle = clips.find((clip) => {
        const candidate = normalizedClipNodeTitle(clip.title);
        return candidate && (candidate === clipTitle || candidate.includes(clipTitle) || clipTitle.includes(candidate));
      });
      if (byTitle) return byTitle;
    }
  }
  return null;
}

function storyboardRecordOwnershipText(record: CanvasStoryboardGenerationRecord, image: { title?: string }): string {
  const metadataText = generationRecordMetadataObjects(record)
    .map((metadata) => [
      stringValue(metadata.clipId),
      stringValue(metadata.clipTitle),
      stringValue(metadata.clipNodeKind),
      stringValue(metadata.title),
    ].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("\n");
  return [
    stripPreviousStoryboardContinuityText(record.prompt),
    metadataText,
    JSON.stringify(record.parameters ?? {}),
    image.title,
  ].filter(Boolean).join("\n");
}

function looksLikeStoryboardPrompt(text: string): boolean {
  if (looksLikeCharacterReferenceSheet(text)) return false;
  return /(storyboard|director board|production board|clip-level director|故事板|导演板|分镜)/i.test(text);
}

function normalizedClipNodeTitle(value: unknown): string {
  return normalizeCompareText(value)
    .replace(/\s*(视频任务|故事板|storyboard|video task|clip-level director board|director board)\s*$/i, "")
    .trim();
}

function recordHasExplicitClipAnchor(text: string, clip: WorkflowClip): boolean {
  const normalized = normalizeCompareText(text);
  if (!normalized) return false;
  if (clip.id && normalized.includes(normalizeCompareText(clip.id))) return true;
  const title = normalizeCompareText(clip.title);
  if (title && normalized.includes(title)) return true;
  const clipNumber = title.match(/\bclip\s*0*(\d+)\b/i)?.[1];
  if (!clipNumber) return false;
  const padded2 = clipNumber.padStart(2, "0");
  const padded3 = clipNumber.padStart(3, "0");
  return new RegExp(`\\bclip\\s*0*${Number(clipNumber)}\\b|\\bclip[-_\\s]?${padded2}\\b|\\bclip[-_\\s]?${padded3}\\b`, "i").test(normalized);
}

function replacePreviousStoryboardContinuityPrompt(prompt: unknown, previous: StoryboardReference | null): string {
  const cleaned = replaceLegacyContinuityCastRule(stripPreviousStoryboardContinuityText(prompt))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!previous?.url && !previous?.nodeId) return cleaned;
  const previousLabel = previous.sourceClip.title || previous.clipTitle || previous.title || "previous Clip";
  const previousEndState = stringValue(previous.sourceClip.endState).replace(/\s+/g, " ").trim();
  const line = [
    `Use the linked previous storyboard image (${previousLabel}) as the continuity reference for scene layout, character positions, and the previous Clip end state; continue the next storyboard from that ending instead of resetting the scene.`,
    previousEndState ? `Previous Clip end state to continue from: ${previousEndState}` : "",
  ].filter(Boolean).join(" ");
  if (normalizeCompareText(cleaned).includes(normalizeCompareText(line))) return cleaned;
  return [line, cleaned].filter(Boolean).join("\n\n");
}

function hasCanvasConnection(edges: CanvasEdge[], source: string, target: string): boolean {
  return edges.some((edge) => edge.source === source && edge.target === target);
}

function canvasAutoEdgeId(prefix: string, sourceId: string, targetId: string): string {
  return `${prefix}-${sourceId}-${targetId}`.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function uniqueCanvasNodeId(base: string, nodes: Array<{ id: string }>): string {
  const normalizedBase = (base || "node").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 140) || "node";
  const existing = new Set(nodes.map((node) => node.id));
  if (!existing.has(normalizedBase)) return normalizedBase;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${normalizedBase}-${index}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${normalizedBase}-${Date.now().toString(36)}`;
}

function preferredImageInputNodeWidth(data: Record<string, unknown>): number {
  const ratio = positiveNumber(data.imageAspectRatio) ?? 1;
  return ratio > 1.15 ? 340 : 260;
}

function preferredImageInputNodeHeight(data: Record<string, unknown>): number {
  const ratio = Math.min(Math.max(positiveNumber(data.imageAspectRatio) ?? 1, 0.45), 3.4);
  const width = preferredImageInputNodeWidth(data);
  return Math.round(34 + 16 + width / ratio + (data.fileName ? 16 : 0));
}

function canvasReferenceGridMetrics(count: number) {
  if (count <= 0) return { columns: 0, rows: 0, width: 0, height: 0 };
  const rows = Math.min(CANVAS_REFERENCE_ROWS_PER_COLUMN, count);
  const columns = Math.ceil(count / CANVAS_REFERENCE_ROWS_PER_COLUMN);
  return {
    columns,
    rows,
    width: columns * CANVAS_REFERENCE_NODE_WIDTH + Math.max(0, columns - 1) * CANVAS_REFERENCE_NODE_GAP_X,
    height: rows * CANVAS_REFERENCE_NODE_HEIGHT + Math.max(0, rows - 1) * CANVAS_REFERENCE_NODE_GAP_Y,
  };
}

function canvasReferenceGridPosition(basePosition: { x: number; y: number }, index: number) {
  const column = Math.floor(index / CANVAS_REFERENCE_ROWS_PER_COLUMN);
  const row = index % CANVAS_REFERENCE_ROWS_PER_COLUMN;
  return {
    x: basePosition.x + column * (CANVAS_REFERENCE_NODE_WIDTH + CANVAS_REFERENCE_NODE_GAP_X),
    y: basePosition.y + row * (CANVAS_REFERENCE_NODE_HEIGHT + CANVAS_REFERENCE_NODE_GAP_Y),
  };
}

function recalculateCanvasSectionItemCounts(nodes: CanvasNode[]): CanvasNode[] {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    if (node.parentId) counts.set(node.parentId, (counts.get(node.parentId) ?? 0) + 1);
  }
  return nodes.map((node) => {
    if (node.type !== "section") return node;
    return {
      ...node,
      data: {
        ...(node.data ?? {}),
        itemCount: counts.get(node.id) ?? 0,
      },
    };
  });
}

function collectCanvasSectionDescendantIds(nodes: CanvasNode[], sectionId: string): Set<string> {
  const descendants = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (!node.parentId || descendants.has(node.id)) continue;
      if (node.parentId === sectionId || descendants.has(node.parentId)) {
        descendants.add(node.id);
        changed = true;
      }
    }
  }
  return descendants;
}

function canvasEdgeKey(edge: CanvasEdge): string {
  return [edge.id || "", edge.source || "", edge.target || "", edge.sourceHandle ?? "", edge.targetHandle ?? ""].join("::");
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numericCanvasSize(value: unknown): number {
  return numberValue(typeof value === "string" ? value.replace(/px$/, "") : value);
}

function normalizeCompareText(value: unknown): string {
  return stringValue(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
