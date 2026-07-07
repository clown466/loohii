import type { Prisma } from "@prisma/client";
import { allocateClipDialogueToBeats } from "./clipDialogueAllocator";
import { normalizeCanvasStoryboardReferencesForScene, storyboardReferencesFromGenerationRecords, type CanvasStoryboardGenerationRecord, type StoryboardReference } from "./canvasStoryboardReferences";
import { isRecord } from "./mappers";
import { isSeedanceMultiReferenceStrategy, projectGenerationStrategyFromMetadata } from "./projectGenerationStrategy";
import { buildClipPositioningBoardPrompt } from "./workflowPositioningBoards";
import { hoistRepeatedShotRules } from "./workflowPromptDedupe";
import {
  ensureClipStoryboardBoardLayoutPrompt,
  finalizeClipStoryboardImagePrompt,
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
  storyboardPrompt?: string;
  seedancePrompt?: string;
  storyboardPanelCount?: number;
  panelCount?: number;
  estimatedDuration?: number;
  targetDuration?: number;
  maxDuration?: number;
};

type WorkflowScene = {
  id?: string;
  title?: string;
  description?: string;
  action?: string;
  dialogue?: string;
  characters?: string[];
  visualPrompt?: string;
  references?: string;
  durationSeconds?: number;
  setting?: string;
  sceneVisualLock?: string;
  shotSize?: string;
  cameraAngle?: string;
  cameraMove?: string;
  composition?: string;
  lens?: string;
};

type WorkflowAssetItem = Record<string, unknown> & {
  id?: string;
  name?: string;
  title?: string;
  aliases?: unknown[];
  referenceImageUrl?: string;
  generatedImageUrl?: string;
  referenceImageAssetId?: string;
  generatedImageAssetId?: string;
  referenceAudioUrl?: string;
  referenceAudioAssetId?: string;
  voiceReferenceFileName?: string;
};

type WorkflowAssets = {
  characters?: unknown[];
  scenes?: unknown[];
  props?: unknown[];
};

type CharacterAudioReference = {
  name: string;
  url?: string;
  assetId?: string;
  fileName?: string;
  source: "workflow-asset";
};

type ClipAssetReference = {
  kind: "characters" | "scenes" | "props" | "positioning-board";
  name: string;
  label: string;
  url: string;
  assetId?: string;
  prompt?: string;
  sourceNodeId?: string;
};

