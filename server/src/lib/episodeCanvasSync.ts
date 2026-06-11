import type { Prisma } from "@prisma/client";
import { normalizeCanvasStoryboardReferencesForScene, storyboardReferencesFromGenerationRecords, type CanvasStoryboardGenerationRecord, type StoryboardReference } from "./canvasStoryboardReferences";
import { isRecord } from "./mappers";
import {
  ensureClipStoryboardBoardLayoutPrompt,
  finalizeClipStoryboardImagePrompt,
} from "./storyboardPrompt";
import { normalizeCompareText, stringValue } from "./typeGuards";
import {
  getEpisodeTitle as workflowEpisodeTitle,
  getWorkflowEpisodes,
  resolveWorkflowEpisodeId,
  workflowEpisodeCanvasSceneId,
  workflowEpisodeIdForTitle,
} from "./workflowEpisodes";

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
  durationSeconds?: number;
  setting?: string;
};

type WorkflowAssetItem = Record<string, unknown> & {
  id?: string;
  name?: string;
  title?: string;
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
  kind: "characters" | "scenes" | "props";
  name: string;
  label: string;
  url: string;
  assetId?: string;
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
const MAX_VIDEO_REFERENCE_IMAGES = 9;
const MAX_DREAMINA_VIDEO_REFERENCE_AUDIO = 2;
const DREAMINA_VIDEO_PROMPT_TARGET_CHARS = 3900;
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
  now?: string;
}): EpisodeCanvasSyncBuildResult {
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
  let edges = removeEdgesForMissingNodes(existingEdges, new Set(nodes.map((node) => node.id)));
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
    const videoPrompt = finalizeEpisodeCanvasVideoPrompt(
      useMultiReferenceStrategy ? (clip.seedancePrompt || buildLocalClipVideoPrompt(clip, clipScenes)) : buildEpisodeClipVideoPrompt(clip, clipScenes),
    );
    const videoReferences = collectClipAssetReferences(clip, clipScenes, assets, useMultiReferenceStrategy ? MAX_VIDEO_REFERENCE_IMAGES : MAX_VIDEO_REFERENCE_IMAGES - 1, videoPrompt, {
      includeProps: useMultiReferenceStrategy,
      includeScenes: useMultiReferenceStrategy,
      includeMissing: useMultiReferenceStrategy,
    });
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
        size: "16:9",
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
          height: preferredImageInputNodeHeight({ imageAspectRatio: reference.kind === "storyboard" ? 1.78 : 1.45, fileName: `${reference.name}.png` }),
        },
        zIndex: 1,
        data: {
          label: reference.label,
          imageUrl: reference.url,
          imageAspectRatio: reference.kind === "storyboard" ? 1.78 : 1.45,
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
        style: { width: 340, height: preferredImageInputNodeHeight({ imageAspectRatio: 1.78, fileName: `${clip.title || "Clip"}-storyboard.png` }) },
        zIndex: 1,
        data: {
          ...storyboardSlotData(clip, outputImage, outputImageAssetId, exactStoryboardRef?.prompt),
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
      const nodeId = `episode-sync-video-ref-${episodeKey}-${clipKey}-${stableCanvasIdPart(`asset-${reference.assetId || reference.name}`, `ref-${refIndex}`)}`;
      const position = canvasReferenceGridPosition({ x: CANVAS_SECTION_PADDING_X, y: CANVAS_SECTION_HEADER_HEIGHT }, refIndex + (useMultiReferenceStrategy ? 0 : 1));
      nodes = upsertCanvasNode(nodes, {
        id: nodeId,
        type: "imageInput",
        parentId: videoSectionId,
        extent: "parent",
        expandParent: false,
        position,
        style: {
          width: 260,
          height: preferredImageInputNodeHeight({ imageAspectRatio: 1.45, fileName: `${reference.name}.png` }),
        },
        zIndex: 1,
        data: {
          label: reference.label,
          imageUrl: reference.url,
          imageAspectRatio: 1.45,
          fileName: `${reference.name}.png`,
          uploadStatus: reference.url ? "linked" : "missing",
          sourcePrompt: `${reference.label}，用于 ${clip.title || "Clip"} 视频连续性参考`,
          uploadError: reference.url ? "" : "该资产还没有参考图，请上传或生成后再生成视频。",
          imageLoadError: false,
          assetKind: reference.kind,
          assetName: reference.name,
          assetId: reference.assetId || "",
          sourceEpisode: episodeTitle,
          sourceEpisodeId: episodeId,
          episodeCanvasSync: true,
          clipSyncRole: `video-asset:${reference.assetId || normalizeCompareText(reference.name)}`,
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
    if (previousRef?.nodeId) {
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
  const normalized = useMultiReferenceStrategy ? { nodes: countedNodes, edges } : normalizeCanvasStoryboardReferencesForScene(
    countedNodes,
    edges,
    input.metadata,
    storyboardRefs,
    episodeId,
  );
  const updatedAt = input.now ?? new Date().toISOString();
  return {
    sceneId,
    episodeId,
    nodes: normalized.nodes,
    edges: normalized.edges,
    clips,
    storyboardCount,
    videoCount,
    recoveredStoryboardCount,
    updatedAt,
  };
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
    durationSeconds: numberValue(scene.durationSeconds),
    setting: stringValue(scene.setting),
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
  const searchableText = normalizeCompareText([
    clip.title,
    clip.setting,
    clip.plotGoal,
    clip.startState,
    clip.endState,
    clip.seedancePrompt,
    extraSearchText,
    ...clipScenes.flatMap((scene) => [scene.title, scene.description, scene.action, scene.dialogue, scene.visualPrompt, scene.setting]),
  ].join("\n"));
  const names = uniqueNames([
    ...(clip.characters ?? []),
    ...clipScenes.flatMap((scene) => {
      const raw: unknown[] = isRecord(scene) && Array.isArray((scene as Record<string, unknown>).characters) ? (scene as Record<string, unknown>).characters as unknown[] : [];
      return raw.map(stringValue);
    }),
  ]);
  for (const name of names) {
    const asset = findWorkflowAssetByName(characters, name);
    pushAssetReference(refs, seen, "characters", asset, "角色参考", { includeMissing });
    if (refs.length >= limit) break;
  }
  for (const character of characters) {
    if (refs.length >= limit) break;
    const name = workflowAssetName(character);
    if (!name || !characterNameLooksPhysicallyPresent(searchableText, name)) continue;
    pushAssetReference(refs, seen, "characters", character, "角色引用参考", { includeMissing });
  }
  if (includeScenes) {
    const settingNames = uniqueNames([clip.setting ?? "", ...clipScenes.map((scene) => scene.setting ?? "")]);
    for (const name of settingNames) {
      if (refs.length >= limit) break;
      pushAssetReference(refs, seen, "scenes", findWorkflowAssetByName(scenes, name), "场景参考", { includeMissing });
    }
    for (const scene of scenes) {
      if (refs.length >= limit) break;
      const name = workflowAssetName(scene);
      if (name && searchableText.includes(normalizeCompareText(name))) {
        pushAssetReference(refs, seen, "scenes", scene, "场景引用参考", { includeMissing });
      }
    }
  }
  if (includeProps) {
    for (const prop of props) {
      if (refs.length >= limit) break;
      const name = workflowAssetName(prop);
      if (name && searchableText.includes(normalizeCompareText(name))) {
        pushAssetReference(refs, seen, "props", prop, "道具参考", { includeMissing });
      }
    }
  }
  return refs.slice(0, limit);
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
  return items.find((item) => normalizeCompareText(workflowAssetName(item)) === target)
    ?? items.find((item) => {
      const assetName = normalizeCompareText(workflowAssetName(item));
      return Boolean(assetName && (assetName.includes(target) || target.includes(assetName)));
    });
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

function characterNameLooksPhysicallyPresent(searchableText: string, characterName: string): boolean {
  const name = normalizeCompareText(characterName);
  if (!name || !searchableText.includes(name)) return false;
  const escaped = escapeRegExp(name);
  const decorativeMention = new RegExp(`\\b${escaped}\\s+(poster|posters|portrait|portraits|photo|photos|image|images|billboard|billboards|logo|logos|sign|signs)\\b`);
  return !decorativeMention.test(searchableText);
}

function buildLocalClipVideoPrompt(clip: WorkflowClip, clipScenes: WorkflowScene[]): string {
  const duration = Math.round(getClipEstimatedDuration(clip, clipScenes) * 10) / 10;
  const beats = clipScenes.map((scene, index) => {
    const action = compactPromptText(scene.action || scene.description || scene.visualPrompt);
    const dialogue = compactPromptText(scene.dialogue);
    return `P${index + 1}: ${[action, dialogue ? `dialogue/reaction ${dialogue}` : ""].filter(Boolean).join("; ")}`;
  });
  return [
    `Clip video prompt for ${clip.title}.`,
    `Duration target: ${duration}s, 16:9 cinematic 3D animated dark comedy style.`,
    `Characters: ${compactList(clip.characters, "characters from this Clip", 12)}.`,
    `Setting: ${clip.setting || "current scene"}.`,
    compactPromptText(clip.plotGoal),
    beats.length ? beats.join("\n") : compactPromptText(clip.startState || clip.endState),
  ].filter(Boolean).join("\n");
}

function buildEpisodeClipVideoPrompt(clip: WorkflowClip, clipScenes: WorkflowScene[]): string {
  if (clip.seedancePrompt) return clip.seedancePrompt;
  const panels = extractStoryboardPromptPanelTexts(clip.storyboardPrompt);
  if (panels.length > 0) {
    const duration = Math.round(getClipEstimatedDuration(clip, clipScenes) * 10) / 10;
    return [
      `Generate one continuous ${duration}s cinematic video, 16:9.`,
      "Style: polished 3D American animated dark-comedy comic look, saturated colors, clean 3D render, exaggerated acting, fast pacing.",
      `Scene: ${clip.setting || "current scene"}.`,
      `Characters: ${compactList(clip.characters, "characters from this Clip", 12)}; use connected character reference images for identity.`,
      "Use the connected storyboard image as the main visual reference. Follow these storyboard panels in exact order and animate them as natural motion, not comic panels:",
      panels.map((panel) => `${panel.label}: ${compactPromptText(panel.text)}`).join("\n"),
      "Do not skip, merge, or reorder the P beats. Do not add subtitles, speech bubbles, UI, panel borders, panel numbers, watermarks, or explanatory text.",
    ].filter(Boolean).join("\n");
  }
  const beats = clipScenes.map((scene, index) => {
    const action = compactPromptText(scene.action || scene.description || scene.visualPrompt);
    const dialogue = compactPromptText(scene.dialogue);
    return `P${index + 1}: ${[action, dialogue ? `dialogue/reaction ${dialogue}` : ""].filter(Boolean).join("; ")}`;
  });
  return [
    `Clip video prompt for ${clip.title}.`,
    `Duration target: ${Math.round(getClipEstimatedDuration(clip, clipScenes) * 10) / 10}s, 16:9 cinematic 3D animated dark comedy style.`,
    `Characters: ${compactList(clip.characters, "characters from this Clip", 12)}.`,
    `Setting: ${clip.setting || "current scene"}.`,
    compactPromptText(clip.plotGoal),
    beats.length ? beats.join("\n") : compactPromptText(clip.startState || clip.endState),
  ].filter(Boolean).join("\n");
}

function finalizeEpisodeCanvasVideoPrompt(value: string): string {
  const normalized = normalizePromptLines(value);
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
  const prefix = match[1];
  if (text.length <= maxLength) return text;
  const bodyLimit = Math.max(24, maxLength - prefix.length - 1);
  return `${prefix}${compactSentence(text.slice(prefix.length), bodyLimit)}`;
}

function compactSentence(value: string, maxLength: number): string {
  const text = compactPromptText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}.`;
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
    return node.data?.episodeCanvasSync !== true || stableCanvasIdPart(node.data?.sourceEpisodeId || node.data?.sourceEpisode, "episode") !== episodeKey;
  });
}

function removeEdgesForMissingNodes(edges: CanvasEdge[], nodeIds: Set<string>): CanvasEdge[] {
  return edges.filter((edge) => edge.source && edge.target && nodeIds.has(edge.source) && nodeIds.has(edge.target));
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
    ...(makeActive ? { activeEpisodeId: id } : {}),
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

function firstPromptLine(value: unknown, label: string): string {
  const line = stringValue(value).split("\n").find((item) => item.trim().startsWith(label));
  return line?.slice(label.length).trim() || "";
}

function projectGenerationStrategyFromPrompt(value: unknown): string {
  const stored = firstPromptLine(value, "Default generation strategy:");
  if (stored === "seedance-multi-ref" || stored === "Seedance 多参") return "seedance-multi-ref";
  if (stored === "chapter-board" || stored === "章节导演板") return "chapter-board";
  return stored;
}

function projectGenerationStrategyFromMetadata(metadata: unknown): string {
  const record = isRecord(metadata) ? metadata : {};
  const setupSettings = isRecord(record.setupSettings) ? record.setupSettings : {};
  return stringValue(setupSettings.generationStrategy) || projectGenerationStrategyFromPrompt(record.globalPrompt);
}

function isSeedanceMultiReferenceStrategy(value: unknown): boolean {
  const normalized = stringValue(value).trim();
  return normalized === "seedance-multi-ref" || normalized === "Seedance 多参";
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

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export type EpisodeCanvasSyncPrismaPayload = Prisma.InputJsonValue;