export type EpisodeCanvasSyncBuildResult = {
  sceneId: string;
  episodeId: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  clips: WorkflowClip[];
  storyboardCount: number;
  videoCount: number;
  recoveredStoryboardCount: number;
  updatedAt: string;
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
const CANVAS_AUDIO_NODE_HEIGHT = 112;
const POSITIONING_BOARD_SECTION_WIDTH = 1180;
const POSITIONING_BOARD_REFERENCE_NODE_WIDTH = 220;
const POSITIONING_BOARD_REFERENCE_NODE_HEIGHT = 180;
const POSITIONING_BOARD_REFERENCE_NODE_GAP_X = 18;
const POSITIONING_BOARD_REFERENCE_NODE_GAP_Y = 16;
const POSITIONING_BOARD_REFERENCE_COLUMNS = 3;
const POSITIONING_BOARD_GENERATION_NODE_WIDTH = 420;
const POSITIONING_BOARD_GENERATION_NODE_X =
  CANVAS_SECTION_PADDING_X +
  POSITIONING_BOARD_REFERENCE_COLUMNS * POSITIONING_BOARD_REFERENCE_NODE_WIDTH +
  Math.max(0, POSITIONING_BOARD_REFERENCE_COLUMNS - 1) * POSITIONING_BOARD_REFERENCE_NODE_GAP_X +
  CANVAS_TARGET_SECTION_GAP;
const MAX_VIDEO_REFERENCE_IMAGES = 9;
const MAX_DREAMINA_VIDEO_REFERENCE_AUDIO = 2;
const DREAMINA_VIDEO_PROMPT_TARGET_CHARS = 9000;
const EPISODE_CANVAS_SYNC_START_X = 120;
const EPISODE_CANVAS_SYNC_START_Y = 120;
const EPISODE_CANVAS_SYNC_COLUMN_GAP = 36;
const EPISODE_CANVAS_SYNC_ROW_GAP = 28;
const MAX_CLIP_STORYBOARD_PANEL_COUNT = 12;
const MIN_CLIP_STORYBOARD_PANEL_COUNT = 5;
const EPISODE_CANVAS_SYNC_ROW_STRIDE =
  CANVAS_SECTION_HEADER_HEIGHT +
  Math.max(
    CANVAS_REFERENCE_ROWS_PER_COLUMN * CANVAS_REFERENCE_NODE_HEIGHT + Math.max(0, CANVAS_REFERENCE_ROWS_PER_COLUMN - 1) * CANVAS_REFERENCE_NODE_GAP_Y,
    CANVAS_GENERATION_NODE_HEIGHT,
    CANVAS_VIDEO_NODE_HEIGHT,
  ) +
  CANVAS_SECTION_PADDING_BOTTOM +
  EPISODE_CANVAS_SYNC_ROW_GAP;

export function buildEpisodeCanvasSyncScene(input: {
  metadata: Record<string, unknown>;
  episodeId: string;
  generationStrategy?: string;
  existingScene?: { nodes?: unknown[]; edges?: unknown[] };
  records?: CanvasStoryboardGenerationRecord[];
  aspectRatio?: string;
  now?: string;
}): EpisodeCanvasSyncBuildResult {
  const projectAspectRatio = /^\d+:\d+$/.test(String(input.aspectRatio || "").trim()) ? String(input.aspectRatio).trim() : "16:9";
  const storyboardImageAspect = (() => {
    const [w, h] = projectAspectRatio.split(":").map(Number);
    return w > 0 && h > 0 ? Math.round((w / h) * 100) / 100 : 1.78;
  })();
  const episodeId = resolveWorkflowEpisodeId(input.metadata, input.episodeId) || input.episodeId;
  const workflow = workflowCenterFromMetadata(input.metadata, episodeId);
  const useMultiReferenceStrategy = isSeedanceMultiReferenceStrategy(input.generationStrategy || projectGenerationStrategyFromMetadata(input.metadata));
  const clips = workflowClips(workflow);
  const scenes = workflowScenes(workflow);
  const assets = workflowAssets(workflow);
  const episodeTitle = stringValue(workflow.selectedEpisode) || workflowEpisodeTitle(input.metadata, episodeId) || episodeId;
  const sceneId = workflowEpisodeCanvasSceneId(episodeId);
  const episodeKey = stableCanvasIdPart(episodeId || episodeTitle, "episode");
  const storyboardRefs = storyboardReferencesFromGenerationRecords(input.records ?? [], input.metadata, episodeId);
  const storyboardRefByClipId = new Map(storyboardRefs.filter((ref) => ref.clipId && ref.url).map((ref) => [ref.clipId, ref]));
  const existingNodes = Array.isArray(input.existingScene?.nodes) ? input.existingScene.nodes.filter(isCanvasNode) : [];
  const existingEdges = Array.isArray(input.existingScene?.edges) ? input.existingScene.edges.filter(isCanvasEdge) : [];
  const existingVideoNodeDataById = new Map(
    existingNodes
      .filter((node) => node.id.startsWith(`episode-sync-video-node-${episodeKey}-`))
      .map((node) => [node.id, isRecord(node.data) ? node.data : {}]),
  );
  let nodes = removeEpisodeSyncNodes(existingNodes, episodeKey);
  let edges = [
    ...removeEdgesForMissingNodes(existingEdges, new Set(nodes.map((node) => node.id))),
    ...preserveExternalEpisodeVideoEdges(existingNodes, existingEdges, nodes, episodeKey),
  ];
  const previousStoryboardRefs = new Map<string, StoryboardReference>();
  let storyboardCount = 0;
  let videoCount = 0;
  let recoveredStoryboardCount = 0;

  for (const [index, clip] of clips.entries()) {
    const clipScenes = getClipScenes(clip, scenes);
    const clipKey = stableCanvasIdPart(clip.id || clip.title, `clip-${index + 1}`);
    const sectionId = `episode-sync-${episodeKey}-${clipKey}`;
    const storyNodeId = `episode-sync-storyboard-${episodeKey}-${clipKey}`;
    const videoSectionId = `episode-sync-video-${episodeKey}-${clipKey}`;
    const videoNodeId = `episode-sync-video-node-${episodeKey}-${clipKey}`;
    const storyboardSlotNodeId = `episode-sync-video-storyboard-slot-${episodeKey}-${clipKey}`;
    const positioningSectionId = `clip-position-board-${episodeId}-${clipKey}`;
    const positioningNodeId = `clip-position-board-gen-${episodeId}-${clipKey}`;
    const exactStoryboardRef = storyboardRefByClipId.get(clip.id);
    if (exactStoryboardRef?.url) recoveredStoryboardCount += 1;
    const previousClip = index > 0 ? clips[index - 1] : null;
    const previousRef = previousClip ? previousStoryboardRefs.get(previousClip.id) : undefined;
    const characterRefs = collectClipCharacterReferences(clip, clipScenes, assets, previousRef ? 8 : 9);
    const storyboardReferences = [
      ...(previousRef?.url ? [{
        kind: "storyboard",
        label: `上一个故事板: ${previousRef.sourceClip.title || previousRef.clipTitle || previousRef.title || "上一段"}`,
        name: previousRef.title || previousRef.sourceClip.title || "上一个故事板",
        url: previousRef.url,
        assetId: previousRef.assetId,
        nodeId: previousRef.nodeId,
        sourceClipId: previousRef.sourceClip.id || previousRef.clipId,
        sourceClipTitle: previousRef.sourceClip.title || previousRef.clipTitle,
      }] : []),
      ...characterRefs,
    ];
    const storyboardGrid = canvasReferenceGridMetrics(storyboardReferences.length);
    const storyboardAreaWidth = storyboardReferences.length ? storyboardGrid.width + CANVAS_TARGET_SECTION_GAP : 0;
    const storyboardWidth = CANVAS_SECTION_PADDING_X * 2 + storyboardAreaWidth + 380;
    const storyboardHeight = CANVAS_SECTION_HEADER_HEIGHT + Math.max(storyboardGrid.height, CANVAS_GENERATION_NODE_HEIGHT) + CANVAS_SECTION_PADDING_BOTTOM;
    const positioningBoardRef = useMultiReferenceStrategy ? collectClipPositioningBoardReference(existingNodes, clip.id, episodeId) : null;
    const videoPrompt = finalizeEpisodeCanvasVideoPrompt(
      withPositioningBoardVideoAuthority(buildEpisodeClipVideoPrompt(clip, clipScenes, projectAspectRatio), positioningBoardRef),
    );
    const assetVideoReferenceLimit = useMultiReferenceStrategy
      ? Math.max(0, MAX_VIDEO_REFERENCE_IMAGES - (positioningBoardRef ? 1 : 0))
      : MAX_VIDEO_REFERENCE_IMAGES - 1;
    const assetVideoReferences = collectClipAssetReferences(clip, clipScenes, assets, assetVideoReferenceLimit, videoPrompt, {
      includeProps: true,
      includeScenes: useMultiReferenceStrategy,
      includeMissing: useMultiReferenceStrategy,
    });
    const videoReferences = positioningBoardRef ? [positioningBoardRef, ...assetVideoReferences] : assetVideoReferences;
    const videoReferenceCount = videoReferences.length + (useMultiReferenceStrategy ? 0 : 1);
    const characterAudioRefs = collectCharacterAudioReferencesForClip(clip, clipScenes, assets, videoPrompt);
    const limitedCharacterAudioRefs = characterAudioRefs.filter((ref) => ref.url).slice(0, MAX_DREAMINA_VIDEO_REFERENCE_AUDIO);
    const videoGrid = canvasReferenceGridMetrics(videoReferenceCount + characterAudioRefs.length);
    const videoAreaWidth = videoGrid.width + CANVAS_TARGET_SECTION_GAP;
    const videoWidth = CANVAS_SECTION_PADDING_X * 2 + videoAreaWidth + 540;
    const videoHeight = CANVAS_SECTION_HEADER_HEIGHT + Math.max(videoGrid.height, CANVAS_VIDEO_NODE_HEIGHT) + CANVAS_SECTION_PADDING_BOTTOM;
    const sectionPosition = {
      x: EPISODE_CANVAS_SYNC_START_X,
      y: EPISODE_CANVAS_SYNC_START_Y + index * EPISODE_CANVAS_SYNC_ROW_STRIDE,
    };
    const videoSectionPosition = {
      x: useMultiReferenceStrategy ? sectionPosition.x : sectionPosition.x + storyboardWidth + EPISODE_CANVAS_SYNC_COLUMN_GAP,
      y: sectionPosition.y,
    };
    const positioningSectionPosition = {
      x: videoSectionPosition.x - POSITIONING_BOARD_SECTION_WIDTH - EPISODE_CANVAS_SYNC_COLUMN_GAP,
      y: videoSectionPosition.y,
    };
    const storyboardBase = {
      x: sectionPosition.x + CANVAS_SECTION_PADDING_X,
      y: sectionPosition.y + CANVAS_SECTION_HEADER_HEIGHT,
    };
    const videoBase = {
      x: videoSectionPosition.x + CANVAS_SECTION_PADDING_X,
      y: videoSectionPosition.y + CANVAS_SECTION_HEADER_HEIGHT,
    };
    const storyboardPrompt = useMultiReferenceStrategy ? stringValue(clip.storyboardPrompt) : appendReferenceImageMapPrompt(
      replacePreviousStoryboardContinuityPrompt(
        finalizeClipStoryboardImagePrompt(clip.storyboardPrompt, clip.storyboardPanelCount || clip.panelCount || undefined),
        previousRef ?? null,
      ),
      storyboardReferences.map(referenceAsPromptMapItem),
    );
    if (!useMultiReferenceStrategy) clip.storyboardPrompt = storyboardPrompt;
    clip.seedancePrompt = videoPrompt;
    const outputImage = exactStoryboardRef?.url || "";
    const outputImageAssetId = exactStoryboardRef?.assetId || "";
    const persistedVideoReferenceUrls = [useMultiReferenceStrategy ? "" : outputImage, ...videoReferences.map((reference) => reference.url)].filter(Boolean).slice(0, MAX_VIDEO_REFERENCE_IMAGES);
    const preservedVideoState = preservedExistingVideoGenerationState(existingVideoNodeDataById.get(videoNodeId));

    if (useMultiReferenceStrategy) {
      const preservedPositioningData = existingNodes.find((node) => node.id === positioningNodeId || (
        node.type === "generation" &&
        node.data?.positioningBoardFlow === true &&
        stringValue(node.data.clipId) === clip.id &&
        (!stringValue(node.data.sourceEpisodeId) || stringValue(node.data.sourceEpisodeId) === episodeId)
      ))?.data ?? {};
      const cleanedPositioning = removeCanvasSectionWithChildren(nodes, edges, positioningSectionId);
      nodes = cleanedPositioning.nodes;
      edges = cleanedPositioning.edges;
      const positioningRefs = collectClipPositioningBoardReferences(clip, clipScenes, assets, 12, { includeMissing: true });
      const positioningGridRows = Math.ceil(positioningRefs.length / POSITIONING_BOARD_REFERENCE_COLUMNS);
      const positioningSectionHeight = Math.max(
        360,
        CANVAS_SECTION_HEADER_HEIGHT +
          Math.max(
            CANVAS_GENERATION_NODE_HEIGHT,
            positioningGridRows * POSITIONING_BOARD_REFERENCE_NODE_HEIGHT + Math.max(0, positioningGridRows - 1) * POSITIONING_BOARD_REFERENCE_NODE_GAP_Y,
          ) +
          CANVAS_SECTION_PADDING_BOTTOM,
      );
      const positioningReferenceLabels = positioningRefs.map((reference) => reference.name || reference.label).filter(Boolean);
      const positioningSceneLockName = positioningRefs.find((reference) => reference.kind === "scenes")?.name;
      const positioningSceneVisualLock = mostCommonString(clipScenes.map((scene) => scene.sceneVisualLock).filter((value): value is string => Boolean(value)));
      const positioningVisibleCharacterNames = positioningRefs
        .filter((reference) => reference.kind === "characters")
        .map((reference) => reference.name)
        .filter(Boolean);
      const boardMode = "storyboard";
      const positioningPrompt = buildClipPositioningBoardPrompt({
        projectName: stringValue(input.metadata.projectName) || stringValue(input.metadata.title) || "美式漫剧",
        clip,
        shots: clipScenes,
        referenceLabels: positioningReferenceLabels,
        visibleCharacterNames: positioningVisibleCharacterNames,
        sceneLockName: positioningSceneLockName,
        sceneVisualLock: positioningSceneVisualLock,
        aspectRatio: projectAspectRatio,
        mode: "positioning",
      });
      const storyboardPrompt = buildClipPositioningBoardPrompt({
        projectName: stringValue(input.metadata.projectName) || stringValue(input.metadata.title) || "美式漫剧",
        clip,
        shots: clipScenes,
        referenceLabels: positioningReferenceLabels,
        visibleCharacterNames: positioningVisibleCharacterNames,
        sceneLockName: positioningSceneLockName,
        sceneVisualLock: positioningSceneVisualLock,
        aspectRatio: projectAspectRatio,
        mode: "storyboard",
      });
      const activeBoardPrompt = boardMode === "storyboard" ? storyboardPrompt : positioningPrompt;
      const oldPositioningData = preservedPositioningData;
      const oldPositioningOutputImages = Array.isArray(oldPositioningData.outputImages) ? oldPositioningData.outputImages : [];
      const hasPositioningOutput = Boolean(publicImageUrl(oldPositioningData.outputImage) || firstPublicImageUrl(oldPositioningOutputImages));
      nodes = upsertCanvasNode(nodes, {
        id: positioningSectionId,
        type: "section",
        position: positioningSectionPosition,
        style: { width: POSITIONING_BOARD_SECTION_WIDTH, height: positioningSectionHeight },
        zIndex: 0,
        data: {
          title: `${clip.title || `Clip ${index + 1}`} · 故事板/定位板图片流程`,
          description: "默认为本 Clip 生成对应视频镜头的宫格故事板；可在节点内切换为单帧空间定位板。",
          tone: "emerald",
          itemCount: positioningRefs.length + 1,
          clipId: clip.id,
          clipOrder: index + 1,
          sourceEpisode: episodeTitle,
          sourceEpisodeId: episodeId,
          sectionKind: "clip-positioning-board",
          positioningBoardFlow: true,
          positioningBoardMode: boardMode,
          episodeCanvasSync: true,
        },
      });
      nodes = upsertCanvasNode(nodes, {
        id: positioningNodeId,
        type: "generation",
        parentId: positioningSectionId,
        extent: "parent",
        expandParent: false,
        position: { x: POSITIONING_BOARD_GENERATION_NODE_X, y: CANVAS_SECTION_HEADER_HEIGHT },
        style: { width: POSITIONING_BOARD_GENERATION_NODE_WIDTH },
        zIndex: 1,
        data: {
          mode: "standalone",
          title: `${clip.title || clip.id} 故事板`,
          description: `生成本 Clip 对应视频镜头的宫格故事板，已接入 ${positioningRefs.length} 张参考图。`,
          prompt: activeBoardPrompt,
          finalPrompt: activeBoardPrompt,
          positioningPrompt,
          storyboardPrompt,
          manualFinalPrompt: true,
          status: hasPositioningOutput ? "completed" : stringValue(oldPositioningData.status) || "waiting",
          error: hasPositioningOutput ? stringValue(oldPositioningData.error) : "",
          outputImage: stringValue(oldPositioningData.outputImage),
          outputImageAssetId: stringValue(oldPositioningData.outputImageAssetId),
          outputImages: oldPositioningOutputImages,
          generationStartedAt: stringValue(oldPositioningData.generationStartedAt),
          size: projectAspectRatio,
          resolution: "2k",
          quality: "high",
          format: "png",
          clipId: clip.id,
          clipTitle: clip.title,
          clipNodeKind: "positioning-board",
          sourceEpisode: episodeTitle,
          sourceEpisodeId: episodeId,
          positioningBoardFlow: true,
          positioningBoardMode: boardMode,
          lightweightGeneration: true,
          episodeCanvasSync: true,
        },
      });
      positioningRefs.forEach((reference, refIndex) => {
        const refNodeId = `clip-position-board-ref-${episodeId}-${clipKey}-${stableCanvasIdPart(reference.kind, "asset")}-${stableCanvasIdPart(reference.assetId || reference.name || refIndex, `ref-${refIndex}`)}`;
        const column = refIndex % POSITIONING_BOARD_REFERENCE_COLUMNS;
        const row = Math.floor(refIndex / POSITIONING_BOARD_REFERENCE_COLUMNS);
        nodes = upsertCanvasNode(nodes, {
          id: refNodeId,
          type: "imageInput",
          parentId: positioningSectionId,
          extent: "parent",
          expandParent: false,
          position: {
            x: CANVAS_SECTION_PADDING_X + column * (POSITIONING_BOARD_REFERENCE_NODE_WIDTH + POSITIONING_BOARD_REFERENCE_NODE_GAP_X),
            y: CANVAS_SECTION_HEADER_HEIGHT + row * (POSITIONING_BOARD_REFERENCE_NODE_HEIGHT + POSITIONING_BOARD_REFERENCE_NODE_GAP_Y),
          },
          style: { width: POSITIONING_BOARD_REFERENCE_NODE_WIDTH },
          zIndex: 1,
          data: {
            label: `${reference.kind === "scenes" ? "场景" : reference.kind === "props" ? "道具" : "角色"} · ${reference.name || reference.label}`,
            imageUrl: reference.url,
            imageAspectRatio: reference.kind === "scenes" ? 1.78 : 1.45,
            fileName: `${reference.name || reference.kind}.png`,
            uploadStatus: reference.url ? "linked" : "missing",
            sourcePrompt: `${reference.label}，用于 ${clip.title || "Clip"} 定位板空间参考`,
            uploadError: reference.url ? "" : "该资产还没有参考图，请上传或生成后再生成定位板。",
            imageLoadError: false,
            assetKind: reference.kind,
            assetName: reference.name,
            assetId: reference.assetId || "",
            sourceClipId: clip.id,
            targetClipId: clip.id,
            sourceEpisode: episodeTitle,
            sourceEpisodeId: episodeId,
            positioningBoardFlow: true,
            lightweightReference: true,
            episodeCanvasSync: true,
            clipSyncRole: `positioning-ref:${reference.kind}:${reference.assetId || normalizeCompareText(reference.name)}`,
            clipSyncAssetId: reference.assetId || "",
            clipSyncUrl: reference.url,
          },
        });
        edges = upsertCanvasEdge(edges, {
          id: canvasAutoEdgeId("clip-position-board-ref", refNodeId, positioningNodeId),
          source: refNodeId,
          sourceHandle: null,
          target: positioningNodeId,
          targetHandle: null,
          type: "smoothstep",
        });
      });
      edges = upsertCanvasEdge(edges, {
        id: canvasAutoEdgeId("clip-position-board-video", positioningNodeId, videoNodeId),
        source: positioningNodeId,
        sourceHandle: null,
        target: videoNodeId,
        targetHandle: null,
        type: "smoothstep",
      });
    }

    if (!useMultiReferenceStrategy) {
      nodes = upsertCanvasNode(nodes, {
      id: sectionId,
      type: "section",
      position: sectionPosition,
      style: { width: storyboardWidth, height: storyboardHeight },
      zIndex: 0,
      data: {
        title: `${clip.title || `Clip ${index + 1}`} · 图片分镜故事板`,
        description: "角色参考和上一个故事板连到右侧故事板生图；道具由角色图承载",
        tone: "amber",
        itemCount: storyboardReferences.length + 1,
        clipId: clip.id,
        sourceEpisode: episodeTitle,
        sourceEpisodeId: episodeId,
        sectionKind: "clip-storyboard-assets",
        episodeCanvasSync: true,
        clipOrder: index + 1,
      },
    });
      nodes = upsertCanvasNode(nodes, {
      id: storyNodeId,
      type: "generation",
      parentId: sectionId,
      extent: "parent",
      expandParent: false,
      position: { x: CANVAS_SECTION_PADDING_X + storyboardAreaWidth, y: CANVAS_SECTION_HEADER_HEIGHT },
      style: { width: 360 },
      zIndex: 1,
      data: {
        mode: "standalone",
        title: `${clip.title || "Clip"} 故事板`,
        description: storyboardReferences.length
          ? `Clip 级导演故事板生图节点，已接入 ${storyboardReferences.length} 张参考图${previousRef ? "，含上一个故事板" : ""}`
          : "Clip 级导演故事板生图节点，当前没有匹配到可用资产参考图",
        prompt: storyboardPrompt,
        finalPrompt: storyboardPrompt,
        manualFinalPrompt: true,
        status: outputImage ? "completed" : "waiting",
        outputImage,
        outputImageAssetId,
        submittedPrompt: exactStoryboardRef?.prompt || "",
        error: outputImage ? "已关联本 Clip 的故事板生成记录。" : "",
        generationStartedAt: "",
        size: projectAspectRatio,
        resolution: "2k",
        quality: "high",
        format: "png",
        storyboardPanelCount: clip.storyboardPanelCount || clip.panelCount || undefined,
        clipId: clip.id,
        clipTitle: clip.title,
        clipNodeKind: "storyboard",
        storyboardForClip: true,
        previousStoryboardAssetId: previousRef?.assetId || previousRef?.nodeId || "",
        sourceEpisode: episodeTitle,
        sourceEpisodeId: episodeId,
        episodeCanvasSync: true,
        clipSyncRole: "storyboard",
        clipSyncUrl: outputImage,
      },
    });
      storyboardCount += 1;

      storyboardReferences.forEach((reference, refIndex) => {
      if (!reference.url) return;
      const nodeId = `episode-sync-story-ref-${episodeKey}-${clipKey}-${stableCanvasIdPart(reference.kind === "storyboard" ? `previous-${reference.sourceClipId || reference.assetId || reference.url}` : `asset-${reference.assetId || reference.name}`, `ref-${refIndex}`)}`;
      const position = canvasReferenceGridPosition({ x: CANVAS_SECTION_PADDING_X, y: CANVAS_SECTION_HEADER_HEIGHT }, refIndex);
      nodes = upsertCanvasNode(nodes, {
        id: nodeId,
        type: "imageInput",
        parentId: sectionId,
        extent: "parent",
        expandParent: false,
        position,
        style: {
          width: reference.kind === "storyboard" ? 340 : 260,
          height: preferredImageInputNodeHeight({ imageAspectRatio: reference.kind === "storyboard" ? storyboardImageAspect : 1.45, fileName: `${reference.name}.png` }),
        },
        zIndex: 1,
        data: {
          label: reference.label,
          imageUrl: reference.url,
          imageAspectRatio: reference.kind === "storyboard" ? storyboardImageAspect : 1.45,
          fileName: `${reference.name}.png`,
          uploadStatus: "linked",
          sourcePrompt: reference.kind === "storyboard"
            ? `上一个故事板，用于延续 ${clip.title || "Clip"} 的场景和角色位置`
            : `${reference.label}，用于 ${clip.title || "Clip"} 故事板连续性参考`,
          uploadError: "",
          imageLoadError: false,
          ...(reference.kind === "storyboard"
            ? {
                clipNodeKind: "storyboard-reference",
                storyboardForClip: false,
                sourceClipId: reference.sourceClipId || "",
                sourceClipTitle: reference.sourceClipTitle || "",
                targetClipId: clip.id,
              }
            : { assetKind: "characters", assetName: reference.name }),
          assetId: reference.assetId || "",
          sourceEpisode: episodeTitle,
          sourceEpisodeId: episodeId,
          episodeCanvasSync: true,
          clipSyncRole: reference.kind === "storyboard" ? `previous:${reference.sourceClipId || reference.assetId || reference.url}` : `asset:${reference.assetId || normalizeCompareText(reference.name)}`,
          clipSyncAssetId: reference.assetId || "",
          clipSyncUrl: reference.url,
        },
      });
      edges = upsertCanvasEdge(edges, {
        id: canvasAutoEdgeId("episode-storyboard-ref", nodeId, storyNodeId),
        source: nodeId,
        sourceHandle: null,
        target: storyNodeId,
        targetHandle: null,
      });
      });
    }

    nodes = upsertCanvasNode(nodes, {
      id: videoSectionId,
      type: "section",
      position: videoSectionPosition,
      style: { width: videoWidth, height: videoHeight },
      zIndex: 0,
      data: {
        title: `${clip.title || `Clip ${index + 1}`} · 视频板`,
        description: useMultiReferenceStrategy
          ? `Seedance 多参视频任务，已接入 ${videoReferences.length} 个资产参考节点和 ${characterAudioRefs.length} 个台词音频坑位。`
          : `当前集自动同步的视频生成任务，已保留对应故事板坑位、${videoReferences.length} 张角色参考图和 ${characterAudioRefs.length} 个台词音频坑位。`,
        tone: "sky",
        itemCount: videoReferenceCount + characterAudioRefs.length + 1,
        clipId: clip.id,
        sourceEpisode: episodeTitle,
        sourceEpisodeId: episodeId,
        sectionKind: "clip-video-assets",
        episodeCanvasSync: true,
        clipOrder: index + 1,
      },
    });
    if (!useMultiReferenceStrategy) {
      nodes = upsertCanvasNode(nodes, {
        id: storyboardSlotNodeId,
        type: "imageInput",
        parentId: videoSectionId,
        extent: "parent",
        expandParent: false,
        position: { x: CANVAS_SECTION_PADDING_X, y: CANVAS_SECTION_HEADER_HEIGHT },
        style: { width: 340, height: preferredImageInputNodeHeight({ imageAspectRatio: storyboardImageAspect, fileName: `${clip.title || "Clip"}-storyboard.png` }) },
        zIndex: 1,
        data: {
          ...storyboardSlotData(clip, outputImage, outputImageAssetId, exactStoryboardRef?.prompt),
          imageAspectRatio: storyboardImageAspect,
          sourceEpisode: episodeTitle,
          sourceEpisodeId: episodeId,
          episodeCanvasSync: true,
        },
      });
    }
    nodes = upsertCanvasNode(nodes, {
      id: videoNodeId,
      type: "video",
      parentId: videoSectionId,
      extent: "parent",
      expandParent: false,
      position: { x: CANVAS_SECTION_PADDING_X + videoAreaWidth, y: CANVAS_SECTION_HEADER_HEIGHT },
      style: { width: 520 },
      zIndex: 1,
      data: {
        kind: "video",
        workflowKind: "video",
        title: `${clip.title || "Clip"} 视频任务`,
        description: useMultiReferenceStrategy
          ? `Seedance 多参视频提示词已就绪，已接入 ${videoReferences.length} 个资产参考节点`
          : `Seedance 视频提示词已就绪，已强制接入对应故事板坑位和 ${videoReferences.length} 张角色参考图`,
        scope: "分镜视频",
        statusLabel: "待生成视频",
        prompt: videoPrompt,
        seedancePrompt: videoPrompt,
        videoPrompt,
        videoStatus: "waiting",
        status: "waiting",
        clipId: clip.id,
        duration: getClipEstimatedDuration(clip, clipScenes),
        durationSeconds: normalizeVideoDuration(getClipEstimatedDuration(clip, clipScenes)),
        resolution: "720p",
        includeAudio: true,
        ratio: "adaptive",
        count: 1,
        videoParametersCollapsed: true,
        referenceCount: videoReferenceCount,
        generationStrategy: useMultiReferenceStrategy ? "seedance-multi-ref" : "",
        storyboardImageUrl: useMultiReferenceStrategy ? "" : outputImage,
        referenceImageUrls: persistedVideoReferenceUrls,
        characters: clip.characters ?? [],
        dialogueCharacterNames: characterAudioRefs.map((ref) => ref.name),
        characterAudioReferences: limitedCharacterAudioRefs,
        referenceAudioUrls: limitedCharacterAudioRefs.map((ref) => ref.url),
        referenceAudioCount: limitedCharacterAudioRefs.length,
        audioReferenceCount: limitedCharacterAudioRefs.length,
        videoError: "",
        sourceEpisode: episodeTitle,
        sourceEpisodeId: episodeId,
        episodeCanvasSync: true,
        clipSyncRole: "video",
        ...preservedVideoState,
      },
    });
    videoCount += 1;

    if (!useMultiReferenceStrategy) {
      edges = upsertCanvasEdge(edges, {
        id: canvasAutoEdgeId("episode-video-storyboard-slot-in", storyNodeId, storyboardSlotNodeId),
        source: storyNodeId,
        sourceHandle: null,
        target: storyboardSlotNodeId,
        targetHandle: null,
      });
      edges = upsertCanvasEdge(edges, {
        id: canvasAutoEdgeId("episode-video-ref", storyboardSlotNodeId, videoNodeId),
        source: storyboardSlotNodeId,
        sourceHandle: null,
        target: videoNodeId,
        targetHandle: null,
      });
    }
    videoReferences.forEach((reference, refIndex) => {
      const referenceKey = reference.kind === "positioning-board"
        ? `positioning-${reference.assetId || reference.sourceNodeId || reference.url || reference.name}`
        : `asset-${reference.assetId || reference.name}`;
      const nodeId = `episode-sync-video-ref-${episodeKey}-${clipKey}-${stableCanvasIdPart(referenceKey, `ref-${refIndex}`)}`;
      const position = canvasReferenceGridPosition({ x: CANVAS_SECTION_PADDING_X, y: CANVAS_SECTION_HEADER_HEIGHT }, refIndex + (useMultiReferenceStrategy ? 0 : 1));
      const isPositioningBoard = reference.kind === "positioning-board";
      nodes = upsertCanvasNode(nodes, {
        id: nodeId,
        type: "imageInput",
        parentId: videoSectionId,
        extent: "parent",
        expandParent: false,
        position,
        style: {
          width: isPositioningBoard ? 340 : 260,
          height: preferredImageInputNodeHeight({ imageAspectRatio: isPositioningBoard ? storyboardImageAspect : 1.45, fileName: `${reference.name}.png` }),
        },
        zIndex: 1,
        data: {
          label: reference.label,
          imageUrl: reference.url,
          imageAspectRatio: isPositioningBoard ? storyboardImageAspect : 1.45,
          fileName: `${reference.name}.png`,
          uploadStatus: reference.url ? "linked" : "missing",
          sourcePrompt: isPositioningBoard
            ? reference.prompt || "Positioning board: use as spatial layout authority for this clip video."
            : `${reference.label}，用于 ${clip.title || "Clip"} 视频连续性参考`,
          uploadError: reference.url ? "" : "该资产还没有参考图，请上传或生成后再生成视频。",
          imageLoadError: false,
          assetKind: reference.kind,
          assetName: reference.name,
          ...(isPositioningBoard
            ? {
                clipNodeKind: "positioning-board-reference",
                positioningBoardForClip: true,
                spatialAuthority: true,
                clipId: clip.id,
                targetClipId: clip.id,
                sourceNodeId: reference.sourceNodeId || "",
              }
            : {}),
          assetId: reference.assetId || "",
          sourceEpisode: episodeTitle,
          sourceEpisodeId: episodeId,
          episodeCanvasSync: true,
          clipSyncRole: isPositioningBoard
            ? `positioning-board:${reference.assetId || reference.sourceNodeId || normalizeCompareText(reference.name)}`
            : `video-asset:${reference.assetId || normalizeCompareText(reference.name)}`,
          clipSyncAssetId: reference.assetId || "",
          clipSyncUrl: reference.url,
        },
      });
      edges = upsertCanvasEdge(edges, {
        id: canvasAutoEdgeId("episode-video-ref", nodeId, videoNodeId),
        source: nodeId,
        sourceHandle: null,
        target: videoNodeId,
        targetHandle: null,
      });
    });
    characterAudioRefs.forEach((reference, refIndex) => {
      const nodeId = `episode-sync-video-audio-ref-${episodeKey}-${clipKey}-${stableCanvasIdPart(`audio-${reference.assetId || reference.name}`, `audio-${refIndex}`)}`;
      const position = canvasReferenceGridPosition({ x: CANVAS_SECTION_PADDING_X, y: CANVAS_SECTION_HEADER_HEIGHT }, videoReferenceCount + refIndex);
      nodes = upsertCanvasNode(nodes, {
        id: nodeId,
        type: "audio",
        parentId: videoSectionId,
        extent: "parent",
        expandParent: false,
        position,
        style: {
          width: 260,
          height: CANVAS_AUDIO_NODE_HEIGHT,
        },
        zIndex: 1,
        data: {
          kind: "audio",
          workflowKind: "audio",
          label: `音频参考: ${reference.name}`,
          title: `${reference.name} 音频参考`,
          characterName: reference.name,
          assetName: reference.name,
          assetKind: "audio",
          audioUrl: reference.url || "",
          referenceAudioUrl: reference.url || "",
          referenceAudioAssetId: reference.assetId || "",
          assetId: reference.assetId || "",
          fileName: reference.fileName || `${reference.name}-voice-reference`,
          uploadStatus: reference.url ? "linked" : "missing",
          uploadError: reference.url ? "" : "该角色还没有绑定音频参考",
          sourcePrompt: reference.url
            ? `${reference.name} 的台词音频参考，用于 ${clip.title || "Clip"} 视频生成`
            : `${reference.name} 在 ${clip.title || "Clip"} 有台词，但还没有绑定音频参考`,
          sourceEpisode: episodeTitle,
          sourceEpisodeId: episodeId,
          episodeCanvasSync: true,
          clipSyncRole: `audio:${reference.assetId || normalizeCompareText(reference.name)}`,
          clipSyncAssetId: reference.assetId || "",
          clipSyncUrl: reference.url || "",
        },
      });
      edges = upsertCanvasEdge(edges, {
        id: canvasAutoEdgeId("episode-video-audio-ref", nodeId, videoNodeId),
        source: nodeId,
        sourceHandle: null,
        target: videoNodeId,
        targetHandle: null,
      });
    });
    if (!useMultiReferenceStrategy && previousRef?.nodeId) {
      edges = upsertCanvasEdge(edges, {
        id: canvasAutoEdgeId("episode-storyboard-prev", previousRef.nodeId, storyNodeId),
        source: previousRef.nodeId,
        sourceHandle: null,
        target: storyNodeId,
        targetHandle: null,
      });
    }

    previousStoryboardRefs.set(clip.id, {
      clipId: clip.id,
      clipTitle: clip.title,
      title: `${clip.title || "Clip"} 故事板`,
      url: outputImage,
      assetId: outputImageAssetId,
      prompt: exactStoryboardRef?.prompt || storyboardPrompt,
      nodeId: storyNodeId,
      sourceClip: clip,
      sourceEpisode: episodeTitle,
      sourceEpisodeId: episodeId,
    });
  }

  const countedNodes = recalculateCanvasSectionItemCounts(nodes);
  const countedNodeIds = new Set(countedNodes.map((node) => node.id));
  const validEdges = removeEdgesForMissingNodes(edges, countedNodeIds);
  const normalized = useMultiReferenceStrategy ? { nodes: countedNodes, edges: validEdges } : normalizeCanvasStoryboardReferencesForScene(
    countedNodes,
    validEdges,
    input.metadata,
    storyboardRefs,
    episodeId,
  );
  const normalizedNodeIds = new Set(normalized.nodes.map((node) => node.id));
  const normalizedEdges = removeEdgesForMissingNodes(normalized.edges, normalizedNodeIds);
  const laidOut = applyPositioningBoardLayout(normalized.nodes, normalizedEdges);
  const updatedAt = input.now ?? new Date().toISOString();
  return {
    sceneId,
    episodeId,
    nodes: laidOut.nodes,
    edges: laidOut.edges,
    clips,
    storyboardCount,
    videoCount,
    recoveredStoryboardCount,
    updatedAt,
  };
}

/**
 * Single source of truth for positioning-board / storyboard section layout.
 * De-duplicates reference image nodes (same asset added across syncs) and lays the
 * kept references on a grid sized to their REAL 340px footprint, with the generation
 * node to the right and the section right-aligned a fixed gutter left of its video board.
 * Keeps each section within the video row pitch so sections never overlap each other or
 * the video boards. Non-mutating: returns new node objects for anything it touches.
 */
const POSITIONING_BOARD_LAYOUT = {
  paddingX: 12,
  header: 42,
  paddingBottom: 8,
  refWidth: 340,
  refRowHeight: 300,
  refGapX: 16,
  refGapY: 10,
  rowsTarget: 3,
  minColumns: 3,
  maxColumns: 6,
  genWidth: 420,
  genHeight: 560,
  targetGap: 24,
  sectionGap: 36,
};

export function applyPositioningBoardLayout(nodes: CanvasNode[], edges: CanvasEdge[]): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const L = POSITIONING_BOARD_LAYOUT;
  const sections = nodes.filter((node) => node.type === "section" && node.data?.positioningBoardFlow === true);
  if (!sections.length) return { nodes, edges };

  const num = (value: unknown, fallback = 0): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const norm = (value: unknown): string => String(value ?? "").trim().toLowerCase();
  const kindOrder = (kind: string): number => (kind === "characters" ? 0 : kind === "scenes" ? 1 : kind === "props" ? 2 : 3);
  const hasImage = (node: CanvasNode): boolean => Boolean(norm(node.data?.imageUrl)) || norm(node.data?.uploadStatus) === "linked";

  const removed = new Set<string>();
  const updates = new Map<string, CanvasNode>();
  const patch = (node: CanvasNode): CanvasNode => {
    let clone = updates.get(node.id);
    if (!clone) {
      clone = { ...node, position: { ...(node.position || {}) }, style: { ...(node.style || {}) }, data: { ...(node.data || {}) } };
      updates.set(node.id, clone);
    }
    return clone;
  };

  const videoSectionFor = (section: CanvasNode): CanvasNode | null => {
    const clipId = String(section.data?.clipId || "");
    if (!clipId) return null;
    const episodeId = String(section.data?.sourceEpisodeId || "");
    return nodes.find((node) => node.type === "section" && node.data?.sectionKind === "clip-video-assets" && String(node.data?.clipId || "") === clipId && (!episodeId || String(node.data?.sourceEpisodeId || "") === episodeId))
      ?? nodes.find((node) => node.type === "section" && node.data?.sectionKind === "clip-video-assets" && String(node.data?.clipId || "") === clipId)
      ?? null;
  };

  for (const section of sections) {
    const children = nodes.filter((node) => node.parentId === section.id);
    const refs = children.filter((node) => node.type === "imageInput");
    const generations = children.filter((node) => node.type === "generation");

    // De-duplicate references (same asset re-added across syncs), preferring a linked copy.
    const byKey = new Map<string, CanvasNode>();
    const kept: CanvasNode[] = [];
    for (const ref of refs) {
      const key = `${norm(ref.data?.assetKind)}|${norm(ref.data?.assetId) || norm(ref.data?.assetName ?? ref.data?.label)}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, ref);
        kept.push(ref);
      } else if (!hasImage(existing) && hasImage(ref)) {
        const index = kept.indexOf(existing);
        if (index >= 0) kept[index] = ref;
        byKey.set(key, ref);
        removed.add(existing.id);
      } else {
        removed.add(ref.id);
      }
    }

    const orderedRefs = kept
      .filter((node) => !removed.has(node.id))
      .sort((a, b) => {
        const ka = kindOrder(norm(a.data?.assetKind));
        const kb = kindOrder(norm(b.data?.assetKind));
        if (ka !== kb) return ka - kb;
        return norm(a.data?.assetName).localeCompare(norm(b.data?.assetName));
      });

    const count = orderedRefs.length;
    const columns = Math.min(L.maxColumns, Math.max(L.minColumns, Math.ceil(count / L.rowsTarget) || L.minColumns));
    orderedRefs.forEach((ref, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const clone = patch(ref);
      clone.position = { x: L.paddingX + col * (L.refWidth + L.refGapX), y: L.header + row * (L.refRowHeight + L.refGapY) };
      clone.style = { ...(clone.style || {}), width: L.refWidth };
      delete (clone.style as Record<string, unknown>).height;
      delete (clone as Record<string, unknown>).width;
      delete (clone as Record<string, unknown>).height;
      delete (clone as Record<string, unknown>).measured;
      clone.extent = "parent";
      clone.expandParent = false;
      clone.zIndex = 1;
    });

    const rows = Math.max(1, Math.ceil(count / columns));
    const refsRight = count > 0 ? L.paddingX + columns * L.refWidth + Math.max(0, columns - 1) * L.refGapX : L.paddingX;
    const refsBottom = count > 0 ? L.header + rows * L.refRowHeight + Math.max(0, rows - 1) * L.refGapY : L.header;

    const genX = refsRight + L.targetGap;
    generations.forEach((gen, index) => {
      const clone = patch(gen);
      clone.position = { x: genX, y: L.header + index * (L.genHeight + L.refGapY) };
      clone.style = { ...(clone.style || {}), width: L.genWidth };
      clone.extent = "parent";
      clone.expandParent = false;
      clone.zIndex = 1;
    });
    const genBottom = generations.length ? L.header + generations.length * L.genHeight + Math.max(0, generations.length - 1) * L.refGapY : L.header;
    const genRight = generations.length ? genX + L.genWidth : refsRight;

    const sectionWidth = Math.max(genRight, refsRight) + L.paddingX;
    const sectionHeight = Math.max(360, Math.max(refsBottom, genBottom) + L.paddingBottom);

    const video = videoSectionFor(section);
    const nextX = video ? num(video.position?.x) - sectionWidth - L.sectionGap : num(section.position?.x);
    const nextY = video ? num(video.position?.y, num(section.position?.y)) : num(section.position?.y);
    const sectionClone = patch(section);
    sectionClone.position = { x: nextX, y: nextY };
    sectionClone.style = { ...(sectionClone.style || {}), width: sectionWidth, height: sectionHeight };
    sectionClone.data = { ...(sectionClone.data || {}), itemCount: count + generations.length };
  }

  if (updates.size === 0 && removed.size === 0) return { nodes, edges };
  const nextNodes = nodes.filter((node) => !removed.has(node.id)).map((node) => updates.get(node.id) ?? node);
  const nextEdges = edges.filter((edge) => !removed.has(String(edge.source)) && !removed.has(String(edge.target)));
  return { nodes: nextNodes, edges: nextEdges };
}

export function writeEpisodeCanvasSyncMetadata(input: {
  metadata: Record<string, unknown>;
  sync: EpisodeCanvasSyncBuildResult;
  makeActive?: boolean;
}): Record<string, unknown> {
  const canvasScenes = isRecord(input.metadata.canvasScenes) ? input.metadata.canvasScenes : {};
  const workflow = workflowCenterFromMetadata(input.metadata, input.sync.episodeId);
  const nextStageStatuses = {
    ...(isRecord(workflow.stageStatuses) ? workflow.stageStatuses : {}),
    storyboard: input.sync.storyboardCount > 0 ? "done" : stringValue(isRecord(workflow.stageStatuses) ? workflow.stageStatuses.storyboard : "") || "idle",
    video: input.sync.clips.some((clip) => stringValue(clip.seedancePrompt)) ? "done" : stringValue(isRecord(workflow.stageStatuses) ? workflow.stageStatuses.video : "") || "idle",
  };
  const nextWorkflow = {
    ...workflow,
    clips: input.sync.clips.map((clip) => {
      const current = workflowClips(workflow).find((item) => item.id === clip.id);
      return current
        ? {
            ...current,
            storyboardPrompt: clip.storyboardPrompt || current.storyboardPrompt,
            seedancePrompt: clip.seedancePrompt || current.seedancePrompt,
          }
        : clip;
    }),
    stageStatuses: nextStageStatuses,
    updatedAt: input.sync.updatedAt,
  };
  const nextMetadata = writeWorkflowEpisode(input.metadata, input.sync.episodeId, nextWorkflow, input.makeActive ?? true);
  const nextCanvasScenes = isRecord(nextMetadata.canvasScenes) ? nextMetadata.canvasScenes : {};
  return {
    ...nextMetadata,
    canvasScenes: {
      ...nextCanvasScenes,
      ...canvasScenes,
      [input.sync.sceneId]: {
        nodes: input.sync.nodes,
        edges: input.sync.edges,
        updatedAt: input.sync.updatedAt,
      },
    },
  };
}

function workflowClips(workflow: Record<string, unknown>): WorkflowClip[] {
  const clips = Array.isArray(workflow.clips) ? workflow.clips : [];
  return clips
    .map((clip, index): WorkflowClip | null => {
      if (!isRecord(clip)) return null;
      const fallbackId = `clip-${String(index + 1).padStart(3, "0")}`;
      const id = stringValue(clip.id) || fallbackId;
      return {
        ...clip,
        id,
        title: stringValue(clip.title) || `Clip ${String(index + 1).padStart(2, "0")}`,
        setting: stringValue(clip.setting),
        characters: Array.isArray(clip.characters) ? clip.characters.map(stringValue).filter(Boolean) : [],
        shotIds: Array.isArray(clip.shotIds) ? clip.shotIds.map(stringValue).filter(Boolean) : [],
        plotGoal: stringValue(clip.plotGoal),
        startState: stringValue(clip.startState),
        endState: stringValue(clip.endState),
        storyboardPrompt: stringValue(clip.storyboardPrompt),
        seedancePrompt: stringValue(clip.seedancePrompt),
        storyboardPanelCount: numberValue(clip.storyboardPanelCount),
        panelCount: numberValue(clip.panelCount),
        estimatedDuration: numberValue(clip.estimatedDuration),
        targetDuration: numberValue(clip.targetDuration),
        maxDuration: numberValue(clip.maxDuration),
      };
    })
    .filter((clip): clip is WorkflowClip => Boolean(clip?.id));
}

function workflowScenes(workflow: Record<string, unknown>): WorkflowScene[] {
  const scenes = Array.isArray(workflow.breakdownScenes) ? workflow.breakdownScenes : [];
  return scenes.filter(isRecord).map((scene) => ({
    id: stringValue(scene.id),
    title: stringValue(scene.title),
    description: stringValue(scene.description),
    action: stringValue(scene.action),
    dialogue: stringValue(scene.dialogue),
    characters: Array.isArray(scene.characters) ? scene.characters.map(stringValue).filter(Boolean) : [],
    visualPrompt: stringValue(scene.visualPrompt),
    references: stringValue(scene.references),
    durationSeconds: numberValue(scene.durationSeconds),
    setting: stringValue(scene.setting),
    sceneVisualLock: stringValue(scene.sceneVisualLock),
  }));
}

function workflowAssets(workflow: Record<string, unknown>): WorkflowAssets {
  return isRecord(workflow.assets) ? workflow.assets as WorkflowAssets : {};
}

function getClipScenes(clip: WorkflowClip, scenes: WorkflowScene[]): WorkflowScene[] {
  const shotIds = new Set((clip.shotIds ?? []).map(String));
  if (shotIds.size === 0) return [];
  return scenes.filter((scene) => scene.id && shotIds.has(scene.id));
}

function collectClipCharacterReferences(clip: WorkflowClip, clipScenes: WorkflowScene[], assets: WorkflowAssets, limit: number, extraSearchText = "") {
  return collectClipAssetReferences(clip, clipScenes, assets, limit, extraSearchText, {
    includeProps: false,
    includeScenes: false,
    includeMissing: false,
  }).filter((reference) => reference.kind === "characters");
}

function collectClipPositioningBoardReference(existingNodes: CanvasNode[], clipId: string, episodeId: string): ClipAssetReference | null {
  const candidates = existingNodes
    .filter((node) => {
      const data = isRecord(node.data) ? node.data : {};
      return node.type === "generation" &&
        data.positioningBoardFlow === true &&
        stringValue(data.clipId) === clipId &&
        (!stringValue(data.sourceEpisodeId) || stringValue(data.sourceEpisodeId) === episodeId) &&
        Boolean(publicImageUrl(data.outputImage) || firstPublicImageUrl(data.outputImages));
    })
    .map((node) => {
      const data = isRecord(node.data) ? node.data : {};
      const url = publicImageUrl(data.outputImage) || firstPublicImageUrl(data.outputImages);
      return {
        kind: "positioning-board" as const,
        name: stringValue(data.title) || "Clip positioning board",
        label: "定位板参考: Clip spatial layout",
        url,
        assetId: stringValue(data.outputImageAssetId),
        prompt: stringValue(data.finalPrompt || data.prompt || data.submittedPrompt),
        sourceNodeId: node.id,
      };
    })
    .filter((reference) => reference.url);
  return candidates[0] ?? null;
}

function withPositioningBoardVideoAuthority(prompt: string, positioningBoardRef: ClipAssetReference | null): string {
  if (!positioningBoardRef?.url) return prompt;
  const authorityLine = "Use the connected positioning board as the spatial layout authority for this clip: preserve character screen positions, facing directions, visible states, and scene geography from that single frame.";
  if (normalizeCompareText(prompt).includes("connected positioning board as the spatial layout authority")) return prompt;
  return [authorityLine, prompt].filter(Boolean).join("\n");
}

function collectClipAssetReferences(
  clip: WorkflowClip,
  clipScenes: WorkflowScene[],
  assets: WorkflowAssets,
  limit: number,
  extraSearchText = "",
  options: { includeProps?: boolean; includeScenes?: boolean; includeMissing?: boolean } = {},
): ClipAssetReference[] {
  const refs: ClipAssetReference[] = [];
  const seen = new Set<string>();
  const characters = assetArray(assets, "characters");
  const scenes = assetArray(assets, "scenes");
  const props = assetArray(assets, "props");
  const includeProps = options.includeProps ?? true;
  const includeScenes = options.includeScenes ?? true;
  const includeMissing = options.includeMissing ?? false;
  const explicitClipText = normalizeCompareText([
    ...clipScenes.flatMap((scene) => [scene.title, scene.description, scene.action, scene.visualPrompt, scene.references, scene.setting]),
  ].join("\n"));
  const propSearchText = normalizeCompareText([
    explicitClipText,
    clip.title,
    clip.setting,
    clip.plotGoal,
    clip.startState,
    clip.endState,
    extraSearchText,
  ].join("\n"));
  const names = clipVisibleCharacterNames(clipScenes);
  for (const name of names) {
    const asset = findWorkflowAssetByName(characters, name);
    pushAssetReference(refs, seen, "characters", asset, "角色参考", { includeMissing });
    if (refs.length >= limit) break;
  }
  const visibleCharacterKeys = new Set(names.map((name) => normalizeCompareText(name)).filter(Boolean));
  for (const character of characters) {
    if (refs.length >= limit) break;
    const name = workflowAssetName(character);
    if (!name || visibleCharacterKeys.has(normalizeCompareText(name))) continue;
    if (!characterNameLooksPhysicallyPresent(explicitClipText, name)) continue;
    pushAssetReference(refs, seen, "characters", character, "角色引用参考", { includeMissing });
  }
  if (includeScenes) {
    const primarySceneNames = primarySceneNamesForClip(clip, clipScenes, extraSearchText);
    for (const name of primarySceneNames) {
      if (refs.length >= limit) break;
      pushAssetReference(refs, seen, "scenes", findWorkflowAssetByName(scenes, name), "场景参考", { includeMissing });
    }

    if (primarySceneNames.length === 0) {
      const settingNames = uniqueNames([clip.setting ?? "", ...clipScenes.map((scene) => scene.setting ?? "")]);
      for (const name of settingNames) {
        if (refs.length >= limit) break;
        pushAssetReference(refs, seen, "scenes", findWorkflowAssetByName(scenes, name), "场景参考", { includeMissing });
      }
    }
  }
  if (includeProps) {
    for (const prop of props) {
      if (refs.length >= limit) break;
      const name = workflowAssetName(prop);
      if (name && explicitClipMentionsAsset(propSearchText, prop)) {
        pushAssetReference(refs, seen, "props", prop, "道具参考", { includeMissing });
      }
    }
  }
  return refs.slice(0, limit);
}

function clipVisibleCharacterNames(clipScenes: WorkflowScene[]): string[] {
  return uniqueNames(clipScenes.flatMap((scene) => {
    const raw: unknown[] = isRecord(scene) && Array.isArray((scene as Record<string, unknown>).characters) ? (scene as Record<string, unknown>).characters as unknown[] : [];
    return raw.map(stringValue).filter((name) => characterIsExplicitlyVisibleInScene(name, scene));
  }));
}

function clipPositioningBoardCharacterNames(clip: WorkflowClip, clipScenes: WorkflowScene[]): string[] {
  const explicit = clipScenes.flatMap((scene) => {
    const raw: unknown[] = isRecord(scene) && Array.isArray((scene as Record<string, unknown>).characters) ? (scene as Record<string, unknown>).characters as unknown[] : [];
    return raw.map(stringValue).filter((name) => characterIsExplicitlyVisibleInScene(name, scene));
  });
  const continuity = [
    ...(Array.isArray(clip.characters) ? clip.characters.map(stringValue) : []),
    ...clipScenes.flatMap((scene) => {
      const raw: unknown[] = isRecord(scene) && Array.isArray((scene as Record<string, unknown>).characters) ? (scene as Record<string, unknown>).characters as unknown[] : [];
      return raw.map(stringValue);
    }),
  ].filter((name) => characterIsAllowedAsPositioningBoardContinuityReference(name, clip, clipScenes));
  return uniqueNames([...explicit, ...continuity]);
}

function characterIsAllowedAsPositioningBoardContinuityReference(name: string, clip: WorkflowClip, clipScenes: WorkflowScene[]): boolean {
  const key = normalizeCompareText(name);
  if (!key) return false;
  const searchableText = normalizeCompareText([
    clip.title,
    clip.plotGoal,
    clip.startState,
    clip.endState,
    ...clipScenes.flatMap((scene) => [
      scene.title,
      scene.description,
      scene.action,
      scene.visualPrompt,
      scene.references,
    ]),
  ].filter(Boolean).join("\n"));
  if (!searchableText.includes(key)) return false;
  return !characterMentionIsNonVisualOnly(searchableText, key);
}

function characterIsExplicitlyVisibleInScene(name: string, scene: WorkflowScene): boolean {
  const key = normalizeCompareText(name);
  if (!key) return false;
  const sceneText = normalizeCompareText([
    scene.title,
    scene.description,
    scene.action,
    scene.visualPrompt,
    scene.references,
    scene.composition,
  ].join("\n"));
  if (!sceneText.includes(key)) return false;

  return !characterMentionIsNonVisualOnly(sceneText, key);
}

function explicitClipMentionsAsset(searchableText: string, asset: WorkflowAssetItem): boolean {
  const candidates = uniqueNames([
    workflowAssetName(asset),
    ...assetAliasCandidates(asset),
  ]);
  return candidates.some((candidate) => {
    const key = normalizeCompareText(candidate);
    return Boolean(key && searchableText.includes(key));
  });
}

function collectClipPositioningBoardReferences(
  clip: WorkflowClip,
  clipScenes: WorkflowScene[],
  assets: WorkflowAssets,
  limit: number,
  options: { includeMissing?: boolean } = {},
): ClipAssetReference[] {
  const refs: ClipAssetReference[] = [];
  const seen = new Set<string>();
  const characters = assetArray(assets, "characters");
  const scenes = assetArray(assets, "scenes");
  const props = assetArray(assets, "props");
  const includeMissing = options.includeMissing ?? false;

  for (const name of clipPositioningBoardCharacterNames(clip, clipScenes)) {
    if (refs.length >= limit) break;
    pushAssetReference(refs, seen, "characters", findWorkflowAssetByName(characters, name), "角色参考", { includeMissing });
  }

  const primarySceneNames = primarySceneNamesForClip(clip, clipScenes);
  for (const name of primarySceneNames) {
    if (refs.length >= limit) break;
    pushAssetReference(refs, seen, "scenes", findWorkflowAssetByName(scenes, name), "场景参考", { includeMissing });
  }
  if (primarySceneNames.length === 0) {
    const settingNames = uniqueNames([clip.setting ?? "", ...clipScenes.map((scene) => scene.setting ?? "")]);
    for (const name of settingNames) {
      if (refs.length >= limit) break;
      pushAssetReference(refs, seen, "scenes", findWorkflowAssetByName(scenes, name), "场景参考", { includeMissing });
    }
  }

  for (const prop of props) {
    if (refs.length >= limit) break;
    const name = workflowAssetName(prop);
    if (name && positioningBoardPropIsExplicitlyVisible(name, prop, clipScenes)) {
      pushAssetReference(refs, seen, "props", prop, "当前可见道具", { includeMissing });
    }
  }

  return refs.slice(0, limit);
}

function positioningBoardPropIsExplicitlyVisible(propName: string, prop: WorkflowAssetItem, clipScenes: WorkflowScene[]): boolean {
  const aliases = assetAliasCandidates({ ...prop, name: propName })
    .map((alias) => normalizeCompareText(alias))
    .filter((alias) => alias.length >= 3);
  if (aliases.length === 0) return false;
  const visibleText = normalizeCompareText(clipScenes.flatMap((scene) => [
    scene.action,
    scene.description,
    scene.references,
    scene.visualPrompt,
  ]).filter(Boolean).join("\n"));
  if (!visibleText) return false;
  if (!aliases.some((alias) => visibleText.includes(alias))) return false;

  const propKey = normalizeCompareText(propName);
  if (propKey && !visibleText.includes(propKey) && propKey.split(/\s+/).length > 1) {
    const genericAliasOnly = aliases.some((alias) => visibleText.includes(alias) && alias.split(/\s+/).length === 1);
    if (genericAliasOnly) {
      return /(holds?|holding|held|carries|carrying|clutches|clutching|aims?|aiming|points?|pointing|pressed|visible|in frame|foreground|midground|background|hand|grip|against|at his|at her|at their|拿|握|抱|举|指|对准|可见|入画|手中|身边|抵住)/i.test(visibleText);
    }
  }
  return true;
}

function assetAliasCandidates(asset: WorkflowAssetItem): string[] {
  const name = workflowAssetName(asset);
  const nameParts = name
    .split(/\s+/g)
    .map((_, index, parts) => parts.slice(index).join(" "))
    .filter((text) => text.length >= 5);
  const raw = [
    ...nameParts,
    stringValue(asset.title),
    ...arrayValue(asset.aliases).map(stringValue),
    stringValue(asset.description),
    stringValue(asset.visualPrompt),
    stringValue(asset.lockedVisualIdentity),
    stringValue(asset.function),
  ];
  return raw
    .flatMap((text) => text.split(/[,\n;，；、()（）[\]【】]/g))
    .map((text) => text.trim())
    .filter((text) => text.length >= 3 && text.length <= 80)
    .slice(0, 16);
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

function workflowAssetNameKeys(asset: WorkflowAssetItem | string): string[] {
  const aliases = typeof asset === "string"
    ? [normalizeCompareText(asset)]
    : [
        workflowAssetName(asset),
        stringValue(asset.title),
        ...arrayValue(asset.aliases).map(stringValue),
      ].map(normalizeCompareText);
  const keys = new Set<string>();
  for (const alias of aliases) {
    if (!alias) continue;
    keys.add(alias);
    const signature = propCanonicalSignature(alias);
    if (signature) keys.add(signature);
  }
  return Array.from(keys);
}

function workflowAssetNamesMatch(asset: WorkflowAssetItem, name: string): boolean {
  const targetKeys = new Set(workflowAssetNameKeys(name));
  return workflowAssetNameKeys(asset).some((key) => targetKeys.has(key));
}

function pushAssetReference(
  refs: ClipAssetReference[],
  seen: Set<string>,
  kind: ClipAssetReference["kind"],
  item: WorkflowAssetItem | undefined,
  labelPrefix: string,
  options: { includeMissing?: boolean } = {},
): boolean {
  if (!item) return false;
  const name = workflowAssetName(item);
  const url = workflowAssetImageUrl(item);
  if (!name || (!url && !options.includeMissing)) return false;
  const key = `${kind}:${workflowAssetStableId(item) || normalizeCompareText(name)}:${url || "missing"}`;
  if (seen.has(key)) return false;
  seen.add(key);
  refs.push({ kind, name, label: `${labelPrefix}: ${name}`, url, assetId: workflowAssetImageAssetId(item) });
  return true;
}

function assetArray(assets: WorkflowAssets, kind: keyof WorkflowAssets): WorkflowAssetItem[] {
  const value = assets[kind];
  return Array.isArray(value) ? value.filter(isRecord) as WorkflowAssetItem[] : [];
}

function findWorkflowAssetByName(items: WorkflowAssetItem[], name: string): WorkflowAssetItem | undefined {
  const target = normalizeCompareText(name);
  if (!target) return undefined;
  return items.find((item) => workflowAssetNamesMatch(item, name))
    ?? items.find((item) => {
      const assetName = normalizeCompareText(workflowAssetName(item));
      return Boolean(assetName && (assetName.includes(target) || target.includes(assetName)));
    });
}

function primarySceneNamesForClip(clip: WorkflowClip, clipScenes: WorkflowScene[], extraSearchText = ""): string[] {
  const text = normalizeCompareText([
    clip.title,
    clip.setting,
    clip.plotGoal,
    clip.startState,
    clip.endState,
    ...clipScenes.flatMap((scene) => [
      scene.title,
      scene.setting,
      scene.description,
      scene.action,
      scene.visualPrompt,
      scene.references,
    ]),
  ].filter(Boolean).join("\n"));
  const names: string[] = [];
  const push = (name: string) => {
    if (!names.some((item) => normalizeCompareText(item) === normalizeCompareText(name))) names.push(name);
  };
  const settingText = normalizeCompareText([
    clip.setting,
    ...clipScenes.map((scene) => scene.setting),
  ].filter(Boolean).join("\n"));

  if (/living vine hospital bed|vine hospital bed|living vine bed|vine bed|ritual bed|hospital bed|operation bed|operating bed|restraint bed|藤蔓病床|活体藤蔓|藤蔓床|仪式病床|仪式床|手术床|束缚床/.test(settingText || text)) {
    push("Living Vine Hospital Bed");
  }
  if (/underground loading dock|地下装卸|地下卸货/.test(text)) push("Underground Loading Dock");
  if (/frozen meat section|冷冻肉|冻肉区/.test(text) && !names.some((name) => normalizeCompareText(name) === "living vine hospital bed")) push("Frozen Meat Section");
  if (/gutted produce section ritual hall|gutted produce hall/.test(settingText || text)) {
    push("Thanksgiving Harvest Ritual Stage");
  }
  if (
    /thanksgiving harvest ritual stage|harvest ritual stage|ritual stage|pumpkin podium|fungus curtain|living wall|vine barricade|front row quarantine seats|coronation|pre-harvest ritual|感恩节丰收仪式舞台|丰收仪式舞台|仪式舞台|南瓜讲台|真菌幕布|活墙|藤蔓墙|藤蔓路障|前排隔离座|加冕|预收获仪式/.test(text)
  ) {
    push("Thanksgiving Harvest Ritual Stage");
  }
  if (/labor purification route|劳动净化路线|净化路线/.test(text)) push("Labor Purification Route");
  if (/labor purification zone|劳动净化区|净化区/.test(text)) push("Labor Purification Zone");
  if (/sanctuary superstore center|superstore meditation circle|meditation circle|trial circle|圣所超市|超市中心|冥想圈|审判圈/.test(settingText || text)) {
    push("Superstore Meditation Circle");
  } else if (/shipping pallet altar|pallet altar|托盘祭坛|货盘祭坛/.test(settingText)) {
    push("Shipping Pallet Altar");
  }

  return names;
}

function workflowAssetName(item: WorkflowAssetItem): string {
  return stringValue(item.name) || stringValue(item.title);
}

function workflowAssetStableId(item: WorkflowAssetItem): string {
  return stringValue(item.id) || workflowAssetImageAssetId(item) || workflowAssetName(item);
}

function workflowAssetImageUrl(item: WorkflowAssetItem): string {
  return publicImageUrl(item.referenceImageUrl || item.generatedImageUrl);
}

function workflowAssetImageAssetId(item: WorkflowAssetItem): string {
  const url = workflowAssetImageUrl(item);
  const referenceAssetId = stringValue(item.referenceImageAssetId);
  const generatedAssetId = stringValue(item.generatedImageAssetId);
  if (generatedAssetId && url.includes(generatedAssetId)) return generatedAssetId;
  if (referenceAssetId && url.includes(referenceAssetId)) return referenceAssetId;
  return referenceAssetId || generatedAssetId;
}

function firstPublicImageUrl(value: unknown): string {
  if (!Array.isArray(value)) return "";
  for (const item of value) {
    const url = publicImageUrl(item);
    if (url) return url;
  }
  return "";
}

function characterNameLooksPhysicallyPresent(searchableText: string, characterName: string): boolean {
  const name = normalizeCompareText(characterName);
  if (!name || !searchableText.includes(name)) return false;
  if (characterMentionIsNonVisualOnly(searchableText, name)) return false;
  const escaped = escapeRegExp(name);
  const decorativeMention = new RegExp(`\\b${escaped}\\s+(poster|posters|portrait|portraits|photo|photos|image|images|billboard|billboards|logo|logos|sign|signs)\\b`);
  return !decorativeMention.test(searchableText);
}

function characterMentionIsNonVisualOnly(searchableText: string, normalizedName: string): boolean {
  const escaped = escapeRegExp(normalizedName);
  const nonVisualPatterns = [
    new RegExp(`\\b${escaped}\\b[^.。!?\\n]{0,80}\\b(?:memory echo only|voice only|audio only|off[- ]?screen voice|voiceover|voice-over|narration only|heard only)\\b`),
    new RegExp(`\\b(?:memory echo only|voice only|audio only|off[- ]?screen voice|voiceover|voice-over|narration only|heard only)\\b[^.。!?\\n]{0,80}\\b${escaped}\\b`),
    new RegExp(`\\b${escaped}\\b[^.。!?\\n]{0,80}\\b(?:回声|声音|旁白|画外音|只闻其声|不出镜|记忆闪回|记忆回声)\\b`),
    new RegExp(`\\b(?:回声|声音|旁白|画外音|只闻其声|不出镜|记忆闪回|记忆回声)\\b[^.。!?\\n]{0,80}\\b${escaped}\\b`),
  ];
  if (!nonVisualPatterns.some((pattern) => pattern.test(searchableText))) return false;

  const visualOverridePatterns = [
    new RegExp(`\\b${escaped}\\b[^.。!?\\n]{0,80}\\b(?:appears physically|visible|on screen|in frame|enters|stands|holds|faces|walks|runs|grabs|points|looks)\\b`),
    new RegExp(`\\b${escaped}\\b[^.。!?\\n]{0,80}\\b(?:可见|出镜|入画|站在|拿着|面对|走进|跑向|抓住|指向|看向)\\b`),
  ];
  return !visualOverridePatterns.some((pattern) => pattern.test(searchableText));
}

function buildLocalClipVideoPrompt(clip: WorkflowClip, clipScenes: WorkflowScene[], aspectRatio = "16:9"): string {
  const duration = Math.round(getClipEstimatedDuration(clip, clipScenes) * 10) / 10;
  const sceneVisualLock = mostCommonString(clipScenes.map((scene) => scene.sceneVisualLock).filter((value): value is string => Boolean(value)));
  const initialStateAndPositions = summarizeCanvasInitialCharacterStateAndPositions(clip, clipScenes);
  const allocation = allocateClipDialogueToBeats(
    clipScenes.map((scene) => ({
      dialogue: scene.dialogue || "",
      characters: scene.characters || [],
      title: scene.title,
      action: scene.action,
      description: scene.description,
      visualPrompt: scene.visualPrompt,
      references: scene.references,
    })),
  );
  const beats = clipScenes.map((scene, index) => {
    const dialogue = compactPromptText(allocation.beats[index]?.join(" ") ?? "");
    const action = stripCanvasShotStyleBoilerplate(compactPromptText(scene.action || scene.description || scene.visualPrompt || fallbackCanvasBeatAction(scene, dialogue)));
    const performance = canvasPerformanceLineForBeat(scene, action, dialogue, clip);
    return `S${index + 1}: ${[
      `Shot: ${sceneCameraPlan(scene, index)}`,
      dialogue ? `Dialogue: ${formatCanvasVideoDialogue(dialogue)}` : "",
      performance,
      action,
    ].filter(Boolean).join("; ")}`;
  });
  return [
    `Clip video prompt for ${clip.title}.`,
    `Duration target: ${duration}s, ${aspectRatio} cinematic 3D animated dark comedy style.`,
    `Characters: ${compactList(clip.characters, "characters from this Clip", 12)}.`,
    `Setting: ${clip.setting || "current scene"}.`,
    sceneVisualLock ? `Scene visual continuity lock: ${compactPromptText(sceneVisualLock)}` : "",
    initialStateAndPositions ? `Initial character state and positions: ${initialStateAndPositions}` : "",
    "Global shot rules: maintain one continuous scene geography, readable screen direction, visible-subject framing, and clear foreground/midground/background separation without repeating these rules in every beat.",
    "Acting rules: infer emotion, facial expression, and dialogue delivery from the current story beat; add them only when useful for close-ups, reactions, or spoken lines, not as fixed boilerplate in every S beat.",
    "Each S beat should contain only concrete shot design, specific blocking, visible action, spoken dialogue when present, useful acting notes, and carried-forward state only when it affects the shot.",
    compactPromptText(clip.plotGoal),
    beats.length ? beats.join("\n") : compactPromptText(clip.startState || clip.endState),
  ].filter(Boolean).join("\n");
}

function formatCanvasVideoDialogue(value: string): string {
  const cleaned = compactPromptText(value || "");
  if (!cleaned) return "";
  const speakerMatch = cleaned.match(/^([^:：;\n]{1,40})\s*[:：]\s*([\s\S]+)$/);
  if (!speakerMatch) return trimCanvasDialogueQuotes(cleaned);
  const speaker = String(speakerMatch[1] || "").trim();
  const line = trimCanvasDialogueQuotes(String(speakerMatch[2] || ""));
  return speaker && line ? `${speaker} says “${line}”` : trimCanvasDialogueQuotes(cleaned);
}

function trimCanvasDialogueQuotes(value: string): string {
  return String(value || "").trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
}

function summarizeCanvasInitialCharacterStateAndPositions(clip: WorkflowClip, clipScenes: WorkflowScene[]): string {
  const output: string[] = [];
  const seen = new Set<string>();
  const fallbackText = compactPromptText([clip.startState, clip.endState].filter(Boolean).join("; "));
  for (const scene of clipScenes.slice(0, 3)) {
    const names = uniquePromptStrings([...(scene.characters ?? []), ...extractDialogueSpeakerNames(scene.dialogue || "")]).slice(0, 4);
    if (names.length === 0) continue;
    const evidence = cleanCanvasInitialStateEvidence([
      scene.composition,
      scene.references,
      scene.visualPrompt,
      scene.action,
      scene.description,
      scene.title,
    ].filter(Boolean).join("; "));
    for (const name of names) {
      const key = normalizeCompareText(name);
      if (!key || seen.has(key)) continue;
      const phrase = summarizeCanvasInitialStateForCharacter(name, evidence, fallbackText);
      if (!phrase) continue;
      output.push(phrase);
      seen.add(key);
      if (output.length >= 5) break;
    }
    if (output.length >= 5) break;
  }
  if (output.length === 0 && fallbackText) return compactSentence(fallbackText, 360);
  return compactSentence(output.join("; "), 520);
}

function summarizeCanvasInitialStateForCharacter(character: string, evidence: string, fallbackText: string): string {
  const clauses = reduceCanvasInitialStateClauses(uniquePromptStrings([
    ...canvasInitialStateClausesForCharacter(character, fallbackText),
    ...canvasInitialStateClausesForCharacter(character, evidence),
  ]).sort((a, b) => canvasInitialStateClausePriority(b) - canvasInitialStateClausePriority(a)));
  if (clauses.length === 0) return "";
  return `${character} ${uniquePromptStrings(clauses).slice(0, 3).join(", ")}`;
}

function canvasInitialStateClausesForCharacter(character: string, value: string): string[] {
  const source = cleanCanvasInitialStateEvidence(value);
  if (!source) return [];
  const name = escapeRegExp(character);
  const clauses: string[] = [];
  const carriedBedState = canvasLivingVineBedStateForCharacter(source, character);
  if (carriedBedState) clauses.push(carriedBedState);
  const localSource = canvasInitialStateLocalTextForCharacter(source, character);
  const patterns = [
    String.raw`\b${name}\b[^.;。!?]{0,90}\b(screen[- ]?(?:left|right|center)|center[- ]?(?:left|right)|foreground|midground|background|left side|right side|front row|rear|elevated|below|above|at the head|head of (?:the )?bed|bed head)\b[^.;。!?]{0,70}`,
    String.raw`\b${name}\b[^.;。!?]{0,90}\b(?:facing|faces|looks toward|turned toward|toward|面向|看向)\b[^.;。!?]{0,70}`,
    String.raw`\b${name}\b[^.;。!?]{0,100}\b(?:holding|holds|held|clutching|clutches|carrying|carries|with|手持|拿着|抱着)\b[^.;。!?]{0,70}`,
    String.raw`\b${name}\b[^.;。!?]{0,110}\b(?:bound|tied|restrained|wearing|wears|splattered|stained|injured|lowered|raised|嵌在|长在|被绑|受限|穿着|戴着|污渍|溅到)\b[^.;。!?]{0,80}`,
  ];
  for (const pattern of patterns) {
    const match = localSource.match(new RegExp(pattern, "i"));
    if (match) clauses.push(cleanCanvasInitialStateClause(match[0].replace(new RegExp(String.raw`^\b${name}\b\s*`, "i"), "")));
  }
  const compactSentenceWithName = localSource.match(new RegExp(String.raw`\b${name}\b[^.;。!?]{0,140}`, "i"));
  if (clauses.length === 0 && compactSentenceWithName) {
    const fallbackClause = cleanCanvasInitialStateClause(compactSentenceWithName[0].replace(new RegExp(String.raw`^\b${name}\b\s*`, "i"), ""));
    if (isUsefulCanvasInitialStateClause(fallbackClause)) clauses.push(fallbackClause);
  }
  return clauses.filter(Boolean);
}

function canvasInitialStateClausePriority(value: string): number {
  const text = normalizeCompareText(value);
  let score = 0;
  if (/living vine hospital bed|vine bed|ritual bed|hospital bed|altar|bed/.test(text)) score += 5;
  if (/bound|restrained|strapped|tied|root restraint|vine restraint|藤蔓|根须|被绑|束缚/.test(text)) score += 4;
  if (/screen|center|left|right|foreground|background|at the head|head of/.test(text)) score += 2;
  if (/facing|toward|looks toward|面向|看向/.test(text)) score += 1;
  return score;
}

function reduceCanvasInitialStateClauses(values: string[]): string[] {
  const cleaned = uniquePromptStrings(values.map(cleanCanvasInitialStateClause).filter(Boolean))
    .filter((item) => !/^Start\s*[:：]/i.test(item))
    .filter((item) => !/^Ends?\s+with\b/i.test(item))
    .filter((item) => !/^['’]s\b/i.test(item))
    .filter((item) => !/^(?:Location|Characters|Continuity references|Character personal prop continuity|Rule)\s*[:：]/i.test(item))
    .filter((item) => !/^\s*,\s*$/.test(item));
  const bestLivingBedState = cleaned.find((item) => /Living Vine Hospital Bed.*wrist connected to needle\/tubing/i.test(item))
    ?? cleaned.find((item) => /lying on the Living Vine Hospital Bed, restrained by living vines\/root restraints/i.test(item))
    ?? cleaned.find((item) => /Living Vine Hospital Bed.*restrained by living vines\/root restraints/i.test(item));
  return cleaned.filter((item) => {
    if (bestLivingBedState && /\bhands bound with rope\b|\bbound with rope\b|\bmovement restricted\b/i.test(item)) return false;
    if (
      bestLivingBedState &&
      item !== bestLivingBedState &&
      /Living Vine Hospital Bed.*restrained by living vines\/root restraints/i.test(item)
    ) return false;
    return true;
  });
}

function canvasLivingVineBedStateForCharacter(value: string, character: string): string {
  const source = compactPromptText(value || "");
  if (!source) return "";
  const name = escapeRegExp(character);
  if (!new RegExp(String.raw`\b${name}\b`, "i").test(source)) return "";
  const hasLivingBed = /\b(?:Living Vine Hospital Bed|vine hospital bed|living vine bed|vine bed|ritual bed|hospital bed|altar)\b|藤蔓病床|藤蔓床|仪式病床|仪式床/.test(source);
  const local = canvasInitialStateLocalTextForCharacter(source, character);
  const hasVineRestraint = /\b(?:living vines?|vine restraints?|root restraints?|restrained by vines?|bound by vines?|tendrils?|fungal neck threads?|bound|restrained|strapped|tied)\b|藤蔓|根须|触须|菌丝|被绑|束缚/.test(local);
  const characterOnBed = /\b(?:lies?|lying|bound|restrained|strapped|twists?|glares?|strains?)\b/i.test(local) ||
    /\bon\s+(?:the\s+)?(?:Living Vine Hospital Bed|vine hospital bed|living vine bed|vine bed|ritual bed|hospital bed|altar)\b/i.test(local);
  if (!hasLivingBed || !hasVineRestraint || !characterOnBed) return "";
  if (/\b(?:wrist|needle|tube|tubing|injection)\b/i.test(local)) {
    return "on the Living Vine Hospital Bed, still restrained by living vines/root restraints, wrist connected to needle/tubing";
  }
  if (/\b(?:lies?|lying|twists?|tilts?|glares?|strains?)\b/i.test(local)) {
    return "lying on the Living Vine Hospital Bed, restrained by living vines/root restraints";
  }
  return "on the Living Vine Hospital Bed, restrained by living vines/root restraints";
}

function canvasInitialStateLocalTextForCharacter(value: string, character: string): string {
  const name = escapeRegExp(character);
  return canvasInitialStateEvidenceClauses(value)
    .map((item) => {
      const match = item.match(new RegExp(String.raw`\b${name}\b[\s\S]*`, "i"));
      const local = match?.[0]?.trim() ?? "";
      return local.split(/(?:[;,]|[.!?])\s+(?=(?:[A-Z][A-Za-z'’.-]+\b|Location|Characters|Start|End|Continuity references|Rule)\b)/)[0]?.trim() ?? "";
    })
    .filter(Boolean)
    .join("; ");
}

function cleanCanvasInitialStateEvidence(value: string): string {
  const structured = canvasInitialStateEvidenceClauses(value).join("; ");
  return compactPromptText(structured)
    .replace(/\bShot:\s*/gi, "")
    .replace(/\bState:\s*/gi, "")
    .replace(/\bPerformance:\s*[^;。!?]+[;。!?]?\s*/gi, "")
    .replace(/\bExact dialogue:\s*[^;。!?]+[;。!?]?\s*/gi, "")
    .replace(/\b(?:medium shot|close-up|wide shot|eye-level|over-shoulder|static hold|slow push-in|controlled camera move|handheld tracking|24mm|35mm|50mm|85mm)\b;?\s*/gi, "")
    .replace(/\s*;\s*;\s*/g, "; ")
    .replace(/^;\s*|\s*;$/g, "")
    .trim();
}

function canvasInitialStateEvidenceClauses(value: string): string[] {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/Character personal prop continuity\s*[:：][\s\S]*?(?=\b(?:Rule|Start|End|Location|Characters|Continuity references)\s*[:：]|$)/gi, "\n")
    .replace(/\s*\|\s*/g, "\n")
    .replace(/\b(Location|Characters|Start|End|Continuity references|Character personal prop continuity|Rule)\s*[:：]/gi, "\n$1: ")
    .split(/\n+|;\s*/)
    .map((line) => line.trim().replace(/^[-*]\s*/, ""))
    .filter(Boolean)
    .map((line) => {
      if (/^(?:Location|Characters|Character personal prop continuity|Rule)\s*[:：]/i.test(line)) return "";
      if (/^Continuity references\s*[:：]\s*/i.test(line)) return line.replace(/^Continuity references\s*[:：]\s*/i, "").trim();
      return line
        .replace(/^Start\s*[:：]\s*(?:Starts?\s+with\s*)?/i, "")
        .replace(/^End\s*[:：]\s*(?:Ends?\s+with\s*)?/i, "")
        .replace(/^Continuity\s*[:：]\s*/i, "")
        .replace(/^Starts?\s+with\s+/i, "")
        .replace(/^Ends?\s+with\s+/i, "")
        .trim();
    })
    .filter((line) => line && !/^Keep screen direction, character side, important props\b/i.test(line))
    .filter((line) => line && !/^these props belong to the listed characters\b/i.test(line));
}

function cleanCanvasInitialStateClause(value: string): string {
  return compactPromptText(value || "")
    .replace(/\b(?:blocking|composition)\s*[:：]\s*/gi, "")
    .replace(/\b(?:Location|Characters|Continuity references)\s*[:：][^;。!?]*[;。!?]?\s*/gi, "")
    .replace(/\bStart\s*[:：]\s*(?:Starts?\s+with\s*)?/gi, "")
    .replace(/\bEnd\s*[:：]\s*(?:Ends?\s+with\s*)?/gi, "")
    .replace(/^(?:is|are|stands?|remains?|still|with)\s+/i, "")
    .replace(/^[,;:：\s]+/g, "")
    .replace(/\s*;\s*$/g, "")
    .trim();
}

function isUsefulCanvasInitialStateClause(value: string): boolean {
  return /\b(?:screen[- ]?(?:left|right|center)|center[- ]?(?:left|right)?|foreground|midground|background|left side|right side|front row|rear|elevated|below|above|at the head|head of (?:the )?bed|bed head|facing|faces|looks toward|turned toward|toward|holding|holds|held|clutching|clutches|carrying|carries|with|bound|tied|restrained|wearing|wears|splattered|stained|injured|lowered|raised|lies?|lying|on the|upon|bed|altar)\b|面向|看向|手持|拿着|抱着|嵌在|长在|被绑|受限|穿着|戴着|污渍|溅到/.test(value);
}

function uniquePromptStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const cleaned = compactPromptText(value);
    const key = normalizeCompareText(cleaned);
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
  }
  return output;
}

function canvasPerformanceLineForBeat(scene: WorkflowScene, action: string, dialogue: string, clip: WorkflowClip): string {
  void clip;
  const localText = normalizeCompareText([
    scene.title,
    scene.description,
    scene.action,
    scene.references,
    scene.visualPrompt,
    action,
    dialogue,
  ].join(" "));
  const closeOrReaction = /(close|close-up|reaction|face|eyes|stare|look|expression|whisper|smirk|特写|反应|表情|眼神)/.test(localText);
  const hasDialogue = Boolean(compactPromptText(dialogue || scene.dialogue));
  const hasLocalEmotionCue = hasCanvasBeatEmotionCue(localText);
  if (!hasDialogue && (!closeOrReaction || !hasLocalEmotionCue)) return "";
  if (!hasLocalEmotionCue && !hasDialogue) return "";
  const speakers = extractDialogueSpeakerNames(dialogue || scene.dialogue || "");
  const visible = clipVisibleCharacterNames([scene]);
  const subject = (speakers.length ? speakers : visible).slice(0, 2).join(" and ") || "visible performer(s)";
  const emotion = inferCanvasBeatEmotion(localText);
  const delivery = hasDialogue ? inferCanvasDialogueDelivery(localText) : "";
  if (!hasLocalEmotionCue && emotion === GENERIC_CANVAS_BEAT_EMOTION && !delivery) return "";
  const parts = [
    `${subject} ${subject.includes(" and ") ? "show" : "shows"} ${emotion}`,
    delivery ? `delivery ${delivery}` : "",
  ].filter(Boolean);
  return parts.length ? `Performance: ${parts.join("; ")}` : "";
}

const GENERIC_CANVAS_BEAT_EMOTION = "story-specific emotion matching the current beat, readable through face and body language";

function hasCanvasBeatEmotionCue(text: string): boolean {
  return /(panic|fear|afraid|terrified|tense|hesitat|nervous|worried|angry|rage|furious|scold|accuse|yell|shout|snap|glares|sarcastic|mock|dry|deadpan|joke|wisecrack|snark|surprise|reveal|shock|realize|sudden|startled|\bconfess(?:es|ed|ing)?\b|guilty|ashamed|plead|beg|ritual|trial|announce|ceremony|sermon|judgment|惊恐|害怕|紧张|犹豫|怒|训斥|指责|吼|瞪|讽刺|吐槽|冷笑|黑色幽默|惊讶|震惊|发现|意识到|忏悔|内疚|羞愧|求饶|审判|仪式|宣告|布道)/.test(text);
}

function inferCanvasBeatEmotion(text: string): string {
  if (/(panic|fear|afraid|terrified|tense|hesitat|nervous|worried|惊恐|害怕|紧张|犹豫)/.test(text)) return "tense, alert expression with small anxious micro-reactions";
  if (/(angry|rage|furious|scold|accuse|yell|shout|snap|glares|怒|训斥|指责|吼|瞪)/.test(text)) return "sharp anger or righteous outrage in the face and posture";
  if (/(sarcastic|mock|dry|deadpan|joke|wisecrack|snark|讽刺|吐槽|冷笑|黑色幽默|crap|kidding)/.test(text)) return "dry comic timing, restrained sarcasm, and readable deadpan expression";
  if (/(surprise|reveal|shock|realize|sudden|startled|惊讶|震惊|发现|意识到)/.test(text)) return "surprised recognition that quickly turns into a reaction";
  if (/\b(confess(?:es|ed|ing)?|guilty|ashamed|plead|beg)\b|忏悔|内疚|羞愧|求饶/.test(text)) return "uneasy guilt or pleading vulnerability";
  if (/(ritual|trial|announce|ceremony|sermon|judgment|审判|仪式|宣告|布道)/.test(text)) return "heightened ritual seriousness with theatrical conviction";
  return GENERIC_CANVAS_BEAT_EMOTION;
}

function inferCanvasDialogueDelivery(text: string): string {
  if (/(deadpan|dry|sarcastic|mock|joke|wisecrack|crap|kidding|讽刺|吐槽|冷笑)/.test(text)) return "dry, quick, sarcastic, with comic pause timing";
  if (/(angry|furious|scold|accuse|yell|shout|snap|murder|trial|审判|指责|训斥|怒吼)/.test(text)) return "forceful and theatrical, rising with controlled outrage";
  if (/(whisper|secret|quiet|low|低声|耳语|悄声)/.test(text)) return "lower and controlled, with guarded tension";
  if (/(panic|fear|please|beg|help|惊恐|求饶|拜托)/.test(text)) return "urgent and breathy, pushed by fear";
  if (/(announce|ritual|ceremony|sermon|宣告|仪式|布道)/.test(text)) return "ceremonial, declarative, and aimed at the hall";
  return "natural to the line's intent, not monotone, with clear emotional subtext";
}

function sceneCameraPlan(scene: WorkflowScene, index: number): string {
  const text = normalizeCompareText([scene.title, scene.description, scene.action, scene.visualPrompt].join(" "));
  const actionLike = /(run|attack|fire|shoot|dodge|explode|slam|grab|fight|chase|冲|打|射|爆|躲)/.test(text);
  const closeLike = /(close|face|eyes|reaction|whisper|smirk|stare|特写|表情)/.test(text);
  const wideLike = /(enter|open|lab|room|space|crowd|screen|world|establish|全景|空间|进入)/.test(text);
  const shotSize = stringValue(scene.shotSize) || (closeLike ? "close-up" : wideLike ? "wide shot" : "medium shot");
  const angle = stringValue(scene.cameraAngle) || (actionLike && index % 3 === 1 ? "low angle" : index % 4 === 2 ? "over-shoulder" : "eye-level");
  const movement = stringValue(scene.cameraMove) || (actionLike ? "handheld tracking" : wideLike ? "slow push-in" : "static hold");
  const composition = cleanShotBlocking(stringValue(scene.composition) || stringValue(scene.visualPrompt));
  const lens = stringValue(scene.lens) || (shotSize.toLowerCase().includes("wide") ? "24mm" : shotSize.toLowerCase().includes("close") ? "85mm" : "50mm");
  return [
    shotSize,
    angle,
    movement,
    lens,
    composition ? `blocking: ${composition}` : "",
  ].join("; ");
}

function cleanShotBlocking(value: string): string {
  return stripCanvasShotStyleBoilerplate(compactPromptText(value || ""))
    .replace(/\bSet in [^;。.!?]+[;。.!?]?\s*/gi, "")
    .replace(/\bUse the current scene layout[;。.!?]?\s*/gi, "")
    .replace(/\bframe only the visible subject\(s\) for this shot[;。.!?]?\s*/gi, "")
    .replace(/\bkeep screen direction readable[;。.!?]?\s*/gi, "")
    .replace(/\bseparate foreground, midground, and background(?: for continuity)?[;。.!?]?\s*/gi, "")
    .replace(/\bclear character blocking[;。.!?]?\s*/gi, "")
    .replace(/\bcurrent scene layout[;。.!?]?\s*/gi, "")
    .replace(/\b[A-Z][A-Za-z'’.-]+(?:\s+and\s+[A-Z][A-Za-z'’.-]+)?\s+in the same established scene position[;。.!?]?\s*/gi, "")
    .replace(/\bin the same established scene position[;。.!?]?\s*/gi, "")
    .replace(/\bSame setting and character blocking,?\s*natural reaction or angle change\.?\s*/gi, "")
    .replace(/\s*;\s*;\s*/g, "; ")
    .replace(/^;\s*|\s*;$/g, "")
    .trim();
}

function stripCanvasShotStyleBoilerplate(value: string): string {
  return compactPromptText(value || "")
    .replace(/\b(?:masterpiece|best quality|highly detailed|cinematic lighting|consistent character design|polished render|saturated colors|clean 3D render)\b,?\s*/gi, "")
    .replace(/\b(?:saturated\s+)?3D\s+(?:American\s+)?(?:animated\s+)?(?:dark[- ]comedy\s+)?comic style\b,?\s*/gi, "")
    .replace(/\b(?:3D style|American comic style|dark humor|dark-comedy comic look)\b,?\s*/gi, "")
    .replace(/^(?:[,;]\s*)+/g, "")
    .replace(/\s*;\s*;\s*/g, "; ")
    .trim();
}

function buildEpisodeClipVideoPrompt(clip: WorkflowClip, clipScenes: WorkflowScene[], aspectRatio = "16:9"): string {
  if (clipScenes.length === 0 && clip.seedancePrompt) return clip.seedancePrompt;
  const panels = extractStoryboardPromptPanelTexts(clip.storyboardPrompt);
  if (clipScenes.length === 0 && panels.length > 0) {
    const duration = Math.round(getClipEstimatedDuration(clip, clipScenes) * 10) / 10;
    return [
      `Generate one continuous ${duration}s cinematic video, ${aspectRatio}.`,
      "Style: polished 3D American animated dark-comedy comic look, saturated colors, clean 3D render, exaggerated acting, fast pacing.",
      `Scene: ${clip.setting || "current scene"}.`,
      `Characters: ${compactList(clip.characters, "characters from this Clip", 12)}; use connected character reference images for identity.`,
      "Use the connected storyboard image as the main visual reference. Follow these storyboard panels in exact order and animate them as natural motion, not comic panels:",
      panels.map((panel) => `${panel.label}: ${compactPromptText(panel.text)}`).join("\n"),
      "Do not skip, merge, or reorder the P beats. Do not add subtitles, speech bubbles, UI, panel borders, panel numbers, watermarks, or explanatory text.",
    ].filter(Boolean).join("\n");
  }
  return buildLocalClipVideoPrompt(clip, clipScenes, aspectRatio) || clip.seedancePrompt || "";
}

function fallbackCanvasBeatAction(scene: WorkflowScene, dialogue: string): string {
  const speakers = extractDialogueSpeakerNames(dialogue || scene.dialogue || "");
  if (speakers.length > 0) return `${speakers.join(" and ")} speak in ${scene.setting || "the scene"} with clear expression and readable body language.`;
  const cast = (scene.characters || []).filter(Boolean).slice(0, 3);
  if (cast.length > 0) return `${cast.join(" and ")} react in ${scene.setting || "the scene"} with clear story intent.`;
  return "Continue the current story beat with visible character action.";
}

function extractDialogueSpeakerNames(value: string): string[] {
  const raw = String(value || "").replace(/\s+/g, " ").trim();
  if (!raw) return [];
  return Array.from(raw.matchAll(/(?:^|\s)([A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,2}|[一-龥·]{1,12})\s*[:：]/g))
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);
}

function finalizeEpisodeCanvasVideoPrompt(value: string): string {
  const normalized = hoistRepeatedShotRules(normalizePromptLines(value));
  if (normalized.length <= DREAMINA_VIDEO_PROMPT_TARGET_CHARS) return normalized;
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const isBeatLine = (line: string) => /^(?:P|S)\d{1,2}(?:\b|[：:.\-)])/i.test(line);
  const beatLines = lines.filter(isBeatLine);
  const headerLines = lines.filter((line) => !isBeatLine(line));
  const compactHeaders = headerLines
    .map((line) => {
      if (/^Style:/i.test(line)) return "Style: saturated 3D American animated dark-comedy, cinematic lighting, fast exaggerated acting.";
      if (/^Characters:/i.test(line)) return compactSentence(line, 260);
      if (/^Use the connected storyboard/i.test(line)) return "Use connected storyboard as shot-order authority and connected character images as identity authority.";
      if (/^Acting rules:/i.test(line)) return "Acting rules: add story-specific expression, emotion, and dialogue delivery only where useful.";
      if (/^Scene:/i.test(line)) return compactSentence(line, 260);
      if (/^Do not/i.test(line)) return "";
      return compactSentence(line, 220);
    })
    .filter(Boolean)
    .slice(0, 7);
  const footer = "No subtitles, speech bubbles, UI, panel borders, watermarks, random text, gore, or identity drift.";
  const headerText = normalizePromptLines(compactHeaders.join("\n"));
  const beatBudget = Math.max(
    120,
    DREAMINA_VIDEO_PROMPT_TARGET_CHARS - headerText.length - footer.length - compactHeaders.length - beatLines.length - 4,
  );
  const perBeatLimit = beatLines.length > 0
    ? Math.max(120, Math.min(460, Math.floor(beatBudget / beatLines.length)))
    : 460;
  const compactBeats = beatLines.map((line) => compactBeatLine(line, perBeatLimit));
  const compacted = normalizePromptLines([
    ...compactHeaders,
    ...compactBeats,
    footer,
  ].join("\n"));
  if (compacted.length <= DREAMINA_VIDEO_PROMPT_TARGET_CHARS) return compacted;
  return trimPromptToLimit(compacted, DREAMINA_VIDEO_PROMPT_TARGET_CHARS);
}

function compactBeatLine(value: string, maxLength: number): string {
  const text = compactPromptText(value);
  const match = text.match(/^((?:P|S)\d{1,2}(?:\b|[：:.\-)])\s*)/i);
  if (!match) return compactSentence(text, maxLength);
  if (/\b(?:Exact dialogue|Dialogue)\s*[:：]/i.test(text)) return protectDialogueBeatLine(text, maxLength);
  const prefix = match[1];
  if (text.length <= maxLength) return text;
  const bodyLimit = Math.max(24, maxLength - prefix.length - 1);
  return `${prefix}${compactSentence(text.slice(prefix.length), bodyLimit)}`;
}

function protectDialogueBeatLine(value: string, maxLength: number): string {
  const text = normalizeDialogueLine(value);
  if (text.length <= maxLength || maxLength < 260) return text;
  const dialogueMatch = text.match(/\bDialogue\s*[:：]\s*([^;]+(?:;[^A-Z]*(?!\s*(?:Performance|State|Shot|blocking|composition)\s*[:：]))*)/i);
  const dialogue = dialogueMatch?.[0]?.trim() ?? "";
  if (!dialogue) return text;
  const prefix = text.match(/^((?:P|S)\d{1,2}(?:\b|[：:.\-)])\s*)/i)?.[1] ?? "";
  const shot = text.match(/\bShot\s*[:：]\s*([^;]+(?:;\s*[^;]+){0,4})/i)?.[0]?.trim() ?? "";
  const actionParts = text
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^(?:Exact dialogue|Dialogue)\s*[:：]/i.test(part))
    .filter((part) => !/^Shot\s*[:：]/i.test(part))
    .filter((part) => !/^Performance\s*[:：]/i.test(part))
    .filter((part) => !/^delivery\b/i.test(part));
  const actionBudget = Math.max(80, maxLength - prefix.length - shot.length - dialogue.length - 8);
  const action = actionParts.length ? compactSentence(actionParts.join("; "), actionBudget) : "";
  return [prefix.trim(), shot, dialogue, action].filter(Boolean).join("; ").replace(/;\s*;/g, ";").trim();
}

function normalizeDialogueLine(value: string): string {
  return compactPromptText(value)
    .replace(/\bExact dialogue\s*[:：]\s*([^:：;\n]{1,40})\s*[:：]\s*([^;\n]+?)(?=;|$)/g, (_match, speaker, dialogue) => {
      return `Dialogue: ${String(speaker).trim()} says “${trimCanvasDialogueQuotes(String(dialogue))}”`;
    })
    .replace(/\bDialogue\s*[:：]\s*([^:：;\n]{1,40})\s*[:：]\s*([^;\n]+?)(?=;|$)/g, (_match, speaker, dialogue) => {
      return `Dialogue: ${String(speaker).trim()} says “${trimCanvasDialogueQuotes(String(dialogue))}”`;
    });
}

function compactSentence(value: string, maxLength: number): string {
  const text = compactPromptText(value);
  if (text.length <= maxLength) return text;
  if (maxLength <= 0) return "";
  if (maxLength <= 8) return text.slice(0, maxLength).trim();
  const candidate = text.slice(0, maxLength).trim();
  const sentenceMatches = Array.from(candidate.matchAll(/[.!?。！？；;](?=\s|$)/g));
  const sentenceEnd = sentenceMatches.at(-1)?.index;
  if (sentenceEnd !== undefined && sentenceEnd + 1 >= Math.floor(maxLength * 0.45)) {
    return stripDanglingPromptFragment(candidate.slice(0, sentenceEnd + 1));
  }
  const commaBoundary = Math.max(candidate.lastIndexOf(", "), candidate.lastIndexOf("，"));
  if (commaBoundary >= Math.floor(maxLength * 0.55)) {
    return stripDanglingPromptFragment(candidate.slice(0, commaBoundary));
  }
  const wordBoundary = candidate.replace(/\s+\S*$/, "").trim();
  return stripDanglingPromptFragment(wordBoundary || candidate);
}

function stripDanglingPromptFragment(value: string): string {
  return compactPromptText(value)
    .replace(/(?<!-)\b(?:as if|and|or|with|to|from|of|for|by|in|on|at|the|a|an)\.?$/i, "")
    .replace(/\b(?:as if addre|addre|del|Cultists s|Cultists sit r)\.?$/i, "")
    .replace(/\s*[;,，；:：-]\s*$/g, "")
    .trim();
}

function trimPromptToLimit(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const lines = value.split("\n");
  const output: string[] = [];
  for (const line of lines) {
    const used = output.join("\n").length + (output.length ? 1 : 0);
    const remaining = maxLength - used;
    if (remaining <= 0) break;
    if (line.length <= remaining) {
      output.push(line);
      continue;
    }
    output.push(compactSentence(line, remaining));
    break;
  }
  return normalizePromptLines(output.join("\n"));
}

function extractStoryboardPromptPanelTexts(value: unknown): Array<{ label: string; text: string }> {
  const prompt = String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  if (!prompt) return [];
  const panelMarker = String.raw`(?:Panel|panel|Storyboard\s*panel|P|p|分镜|镜头|格|画面|Shot|shot)`;
  const panelPattern = new RegExp(
    String.raw`(?:^|\n)[ \t]*(?:[-*]\s*)?${panelMarker}\s*#?\s*(\d{1,2})\s*(?:[:：.\-]|[)\]]|\s+-\s+)\s*([\s\S]*?)(?=(?:^|\n)[ \t]*(?:[-*]\s*)?${panelMarker}\s*#?\s*\d{1,2}\s*(?:[:：.\-]|[)\]]|\s+-\s+)|(?:^|\n)[ \t]*(?:Make panels|Panel planning rules|Technical labels|Avoid|Negative prompt|Board style|Reference image map|Dialogue lock)\b|$)`,
    "gi",
  );
  return Array.from(prompt.matchAll(panelPattern))
    .map((match) => ({
      order: Number(match[1]),
      text: cleanStoryboardPromptPanelText(match[2] ?? ""),
    }))
    .filter((item) => Number.isFinite(item.order) && item.order > 0 && item.text)
    .sort((a, b) => a.order - b.order)
    .slice(0, MAX_CLIP_STORYBOARD_PANEL_COUNT)
    .map((item) => ({ label: `P${item.order}`, text: item.text }));
}

function cleanStoryboardPromptPanelText(value: string): string {
  return value
    .replace(/\b(?:shot size|angle|camera angle|camera movement|move|lens|focal length|action|key prop|dialogue)\s*[:=]/gi, "")
    .replace(/\b(?:image area|technical label strip|label strip)\b/gi, "")
    .replace(/\s*[|/]\s*/g, "; ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactList(items: string[] | undefined, fallback: string, max: number): string {
  const values = (items ?? []).filter(Boolean).slice(0, max);
  return values.length ? values.join(", ") : fallback;
}

function mostCommonString(values: string[]): string {
  const counts = new Map<string, { value: string; count: number }>();
  for (const value of values) {
    const cleaned = compactPromptText(value);
    if (!cleaned) continue;
    const key = normalizeCompareText(cleaned);
    const current = counts.get(key);
    counts.set(key, { value: cleaned, count: (current?.count ?? 0) + 1 });
  }
  return Array.from(counts.values()).sort((a, b) => b.count - a.count)[0]?.value ?? "";
}

function compactPromptText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizePromptLines(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function getClipEstimatedDuration(clip: WorkflowClip, clipScenes: WorkflowScene[]): number {
  if (Number.isFinite(clip.estimatedDuration) && Number(clip.estimatedDuration) > 0) return Number(clip.estimatedDuration);
  const sceneTotal = clipScenes.reduce((sum, scene) => sum + Math.max(0, Number(scene.durationSeconds ?? 0)), 0);
  if (sceneTotal > 0) return sceneTotal;
  if (Number.isFinite(clip.targetDuration) && Number(clip.targetDuration) > 0) return Number(clip.targetDuration);
  return 10;
}

function normalizeVideoDuration(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 5;
  return Math.max(4, Math.min(15, Math.round(parsed)));
}

function referenceAsPromptMapItem(reference: { kind: string; name: string; label: string }): { name: string; label: string; kind: string } {
  return {
    name: reference.name,
    label: reference.label,
    kind: reference.kind === "storyboard" ? "storyboard" : "character",
  };
}

function appendReferenceImageMapPrompt(prompt: unknown, referenceImages: Array<{ name: string; label: string; kind: string }>): string {
  const mapPrompt = buildReferenceImageMapPrompt(referenceImages);
  const cleanedPrompt = stripReferenceImageMapPrompt(prompt);
  return [mapPrompt, cleanedPrompt].filter(Boolean).join("\n\n");
}

function buildReferenceImageMapPrompt(referenceImages: Array<{ name: string; label: string; kind: string }>): string {
  if (referenceImages.length === 0) return "";
  const lines = referenceImages.map((image, index) => {
    const type = image.kind === "storyboard" ? "previous storyboard" : "Character";
    const suffix = image.kind === "storyboard"
      ? "use for scene layout and character positions."
      : `identity source for ${image.name}.`;
    return `#${index + 1}: ${type} (${image.name || image.label}); ${suffix}`;
  });
  const bindings = referenceImages
    .map((image, index) => (image.kind === "storyboard" ? "" : `${image.name}=Reference image #${index + 1}`))
    .filter(Boolean);
  return [
    "Reference image map:",
    ...lines,
    bindings.length ? `Character bindings: ${bindings.join("; ")}.` : "",
  ].filter(Boolean).join("\n");
}

function stripReferenceImageMapPrompt(prompt: unknown): string {
  return String(prompt || "")
    .replace(/(?:^|\n|^)Reference image map:\s+[\s\S]*?(?=(?:\n\n|\n)?(?:Storyboard layout|Comic panels in reading order|Create|Required|Use the linked previous storyboard image|Clip title|This storyboard|Each panel|First infer|Setting|Characters present|Plot goal|Start state|End state|Shots to cover|Panel\s+\d+)\b|$)/i, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function storyboardSlotData(clip: WorkflowClip, url: string, assetId?: string, prompt?: string): Record<string, unknown> {
  return {
    label: "对应故事板",
    imageUrl: url,
    imageAspectRatio: 1.78,
    fileName: `${clip.title || "Clip"}-storyboard.png`,
    uploadStatus: url ? "linked" : "waiting",
    sourcePrompt: prompt || clip.storyboardPrompt || "",
    uploadError: "",
    imageLoadError: false,
    clipId: clip.id,
    clipNodeKind: "storyboard",
    storyboardForClip: true,
    storyboardSlotForClip: true,
    sourceClipId: clip.id,
    sourceClipTitle: clip.title,
    targetClipId: clip.id,
    assetId: assetId || "",
    clipSyncRole: "storyboard-slot",
    clipSyncAssetId: assetId || "",
    clipSyncUrl: url,
  };
}

function preservedExistingVideoGenerationState(data: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!data) return {};
  const outputVideo = stringValue(data.outputVideo);
  const generationId = stringValue(data.generationId);
  const videoSubmitId = stringValue(data.videoSubmitId);
  const providerStatus = stringValue(data.videoProviderStatus);
  const status = stringValue(data.status);
  const videoStatus = stringValue(data.videoStatus);
  const hasCompletedVideo = Boolean(outputVideo || status === "completed" || videoStatus === "completed" || videoStatus === "succeeded");
  if (!hasCompletedVideo) return {};
  return {
    status: status || "completed",
    videoStatus: videoStatus || "completed",
    statusLabel: stringValue(data.statusLabel) || "视频已生成",
    videoError: stringValue(data.videoError),
    outputVideo,
    outputVideoAssetId: stringValue(data.outputVideoAssetId),
    generationId,
    videoSubmitId,
    videoProviderStatus: providerStatus || (outputVideo ? "succeeded" : ""),
    generationStartedAt: "",
  };
}

function removeEpisodeSyncNodes(nodes: CanvasNode[], episodeKey: string): CanvasNode[] {
  return nodes.filter((node) => {
    if (node.id.startsWith(`episode-sync-${episodeKey}-`)) return false;
    if (node.id.startsWith(`episode-sync-storyboard-${episodeKey}-`)) return false;
    if (node.id.startsWith(`episode-sync-story-ref-${episodeKey}-`)) return false;
    if (node.id.startsWith(`episode-sync-video-${episodeKey}-`)) return false;
    if (node.id.startsWith(`episode-sync-video-ref-${episodeKey}-`)) return false;
    if (node.id.startsWith(`episode-sync-video-node-${episodeKey}-`)) return false;
    if (node.id.startsWith(`episode-sync-video-storyboard-slot-${episodeKey}-`)) return false;
    if (node.id.startsWith(`clip-position-board-${episodeKey}-`)) return false;
    if (node.id.startsWith(`clip-position-board-gen-${episodeKey}-`)) return false;
    if (node.id.startsWith(`clip-position-board-ref-${episodeKey}-`)) return false;
    return node.data?.episodeCanvasSync !== true || stableCanvasIdPart(node.data?.sourceEpisodeId || node.data?.sourceEpisode, "episode") !== episodeKey;
  });
}

function preserveExternalEpisodeVideoEdges(
  existingNodes: CanvasNode[],
  existingEdges: CanvasEdge[],
  keptNodes: CanvasNode[],
  episodeKey: string,
): CanvasEdge[] {
  const keptIds = new Set(keptNodes.map((node) => node.id));
  const rebuiltVideoNodeIds = new Set(
    existingNodes
      .map((node) => node.id)
      .filter((id) => id.startsWith(`episode-sync-video-node-${episodeKey}-`)),
  );
  const preserved: CanvasEdge[] = [];
  const seen = new Set<string>();

  for (const edge of existingEdges) {
    if (!edge.source || !edge.target) continue;
    const sourceIsRebuiltVideo = rebuiltVideoNodeIds.has(edge.source);
    const targetIsRebuiltVideo = rebuiltVideoNodeIds.has(edge.target);
    const sourceIsKept = keptIds.has(edge.source);
    const targetIsKept = keptIds.has(edge.target);
    if (!((sourceIsRebuiltVideo && targetIsKept) || (targetIsRebuiltVideo && sourceIsKept))) continue;
    const key = edge.id || `${edge.source}|${edge.sourceHandle ?? ""}|${edge.target}|${edge.targetHandle ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    preserved.push(edge);
  }

  return preserved;
}

function removeEdgesForMissingNodes(edges: CanvasEdge[], nodeIds: Set<string>): CanvasEdge[] {
  return edges.filter((edge) => edge.source && edge.target && nodeIds.has(edge.source) && nodeIds.has(edge.target));
}

function removeCanvasSectionWithChildren(nodes: CanvasNode[], edges: CanvasEdge[], sectionId: string): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const removed = new Set<string>([sectionId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.parentId && removed.has(node.parentId) && !removed.has(node.id)) {
        removed.add(node.id);
        changed = true;
      }
    }
  }
  const nextNodes = nodes.filter((node) => !removed.has(node.id));
  return {
    nodes: nextNodes,
    edges: edges.filter((edge) => !removed.has(String(edge.source)) && !removed.has(String(edge.target))),
  };
}

function upsertCanvasNode(nodes: CanvasNode[], node: CanvasNode): CanvasNode[] {
  const index = nodes.findIndex((item) => item.id === node.id);
  if (index < 0) return [...nodes, node];
  return nodes.map((item, itemIndex) => (itemIndex === index ? { ...item, ...node, data: { ...(item.data ?? {}), ...(node.data ?? {}) } } : item));
}

function upsertCanvasEdge(edges: CanvasEdge[], edge: CanvasEdge): CanvasEdge[] {
  if (edges.some((item) => item.id === edge.id || (item.source === edge.source && item.target === edge.target))) return edges;
  return [...edges, edge];
}

function recalculateCanvasSectionItemCounts(nodes: CanvasNode[]): CanvasNode[] {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    if (node.parentId) counts.set(node.parentId, (counts.get(node.parentId) ?? 0) + 1);
  }
  return nodes.map((node) => (
    node.type === "section"
      ? { ...node, data: { ...(node.data ?? {}), itemCount: counts.get(node.id) ?? 0 } }
      : node
  ));
}

function replacePreviousStoryboardContinuityPrompt(prompt: unknown, previous: StoryboardReference | null): string {
  const cleaned = stripPreviousStoryboardContinuityText(prompt)
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

function stripPreviousStoryboardContinuityText(value: unknown): string {
  return stringValue(value)
    .replace(/Use the linked previous storyboard image[\s\S]*?as the continuity reference for scene layout[\s\S]*?(?:resetting the scene\.|character positions\.?)\s*/gi, " ")
    .replace(/Previous Clip end state to continue from:[\s\S]*?(?=(?:Reference image map:|Create one|Create a|Required continuity characters:|Character reference lock:|Dialogue lock:|Panel\s+\d+:|$))/gi, " ")
    .replace(/(^|\n)\s*上一个故事板[:：][^\n。.]*(?:[。.])?\s*(?=\n|$)/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function writeWorkflowEpisode(
  metadata: Record<string, unknown>,
  episodeId: string,
  workflow: Record<string, unknown>,
  makeActive = false,
): Record<string, unknown> {
  const id = episodeId || workflowEpisodeIdForTitle(stringValue(workflow.selectedEpisode) || "第 1 集", "episode-001");
  const episodes = getWorkflowEpisodes(metadata);
  return {
    ...metadata,
    workflowCenter: workflow,
    ...(makeActive
      ? {
          activeEpisodeId: id,
          currentEpisodeId: id,
          selectedEpisodeId: id,
          activeCanvasSceneId: workflowEpisodeCanvasSceneId(id),
        }
      : {}),
    episodes: {
      ...episodes,
      [id]: {
        ...(episodes[id] ?? {}),
        id,
        title: stringValue(workflow.selectedEpisode) || stringValue(episodes[id]?.title) || "第 1 集",
        canvasSceneId: workflowEpisodeCanvasSceneId(id),
        workflowCenter: workflow,
        updatedAt: stringValue(workflow.updatedAt) || new Date().toISOString(),
      },
    },
  };
}

function workflowCenterFromMetadata(metadata: unknown, episodeId = ""): Record<string, unknown> {
  const record = isRecord(metadata) ? metadata : {};
  const resolvedEpisodeId = resolveWorkflowEpisodeId(record, episodeId);
  const episodes = getWorkflowEpisodes(record);
  const episode = resolvedEpisodeId ? episodes[resolvedEpisodeId] : undefined;
  if (isRecord(episode) && isRecord(episode.workflowCenter)) return episode.workflowCenter;
  if (isRecord(record.workflowCenter)) return record.workflowCenter;
  return {};
}

function workflowEpisodeTitle(metadata: unknown, episodeId: string): string {
  const episodes = getWorkflowEpisodes(metadata);
  const episode = episodes[resolveWorkflowEpisodeId(metadata, episodeId)];
  return isRecord(episode) ? stringValue(episode.title) : "";
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

function workflowEpisodeIdForTitle(title: string, fallback: string): string {
  const text = title.trim();
  const numberMatch = text.match(/(?:第\s*)?(\d{1,4})\s*(?:集|话|章|回|episode|ep\b)/i) ?? text.match(/(?:episode|ep)\s*0*(\d{1,4})/i);
  if (numberMatch) return `episode-${String(Number(numberMatch[1])).padStart(3, "0")}`;
  const slug = text
    .toLowerCase()
    .replace(/[\u3400-\u9fff]+/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug ? `episode-${slug}` : fallback;
}

function workflowEpisodeCanvasSceneId(episodeId: string): string {
  return episodeId || "default";
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

function preferredImageInputNodeWidth(data: Record<string, unknown>): number {
  const ratio = positiveNumber(data.imageAspectRatio) ?? 1;
  return ratio > 1.15 ? 340 : 260;
}

function preferredImageInputNodeHeight(data: Record<string, unknown>): number {
  const ratio = Math.min(Math.max(positiveNumber(data.imageAspectRatio) ?? 1, 0.45), 3.4);
  const width = preferredImageInputNodeWidth(data);
  return Math.round(34 + 16 + width / ratio + (data.fileName ? 16 : 0));
}

function canvasAutoEdgeId(prefix: string, sourceId: string, targetId: string): string {
  return `${prefix}-${sourceId}-${targetId}`.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function stableCanvasIdPart(value: unknown, fallback = "item"): string {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || fallback;
}

function uniqueNames(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const name = value.trim();
    const key = normalizeCompareText(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

function collectCharacterAudioReferencesForClip(
  clip: WorkflowClip,
  clipScenes: WorkflowScene[],
  assets: WorkflowAssets,
  prompt: string,
): Array<{ name: string; url?: string; assetId?: string; fileName?: string; source: "workflow-asset" }> {
  const characters = assetArray(assets, "characters");
  const availableNames = uniqueNames([
    ...characters.map(workflowAssetName),
    ...(Array.isArray(clip.characters) ? clip.characters.map(String) : []),
  ]);
  const dialogueNames = uniqueNames([
    ...extractDialogueCharacterNamesFromScenes(clipScenes, availableNames),
    ...extractDialogueCharacterNamesFromPrompt(prompt, availableNames),
  ]);
  return dialogueNames
    .map((name) => {
      const character = findWorkflowAssetByName(characters, name);
      return {
        name,
        url: publicAudioUrl(character?.referenceAudioUrl),
        assetId: stringValue(character?.referenceAudioAssetId),
        fileName: stringValue(character?.voiceReferenceFileName),
        source: "workflow-asset" as const,
      };
    })
    .filter((ref) => ref.name);
}

function extractDialogueCharacterNamesFromScenes(clipScenes: WorkflowScene[], availableNames: string[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const scene of clipScenes) {
    const dialogue = stringValue(scene.dialogue).replace(/\s+/g, " ").trim();
    if (!dialogue || /^(none|no dialogue|silent|无|无台词)$/i.test(dialogue)) continue;
    let matchedExplicitSpeaker = false;
    for (const rawName of Array.isArray(scene.characters) ? scene.characters : []) {
      const name = availableNames.find((candidate) => normalizeCompareText(candidate) === normalizeCompareText(rawName));
      if (!name) continue;
      if (dialogueNamesCharacter(dialogue, name)) matchedExplicitSpeaker = pushUniqueName(found, seen, name) || matchedExplicitSpeaker;
    }
    for (const name of availableNames) {
      if (dialogueNamesCharacter(dialogue, name)) matchedExplicitSpeaker = pushUniqueName(found, seen, name) || matchedExplicitSpeaker;
    }
    if (!matchedExplicitSpeaker) {
      const sceneCharacterNames = uniqueNames((Array.isArray(scene.characters) ? scene.characters : [])
        .map((rawName) => availableNames.find((candidate) => normalizeCompareText(candidate) === normalizeCompareText(rawName)) || "")
        .filter(Boolean));
      if (sceneCharacterNames.length === 1) pushUniqueName(found, seen, sceneCharacterNames[0]);
    }
  }
  return found;
}

function pushUniqueName(found: string[], seen: Set<string>, name: string): boolean {
  const key = normalizeCompareText(name);
  if (!key || seen.has(key)) return false;
  seen.add(key);
  found.push(name);
  return true;
}

function dialogueNamesCharacter(dialogue: string, name: string): boolean {
  const escaped = escapeRegExp(name);
  return (
    new RegExp(`(?:^|[\\n;。.!?])\\s*${escaped}\\s*[:：]`, "i").test(dialogue) ||
    new RegExp(`\\b${escaped}\\b\\s*(?:says|said|asks|asked|replies|responds|whispers|shouts|mutters|delivers|speaks)\\b`, "i").test(dialogue)
  );
}

function extractDialogueCharacterNamesFromPrompt(prompt: string, availableNames: string[]): string[] {
  const text = stringValue(prompt);
  if (!text) return [];
  const found: string[] = [];
  for (const name of availableNames) {
    if (promptNamesSpeakingCharacter(text, name)) {
      found.push(name);
    }
  }
  return found;
}

function promptNamesSpeakingCharacter(text: string, name: string): boolean {
  const escaped = escapeRegExp(name);
  return (
    new RegExp(`(?:^|[\\n;。.!?])\\s*${escaped}\\s*[:：]["'“”‘’\\s]`, "i").test(text) ||
    new RegExp(`\\b${escaped}\\b\\s*(?:says|said|asks|asked|replies|responds|whispers|shouts|mutters|speaks)\\b`, "i").test(text) ||
    new RegExp(`\\b${escaped}\\b\\s*(?:delivers|gives)\\s+(?:the\\s+)?(?:spoken\\s+)?(?:dialogue|line)\\b`, "i").test(text)
  );
}

function publicAudioUrl(value: unknown): string {
  const url = stringValue(value);
  const localPublicPath = localPublicUploadPath(url);
  if (localPublicPath) return `https://loohii.com${localPublicPath}`;
  if (/^https?:\/\//i.test(url) || /^\/api\/uploads\/public\//i.test(url)) return url;
  return "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isCanvasNode(value: unknown): value is CanvasNode {
  return isRecord(value) && typeof value.id === "string";
}

function isCanvasEdge(value: unknown): value is CanvasEdge {
  return isRecord(value) && typeof value.source === "string" && typeof value.target === "string";
}

function publicImageUrl(value: unknown): string {
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

function normalizeCompareText(value: unknown): string {
  return stringValue(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export type EpisodeCanvasSyncPrismaPayload = Prisma.InputJsonValue;
