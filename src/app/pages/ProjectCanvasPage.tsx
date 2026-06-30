import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  applyEdgeChanges,
  SelectionMode,
  useOnSelectionChange,
  NodeChange,
  EdgeChange,
  type Connection,
  type Edge,
  type OnConnectEnd,
  type OnConnectStart,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Boxes,
  Bot,
  ClipboardCheck,
  Copy,
  Download,
  Film,
  FileText,
  Image as ImageIcon,
  ImagePlay,
  Languages,
  Layers3,
  ListChecks,
  Mic,
  MonitorPlay,
  Package,
  PackageOpen,
  Plus,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Trash2,
  UploadCloud,
  Users,
  Wand2,
  X,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { cn } from '../utils/cn';
import { CanvasNodeKind, detachNodesFromRemovedParents, useCanvasStore } from '../stores/useCanvasStore';
import { AGENT_ACTIONS_APPLIED_EVENT } from '../stores/useAgentStore';
import { useProjectStore } from '../stores/useProjectStore';
import {
  apiClient,
  type ModelConfig,
  type GenerationRecord,
  type WorkflowAssetImageHistoryItem,
  type WorkflowEpisodeListResponse,
  type WorkflowState,
} from '../lib/apiClient';
import { nodeTypes } from '../features/canvas/nodes';
import { PromptTextarea } from '../features/canvas/nodes/shared';
import { sceneImageModeInstruction } from '../features/canvas/sceneImageMode';
import {
  type AssetHistoryLoadKind,
  type AssetHistoryTarget,
  type AssetImagePreview,
  type AssetLibraryCategory,
  type AssetLibraryEpisodeFilter,
  type AssetLibraryItem,
  type BreakdownScene,
  type CanvasImageDragPayload,
  type Clip,
  type ClipImageReference,
  type ClipPositioningBoardMode,
  type ClipStoryboardImageReference,
  type ClipVideoPromptInferenceResult,
  type ConnectionCreateMenu,
  type ConnectionCreateOption,
  type ConnectionStartSnapshot,
  type DirectorBoardLibraryItem,
  type EpisodeCanvasSyncRequest,
  type EpisodeWorkflowAssetBundle,
  type GenerateAssetImageOptions,
  type InferBoardsAndVideoResult,
  type ProjectGlobalSettingsDraft,
  type WorkflowAssetItem,
  type WorkflowAssetKind,
  type WorkflowAssets,
  type WorkflowBreakdownRecoveryOptions,
  type WorkflowStageKey,
  CANVAS_GENERATION_NODE_HEIGHT,
  CANVAS_GENERATION_RECORDS_REFRESH_EVENT,
  CANVAS_GENERATION_SUBMIT_CONFIRM_MS,
  CANVAS_IMAGE_PREVIEW_EVENT,
  CANVAS_SECTION_HEADER_HEIGHT,
  CANVAS_SECTION_PADDING_BOTTOM,
  CANVAS_SECTION_PADDING_X,
  CANVAS_SINGLE_ASSET_NODE_HEIGHT,
  CANVAS_TARGET_SECTION_GAP,
  CANVAS_VIDEO_NODE_HEIGHT,
  EPISODE_CANVAS_SYNC_COLUMN_GAP,
  MAX_CLIP_STORYBOARD_PANEL_COUNT,
  MAX_VIDEO_REFERENCE_IMAGES,
  MIN_CLIP_STORYBOARD_PANEL_COUNT,
  POSITIONING_BOARD_REFERENCE_COLUMNS,
  POSITIONING_BOARD_REFERENCE_NODE_GAP_X,
  POSITIONING_BOARD_REFERENCE_NODE_GAP_Y,
  POSITIONING_BOARD_REFERENCE_NODE_HEIGHT,
  POSITIONING_BOARD_REFERENCE_NODE_WIDTH,
  POSITIONING_BOARD_GENERATION_NODE_WIDTH,
  POSITIONING_BOARD_GENERATION_NODE_X,
  POSITIONING_BOARD_SECTION_WIDTH,
  PROJECT_DEFAULT_COVER,
  SEEDANCE_MULTI_REF_STRATEGY,
  WORKFLOW_ASSET_SYNC_EVENT,
  addCanvasSection,
  appendCanvasImageGenerationRetryHint,
  appendPreviousStoryboardContinuityPrompt,
  appendReferenceImageMapPrompt,
  applyWorkflowSnapshot,
  assetArray,
  assetGroups,
  assetHistoryImageIsWithProps,
  assetImageAspectRatioOptions,
  assetImageResolutionOptions,
  assetImageSourceLabel,
  assetLibraryCategories,
  attachNodesToCanvasSection,
  batchCharacterAudioTargets,
  browserImageLooksReachable,
  buildCanvasAssetFinalPrompt,
  buildCanvasClipPositioningBoardPrompt,
  buildFinalClipStoryboardPromptForCanvas,
  buildProjectGlobalPromptFromDraft,
  canvasActiveGenerationRecoveryKeys,
  canvasAutoEdgeId,
  canvasEdgeListsEqual,
  canvasGenerationAgeMs,
  canvasGenerationStartedAt,
  canvasGraphChangeSignature,
  canvasIdListsEqual,
  canvasNodePromptLabel,
  canvasNodePromptText,
  canvasNodeAbsolutePosition,
  canvasNodeVisualSize,
  canvasNodeChangeSignature,
  canvasNodeListsEqual,
  canvasNodeReferenceUrl,
  canvasNodesBoundingBox,
  canvasOutputImageVariantsFromResult,
  canvasOutputImageVariantsEqual,
  canvasPromptTooLongError,
  canvasReferenceGridMetrics,
  canvasReferenceGridPosition,
  canvasReferenceDedupKey,
  canvasReferenceImageKind,
  canvasStyleValuesEqual,
  characterAudioReferenceMetadata,
  chooseReachableAssetHistoryImage,
  clampConnectionMenuPoint,
  cleanAssetPromptSeed,
  clientPointFromConnectionEvent,
  clipCanvasSectionTitle,
  clipImageReferenceAsCanvasReference,
  collectCanvasSectionDescendantIds,
  collectCharacterAudioReferencesFromWorkflow,
  collectClipAssetReferences,
  collectClipPositioningBoardReferences,
  collectClipStoryboardImageReferences,
  collectClipVideoReferences,
  collectDirectorBoardLibraryItems,
  collectEpisodeAssetLibraryItems,
  compactProjectPromptContext,
  createCanvasGenerationRequestToken,
  createProjectGlobalSettingsDraft,
  dataTransferHasImage,
  defaultEpisodeList,
  defaultWorkflowAssets,
  downloadCanvasImagePreview,
  enforceClipStoryboardContinuityPrompt,
  extractDialogueCharacterNames,
  extractDroppedImagePayload,
  finalizeClipStoryboardImagePrompt,
  findCharacterPropReferences,
  findClipStoryboardNode,
  findWorkflowAssetByName,
  findExactClipStoryboardReference,
  findLatestCanvasImageGenerationRecordForNode,
  findLatestCanvasVideoGenerationRecordForNode,
  findPreviousClipStoryboardReference,
  firstCleanAssetPromptSeed,
  formatDurationMs,
  generationReferenceSourcePriority,
  generationRecordBelongsToEpisode,
  generationRecordImageUrl,
  generationRecordImageUrls,
  generationRecordMatchesActiveCanvasGeneration,
  generationRecordReferenceImageCount,
  generationRecordResolution,
  generationRecordStartedAt,
  generationRecordVideoUrl,
  generationRecordWorkflowAssetBusyKey,
  getClipEstimatedDuration,
  getClipScenes,
  getImageFileAspectRatio,
  imageLabelFromUrl,
  isAutoCanvasLayoutChange,
  isAutoCanvasLayoutChangeBatch,
  isCanvasPromptWithinApiLimit,
  isImageDropFile,
  isInteractiveCanvasResizeChange,
  isMeasurementCanvasNodeChange,
  isProjectNotFoundError,
  isRecentGenerationRecord,
  isFirstFrameStrategy,
  isSeedanceMultiReferenceStrategy,
  isTransientCanvasNodeChange,
  isVideoCanvasNode,
  isWorkflowImageModel,
  isWorkflowTextModel,
  mergeWorkflowAssetsWithProjectRecords,
  modelOptionLabel,
  nextEpisodeTitle,
  nextManualBoundPropNames,
  nodeStyleWidth,
  nonStoryboardImageUrlsFromGenerationRecords,
  normalizeClipStoryboardReferenceSections,
  normalizeCanvasImageSize,
  normalizeImageResolution,
  normalizeCompareText,
  normalizeReactFlowCanvasNodes,
  normalizeReusableImageSource,
  normalizeVideoDuration,
  normalizeVideoReferenceGraph,
  normalizeWorkflowAssetKind,
  numericCanvasSize,
  preferredImageInputNodeHeight,
  preferredImageInputNodeWidth,
  previewCanvasImage,
  projectGenerationStrategy,
  projectStrategySupportsStoryboard,
  publicAudioUrl,
  publicImageUrl,
  readObjectString,
  recalculateCanvasSectionItemCounts,
  removeEpisodeCanvasChildren,
  safeAudioUploadKey,
  safeUploadKey,
  selectedPropNamesFromCharacter,
  setImageDragData,
  shouldAllowMissingBackendTaskRecovery,
  shouldIgnoreStoppedCanvasGenerationRecord,
  shouldRecoverWorkflowAfterRequestError,
  shouldSkipCanvasGenerationReference,
  stableCanvasValue,
  stableCanvasIdPart,
  storyboardReferencesFromGenerationRecords,
  storyboardSlotImageData,
  stripLegacyCanvasAssetPromptScaffold,
  applyPositioningBoardLayout,
  suggestClipStoryboardPanelCount,
  syncEpisodeClipBoardsToCanvas,
  translateProjectPromptSettingsDraftToEnglish,
  uniqueCanvasNodesById,
  upsertEpisodeCanvasEdge,
  upsertEpisodeCanvasNode,
  uploadCanvasReferenceFile,
  workflowAssetBusyKey,
  workflowAssetImageReadiness,
  workflowAssetImageUrl,
  workflowAssetKindLabel,
  workflowAssetName,
  workflowEpisodeCanvasSceneId,
  workflowEpisodeLibraryTitle,
  workflowHasBreakdownResult,
  workflowHasAssetResult,
  workflowHasRunningStage,
  workflowRemoteBatchFinished,
  workflowRunCompletedAfter,
  workflowRunProgressText,
  workflowRunStartedAfter,
} from '../features/canvas/canvasUtils';
import {
  AssetMiniList,
  WorkflowCenterOverlay,
  ProjectGlobalSettingsModal,
} from '../features/canvas/components';

const BATCH_TRANSLATION_SELECTED_NODE_TYPES = new Set([
  'video',
  'generation',
  'scene',
  'character',
  'imageInput',
  'workflow',
  'directorBoard',
]);

function batchTranslationModelSearchText(model: ModelConfig): string {
  const looseModel = model as ModelConfig & {
    name?: unknown;
    label?: unknown;
    providerName?: unknown;
  };
  return [
    model.id,
    looseModel.name,
    looseModel.label,
    model.displayName,
    model.model,
    model.provider,
    looseModel.providerName,
    model.providerConfig?.displayName,
    model.providerConfig?.providerType,
    ...model.capabilities,
  ]
    .filter((item) => item !== null && item !== undefined && String(item).trim())
    .map(String)
    .join(' ')
    .toLowerCase();
}

function isDeepSeek4FlashTextModel(model: ModelConfig): boolean {
  const compact = batchTranslationModelSearchText(model).replace(/[^a-z0-9]+/g, '');
  return (
    compact.includes('deepseek') &&
    (compact.includes('flash') || compact.includes('fast')) &&
    (
      compact.includes('deepseek4flash') ||
      compact.includes('deepseekv4flash') ||
      compact.includes('deepseek4fast') ||
      compact.includes('deepseekv4fast') ||
      compact.includes('v4') ||
      compact.includes('version4')
    )
  );
}

function findDeepSeek4FlashTextModel(models: ModelConfig[]): ModelConfig | undefined {
  return models.find(isDeepSeek4FlashTextModel);
}

function isCurrentEpisodeVideoPromptNode(node: { id?: string; type?: string; data?: any }, activeEpisodeId: string): boolean {
  return (
    node.type === 'video' &&
    node.data?.clipSyncRole === 'video' &&
    node.data?.sourceEpisodeId === activeEpisodeId &&
    Boolean(canvasNodePromptText(node).trim())
  );
}

function isCurrentEpisodeStoryboardGenerationNode(node: { id?: string; type?: string; data?: any }, activeEpisodeId: string): boolean {
  if (node.type !== 'generation') return false;
  const data = node.data ?? {};
  const sourceEpisodeId = String(data.sourceEpisodeId || '');
  if (sourceEpisodeId && sourceEpisodeId !== activeEpisodeId) return false;
  const nodeId = String(node.id || '');
  const clipKind = String(data.clipNodeKind || '');
  const role = String(data.clipSyncRole || '');
  const title = String(data.title || data.description || '');
  const isDualModeStoryboard = data.positioningBoardFlow === true && data.positioningBoardMode !== 'positioning';
  const isClipStoryboard = (
    data.storyboardForClip === true ||
    clipKind === 'storyboard' ||
    role === 'storyboard' ||
    /故事板|storyboard/i.test(title)
  );
  return Boolean(
    (isDualModeStoryboard || isClipStoryboard) &&
    (nodeId.includes(activeEpisodeId) || sourceEpisodeId === activeEpisodeId) &&
    canvasNodePromptText(node).trim(),
  );
}

function isStoryboardGenerationMissingImage(node: { data?: any }): boolean {
  const data = node.data ?? {};
  return !publicImageUrl(data.outputImage) && !(Array.isArray(data.outputImages) && data.outputImages.some((item: unknown) => {
    if (typeof item === 'string') return Boolean(publicImageUrl(item));
    if (item && typeof item === 'object') return Boolean(publicImageUrl((item as Record<string, unknown>).url));
    return false;
  }));
}

function batchTranslationNodeIdForSource(sourceId: string): string {
  return `batch-translation-node-${sourceId}`;
}

function batchTranslationNodePositionForSource(
  source: { id: string; parentId?: string; position?: { x?: number; y?: number }; style?: any; width?: number | null; height?: number | null; measured?: { width?: number; height?: number }; type?: string },
  nodes: Array<{ id: string; parentId?: string; position?: { x?: number; y?: number }; style?: any; width?: number | null; height?: number | null; measured?: { width?: number; height?: number }; type?: string }>,
) {
  const safeNode = {
    ...source,
    position: {
      x: Number(source.position?.x ?? 0),
      y: Number(source.position?.y ?? 120),
    },
  };
  const nodeById = new Map(nodes.map((node) => [
    node.id,
    {
      ...node,
      position: {
        x: Number(node.position?.x ?? 0),
        y: Number(node.position?.y ?? 0),
      },
    },
  ]));
  const absolutePosition = canvasNodeAbsolutePosition(safeNode, nodeById);
  const { width } = canvasNodeVisualSize(source);
  return {
    x: absolutePosition.x + width + 120,
    y: absolutePosition.y,
  };
}

function workflowStageFromRemote(value: unknown): WorkflowStageKey | null {
  const stage = String(value || '').trim();
  return stage === 'source' || stage === 'assets' || stage === 'storyboard' || stage === 'video' || stage === 'voice' || stage === 'preview' || stage === 'edit'
    ? stage
    : null;
}

function CanvasInner() {
  const { id: projectId = 'local' } = useParams<{ id: string }>();
  const [activePanel, setActivePanel] = useState<'workflow' | 'assets' | 'assetLibrary' | null>('workflow');
  const [activeWorkflowStage, setActiveWorkflowStage] = useState<WorkflowStageKey>('source');
  const [sourceText, setSourceText] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [selectedEpisode, setSelectedEpisode] = useState('第 1 集');
  const [episodeList, setEpisodeList] = useState<WorkflowEpisodeListResponse>(defaultEpisodeList);
  const [activeEpisodeId, setActiveEpisodeId] = useState('episode-001');
  const [episodeSwitching, setEpisodeSwitching] = useState(false);
  const [episodeCreating, setEpisodeCreating] = useState(false);
  const [breakdownScenes, setBreakdownScenes] = useState<BreakdownScene[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [workflowAssets, setWorkflowAssets] = useState<WorkflowAssets>(defaultWorkflowAssets);
  const [stageStatuses, setStageStatuses] = useState<Record<string, string>>({});
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflowInitialLoaded, setWorkflowInitialLoaded] = useState(projectId === 'local');
  const [workflowSaving, setWorkflowSaving] = useState(false);
  const [workflowRunning, setWorkflowRunning] = useState(false);
  const [workflowInferAllRunning, setWorkflowInferAllRunning] = useState(false);
  const [optimizingClipId, setOptimizingClipId] = useState<string | null>(null);
  const [generatingSeedanceClipId, setGeneratingSeedanceClipId] = useState<string | null>(null);
  const [generationRecords, setGenerationRecords] = useState<GenerationRecord[]>([]);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [workflowModels, setWorkflowModels] = useState<ModelConfig[]>([]);
  const [workflowAiModelId, setWorkflowAiModelId] = useState('');
  const [workflowModelsLoading, setWorkflowModelsLoading] = useState(false);
  const [workflowModelError, setWorkflowModelError] = useState<string | null>(null);
  const [workflowProgressText, setWorkflowProgressText] = useState('');
  const [assetImageModels, setAssetImageModels] = useState<ModelConfig[]>([]);
  const [assetGenerationModelId, setAssetGenerationModelId] = useState('');
  const [assetGenerationAspectRatio, setAssetGenerationAspectRatio] = useState('16:9');
  const [assetGenerationResolution, setAssetGenerationResolution] = useState('2k');
  const [assetGenerationBusyKeys, setAssetGenerationBusyKeys] = useState<string[]>([]);
  const [assetGenerationStatus, setAssetGenerationStatus] = useState<string | null>(null);
  const [assetHistoryLoadBusy, setAssetHistoryLoadBusy] = useState(false);
  const [assetHistoryTarget, setAssetHistoryTarget] = useState<AssetHistoryTarget | null>(null);
  const [assetHistoryItems, setAssetHistoryItems] = useState<WorkflowAssetImageHistoryItem[]>([]);
  const [assetHistoryLoading, setAssetHistoryLoading] = useState(false);
  const [assetHistoryStatus, setAssetHistoryStatus] = useState<string | null>(null);
  const [assetImagePreview, setAssetImagePreview] = useState<AssetImagePreview | null>(null);
  const [propPickerCharacter, setPropPickerCharacter] = useState<WorkflowAssetItem | null>(null);
  const [propGenerationPrompt, setPropGenerationPrompt] = useState('');
  const [propBindingBusy, setPropBindingBusy] = useState(false);
  const [propBindingStatus, setPropBindingStatus] = useState<string | null>(null);
  const [assetHistoryVariantFilter, setAssetHistoryVariantFilter] = useState<'all' | 'with-props'>('all');
  const [assetUploadKind, setAssetUploadKind] = useState<WorkflowAssetKind>('characters');
  const [assetUploadName, setAssetUploadName] = useState('');
  const [assetUploadModelId, setAssetUploadModelId] = useState('');
  const [assetUploadBusyKeys, setAssetUploadBusyKeys] = useState<string[]>([]);
  const [assetUploadStatus, setAssetUploadStatus] = useState<string | null>(null);
  const [assetLibraryEpisodeId, setAssetLibraryEpisodeId] = useState<AssetLibraryEpisodeFilter>('all');
  const [assetLibraryCategory, setAssetLibraryCategory] = useState<AssetLibraryCategory>('characters');
  const [assetLibraryBundles, setAssetLibraryBundles] = useState<EpisodeWorkflowAssetBundle[]>([]);
  const [assetLibraryRecords, setAssetLibraryRecords] = useState<GenerationRecord[]>([]);
  const [assetLibraryLoading, setAssetLibraryLoading] = useState(false);
  const [assetLibraryStatus, setAssetLibraryStatus] = useState<string | null>(null);
  const [canvasDropActive, setCanvasDropActive] = useState(false);
  const [canvasDropStatus, setCanvasDropStatus] = useState<string | null>(null);
  const [batchTranslatingPrompts, setBatchTranslatingPrompts] = useState(false);
  const [batchGeneratingStoryboards, setBatchGeneratingStoryboards] = useState(false);
  const [projectUnavailable, setProjectUnavailable] = useState(false);
  const [workflowDraftProjectId, setWorkflowDraftProjectId] = useState<string | null>(null);
  const sourceFileRef = useRef<HTMLInputElement>(null);
  const canvasImageFileRef = useRef<HTMLInputElement>(null);
  const assetImageFileRef = useRef<HTMLInputElement>(null);
  const assetAudioFileRef = useRef<HTMLInputElement>(null);
  const pendingAssetUploadRef = useRef<{ kind: WorkflowAssetKind; name: string } | null>(null);
  const pendingAudioUploadRef = useRef<{ mode: 'single'; name: string } | { mode: 'batch' } | null>(null);
  const workflowInferAllActiveRequestStartedAtRef = useRef(0);
  const workflowInferAllExpectedClipIdsRef = useRef<string[]>([]);
  const workflowInferAllCompletedClipIdsRef = useRef<Set<string>>(new Set());
  const workflowBreakdownRecoveryRef = useRef<WorkflowBreakdownRecoveryOptions | null>(null);
  const syncEpisodeBoardsToCanvasRef = useRef<((override?: EpisodeCanvasSyncRequest) => Promise<void>) | null>(null);
  const inferBoardsAndVideoToCanvasRef = useRef<(() => Promise<InferBoardsAndVideoResult>) | null>(null);
  const [fullPipelineRunning, setFullPipelineRunning] = useState(false);
  const currentProject = useProjectStore((s) => s.projects.find((project) => project.id === projectId));
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const updateProject = useProjectStore((s) => s.updateProject);
  const projectPromptContext = useMemo(() => compactProjectPromptContext(currentProject), [currentProject]);
  const currentGenerationStrategy = useMemo(() => projectGenerationStrategy(currentProject), [currentProject]);
  const storyboardEnabled = useMemo(() => projectStrategySupportsStoryboard(currentGenerationStrategy), [currentGenerationStrategy]);
  const firstFrameUnavailable = useMemo(() => isFirstFrameStrategy(currentGenerationStrategy), [currentGenerationStrategy]);
  const [projectGlobalSettingsOpen, setProjectGlobalSettingsOpen] = useState(false);
  const [projectGlobalSettingsDraft, setProjectGlobalSettingsDraft] = useState<ProjectGlobalSettingsDraft>(() => createProjectGlobalSettingsDraft());
  const [projectGlobalSettingsSaving, setProjectGlobalSettingsSaving] = useState(false);
  const [projectGlobalSettingsError, setProjectGlobalSettingsError] = useState<string | null>(null);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const canvasLocalRevision = useCanvasStore((s) => s.localRevision);
  const setNodes = useCanvasStore((s) => s.setNodes);
  const setNodesTransient = useCanvasStore((s) => s.setNodesTransient);
  const setEdges = useCanvasStore((s) => s.setEdges);
  const setEdgesTransient = useCanvasStore((s) => s.setEdgesTransient);
  const applyRemoteCanvasScene = useCanvasStore((s) => s.applyRemoteScene);
  const markCanvasNodesDeleted = useCanvasStore((s) => s.markNodesDeleted);
  const loadCanvasScene = useCanvasStore((s) => s.loadScene);
  const saveCanvasScene = useCanvasStore((s) => s.saveScene);
  const addNode = useCanvasStore((s) => s.addNode);
  const onConnect = useCanvasStore((s) => s.onConnect);
  const { fitView, screenToFlowPosition, setNodes: setReactFlowNodes, setEdges: setReactFlowEdges } = useReactFlow();
  const canvasDropStatusTimerRef = useRef<number | null>(null);
  const canvasLoadedRef = useRef(false);
  const episodeWorkspaceLoadSeqRef = useRef(0);
  const episodeWorkspaceCanvasLoadSceneRef = useRef('');
  const canvasAutoNormalizeTransitionRef = useRef('');
  const reactFlowNodeSignatureRef = useRef('');
  const reactFlowEdgeSignatureRef = useRef('');
  const activeCanvasSceneId = useMemo(() => workflowEpisodeCanvasSceneId(activeEpisodeId), [activeEpisodeId]);
  const activeEpisodeSummary = useMemo(
    () => episodeList.episodes.find((episode) => episode.id === activeEpisodeId) ?? episodeList.episodes[0],
    [activeEpisodeId, episodeList.episodes],
  );

  useEffect(() => {
    if (!episodeList.episodes.length) return;
    if (episodeList.episodes.some((episode) => episode.id === activeEpisodeId)) return;
    const nextEpisodeId = episodeList.activeEpisodeId && episodeList.episodes.some((episode) => episode.id === episodeList.activeEpisodeId)
      ? episodeList.activeEpisodeId
      : episodeList.episodes[0].id;
    setActiveEpisodeId(nextEpisodeId);
    setWorkflowDraftProjectId(`${projectId}:${nextEpisodeId}`);
  }, [activeEpisodeId, episodeList.activeEpisodeId, episodeList.episodes, projectId]);

  const showCanvasDropStatus = useCallback((message: string) => {
    setCanvasDropStatus(message);
    if (canvasDropStatusTimerRef.current) {
      window.clearTimeout(canvasDropStatusTimerRef.current);
    }
    canvasDropStatusTimerRef.current = window.setTimeout(() => {
      setCanvasDropStatus(null);
      canvasDropStatusTimerRef.current = null;
    }, 3500);
  }, []);

  useEffect(() => {
    if (!projectGlobalSettingsOpen) {
      setProjectGlobalSettingsDraft(createProjectGlobalSettingsDraft(currentProject));
      setProjectGlobalSettingsError(null);
    }
  }, [currentProject, projectGlobalSettingsOpen]);

  const openProjectGlobalSettings = useCallback(() => {
    setProjectGlobalSettingsDraft(createProjectGlobalSettingsDraft(currentProject));
    setProjectGlobalSettingsError(null);
    setProjectGlobalSettingsOpen(true);
  }, [currentProject]);

  const saveProjectGlobalSettings = useCallback(async () => {
    if (!projectId || projectId === 'local') {
      setProjectGlobalSettingsError('本地项目不能保存全局设定。');
      return;
    }
    const title = projectGlobalSettingsDraft.title.trim();
    if (!title) {
      setProjectGlobalSettingsError('项目名称不能为空。');
      return;
    }
    const normalizedDraft = translateProjectPromptSettingsDraftToEnglish(projectGlobalSettingsDraft);
    const finalStyle = normalizedDraft.style === '自定义'
      ? (normalizedDraft.customStyleName.trim() || '自定义风格')
      : normalizedDraft.style;
    setProjectGlobalSettingsSaving(true);
    setProjectGlobalSettingsError(null);
    try {
      const updated = await updateProject(projectId, {
        title,
        description: normalizedDraft.description,
        ratio: normalizedDraft.ratio,
        style: finalStyle,
        cover: currentProject?.cover || PROJECT_DEFAULT_COVER,
        globalPrompt: buildProjectGlobalPromptFromDraft(normalizedDraft),
        negativePrompt: normalizedDraft.negativePrompt,
        setupSettings: {
          customStyleName: normalizedDraft.customStyleName.trim(),
          customStylePrompt: normalizedDraft.customStylePrompt.trim(),
          generationStrategy: normalizedDraft.generationStrategy,
          projectTone: normalizedDraft.projectTone,
          directorNotes: normalizedDraft.directorNotes,
          characterIdentityRules: normalizedDraft.characterIdentityRules,
          globalPrompt: normalizedDraft.globalPrompt,
          scriptRules: normalizedDraft.scriptRules,
        },
      });
      if (!updated) throw new Error('项目保存失败，请确认项目仍然存在后重试。');
      await loadProjects();
      setProjectGlobalSettingsOpen(false);
      showCanvasDropStatus('项目全局设定已保存，后续推理会按新设定执行。');
    } catch (error) {
      setProjectGlobalSettingsError(error instanceof Error ? error.message : '项目全局设定保存失败。');
    } finally {
      setProjectGlobalSettingsSaving(false);
    }
  }, [currentProject?.cover, loadProjects, projectGlobalSettingsDraft, projectId, showCanvasDropStatus, updateProject]);

  const syncedAssetGenerationBusyKeys = useMemo(() => {
    const keys = generationRecords
      .map(generationRecordWorkflowAssetBusyKey)
      .filter((key): key is string => Boolean(key));
    return Array.from(new Set([...assetGenerationBusyKeys, ...keys]));
  }, [assetGenerationBusyKeys, generationRecords]);

  const isAssetGenerationBusy = useCallback((kind: WorkflowAssetKind, item: WorkflowAssetItem) => {
    const assetName = item.name?.trim();
    return Boolean(assetName && syncedAssetGenerationBusyKeys.includes(workflowAssetBusyKey(kind, assetName)));
  }, [syncedAssetGenerationBusyKeys]);

  const isAssetUploadBusy = useCallback((kind: WorkflowAssetKind, item: WorkflowAssetItem) => {
    const assetName = item.name?.trim();
    return Boolean(assetName && assetUploadBusyKeys.includes(workflowAssetBusyKey(kind, assetName)));
  }, [assetUploadBusyKeys]);

  const storyboardAssetReferences = useMemo(
    () => storyboardReferencesFromGenerationRecords(generationRecords, clips, { episodeId: activeEpisodeId, episode: selectedEpisode }),
    [activeEpisodeId, generationRecords, clips, selectedEpisode],
  );
  const assetLibraryEpisodes = useMemo(
    () => episodeList.episodes.length ? episodeList.episodes : defaultEpisodeList().episodes,
    [episodeList.episodes],
  );
  const assetLibraryAssetItems = useMemo(
    () => assetLibraryCategory === 'directorBoards'
      ? []
      : collectEpisodeAssetLibraryItems(assetLibraryBundles, assetLibraryCategory, assetLibraryEpisodeId),
    [assetLibraryBundles, assetLibraryCategory, assetLibraryEpisodeId],
  );
  const assetLibraryDirectorItems = useMemo(
    () => assetLibraryCategory === 'directorBoards'
      ? collectDirectorBoardLibraryItems(assetLibraryRecords, assetLibraryEpisodes, assetLibraryEpisodeId)
      : [],
    [assetLibraryCategory, assetLibraryEpisodeId, assetLibraryEpisodes, assetLibraryRecords],
  );
  const assetLibraryTotalCount = assetLibraryCategory === 'directorBoards'
    ? assetLibraryDirectorItems.length
    : assetLibraryAssetItems.length;
  const blockedStoryboardImageUrls = useMemo(
    () => nonStoryboardImageUrlsFromGenerationRecords(generationRecords),
    [generationRecords],
  );
  const clipStoryboardImageRefs = useMemo(
    () => clips.flatMap((clip) => collectClipStoryboardImageReferences(clip, nodes, storyboardAssetReferences, blockedStoryboardImageUrls)),
    [clips, nodes, storyboardAssetReferences, blockedStoryboardImageUrls],
  );
  const finalizeClipStoryboardPrompt = useCallback((
    clip: Clip,
    basePrompt: string,
    clipsOverride: Clip[] = clips,
    assetsOverride: WorkflowAssets = workflowAssets,
    scenesOverride: BreakdownScene[] = breakdownScenes,
  ) => buildFinalClipStoryboardPromptForCanvas({
    clip,
    clips: clipsOverride,
    scenes: scenesOverride,
    assets: assetsOverride,
    nodes: useCanvasStore.getState().nodes,
    storyboardAssetRefs: storyboardAssetReferences,
    blockedStoryboardUrls: blockedStoryboardImageUrls,
    basePrompt,
  }), [blockedStoryboardImageUrls, breakdownScenes, clips, storyboardAssetReferences, workflowAssets]);

  const normalizeCanvasStoryboardLinks = useCallback((rawNodes = useCanvasStore.getState().nodes, rawEdges = useCanvasStore.getState().edges) => {
    const normalizedStoryboards = normalizeClipStoryboardReferenceSections(clips, rawNodes, rawEdges, storyboardAssetReferences, blockedStoryboardImageUrls);
    const normalized = normalizeVideoReferenceGraph(
      normalizedStoryboards.nodes,
      normalizedStoryboards.edges,
      storyboardAssetReferences,
      blockedStoryboardImageUrls,
    );
    return normalized;
  }, [blockedStoryboardImageUrls, clips, storyboardAssetReferences]);

  useEffect(() => {
    if (generationRecords.length === 0 || nodes.length === 0) return;
    let changed = false;
    const nextNodes = nodes.map((node) => {
      if (node.type === 'video') {
        const videoStatus = String(node.data?.videoStatus || node.data?.status || '');
        if (!['generating', 'submitted'].includes(videoStatus)) return node;
        const prompt = String(node.data?.videoPrompt || node.data?.seedancePrompt || node.data?.prompt || '');
        const generationStartedAt = String(node.data?.generationStartedAt || '');
        const generationId = String(node.data?.generationId || '');
        const latestRecord = findLatestCanvasVideoGenerationRecordForNode(
          generationRecords,
          node,
          prompt,
          { ...(generationStartedAt ? { notBefore: generationStartedAt } : {}), generationId },
        );
        if (!latestRecord) return node;
        if (!generationStartedAt && !isRecentGenerationRecord(latestRecord)) return node;
        if (latestRecord.status === 'RUNNING' || latestRecord.status === 'QUEUED') return node;
        if (latestRecord.status === 'FAILED' || latestRecord.status === 'CANCELED') {
          const error = latestRecord.errorMessage || (latestRecord.status === 'CANCELED' ? '视频生成已取消。' : '视频生成失败。');
          if (node.data?.videoStatus === 'failed' && node.data?.videoError === error) return node;
          changed = true;
          return {
            ...node,
            data: {
              ...node.data,
              videoStatus: 'failed',
              status: 'failed',
              statusLabel: '视频生成失败',
              videoError: error,
              generationStartedAt: '',
              generationId: latestRecord.id || generationId,
            },
          };
        }
        if (latestRecord.status !== 'SUCCEEDED') return node;
        const video = generationRecordVideoUrl(latestRecord);
        if (!video?.url) return node;
        changed = true;
        return {
          ...node,
          data: {
            ...node.data,
            videoStatus: 'completed',
            status: 'completed',
            statusLabel: '视频已完成',
            videoError: '',
            outputVideo: video.url,
            outputVideoAssetId: video.assetId || node.data?.outputVideoAssetId || '',
            generationStartedAt: '',
            generationId: latestRecord.id || generationId,
          },
        };
      }
      if (node.type !== 'generation') return node;
      const status = String(node.data?.status || '');
      if (status && status !== 'generating' && status !== 'failed' && status !== 'waiting') return node;
      const prompt = String(node.data?.submittedPrompt || node.data?.finalPrompt || node.data?.prompt || '');
      const generationStartedAt = String(node.data?.generationStartedAt || '');
      const generationRequestId = String(node.data?.generationRequestId || '');
      const generationId = String(node.data?.generationId || '');
      const latestRecord = findLatestCanvasImageGenerationRecordForNode(
        generationRecords,
        node,
        prompt,
        { ...(generationStartedAt ? { notBefore: generationStartedAt, requestId: generationRequestId } : {}), generationId },
      );
      if (!latestRecord) {
        const age = canvasGenerationAgeMs(generationStartedAt);
        if (!generationId && status === 'generating' && age !== null && age > CANVAS_GENERATION_SUBMIT_CONFIRM_MS) {
          changed = true;
          return {
            ...node,
            data: {
              ...node.data,
              status: 'failed',
              error: '没有找到对应的后端生成任务，请重新生成。',
              generationStartedAt: '',
              generationRequestId: '',
            },
          };
        }
        return node;
      }
      const allowMissingTaskRecovery = shouldAllowMissingBackendTaskRecovery(node, latestRecord, prompt);
      if (!generationStartedAt && !isRecentGenerationRecord(latestRecord) && !allowMissingTaskRecovery) return node;
      if (shouldIgnoreStoppedCanvasGenerationRecord(node.data as Record<string, unknown> | undefined, latestRecord, prompt)) return node;
      if (latestRecord.status === 'RUNNING' || latestRecord.status === 'QUEUED') {
        const nextStartedAt = generationStartedAt || generationRecordStartedAt(latestRecord) || canvasGenerationStartedAt();
        const nextError = '后端已有同一图片生成请求正在运行，已接管等待。';
        if (
          node.data?.status === 'generating' &&
          node.data?.error === nextError &&
          node.data?.generationStartedAt === nextStartedAt
        ) return node;
        changed = true;
        return {
          ...node,
          data: {
            ...node.data,
            status: 'generating',
            error: nextError,
            generationStartedAt: nextStartedAt,
            generationRequestId,
            generationId: latestRecord.id || generationId,
          },
        };
      }
      if (latestRecord?.status === 'FAILED' || latestRecord?.status === 'CANCELED') {
        const rawError = latestRecord.errorMessage || (latestRecord.status === 'CANCELED' ? '生成已取消。' : '生成失败。');
        const error = appendCanvasImageGenerationRetryHint(
          rawError,
          generationRecordReferenceImageCount(latestRecord),
          generationRecordResolution(latestRecord),
        );
        if (
          node.data?.status === 'failed' &&
          node.data?.error === error &&
          !node.data?.generationStartedAt
        ) return node;
        changed = true;
        return {
          ...node,
          data: {
            ...node.data,
            status: 'failed',
            error,
            generationStartedAt: '',
            generationRequestId: '',
            generationId: latestRecord.id || generationId,
          },
        };
      }
      if (latestRecord.status !== 'SUCCEEDED') return node;
      const image = generationRecordImageUrl(latestRecord);
      if (!image?.url) return node;
      const outputImageVariants = generationRecordImageUrls(latestRecord);
      if (!generationStartedAt && node.data?.outputImage && node.data.outputImage !== image.url) return node;
      const nextOutputImageAssetId = image.assetId || node.data?.outputImageAssetId || '';
      if (
        node.data?.status === 'completed' &&
        node.data?.outputImage === image.url &&
        node.data?.outputImageAssetId === nextOutputImageAssetId &&
        canvasOutputImageVariantsEqual(node.data?.outputImages, outputImageVariants) &&
        !node.data?.generationStartedAt
      ) return node;
      changed = true;
      return {
        ...node,
        data: {
          ...node.data,
          status: 'completed',
          outputImage: image.url,
          outputImageAssetId: nextOutputImageAssetId,
          outputImages: outputImageVariants,
          finalPrompt: node.data?.finalPrompt || node.data?.prompt || prompt,
          submittedPrompt: latestRecord.prompt || prompt,
          manualFinalPrompt: true,
          mode: node.data?.mode || 'standalone',
          error: '后台长请求已完成，已自动恢复生成结果。',
          generationStartedAt: '',
          generationRequestId: '',
          generationId: latestRecord.id || generationId,
        },
      };
    });
    if (!changed) return;
    const latest = useCanvasStore.getState();
    const normalized = normalizeCanvasStoryboardLinks(nextNodes as any, latest.edges);
    if (!canvasNodeListsEqual(normalized.nodes as any[], latest.nodes as any[])) setNodes(normalized.nodes as any);
    if (!canvasEdgeListsEqual(normalized.edges as any[], latest.edges as any[])) setEdges(normalized.edges);
  }, [edges, generationRecords, nodes, normalizeCanvasStoryboardLinks, setEdges, setNodes]);

  useEffect(() => {
    if (projectId !== 'local' && !currentProject) {
      void loadProjects();
    }
  }, [currentProject, loadProjects, projectId]);

  const loadEpisodeWorkspace = useCallback(async (episodeId: string) => {
    if (!episodeId || !projectId || projectId === 'local') return;
    const loadSeq = ++episodeWorkspaceLoadSeqRef.current;
    setEpisodeSwitching(true);
    setWorkflowLoading(true);
    setWorkflowError(null);
    canvasLoadedRef.current = false;
    setNodesTransient([]);
    setEdgesTransient([]);
    try {
      const remote = await apiClient.getProjectWorkflow(projectId, { episodeId });
      if (loadSeq !== episodeWorkspaceLoadSeqRef.current) return;
      const resolvedEpisodeId = remote?.episodeId || episodeId;
      if (remote) {
        applyWorkflowSnapshot(remote, {
          setEpisodeList,
          setActiveEpisodeId,
          setSourceText,
          setSourceName,
          setSelectedEpisode,
          setBreakdownScenes,
          setClips,
          setWorkflowAssets,
          setStageStatuses,
        });
        const remoteStage = workflowStageFromRemote(remote.activeStage);
        if (remoteStage) setActiveWorkflowStage(remoteStage);
        setWorkflowDraftProjectId(`${projectId}:${resolvedEpisodeId}`);
      } else {
        setActiveEpisodeId(episodeId);
        setWorkflowDraftProjectId(`${projectId}:${episodeId}`);
      }
      const nextCanvasSceneId = workflowEpisodeCanvasSceneId(resolvedEpisodeId);
      episodeWorkspaceCanvasLoadSceneRef.current = nextCanvasSceneId;
      await loadCanvasScene(projectId, nextCanvasSceneId);
      if (loadSeq !== episodeWorkspaceLoadSeqRef.current) return;
      canvasLoadedRef.current = true;
      setGenerationRecords([]);
    } catch (error) {
      if (loadSeq === episodeWorkspaceLoadSeqRef.current) {
        setWorkflowError(error instanceof Error ? error.message : '剧集切换失败');
      }
    } finally {
      if (loadSeq === episodeWorkspaceLoadSeqRef.current) {
        setEpisodeSwitching(false);
        setWorkflowLoading(false);
      }
    }
  }, [loadCanvasScene, projectId, setEdgesTransient, setNodesTransient]);

  const createNextEpisodeWorkspace = useCallback(async () => {
    if (!projectId || projectId === 'local' || episodeCreating) return;
    const title = window.prompt('下一集名称', nextEpisodeTitle(episodeList.episodes));
    if (!title?.trim()) return;
    setEpisodeCreating(true);
    setWorkflowError(null);
    try {
      const result = await apiClient.createProjectWorkflowEpisode(projectId, {
        title: title.trim(),
        copyAssetsFromEpisodeId: activeEpisodeId,
      });
      setEpisodeList(result.episodes);
      await loadEpisodeWorkspace(result.episode.id);
      showCanvasDropStatus(`已新增 ${result.episode.title}，全局设定和角色资产沿用当前项目，分镜和画布为空。`);
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : '新增下一集失败');
    } finally {
      setEpisodeCreating(false);
    }
  }, [activeEpisodeId, episodeCreating, episodeList.episodes, loadEpisodeWorkspace, projectId, showCanvasDropStatus]);

  const handleSaveWorkflowSource = useCallback(async () => {
    if (projectUnavailable) return;
    const draft = {
      episodeId: activeEpisodeId,
      sourceText,
      sourceName,
      selectedEpisode,
      breakdownScenes,
      clips,
      assets: workflowAssets,
      stageStatuses,
    };

    try {
      localStorage.setItem(`loohii-workflow-center:${projectId}:${activeEpisodeId}`, JSON.stringify(draft));
    } catch {
      // Keep the current text in memory even if local storage is unavailable.
    }

    if (!projectId || projectId === 'local') {
      showCanvasDropStatus('当前原文已保存到本地浏览器。');
      return;
    }

    setWorkflowSaving(true);
    setWorkflowError(null);
    try {
      const remote = await apiClient.saveProjectWorkflow(projectId, draft, { episodeId: activeEpisodeId });
      if (remote) {
        applyWorkflowSnapshot(remote, {
          setEpisodeList,
          setActiveEpisodeId,
          setSourceText,
          setSourceName,
          setSelectedEpisode,
          setBreakdownScenes,
          setClips,
          setWorkflowAssets,
          setStageStatuses,
        });
        setWorkflowDraftProjectId(`${projectId}:${remote.episodeId || activeEpisodeId}`);
      }
      showCanvasDropStatus(`已保存 ${selectedEpisode} 原文到后端。`);
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : '保存原文失败');
    } finally {
      setWorkflowSaving(false);
    }
  }, [activeEpisodeId, breakdownScenes, clips, projectId, projectUnavailable, selectedEpisode, sourceName, sourceText, stageStatuses, workflowAssets, showCanvasDropStatus]);

  useEffect(() => {
    if (!workflowInitialLoaded) return;
    if (episodeWorkspaceCanvasLoadSceneRef.current === activeCanvasSceneId) {
      episodeWorkspaceCanvasLoadSceneRef.current = '';
      return;
    }
    let cancelled = false;
    canvasLoadedRef.current = false;
    loadCanvasScene(projectId || 'local', activeCanvasSceneId)
      .then(() => {
        if (!cancelled) canvasLoadedRef.current = true;
      })
      .catch((error) => {
        if (!cancelled) setWorkflowError(error instanceof Error ? error.message : '画布加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [activeCanvasSceneId, loadCanvasScene, projectId, workflowInitialLoaded]);

  useEffect(() => {
    if (!canvasLoadedRef.current || projectUnavailable || !projectId || projectId === 'local') return;
    const timer = window.setTimeout(() => {
      const canvasState = useCanvasStore.getState();
      if (!canvasLoadedRef.current || canvasState.activeProjectId !== projectId || canvasState.activeSceneId !== activeCanvasSceneId) return;
      saveCanvasScene(projectId, activeCanvasSceneId).catch(() => {
        // Local canvas persistence remains available if the remote save fails.
      });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [activeCanvasSceneId, canvasLocalRevision, projectId, projectUnavailable, saveCanvasScene]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; actionResults?: Array<Record<string, unknown>> }>).detail;
      if (!detail?.projectId || detail.projectId !== projectId || projectId === 'local') return;
      const results = Array.isArray(detail.actionResults) ? detail.actionResults : [];
      const shouldRefreshCanvas = results.some((result) => result?.ok && (
        result.canvasChanged ||
        result.stateVerified ||
        result.type === 'sync_episode_canvas' ||
        result.type === 'connect_asset_to_clip' ||
        result.type === 'connect_asset_to_all_clips'
      ));
      const shouldRefreshRecords = results.some((result) => result?.ok && (result.generationId || result.recordsChanged));
      const shouldRefreshProject = results.some((result) => result?.ok && (result.projectChanged || result.workflowChanged));
      if (shouldRefreshCanvas) {
        const refreshedSceneId = results
          .map((result) => String(result?.sceneId || ''))
          .find(Boolean) || activeCanvasSceneId;
        canvasLoadedRef.current = false;
        void loadCanvasScene(projectId, refreshedSceneId)
          .then(() => {
            canvasLoadedRef.current = true;
            showCanvasDropStatus(refreshedSceneId === activeCanvasSceneId ? '项目总控已更新画布。' : `项目总控已更新画布场景 ${refreshedSceneId}。`);
          })
          .catch((error) => {
            setWorkflowError(error instanceof Error ? error.message : '项目总控更新后画布刷新失败');
          });
      }
      if (shouldRefreshRecords) {
        window.dispatchEvent(new Event(CANVAS_GENERATION_RECORDS_REFRESH_EVENT));
      }
      if (shouldRefreshProject) {
        void loadProjects();
        void apiClient.getProjectWorkflow(projectId, { episodeId: activeEpisodeId })
          .then((remote) => {
            if (!remote) return;
            applyWorkflowSnapshot(remote, {
              setEpisodeList,
              setActiveEpisodeId,
              setSourceText,
              setSourceName,
              setSelectedEpisode,
              setBreakdownScenes,
              setClips,
              setWorkflowAssets,
              setStageStatuses,
            });
            setWorkflowDraftProjectId(`${projectId}:${remote.episodeId || activeEpisodeId}`);
          })
          .catch(() => {
            // The canvas update itself should remain visible even if workflow refresh fails.
          });
      }
    };
    window.addEventListener(AGENT_ACTIONS_APPLIED_EVENT, handler);
    return () => window.removeEventListener(AGENT_ACTIONS_APPLIED_EVENT, handler);
  }, [activeCanvasSceneId, activeEpisodeId, loadCanvasScene, loadProjects, projectId, showCanvasDropStatus]);

  useEffect(() => {
    if (!projectId || projectId === 'local') {
      setGenerationRecords([]);
      return;
    }
    let cancelled = false;
    const loadRecords = () => {
      apiClient.listGenerationRecords(projectId, { limit: 120, compact: true })
        .then((records) => {
          if (!cancelled) {
            const activeGenerationKeys = canvasActiveGenerationRecoveryKeys(useCanvasStore.getState().nodes);
            const filtered = records.filter((record) => (
              generationRecordBelongsToEpisode(record, activeEpisodeId, selectedEpisode) ||
              generationRecordMatchesActiveCanvasGeneration(record, activeGenerationKeys)
            ));
            setGenerationRecords(filtered);
          }
        })
        .catch(() => {
          if (!cancelled) setGenerationRecords([]);
        });
    };
    loadRecords();
    const timer = window.setInterval(loadRecords, 5000);
    window.addEventListener(CANVAS_GENERATION_RECORDS_REFRESH_EVENT, loadRecords);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener(CANVAS_GENERATION_RECORDS_REFRESH_EVENT, loadRecords);
    };
  }, [activeEpisodeId, projectId, selectedEpisode]);

  const loadAssetLibrary = useCallback(async () => {
    if (!projectId || projectId === 'local') {
      setAssetLibraryBundles([]);
      setAssetLibraryRecords([]);
      setAssetLibraryStatus('本地示例项目没有跨集资产库。');
      return;
    }
    setAssetLibraryLoading(true);
    setAssetLibraryStatus(null);
    try {
      const latestEpisodeList = await apiClient.listProjectWorkflowEpisodes(projectId).catch(() => null);
      const episodes = latestEpisodeList?.episodes?.length
        ? latestEpisodeList.episodes
        : assetLibraryEpisodes.length ? assetLibraryEpisodes : defaultEpisodeList().episodes;
      if (latestEpisodeList?.episodes?.length) setEpisodeList(latestEpisodeList);
      const [bundles, records] = await Promise.all([
        Promise.all(episodes.map(async (episode) => {
          try {
            const workflow = await apiClient.getProjectWorkflow(projectId, { episodeId: episode.id });
            return { episode, workflow };
          } catch {
            return { episode, workflow: null };
          }
        })),
        apiClient.listGenerationRecords(projectId, { limit: 300, compact: true }).catch(() => []),
      ]);
      setAssetLibraryBundles(bundles);
      setAssetLibraryRecords(records);
      const missing = bundles.filter((bundle) => !bundle.workflow).length;
      setAssetLibraryStatus(missing > 0 ? `已加载 ${bundles.length - missing}/${bundles.length} 集资产，${missing} 集读取失败。` : null);
    } catch (error) {
      setAssetLibraryBundles([]);
      setAssetLibraryRecords([]);
      setAssetLibraryStatus(error instanceof Error ? error.message : '全资产库加载失败');
    } finally {
      setAssetLibraryLoading(false);
    }
  }, [assetLibraryEpisodes, projectId]);

  useEffect(() => {
    if (assetLibraryEpisodeId !== 'all' && !assetLibraryEpisodes.some((episode) => episode.id === assetLibraryEpisodeId)) {
      setAssetLibraryEpisodeId('all');
    }
  }, [assetLibraryEpisodeId, assetLibraryEpisodes]);

  useEffect(() => {
    if (activePanel === 'assetLibrary') void loadAssetLibrary();
  }, [activePanel, projectId]);

  useEffect(() => {
    const handler = (event: Event) => {
      const preview = (event as CustomEvent<AssetImagePreview>).detail;
      if (preview?.url) setAssetImagePreview(preview);
    };
    window.addEventListener(CANVAS_IMAGE_PREVIEW_EVENT, handler);
    return () => window.removeEventListener(CANVAS_IMAGE_PREVIEW_EVENT, handler);
  }, []);

  useEffect(() => {
    let changed = false;
    const nextNodes = nodes.map((node) => {
      if (isVideoCanvasNode(node)) {
        const needsTypeUpdate = node.type !== 'video';
        const needsWidthUpdate = nodeStyleWidth(node.style) < 520;
        const needsCollapsedDefault = node.data?.videoParametersCollapsed === undefined;
        if (!needsTypeUpdate && !needsWidthUpdate && !needsCollapsedDefault) return node;
        changed = true;
        return {
          ...node,
          type: 'video',
          data: needsCollapsedDefault ? { ...node.data, videoParametersCollapsed: true } : node.data,
          style: needsWidthUpdate ? { ...node.style, width: 520 } : node.style,
        };
      }
      if (node.type !== 'imageInput') return node;
      const minWidth = preferredImageInputNodeWidth(node.data);
      const minHeight = preferredImageInputNodeHeight(node.data);
      const normalizedImageUrl = publicImageUrl(node.data?.imageUrl);
      const needsWidthUpdate = nodeStyleWidth(node.style) < minWidth;
      const needsHeightUpdate = numericCanvasSize(node.style?.height) !== minHeight;
      const needsUrlUpdate = Boolean(normalizedImageUrl && normalizedImageUrl !== node.data?.imageUrl);
      if (!needsWidthUpdate && !needsHeightUpdate && !needsUrlUpdate) return node;
      changed = true;
      return {
        ...node,
        data: needsUrlUpdate ? { ...node.data, imageUrl: normalizedImageUrl, uploadStatus: node.data?.uploadStatus || 'linked' } : node.data,
        style: { ...node.style, ...(needsWidthUpdate ? { width: minWidth } : {}), height: minHeight },
      };
    });
    if (changed) setNodesTransient(nextNodes);
  }, [nodes, setNodesTransient]);

  useEffect(() => {
    const latest = useCanvasStore.getState();
    const normalized = normalizeCanvasStoryboardLinks(latest.nodes, latest.edges);
    const normalizedNodes = normalized.nodes as any[];
    const normalizedEdges = normalized.edges as any[];
    if (
      canvasNodeListsEqual(normalizedNodes, latest.nodes as any[]) &&
      canvasEdgeListsEqual(normalizedEdges, latest.edges as any[])
    ) {
      canvasAutoNormalizeTransitionRef.current = '';
      return;
    }

    const inputSignature = canvasGraphChangeSignature(latest.nodes as any[], latest.edges as any[]);
    const outputSignature = canvasGraphChangeSignature(normalizedNodes, normalizedEdges);
    const transitionSignature = `${inputSignature}\n=>\n${outputSignature}`;
    if (canvasAutoNormalizeTransitionRef.current === transitionSignature) return;

    const convergence = normalizeCanvasStoryboardLinks(normalizedNodes, normalizedEdges);
    if (
      !canvasNodeListsEqual(convergence.nodes as any[], normalizedNodes) ||
      !canvasEdgeListsEqual(convergence.edges as any[], normalizedEdges)
    ) {
      canvasAutoNormalizeTransitionRef.current = transitionSignature;
      return;
    }

    canvasAutoNormalizeTransitionRef.current = transitionSignature;
    if (!canvasNodeListsEqual(normalizedNodes, latest.nodes as any[])) setNodesTransient(normalizedNodes as any);
    if (!canvasEdgeListsEqual(normalizedEdges, latest.edges as any[])) setEdgesTransient(normalizedEdges);
  }, [nodes, edges, normalizeCanvasStoryboardLinks, setEdgesTransient, setNodesTransient]);

  useEffect(() => () => {
    if (canvasDropStatusTimerRef.current) {
      window.clearTimeout(canvasDropStatusTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const workflow = (event as CustomEvent<{ workflow?: WorkflowState }>).detail?.workflow;
      if (!workflow) return;
      setWorkflowAssets(workflow.assets ?? defaultWorkflowAssets());
      setStageStatuses(workflow.stageStatuses ?? {});
    };
    window.addEventListener(WORKFLOW_ASSET_SYNC_EVENT, handler);
    return () => window.removeEventListener(WORKFLOW_ASSET_SYNC_EVENT, handler);
  }, []);

  useEffect(() => {
    const { characters, scenes, props } = workflowAssets;
    if (!characters.length && !scenes.length && !props.length) return;
    const { nodes: currentNodes, updateNodeData } = useCanvasStore.getState();
    for (const node of currentNodes) {
      const name = String(node.data.assetName || node.data.name || '');
      if (!name) continue;
      const kind = String(node.data.assetKind || '');
      const items = kind === 'characters' ? characters : kind === 'scenes' ? scenes : kind === 'props' ? props : [];
      if (!items.length) continue;
      const asset = findWorkflowAssetByName(items, name);
      if (!asset) continue;
      const assetImage = workflowAssetImageUrl(asset);
      if (!assetImage) continue;
      if (node.type === 'character') {
        if (assetImage !== String(node.data.avatar || '')) {
          updateNodeData(node.id, { avatar: assetImage });
        }
      } else if (node.type === 'generation') {
        if (assetImage !== String(node.data.outputImage || '')) {
          updateNodeData(node.id, { outputImage: assetImage, status: 'completed' });
        }
      } else if (node.type === 'imageInput' && !node.data.clipNodeKind) {
        if (assetImage !== publicImageUrl(node.data.imageUrl)) {
          updateNodeData(node.id, {
            imageUrl: assetImage,
            uploadStatus: 'linked',
            imageLoadError: false,
            uploadError: '',
          });
        }
      }
    }
  }, [workflowAssets]);

  useEffect(() => {
    let cancelled = false;
    setWorkflowModelsLoading(true);
    setWorkflowModelError(null);

    apiClient.listModelConfigs()
      .then((configs) => {
        if (cancelled) return;
        const textModels = configs.models.filter(isWorkflowTextModel);
        const imageModels = configs.models.filter(isWorkflowImageModel);
        setWorkflowModels(textModels);
        setAssetImageModels(imageModels);
        const savedModelId = localStorage.getItem(`loohii-workflow-text-model:${projectId}`) ?? '';
        const savedImageModelId = localStorage.getItem(`loohii-workflow-image-model:${projectId}`) ?? '';
        setWorkflowAiModelId((current) => {
          if (current && textModels.some((model) => model.id === current)) return current;
          if (savedModelId && textModels.some((model) => model.id === savedModelId)) return savedModelId;
          return textModels[0]?.id ?? '';
        });
        setAssetGenerationModelId((current) => {
          if (current && imageModels.some((model) => model.id === current)) return current;
          if (savedImageModelId && imageModels.some((model) => model.id === savedImageModelId)) return savedImageModelId;
          return imageModels[0]?.id ?? '';
        });
      })
      .catch((error) => {
        if (!cancelled) {
          setWorkflowModels([]);
          setAssetImageModels([]);
          setWorkflowAiModelId('');
          setAssetGenerationModelId('');
          setWorkflowModelError(error instanceof Error ? error.message : '文本模型列表加载失败');
        }
      })
      .finally(() => {
        if (!cancelled) setWorkflowModelsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    try {
      if (workflowAiModelId) {
        localStorage.setItem(`loohii-workflow-text-model:${projectId}`, workflowAiModelId);
      }
    } catch {
      // Model selection is still kept in memory for the current session.
    }
  }, [projectId, workflowAiModelId]);

  useEffect(() => {
    try {
      if (assetGenerationModelId) {
        localStorage.setItem(`loohii-workflow-image-model:${projectId}`, assetGenerationModelId);
      }
    } catch {
      // Keep selection in memory for the current session.
    }
  }, [assetGenerationModelId, projectId]);

  useEffect(() => {
    setAssetUploadModelId((current) => current || workflowAiModelId);
  }, [workflowAiModelId]);

  useEffect(() => {
    let cancelled = false;
    setWorkflowLoading(true);
    setWorkflowInitialLoaded(false);
    setWorkflowError(null);
    setProjectUnavailable(false);
    setWorkflowDraftProjectId(null);
    canvasLoadedRef.current = false;
    setNodesTransient([]);
    setEdgesTransient([]);

    async function loadWorkflow() {
      let remote = null;
      try {
        remote = await apiClient.getProjectWorkflow(projectId);
      } catch (error) {
        if (cancelled) return;
        if (isProjectNotFoundError(error)) {
          setProjectUnavailable(true);
          setWorkflowError('当前项目不存在，可能是旧本地示例项目或已被删除。请返回「我的项目」，从真实项目重新进入。');
          setSourceText('');
          setSourceName('');
          setSelectedEpisode('第 1 集');
          setEpisodeList(defaultEpisodeList());
          setActiveEpisodeId('episode-001');
          setBreakdownScenes([]);
          setClips([]);
          setWorkflowAssets(defaultWorkflowAssets());
          setStageStatuses({});
          return;
        }
        throw error;
      }
      if (cancelled) return;
      if (remote) {
        applyWorkflowSnapshot(remote, {
          setEpisodeList,
          setActiveEpisodeId,
          setSourceText,
          setSourceName,
          setSelectedEpisode,
          setBreakdownScenes,
          setClips,
          setWorkflowAssets,
          setStageStatuses,
        });
        setWorkflowProgressText(workflowRunProgressText(remote));
        const remoteStage = workflowStageFromRemote(remote.activeStage);
        if (remoteStage) setActiveWorkflowStage(remoteStage);
        setWorkflowDraftProjectId(`${projectId}:${remote.episodeId || 'episode-001'}`);
        return;
      }

      try {
        const raw = localStorage.getItem(`loohii-workflow-center:${projectId}`);
        if (raw) {
          const saved = JSON.parse(raw);
          setEpisodeList(defaultEpisodeList());
          setActiveEpisodeId('episode-001');
          setSourceText(typeof saved.sourceText === 'string' ? saved.sourceText : '');
          setSourceName(typeof saved.sourceName === 'string' ? saved.sourceName : '');
          setSelectedEpisode(typeof saved.selectedEpisode === 'string' ? saved.selectedEpisode : '第 1 集');
          setBreakdownScenes(Array.isArray(saved.breakdownScenes) ? saved.breakdownScenes : []);
          setClips(Array.isArray(saved.clips) ? saved.clips : []);
          setWorkflowAssets(saved.assets && typeof saved.assets === 'object' ? saved.assets : defaultWorkflowAssets());
          setStageStatuses(saved.stageStatuses && typeof saved.stageStatuses === 'object' ? saved.stageStatuses : {});
        } else {
          setEpisodeList(defaultEpisodeList());
          setActiveEpisodeId('episode-001');
          setSourceText('');
          setSourceName('');
          setSelectedEpisode('第 1 集');
          setBreakdownScenes([]);
          setClips([]);
          setWorkflowAssets(defaultWorkflowAssets());
          setStageStatuses({});
        }
      } catch {
        setEpisodeList(defaultEpisodeList());
        setActiveEpisodeId('episode-001');
        setSourceText('');
        setSourceName('');
        setSelectedEpisode('第 1 集');
        setBreakdownScenes([]);
        setClips([]);
        setWorkflowAssets(defaultWorkflowAssets());
        setStageStatuses({});
      } finally {
        setWorkflowDraftProjectId(`${projectId}:episode-001`);
      }
    }

    loadWorkflow()
      .catch((error) => {
        if (!cancelled) setWorkflowError(error instanceof Error ? error.message : '流程中心加载失败');
      })
      .finally(() => {
        if (!cancelled) {
          setWorkflowInitialLoaded(true);
          setWorkflowLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, setEdgesTransient, setNodesTransient]);

  useEffect(() => {
    if (projectUnavailable) return;
    const draftKey = `${projectId}:${activeEpisodeId}`;
    if (workflowDraftProjectId !== draftKey) return;
    if (workflowInferAllRunning) return;
    if (workflowHasRunningStage(stageStatuses)) return;
    const draft = { episodeId: activeEpisodeId, sourceText, sourceName, selectedEpisode, breakdownScenes, clips, assets: workflowAssets, stageStatuses };
    try {
      localStorage.setItem(
        `loohii-workflow-center:${projectId}:${activeEpisodeId}`,
        JSON.stringify(draft)
      );
    } catch {
      // Ignore storage quota errors; the current session still keeps the data in memory.
    }

    const timer = window.setTimeout(() => {
      setWorkflowSaving(true);
      apiClient.saveProjectWorkflow(projectId, draft, { episodeId: activeEpisodeId })
        .catch((error) => {
          setWorkflowError(error instanceof Error ? error.message : '流程草稿保存失败');
        })
        .finally(() => setWorkflowSaving(false));
    }, 900);

    return () => window.clearTimeout(timer);
  }, [activeEpisodeId, breakdownScenes, clips, projectId, projectUnavailable, selectedEpisode, sourceName, sourceText, stageStatuses, workflowAssets, workflowDraftProjectId, workflowInferAllRunning]);

  useEffect(() => {
    if (projectUnavailable || workflowInferAllRunning || !workflowHasRunningStage(stageStatuses)) return;
    let cancelled = false;
    let recovering = false;
    const timer = window.setInterval(() => {
      apiClient.getProjectWorkflow(projectId, { episodeId: activeEpisodeId })
        .then((remote) => {
          if (cancelled || !remote) return;
          const remoteProgress = workflowRunProgressText(remote);
          if (remoteProgress) {
            setWorkflowProgressText(remoteProgress);
          } else if (!workflowHasRunningStage(remote.stageStatuses)) {
            setWorkflowProgressText('');
          }
          const breakdownRecovery = workflowBreakdownRecoveryRef.current;
          if (
            breakdownRecovery &&
            workflowHasBreakdownResult(remote) &&
            workflowRunCompletedAfter(remote, breakdownRecovery.startedAtMs)
          ) {
            if (recovering) return;
            recovering = true;
            applyWorkflowBreakdownResult(remote, breakdownRecovery)
              .then(() => {
                if (cancelled) return;
                workflowBreakdownRecoveryRef.current = null;
                setWorkflowRunning(false);
                setWorkflowProgressText('');
                setWorkflowError(null);
                showCanvasDropStatus('后端已完成拆解，已从最新结果恢复到分镜阶段。');
              })
              .catch(() => {
                if (cancelled) return;
                applyWorkflowSnapshot(remote, {
                  setEpisodeList,
                  setActiveEpisodeId,
                  setSourceText,
                  setSourceName,
                  setSelectedEpisode,
                  setBreakdownScenes,
                  setClips,
                  setWorkflowAssets,
                  setStageStatuses,
                });
                setWorkflowDraftProjectId(`${projectId}:${remote.episodeId || activeEpisodeId}`);
              })
              .finally(() => {
                recovering = false;
              });
            return;
          }
          if (workflowBreakdownRecoveryRef.current && remote && !workflowHasRunningStage(remote.stageStatuses)) {
            const recovery = workflowBreakdownRecoveryRef.current;
            const completed = recovery.stage === 'assets'
              ? workflowHasAssetResult(remote)
              : workflowHasBreakdownResult(remote);
            if (completed && workflowRunCompletedAfter(remote, recovery.startedAtMs)) {
              if (recovering) return;
              recovering = true;
              applyWorkflowBreakdownResult(remote, recovery)
                .then(() => {
                  if (cancelled) return;
                  workflowBreakdownRecoveryRef.current = null;
                  setWorkflowRunning(false);
                  setWorkflowProgressText('');
                  setWorkflowError(null);
                  showCanvasDropStatus(recovery.stage === 'assets' ? '后端已完成资产提取，已自动恢复最新结果。' : '后端已完成拆解，已自动恢复最新结果。');
                })
                .catch(() => {
                  if (cancelled) return;
                  applyWorkflowSnapshot(remote, {
                    setEpisodeList,
                    setActiveEpisodeId,
                    setSourceText,
                    setSourceName,
                    setSelectedEpisode,
                    setBreakdownScenes,
                    setClips,
                    setWorkflowAssets,
                    setStageStatuses,
                  });
                  setWorkflowDraftProjectId(`${projectId}:${remote.episodeId || activeEpisodeId}`);
                })
                .finally(() => {
                  recovering = false;
                });
              return;
            }
          }
          applyWorkflowSnapshot(remote, {
            setEpisodeList,
            setActiveEpisodeId,
            setSourceText,
            setSourceName,
            setSelectedEpisode,
            setBreakdownScenes,
            setClips,
            setWorkflowAssets,
            setStageStatuses,
          });
          setWorkflowDraftProjectId(`${projectId}:${remote.episodeId || activeEpisodeId}`);
        })
        .catch(() => {
          // Keep the last persisted state visible; the next poll can recover.
        });
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeEpisodeId, projectId, projectUnavailable, stageStatuses, workflowInferAllRunning]);

  useEffect(() => {
    if (!workflowInferAllRunning || projectUnavailable || !projectId || projectId === 'local') return;
    let cancelled = false;
    let recovering = false;
    const recoverFromRemoteWorkflow = () => {
      if (recovering) return;
      apiClient.getProjectWorkflow(projectId, { episodeId: activeEpisodeId })
        .then((remote) => {
          if (
            cancelled ||
            !workflowRemoteBatchFinished(
              remote,
              workflowInferAllExpectedClipIdsRef.current,
              workflowInferAllActiveRequestStartedAtRef.current,
              workflowInferAllCompletedClipIdsRef.current,
              { requireStoryboard: storyboardEnabled },
            )
          ) return;
          recovering = true;
          applyWorkflowSnapshot(remote, {
            setEpisodeList,
            setActiveEpisodeId,
            setSourceText,
            setSourceName,
            setSelectedEpisode,
            setBreakdownScenes,
            setClips,
            setWorkflowAssets,
            setStageStatuses,
          });
          setWorkflowDraftProjectId(`${projectId}:${remote.episodeId || activeEpisodeId}`);
          setWorkflowInferAllRunning(false);
          showCanvasDropStatus(storyboardEnabled ? '故事板和视频提示词已完成，已恢复远端结果。' : '视频提示词已完成，已恢复远端结果。');
          const syncEpisodeBoardsToCanvas = syncEpisodeBoardsToCanvasRef.current;
          if (!syncEpisodeBoardsToCanvas) {
            recovering = false;
            return;
          }
          void syncEpisodeBoardsToCanvas({
            episodeId: remote.episodeId || activeEpisodeId,
            clips: remote.clips ?? [],
            scenes: remote.breakdownScenes as BreakdownScene[],
            assets: remote.assets ?? defaultWorkflowAssets(),
            episode: remote.selectedEpisode,
            refreshRecords: true,
          }).finally(() => {
            recovering = false;
          });
        })
        .catch(() => {
          // Keep the local in-flight state; the next poll can recover after a transient network error.
          recovering = false;
        });
    };
    recoverFromRemoteWorkflow();
    const timer = window.setInterval(recoverFromRemoteWorkflow, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeEpisodeId, projectId, projectUnavailable, showCanvasDropStatus, storyboardEnabled, workflowInferAllRunning]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const currentNodes = useCanvasStore.getState().nodes;
      if (isAutoCanvasLayoutChangeBatch(changes)) {
        const layoutChanges = changes.filter((change) => !isMeasurementCanvasNodeChange(change));
        if (layoutChanges.length === 0 || layoutChanges.every(isTransientCanvasNodeChange)) return;
        const nextNodes = applyNodeChanges(layoutChanges, currentNodes);
        if (changes.some(isInteractiveCanvasResizeChange)) {
          setNodes(nextNodes);
        } else {
          setNodesTransient(nextNodes);
        }
        return;
      }
      const actionableChanges = changes.filter((change) => !isMeasurementCanvasNodeChange(change) && !isAutoCanvasLayoutChange(change));
      if (actionableChanges.length === 0) return;
      if (actionableChanges.every(isTransientCanvasNodeChange)) {
        return;
      }
      const durableChanges = actionableChanges.filter((change) => !isTransientCanvasNodeChange(change));
      if (durableChanges.length === 0) return;
      const removedIds = new Set(
        durableChanges
          .filter((change) => change.type === 'remove')
          .map((change) => change.id),
      );
      for (const nodeId of Array.from(removedIds)) {
        const node = currentNodes.find((item) => item.id === nodeId);
        if (node?.type !== 'section') continue;
        for (const descendantId of collectCanvasSectionDescendantIds(currentNodes, node.id)) {
          removedIds.add(descendantId);
        }
      }
      if (removedIds.size > 0) markCanvasNodesDeleted(removedIds);
      const changedNodes = applyNodeChanges(durableChanges, currentNodes);
      setNodes(detachNodesFromRemovedParents(changedNodes, removedIds, currentNodes));
    },
    [markCanvasNodesDeleted, setNodes, setNodesTransient]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const currentEdges = useCanvasStore.getState().edges;
      if (changes.every((change) => change.type === 'select')) {
        return;
      }
      const durableChanges = changes.filter((change) => change.type !== 'select');
      if (durableChanges.length === 0) return;
      setEdges(applyEdgeChanges(durableChanges, currentEdges));
    },
    [setEdges]
  );

  const handleAddNode = () => {
    const lastScene = nodes.filter((n) => n.type === 'scene').pop();
    const x = lastScene ? lastScene.position.x + 380 : 350;
    const y = lastScene ? lastScene.position.y : 100;
    addNode('scene', { x, y });
  };

  const handleAddWorkflowNode = (nodeType: CanvasNodeKind, title: string, description: string) => {
    const processNodes = useCanvasStore
      .getState()
      .nodes.filter((n) => ['episode', 'asset', 'workflow', 'directorBoard'].includes(String(n.type)));
    const x = 120;
    const y = 80 + processNodes.length * 140;
    addNode(nodeType, { x, y }, {
      title,
      description,
      kind: nodeType,
      scope: '多集生产流程',
      statusLabel: '待接入',
    });
  };

  const handleAddAssetToCanvas = (kind: WorkflowAssetKind, item: WorkflowAssetItem, options: { sourceEpisode?: string; sourceEpisodeId?: string } = {}) => {
    const nodeCount = useCanvasStore.getState().nodes.length;
    const x = 350 + (nodeCount % 4) * 320;
    const y = 100 + Math.floor(nodeCount / 4) * 220;
    const sectionPosition = { x: x - CANVAS_SECTION_PADDING_X, y: y - CANVAS_SECTION_HEADER_HEIGHT };
    const sectionWidth = 396;
    const sectionHeight = CANVAS_SECTION_HEADER_HEIGHT + CANVAS_SINGLE_ASSET_NODE_HEIGHT + CANVAS_SECTION_PADDING_BOTTOM;
    const assetName = workflowAssetName(item) || '未命名资产';
    const sourceEpisodeTitle = options.sourceEpisode || selectedEpisode;
    const sourceEpisodeId = options.sourceEpisodeId || activeEpisodeId;
    const sectionId = addCanvasSection(addNode, sectionPosition, { width: sectionWidth, height: sectionHeight }, {
      title: `${workflowAssetKindLabel(kind)} · ${assetName}`,
      description: '从资产区放入画布',
      tone: kind === 'characters' ? 'emerald' : kind === 'scenes' ? 'sky' : 'amber',
      itemCount: 1,
      assetKind: kind,
      assetName,
      sectionKind: 'workflow-asset',
      sourceEpisode: sourceEpisodeTitle,
      sourceEpisodeId,
    });
    const nodePosition = {
      x: sectionPosition.x + CANVAS_SECTION_PADDING_X,
      y: sectionPosition.y + CANVAS_SECTION_HEADER_HEIGHT,
    };
    const image = normalizeReusableImageSource(item.generatedImageUrl || item.referenceImageUrl || '');
    const imageAssetId = item.generatedImageAssetId || item.referenceImageAssetId || '';
    const prompt = firstCleanAssetPromptSeed(item.visualPrompt, item.lockedVisualIdentity, item.description);
    const finalPrompt = stripLegacyCanvasAssetPromptScaffold(item.manualFinalPrompt) || buildWorkflowAssetFinalPromptForItem(kind, item, 0);
    const assetNodeData = {
      title: assetName,
      assetKind: kind,
      assetName,
      prompt,
      visualPrompt: cleanAssetPromptSeed(item.visualPrompt) || prompt,
      description: item.description || '',
      timeOfDay: item.timeOfDay || '',
      function: item.function || '',
      projectPromptContext,
    };

    if (kind === 'characters') {
      const nodeId = addNode('character', nodePosition, {
        name: assetName || '未命名角色',
        assetKind: kind,
        assetName: assetName || '未命名角色',
        traits: item.lockedVisualIdentity || item.description || item.role || item.fruitIdentity || '待设定',
        avatar: image,
        generatedImage: item.generatedImageUrl || '',
        generatedImageAssetId: imageAssetId,
        finalPrompt,
        visualPrompt: prompt,
        fruitIdentity: item.fruitIdentity || '',
        projectPromptContext,
        ratio: assetGenerationAspectRatio,
        resolution: assetGenerationResolution,
        sourceEpisode: sourceEpisodeTitle,
        sourceEpisodeId,
      });
      attachNodesToCanvasSection(sectionId, new Map([[nodeId, nodePosition]]));
    } else {
      const nodeId = addNode('generation', nodePosition, {
        ...assetNodeData,
        finalPrompt,
        status: image ? 'completed' : 'waiting',
        outputImage: image,
        outputImageAssetId: imageAssetId,
        size: assetGenerationAspectRatio,
        resolution: assetGenerationResolution,
        quality: 'high',
        format: 'png',
        sourceEpisode: sourceEpisodeTitle,
        sourceEpisodeId,
      });
      attachNodesToCanvasSection(sectionId, new Map([[nodeId, nodePosition]]));
    }
  };

  const handleAddLibraryAssetToCanvas = useCallback((entry: AssetLibraryItem) => {
    handleAddAssetToCanvas(entry.kind, entry.asset, {
      sourceEpisode: entry.episodeTitle,
      sourceEpisodeId: entry.episodeId,
    });
    showCanvasDropStatus(`已把 ${entry.episodeTitle} · ${entry.name} 放入当前画布。`);
  }, [handleAddAssetToCanvas, showCanvasDropStatus]);

  const loadMergedWorkflowAssets = async (): Promise<WorkflowAssets> => {
    if (projectUnavailable || !projectId || projectId === 'local') return workflowAssets;
    try {
      const [workflow, characters, scenes] = await Promise.all([
        apiClient.getProjectWorkflow(projectId, { episodeId: activeEpisodeId }),
        apiClient.listProjectCharacters(projectId).catch(() => []),
        apiClient.listProjectScenes(projectId).catch(() => []),
      ]);
      const merged = mergeWorkflowAssetsWithProjectRecords(
        workflow?.assets ?? workflowAssets,
        characters,
        scenes,
      );
      setWorkflowAssets(merged);
      if (workflow?.stageStatuses) setStageStatuses(workflow.stageStatuses);
      return merged;
    } catch {
      return workflowAssets;
    }
  };

  const handleSourceFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setSourceName(file.name);
      setSourceText(String(reader.result ?? ''));
      setActiveWorkflowStage('source');
      setActivePanel('workflow');
    };
    reader.readAsText(file);
  };

  const openAssetReferencePicker = (kind = assetUploadKind, name?: string) => {
    const assetName = (name ?? assetUploadName).trim();
    if (!assetName) {
      setAssetUploadStatus('先选择或填写资产名，再上传参考图。');
      return;
    }
    pendingAssetUploadRef.current = { kind, name: assetName };
    setAssetUploadKind(kind);
    setAssetUploadName(assetName);
    setAssetUploadStatus(`准备为 ${assetName} 上传参考图。`);
    assetImageFileRef.current?.click();
  };

  const handleUploadAssetReference = (kind: WorkflowAssetKind, item: WorkflowAssetItem) => {
    if (!item.name?.trim()) {
      setAssetUploadStatus('这个资产缺少名称，不能自动匹配。');
      return;
    }
    setActivePanel('assets');
    setActiveWorkflowStage('assets');
    openAssetReferencePicker(kind, item.name);
  };

  const handleUploadAudioReference = (item: WorkflowAssetItem) => {
    const assetName = workflowAssetName(item);
    if (!assetName) {
      setAssetUploadStatus('这个角色缺少名称，不能上传音频参考。');
      return;
    }
    setActivePanel('assets');
    setActiveWorkflowStage('assets');
    pendingAudioUploadRef.current = { mode: 'single', name: assetName };
    setAssetUploadStatus(`准备为 ${assetName} 上传角色音频参考。`);
    assetAudioFileRef.current?.click();
  };

  const handleBatchUploadCharacterAudioReferences = () => {
    if (projectUnavailable) {
      setAssetUploadStatus('当前项目不存在，无法上传角色音频。');
      return;
    }
    const characterNames = new Set(assetArray(workflowAssets, 'characters').map((item) => normalizeCompareText(workflowAssetName(item))).filter(Boolean));
    const missing = batchCharacterAudioTargets.filter((target) => !characterNames.has(normalizeCompareText(target.name))).map((target) => target.name);
    pendingAudioUploadRef.current = { mode: 'batch' };
    setActivePanel('assets');
    setActiveWorkflowStage('assets');
    setAssetUploadStatus(
      `准备批量上传角色音频：1 Bob，2 Chloe，3 Leo，4 Tiffany，5 Eugene。${missing.length ? `当前资产缺少：${missing.join('、')}，上传后会自动补齐。` : ''}`
    );
    assetAudioFileRef.current?.click();
  };

  const uploadCharacterAudioReferenceFile = async (assetName: string, file: File) => {
    const uploadKey = workflowAssetBusyKey('characters', `${assetName}:audio`);
    const local = await apiClient.uploadLocalFile({
      key: safeAudioUploadKey(projectId, file.name),
      file,
      contentType: file.type || 'audio/mpeg',
    });
    return apiClient.uploadCharacterReferenceAudio(projectId, {
      episodeId: activeEpisodeId,
      characterName: assetName,
      audioUrl: local.publicUrl,
      fileName: file.name,
      mimeType: local.contentType || file.type,
      sizeBytes: local.sizeBytes ?? file.size,
    }).finally(() => {
      setAssetUploadBusyKeys((current) => current.filter((key) => key !== uploadKey));
    });
  };

  const refreshCanvasAfterAssetReferenceChange = async () => {
    if (projectUnavailable || !projectId || projectId === 'local') return;
    try {
      canvasLoadedRef.current = false;
      const canvasState = useCanvasStore.getState();
      const hasUnsavedLocalChanges =
        canvasState.localRevision > canvasState.lastSavedRevision &&
        canvasState.activeProjectId === projectId &&
        canvasState.activeSceneId === activeCanvasSceneId;
      if (hasUnsavedLocalChanges) {
        try {
          await saveCanvasScene(projectId, activeCanvasSceneId);
        } catch (error) {
          console.warn('画布刷新前保存本地修改失败，继续重载画布', error);
        }
      }
      await loadCanvasScene(projectId, activeCanvasSceneId);
      canvasLoadedRef.current = true;
    } catch (error) {
      canvasLoadedRef.current = true;
      console.warn('画布刷新失败，可手动刷新页面查看最新画布', error);
    }
  };

  const uploadSingleCharacterAudioFile = async (assetName: string, file: File) => {
    const pending = pendingAudioUploadRef.current;
    if (!assetName) {
      setAssetUploadStatus('先选择角色，再上传音频参考。');
      return;
    }
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|ogg|opus|webm|flac)$/i.test(file.name)) {
      setAssetUploadStatus('请选择音频文件。');
      return;
    }
    const uploadKey = workflowAssetBusyKey('characters', `${assetName}:audio`);
    if (assetUploadBusyKeys.includes(uploadKey)) {
      setAssetUploadStatus(`${assetName} 的音频正在上传，请等待完成。`);
      return;
    }
    setAssetUploadBusyKeys((current) => current.includes(uploadKey) ? current : [...current, uploadKey]);
    setAssetUploadStatus(`正在上传 ${assetName} 的角色音频参考...`);
    try {
      const result = await uploadCharacterAudioReferenceFile(assetName, file);
      if (result.workflow) {
        setWorkflowAssets(result.workflow.assets ?? defaultWorkflowAssets());
        setStageStatuses(result.workflow.stageStatuses ?? {});
      } else {
        const remote = await apiClient.getProjectWorkflow(projectId, { episodeId: activeEpisodeId });
        if (remote) {
          setWorkflowAssets(remote.assets ?? defaultWorkflowAssets());
          setStageStatuses(remote.stageStatuses ?? {});
        }
      }
      await refreshCanvasAfterAssetReferenceChange();
      setAssetUploadStatus(`${assetName} 的角色音频参考已上传。后续视频节点会按台词角色自动带入。`);
    } catch (error) {
      setAssetUploadStatus(error instanceof Error ? error.message : '角色音频上传失败');
    } finally {
      if (
        pendingAudioUploadRef.current?.mode === 'single' &&
        normalizeCompareText(pendingAudioUploadRef.current.name) === normalizeCompareText(assetName)
      ) {
        pendingAudioUploadRef.current = null;
      }
    }
  };

  const batchAudioTargetForFile = (file: File): (typeof batchCharacterAudioTargets)[number] | null => {
    const base = file.name.replace(/\.[^.]+$/, '').trim().toLowerCase();
    const indexMatch = base.match(/(?:^|[^0-9])([1-5])(?:[^0-9]|$)/);
    if (indexMatch?.[1]) {
      return batchCharacterAudioTargets.find((target) => target.index === Number(indexMatch[1])) ?? null;
    }
    return batchCharacterAudioTargets.find((target) => target.aliases.some((alias) => base.includes(alias))) ?? null;
  };

  const uploadBatchCharacterAudioFiles = async (files: File[]) => {
    const audioFiles = files.filter((file) => file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|opus|webm|flac)$/i.test(file.name));
    if (audioFiles.length === 0) {
      setAssetUploadStatus('请选择音频文件。文件名需要包含 1-5 编号，或包含 Bob/Chloe/Leo/Tiffany/Eugene。');
      return;
    }
    const entries: Array<{ file: File; target: (typeof batchCharacterAudioTargets)[number] }> = [];
    const skipped: string[] = [];
    const seenTargets = new Set<number>();
    for (const file of audioFiles) {
      const target = batchAudioTargetForFile(file);
      if (!target || seenTargets.has(target.index) || assetUploadBusyKeys.includes(workflowAssetBusyKey('characters', `${target.name}:audio`))) {
        skipped.push(file.name);
        continue;
      }
      seenTargets.add(target.index);
      entries.push({ file, target });
    }
    if (entries.length === 0) {
      setAssetUploadStatus('没有匹配到可绑定音频。请把文件名改成 1、2、3、4、5 开头，或包含角色名。');
      return;
    }
    const busyKeys = entries.map((entry) => workflowAssetBusyKey('characters', `${entry.target.name}:audio`));
    setAssetUploadBusyKeys((current) => [...new Set([...current, ...busyKeys])]);
    setAssetUploadStatus(`正在批量上传 ${entries.length} 个角色音频...`);
    const succeeded: string[] = [];
    const failed: string[] = [];
    let latestWorkflow: WorkflowState | undefined;
    for (const entry of entries) {
      try {
        const result = await uploadCharacterAudioReferenceFile(entry.target.name, entry.file);
        if (result.workflow) latestWorkflow = result.workflow;
        succeeded.push(entry.target.name);
      } catch (error) {
        failed.push(`${entry.target.name}${error instanceof Error ? `：${error.message}` : ''}`);
      }
    }
    if (latestWorkflow) {
      setWorkflowAssets(latestWorkflow.assets ?? defaultWorkflowAssets());
      setStageStatuses(latestWorkflow.stageStatuses ?? {});
    } else {
      const remote = await apiClient.getProjectWorkflow(projectId, { episodeId: activeEpisodeId }).catch(() => null);
      if (remote) {
        setWorkflowAssets(remote.assets ?? defaultWorkflowAssets());
        setStageStatuses(remote.stageStatuses ?? {});
      }
    }
    await refreshCanvasAfterAssetReferenceChange();
    const missing = batchCharacterAudioTargets.filter((target) => !seenTargets.has(target.index)).map((target) => `${target.index}-${target.name}`);
    setAssetUploadStatus([
      succeeded.length ? `已绑定：${succeeded.join('、')}` : '',
      failed.length ? `失败：${failed.join('；')}` : '',
      missing.length ? `未收到：${missing.join('、')}` : '',
      skipped.length ? `未识别文件：${skipped.join('、')}` : '',
    ].filter(Boolean).join('。'));
  };

  const handleAssetAudioFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    if (projectUnavailable) {
      setAssetUploadStatus('当前项目不存在，无法上传角色音频。');
      return;
    }
    const pending = pendingAudioUploadRef.current;
    if (pending?.mode === 'batch' || files.length > 1) {
      pendingAudioUploadRef.current = null;
      await uploadBatchCharacterAudioFiles(files);
      return;
    }
    await uploadSingleCharacterAudioFile(pending?.mode === 'single' ? pending.name.trim() : '', files[0]);
  };

  const handleClearAudioReference = async (item: WorkflowAssetItem) => {
    const assetName = workflowAssetName(item);
    if (!assetName) {
      setAssetUploadStatus('这个角色缺少名称，不能取消音频参考。');
      return;
    }
    if (!item.referenceAudioUrl) {
      setAssetUploadStatus(`${assetName} 当前没有绑定音频参考。`);
      return;
    }
    if (projectUnavailable || !projectId || projectId === 'local') {
      setAssetUploadStatus('当前项目不存在，无法取消角色音频。');
      return;
    }
    const uploadKey = workflowAssetBusyKey('characters', `${assetName}:audio`);
    if (assetUploadBusyKeys.includes(uploadKey)) {
      setAssetUploadStatus(`${assetName} 的音频正在处理，请等待完成。`);
      return;
    }
    setAssetUploadBusyKeys((current) => current.includes(uploadKey) ? current : [...current, uploadKey]);
    setActivePanel('assets');
    setActiveWorkflowStage('assets');
    setAssetUploadStatus(`正在取消 ${assetName} 的角色音频参考...`);
    try {
      const result = await apiClient.clearCharacterReferenceAudio(projectId, {
        episodeId: activeEpisodeId,
        characterName: assetName,
      });
      setWorkflowAssets(result.workflow.assets ?? defaultWorkflowAssets());
      setStageStatuses(result.workflow.stageStatuses ?? {});
      await refreshCanvasAfterAssetReferenceChange();
      setAssetUploadStatus(`${assetName} 的角色音频参考已取消，历史音频文件仍保留。`);
    } catch (error) {
      setAssetUploadStatus(error instanceof Error ? error.message : '取消角色音频失败');
    } finally {
      setAssetUploadBusyKeys((current) => current.filter((key) => key !== uploadKey));
    }
  };

  const openCharacterPropPicker = (character: WorkflowAssetItem) => {
    const characterName = workflowAssetName(character);
    if (!characterName) {
      setAssetUploadStatus('这个角色缺少名称，不能绑定道具。');
      return;
    }
    setPropPickerCharacter(character);
    setPropGenerationPrompt('');
    setPropBindingStatus(null);
    setActivePanel('assets');
    setActiveWorkflowStage('assets');
  };

  const handleAssetReferenceFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (projectUnavailable) {
      setAssetUploadStatus('当前项目不存在，无法上传资产参考图。');
      return;
    }
    const pending = pendingAssetUploadRef.current;
    const uploadKind = pending?.kind ?? assetUploadKind;
    const assetName = (pending?.name || assetUploadName).trim();
    if (!assetName) {
      setAssetUploadStatus('先填写资产名，再上传参考图。');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setAssetUploadStatus('请选择图片文件。');
      return;
    }
    const uploadKey = workflowAssetBusyKey(uploadKind, assetName);
    if (assetUploadBusyKeys.includes(uploadKey)) {
      setAssetUploadStatus(`${assetName} 正在上传并识别，请等待完成。`);
      return;
    }
    setAssetUploadBusyKeys((current) => current.includes(uploadKey) ? current : [...current, uploadKey]);
    setAssetUploadStatus(`正在上传并识别 ${assetName} 的资产图...`);
    try {
      const local = await apiClient.uploadLocalFile({
        key: safeUploadKey(projectId, file.name, uploadKind),
        file,
        contentType: file.type || 'image/png',
      });
      const commonInput = {
        episodeId: activeEpisodeId,
        imageUrl: local.publicUrl,
        fileName: file.name,
        mimeType: local.contentType || file.type,
        sizeBytes: local.sizeBytes ?? file.size,
        aiModelId: assetUploadModelId || workflowAiModelId || undefined,
      };
      const result =
        uploadKind === 'characters'
          ? await apiClient.uploadCharacterReferenceImage(projectId, {
              characterName: assetName,
              ...commonInput,
            })
          : await apiClient.uploadWorkflowAssetReferenceImage(projectId, {
              episodeId: activeEpisodeId,
              assetKind: uploadKind,
              assetName,
              ...commonInput,
            });
      if (result.workflow) {
        setWorkflowAssets(result.workflow.assets ?? defaultWorkflowAssets());
        setStageStatuses(result.workflow.stageStatuses ?? {});
      } else {
        const remote = await apiClient.getProjectWorkflow(projectId, { episodeId: activeEpisodeId });
        if (remote) {
          setWorkflowAssets(remote.assets ?? defaultWorkflowAssets());
          setStageStatuses(remote.stageStatuses ?? {});
        }
      }
      await refreshCanvasAfterAssetReferenceChange();
      setAssetUploadStatus(
        result.analysisError
          ? `图片已保存，但识图失败：${result.analysisError}`
          : `${assetName} 的参考图已上传，资产信息已更新。`
      );
      setActiveWorkflowStage('assets');
      setActivePanel('assets');
      if (
        assetHistoryTarget &&
        assetHistoryTarget.kind === uploadKind &&
        normalizeCompareText(assetHistoryTarget.asset.name ?? '') === normalizeCompareText(assetName)
      ) {
        void handleOpenAssetHistory(uploadKind, { ...assetHistoryTarget.asset, name: assetName });
      }
    } catch (error) {
      setAssetUploadStatus(error instanceof Error ? error.message : '资产参考图上传失败');
    } finally {
      setAssetUploadBusyKeys((current) => current.filter((key) => key !== uploadKey));
      if (
        pendingAssetUploadRef.current &&
        pendingAssetUploadRef.current.kind === uploadKind &&
        normalizeCompareText(pendingAssetUploadRef.current.name) === normalizeCompareText(assetName)
      ) {
        pendingAssetUploadRef.current = null;
      }
    }
  };

  const handleOpenAssetHistory = async (kind: WorkflowAssetKind, item: WorkflowAssetItem, variantFilter: 'all' | 'with-props' = 'all') => {
    const assetName = item.name?.trim();
    if (!assetName) {
      setAssetHistoryStatus('这个资产缺少名称，无法读取历史图片。');
      return;
    }
    if (projectUnavailable) {
      setAssetHistoryStatus('当前项目不存在，无法读取资产历史。');
      return;
    }
    setAssetHistoryTarget({ kind, asset: item });
    setAssetHistoryVariantFilter(variantFilter);
    setAssetHistoryLoading(true);
    setAssetHistoryStatus(null);
    try {
      const result = await apiClient.listWorkflowAssetImages(projectId, { assetKind: kind, assetName, episodeId: activeEpisodeId });
      setAssetHistoryItems(result.images);
      const filteredCount = variantFilter === 'with-props' ? result.images.filter(assetHistoryImageIsWithProps).length : result.images.length;
      setAssetHistoryStatus(filteredCount > 0 ? null : variantFilter === 'with-props' ? `${assetName} 暂无已生成的道具版图片。请先用小包裹入口生成。` : `${assetName} 暂无历史图片。`);
      setActiveWorkflowStage('assets');
      setActivePanel('assets');
    } catch (error) {
      setAssetHistoryItems([]);
      setAssetHistoryStatus(error instanceof Error ? error.message : '资产历史图片加载失败');
    } finally {
      setAssetHistoryLoading(false);
    }
  };

  const handleLoadAssetHistoryImages = async (kind: AssetHistoryLoadKind = 'all') => {
    if (assetHistoryLoadBusy) return;
    if (projectUnavailable || !projectId || projectId === 'local') {
      setAssetGenerationStatus('当前项目不存在，无法加载历史图片。');
      return;
    }
    const targetKinds: WorkflowAssetKind[] = kind === 'all' ? ['characters', 'scenes', 'props'] : [kind];
    const candidates = targetKinds.flatMap((assetKind) => assetArray(workflowAssets, assetKind)
      .map((asset) => ({ kind: assetKind, asset, name: workflowAssetName(asset), currentUrl: workflowAssetImageUrl(asset) }))
      .filter((item) => item.name));
    if (candidates.length === 0) {
      setAssetGenerationStatus('当前资产区没有可匹配的资产。');
      return;
    }

    setAssetHistoryLoadBusy(true);
    setAssetGenerationStatus(`正在为 ${candidates.length} 个资产重新匹配可用历史图...`);
    const reachableChecks = await Promise.all(candidates.map(async (target) => ({
      ...target,
      currentReachable: target.currentUrl ? await browserImageLooksReachable(target.currentUrl) : false,
    })));
    const targets = reachableChecks;
    setAssetGenerationBusyKeys((current) => Array.from(new Set([
      ...current,
      ...targets.map((target) => workflowAssetBusyKey(target.kind, target.name)),
    ])));
    const missingOrBrokenCount = targets.filter((target) => !target.currentReachable).length;
    setAssetGenerationStatus(`正在查找可用历史图 ${targets.length} 个资产${missingOrBrokenCount ? `，其中 ${missingOrBrokenCount} 个当前图缺失或失效` : ''}...`);
    try {
      let latestWorkflow: WorkflowState | null = null;
      let matched = 0;
      let scanned = 0;
      const missed: string[] = [];
      for (const target of targets) {
        scanned += 1;
        setAssetGenerationStatus(`正在验证历史图片 ${scanned}/${targets.length}：${target.name}`);
        const history = await apiClient.listWorkflowAssetImages(projectId, {
          assetKind: target.kind,
          assetName: target.name,
          episodeId: activeEpisodeId,
        });
        const image = await chooseReachableAssetHistoryImage(target.kind, history.images);
        if (!image) {
          missed.push(target.name);
          continue;
        }
        const selected = await apiClient.selectWorkflowAssetImage(projectId, {
          episodeId: activeEpisodeId,
          assetKind: target.kind,
          assetName: target.name,
          assetId: image.id,
        });
        latestWorkflow = selected.workflow;
        matched += 1;
      }
      if (latestWorkflow) {
        setWorkflowAssets(latestWorkflow.assets ?? defaultWorkflowAssets());
        setStageStatuses(latestWorkflow.stageStatuses ?? {});
        setWorkflowDraftProjectId(`${projectId}:${latestWorkflow.episodeId || activeEpisodeId}`);
      }
      if (matched > 0) {
        await refreshCanvasAfterAssetReferenceChange();
      }
      setAssetGenerationStatus(matched > 0
        ? `已从可访问历史图片重新匹配 ${matched}/${targets.length} 个资产，并同步画布引用。${missed.length ? `未匹配：${missed.slice(0, 6).join('、')}${missed.length > 6 ? '等' : ''}` : ''}`
        : `没有匹配到可访问的历史图片。${missed.length ? `检查过：${missed.slice(0, 6).join('、')}${missed.length > 6 ? '等' : ''}` : ''}`);
    } catch (error) {
      setAssetGenerationStatus(error instanceof Error ? error.message : '历史图片加载失败');
    } finally {
      setAssetGenerationBusyKeys((current) => current.filter((key) => !targets.some((target) => key === workflowAssetBusyKey(target.kind, target.name))));
      setAssetHistoryLoadBusy(false);
    }
  };

  const saveCharacterPropBinding = async (character: WorkflowAssetItem, prop: WorkflowAssetItem, shouldBind: boolean) => {
    const characterName = workflowAssetName(character);
    const propName = workflowAssetName(prop);
    if (!characterName || !propName) return;
    if (projectUnavailable) {
      setPropBindingStatus('当前项目不存在，无法保存道具绑定。');
      return;
    }
    setPropBindingBusy(true);
    setPropBindingStatus(`${shouldBind ? '正在绑定' : '正在取消绑定'} ${propName}...`);
    try {
      const characters = assetArray(workflowAssets, 'characters');
      let matchedCharacter = false;
      const nextCharacters = characters.map((current) => {
        if (normalizeCompareText(workflowAssetName(current)) !== normalizeCompareText(characterName)) return current;
        matchedCharacter = true;
        const boundPropNames = nextManualBoundPropNames(current, propName, shouldBind);
        return {
          ...current,
          boundPropNames,
        };
      });
      if (!matchedCharacter) {
        const boundPropNames = nextManualBoundPropNames(character, propName, shouldBind);
        nextCharacters.push({
          ...character,
          name: characterName,
          boundPropNames,
        });
      }
      const nextAssets: WorkflowAssets = {
        ...workflowAssets,
        characters: nextCharacters,
        scenes: assetArray(workflowAssets, 'scenes'),
        props: assetArray(workflowAssets, 'props'),
      };
      const draft = { episodeId: activeEpisodeId, sourceText, sourceName, selectedEpisode, breakdownScenes, clips, assets: nextAssets, stageStatuses };
      setWorkflowAssets(nextAssets);
      setPropPickerCharacter((current) => {
        if (!current || normalizeCompareText(workflowAssetName(current)) !== normalizeCompareText(characterName)) return current;
        return nextCharacters.find((item) => normalizeCompareText(workflowAssetName(item)) === normalizeCompareText(characterName)) ?? current;
      });
      const saved = await apiClient.saveProjectWorkflow(projectId, draft, { episodeId: activeEpisodeId });
      if (saved) {
        setWorkflowAssets(saved.assets ?? nextAssets);
        setStageStatuses(saved.stageStatuses ?? stageStatuses);
        const savedCharacter = assetArray(saved.assets ?? nextAssets, 'characters')
          .find((item) => normalizeCompareText(workflowAssetName(item)) === normalizeCompareText(characterName));
        if (savedCharacter) setPropPickerCharacter(savedCharacter);
      }
      setPropBindingStatus(shouldBind ? `${propName} 已绑定到 ${characterName}。` : `${propName} 已从 ${characterName} 取消绑定。`);
    } catch (error) {
      setPropBindingStatus(error instanceof Error ? error.message : '道具绑定保存失败');
    } finally {
      setPropBindingBusy(false);
    }
  };

  const handleSelectAssetHistoryImage = async (image: WorkflowAssetImageHistoryItem) => {
    const target = assetHistoryTarget;
    const assetName = target?.asset.name?.trim();
    if (!target || !assetName || !image.id) return;
    setAssetHistoryLoading(true);
    setAssetHistoryStatus(`正在把 ${assetName} 的历史图设为当前图...`);
    try {
      const result = await apiClient.selectWorkflowAssetImage(projectId, {
        episodeId: activeEpisodeId,
        assetKind: target.kind,
        assetName,
        assetId: image.id,
      });
      setWorkflowAssets(result.workflow.assets ?? defaultWorkflowAssets());
      setStageStatuses(result.workflow.stageStatuses ?? {});
      setAssetHistoryTarget((current) => current ? {
        ...current,
        asset: assetArray(result.workflow.assets ?? defaultWorkflowAssets(), target.kind)
          .find((candidate) => normalizeCompareText(candidate.name ?? '') === normalizeCompareText(assetName)) ?? current.asset,
      } : current);
      const refreshed = await apiClient.listWorkflowAssetImages(projectId, { assetKind: target.kind, assetName, episodeId: activeEpisodeId });
      setAssetHistoryItems(refreshed.images);
      await refreshCanvasAfterAssetReferenceChange();
      setAssetHistoryStatus(`${assetName} 当前图已切换。`);
    } catch (error) {
      setAssetHistoryStatus(error instanceof Error ? error.message : '资产历史图切换失败');
    } finally {
      setAssetHistoryLoading(false);
    }
  };

  const handleClearAssetCurrentImage = async (kind: WorkflowAssetKind, item: WorkflowAssetItem) => {
    const assetName = item.name?.trim();
    if (!assetName) return;
    if (isAssetGenerationBusy(kind, item) || isAssetUploadBusy(kind, item)) return;
    if (projectUnavailable) {
      setAssetGenerationStatus('当前项目不存在，无法取消当前资产图。');
      return;
    }
    const busyKey = workflowAssetBusyKey(kind, assetName);
    setAssetGenerationBusyKeys((current) => current.includes(busyKey) ? current : [...current, busyKey]);
    setAssetGenerationStatus(`正在取消 ${assetName} 的当前图...`);
    if (
      assetHistoryTarget &&
      assetHistoryTarget.kind === kind &&
      normalizeCompareText(assetHistoryTarget.asset.name ?? '') === normalizeCompareText(assetName)
    ) {
      setAssetHistoryLoading(true);
      setAssetHistoryStatus(`正在取消 ${assetName} 的当前图...`);
    }
    try {
      const result = await apiClient.clearWorkflowAssetImage(projectId, {
        episodeId: activeEpisodeId,
        assetKind: kind,
        assetName,
      });
      setWorkflowAssets(result.workflow.assets ?? defaultWorkflowAssets());
      setStageStatuses(result.workflow.stageStatuses ?? {});
      setWorkflowDraftProjectId(`${projectId}:${result.workflow.episodeId || activeEpisodeId}`);
      await refreshCanvasAfterAssetReferenceChange();
      setAssetGenerationStatus(`${assetName} 当前图已取消，历史图片仍保留。`);
      if (
        assetHistoryTarget &&
        assetHistoryTarget.kind === kind &&
        normalizeCompareText(assetHistoryTarget.asset.name ?? '') === normalizeCompareText(assetName)
      ) {
        const refreshed = await apiClient.listWorkflowAssetImages(projectId, { assetKind: kind, assetName, episodeId: activeEpisodeId });
        setAssetHistoryItems(refreshed.images);
        setAssetHistoryTarget((current) => current ? {
          ...current,
          asset: assetArray(result.workflow.assets ?? defaultWorkflowAssets(), kind)
            .find((candidate) => normalizeCompareText(candidate.name ?? '') === normalizeCompareText(assetName)) ?? current.asset,
        } : current);
        setAssetHistoryStatus(`${assetName} 当前图已取消，历史图片仍保留。`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '取消当前资产图失败';
      setAssetGenerationStatus(message);
      if (
        assetHistoryTarget &&
        assetHistoryTarget.kind === kind &&
        normalizeCompareText(assetHistoryTarget.asset.name ?? '') === normalizeCompareText(assetName)
      ) {
        setAssetHistoryStatus(message);
      }
    } finally {
      setAssetGenerationBusyKeys((current) => current.filter((key) => key !== busyKey));
      if (
        assetHistoryTarget &&
        assetHistoryTarget.kind === kind &&
        normalizeCompareText(assetHistoryTarget.asset.name ?? '') === normalizeCompareText(assetName)
      ) {
        setAssetHistoryLoading(false);
      }
    }
  };

  const handleDeleteAssetHistoryImage = async (image: WorkflowAssetImageHistoryItem) => {
    const target = assetHistoryTarget;
    const assetName = target?.asset.name?.trim();
    if (!target || !assetName || !image.id) return;
    if (!window.confirm(`删除「${assetName}」的这张历史图片？${image.isCurrent ? ' 这张是当前图，删除后会清空当前图。' : ''}`)) return;
    setAssetHistoryLoading(true);
    setAssetHistoryStatus(`正在删除 ${assetName} 的历史图...`);
    try {
      const result = await apiClient.deleteWorkflowAssetImage(projectId, {
        episodeId: activeEpisodeId,
        assetKind: target.kind,
        assetName,
        assetId: image.id,
      });
      setWorkflowAssets(result.workflow.assets ?? defaultWorkflowAssets());
      setStageStatuses(result.workflow.stageStatuses ?? {});
      const refreshed = await apiClient.listWorkflowAssetImages(projectId, { assetKind: target.kind, assetName, episodeId: activeEpisodeId });
      setAssetHistoryItems(refreshed.images);
      if (result.removedCurrent) {
        await refreshCanvasAfterAssetReferenceChange();
      }
      setAssetHistoryStatus(result.removedCurrent ? `${assetName} 历史图已删除，当前图已清空。` : `${assetName} 历史图已删除。`);
    } catch (error) {
      setAssetHistoryStatus(error instanceof Error ? error.message : '资产历史图删除失败');
    } finally {
      setAssetHistoryLoading(false);
    }
  };

  const handleRemoveWorkflowAsset = async (kind: WorkflowAssetKind, item: WorkflowAssetItem) => {
    const assetName = item.name?.trim();
    if (!assetName) return;
    if (isAssetGenerationBusy(kind, item)) return;
    if (projectUnavailable) {
      setAssetGenerationStatus('当前项目不存在，无法移除资产。');
      return;
    }
    if (!window.confirm(`从当前项目资产库移除「${assetName}」？历史图片不会删除。`)) return;
    setAssetGenerationStatus(`正在移除 ${assetName}...`);
    try {
      const result = await apiClient.removeWorkflowAsset(projectId, { episodeId: activeEpisodeId, assetKind: kind, assetName });
      setWorkflowAssets(result.workflow.assets ?? defaultWorkflowAssets());
      setStageStatuses(result.workflow.stageStatuses ?? {});
      if (
        assetHistoryTarget &&
        assetHistoryTarget.kind === kind &&
        normalizeCompareText(assetHistoryTarget.asset.name ?? '') === normalizeCompareText(assetName)
      ) {
        setAssetHistoryTarget(null);
        setAssetHistoryItems([]);
        setAssetHistoryStatus(null);
      }
      setAssetGenerationStatus(result.removed ? `${assetName} 已从当前资产库移除。` : `${assetName} 不在当前资产库中。`);
    } catch (error) {
      setAssetGenerationStatus(error instanceof Error ? error.message : '资产移除失败');
    }
  };

  const buildWorkflowAssetFinalPromptForItem = useCallback((kind: WorkflowAssetKind, item: WorkflowAssetItem, referenceCount = 0, options: { variant?: 'clean' | 'with-props'; customPrompt?: string; boundPropNames?: string[]; sceneImageMode?: GenerateAssetImageOptions['sceneImageMode'] } = {}) => {
    const assetName = workflowAssetName(item);
    const assetPrompt = firstCleanAssetPromptSeed(item.visualPrompt, item.lockedVisualIdentity, item.description);
    return buildCanvasAssetFinalPrompt(kind, {
      name: assetName,
      assetName,
      role: item.role,
      visualPrompt: assetPrompt,
      prompt: assetPrompt,
      customGenerationPrompt: options.customPrompt || undefined,
      traits: item.lockedVisualIdentity || item.description || item.role || item.fruitIdentity || '',
      description: item.description,
      fruitIdentity: item.fruitIdentity,
      signatureProps: item.signatureProps,
      boundPropNames: options.boundPropNames ?? selectedPropNamesFromCharacter(item),
      primaryLook: item.primaryLook,
      habitualActions: item.habitualActions,
      variant: options.variant,
      timeOfDay: item.timeOfDay,
      function: item.function,
      canonicalSceneId: item.canonicalSceneId,
      sceneVisualLock: item.sceneVisualLock,
      sceneZone: item.sceneZone,
      sceneAnchors: item.sceneAnchors,
      sceneImageMode: kind === 'scenes' ? options.sceneImageMode : undefined,
    }, referenceCount, projectPromptContext);
  }, [projectPromptContext]);

  const handleUpdateWorkflowAssetPrompt = async (kind: WorkflowAssetKind, item: WorkflowAssetItem, prompt: string) => {
    const assetName = workflowAssetName(item);
    if (!assetName) return;
    const cleanedPrompt = prompt.trim();
    const currentItems = assetArray(workflowAssets, kind);
    const nextItems = currentItems.map((asset) => {
      if (normalizeCompareText(workflowAssetName(asset)) !== normalizeCompareText(assetName)) return asset;
      return {
        ...asset,
        manualFinalPrompt: cleanedPrompt,
      };
    });
    const nextAssets: WorkflowAssets = {
      ...workflowAssets,
      characters: kind === 'characters' ? nextItems : assetArray(workflowAssets, 'characters'),
      scenes: kind === 'scenes' ? nextItems : assetArray(workflowAssets, 'scenes'),
      props: kind === 'props' ? nextItems : assetArray(workflowAssets, 'props'),
    };
    setWorkflowAssets(nextAssets);
    setAssetGenerationStatus(`正在保存 ${assetName} 的完整生图提示词...`);
    if (projectUnavailable || !projectId || projectId === 'local') {
      setAssetGenerationStatus(`${assetName} 的完整生图提示词已更新到当前会话。`);
      return;
    }
    try {
      const draft = { episodeId: activeEpisodeId, sourceText, sourceName, selectedEpisode, breakdownScenes, clips, assets: nextAssets, stageStatuses };
      const saved = await apiClient.saveProjectWorkflow(projectId, draft, { episodeId: activeEpisodeId });
      if (saved) {
        setWorkflowAssets(saved.assets ?? nextAssets);
        setStageStatuses(saved.stageStatuses ?? stageStatuses);
      }
      setAssetGenerationStatus(`${assetName} 的完整生图提示词已保存。`);
    } catch (error) {
      setAssetGenerationStatus(error instanceof Error ? error.message : '完整生图提示词保存失败');
      setWorkflowAssets(workflowAssets);
      throw error;
    }
  };

  const handleGenerateAssetImage = async (kind: WorkflowAssetKind, item: WorkflowAssetItem, options: GenerateAssetImageOptions = {}) => {
    const assetName = item.name?.trim();
    if (!assetName) return;
    const busyKey = workflowAssetBusyKey(kind, assetName);
    const variant = options.variant === 'with-props' ? 'with-props' : 'clean';
    const variantLabel = kind === 'characters' && variant === 'with-props' ? '道具版' : '';
    const isPropVariant = kind === 'characters' && variant === 'with-props';
    const setGenerationMessage = (message: string) => {
      setAssetGenerationStatus(message);
      if (isPropVariant) setPropBindingStatus(message);
    };
    if (assetGenerationBusyKeys.includes(busyKey)) {
      setGenerationMessage(`${assetName}${variantLabel ? ` ${variantLabel}` : ''}资产图正在生成中，请等待完成后再重试。`);
      return;
    }
    if (projectUnavailable) {
      setGenerationMessage('当前项目不存在，无法生成资产图。');
      return;
    }
    const explicitReferenceImageUrl = publicImageUrl(options.referenceImageUrl);
    const currentReferenceImageUrl = publicImageUrl(item.referenceImageUrl) || publicImageUrl(item.generatedImageUrl);
    const shouldUseCurrentReference = Boolean(options.useCurrentReference && !explicitReferenceImageUrl);
    if (shouldUseCurrentReference && !currentReferenceImageUrl) {
      setGenerationMessage(`${assetName} 还没有当前参考图，无法参考生成。`);
      return;
    }
    const explicitReferenceUrls = [
      explicitReferenceImageUrl,
      ...(options.extraReferenceImageUrls ?? []).map(publicImageUrl),
    ].filter(Boolean);
    const linkedPropRefs = kind === 'characters' && variant === 'with-props' ? findCharacterPropReferences(item, workflowAssets) : [];
    const linkedPropUrls = linkedPropRefs.map((reference) => publicImageUrl(reference.url)).filter(Boolean);
    const referenceImageUrls = [
      ...explicitReferenceUrls,
      ...(shouldUseCurrentReference ? [currentReferenceImageUrl] : []),
      ...linkedPropUrls,
    ].filter((url, index, urls) => Boolean(url) && urls.indexOf(url) === index);
    if (variant === 'with-props') {
      if (!currentReferenceImageUrl && !explicitReferenceImageUrl) {
        setGenerationMessage(`${assetName} 需要先有一张角色图，才能生成道具版。`);
        return;
      }
      if (linkedPropRefs.length === 0 || linkedPropUrls.length === 0) {
        setGenerationMessage(`${assetName} 没有找到已选择且有图片的道具。请先上传/生成对应道具图，并在小包裹面板里点选要合成的道具。`);
        return;
      }
    }
    setAssetGenerationBusyKeys((current) => current.includes(busyKey) ? current : [...current, busyKey]);
    const modeLabel = explicitReferenceImageUrl ? '参考选中历史图' : shouldUseCurrentReference ? '参考当前图' : '全新';
    const propLabel = linkedPropRefs.length ? `，合成道具：${linkedPropRefs.map((reference) => reference.name).join('、')}` : '';
    setGenerationMessage(`正在${modeLabel}生成 ${assetName}${variantLabel ? ` ${variantLabel}` : ''}资产图${propLabel}... ${assetGenerationAspectRatio} / ${assetGenerationResolution.toUpperCase()}`);
    try {
      const customPrompt = options.customPrompt?.trim();
      const useExactCustomPrompt = Boolean(options.preservePromptExact && customPrompt);
      const manualFinalPrompt = stripLegacyCanvasAssetPromptScaffold(item.manualFinalPrompt);
      const useManualFinalPrompt = Boolean(!useExactCustomPrompt && manualFinalPrompt);
      const referenceCount = referenceImageUrls.length;
      const sceneLayoutInstruction = kind === 'scenes' ? sceneImageModeInstruction(options.sceneImageMode) : '';
      const prompt = useExactCustomPrompt
        ? customPrompt
        : useManualFinalPrompt
          ? [manualFinalPrompt, sceneLayoutInstruction].filter(Boolean).join('\n\n')
          : buildWorkflowAssetFinalPromptForItem(kind, item, referenceCount, {
              variant,
              sceneImageMode: kind === 'scenes' ? options.sceneImageMode : undefined,
              customPrompt: customPrompt || undefined,
              boundPropNames: variant === 'with-props' ? linkedPropRefs.map((reference) => reference.name) : selectedPropNamesFromCharacter(item),
            });
      if (!isCanvasPromptWithinApiLimit(prompt)) {
        setGenerationMessage(canvasPromptTooLongError('image', prompt.length));
        return;
      }
      const result = await apiClient.generateWorkflowAssetImage(projectId, {
        episodeId: activeEpisodeId,
        assetKind: kind,
        assetName,
        prompt,
        usePromptAsFinal: true,
        preservePromptExact: useExactCustomPrompt || useManualFinalPrompt,
        variant,
        aiModelId: assetGenerationModelId || undefined,
        size: assetGenerationAspectRatio,
        useCurrentReference: false,
        referenceImageUrls: referenceImageUrls.length ? referenceImageUrls : undefined,
        writeBackToAsset: variant === 'with-props' ? false : undefined,
        parameters: { resolution: assetGenerationResolution, quality: 'high', format: 'png' },
      });
      setWorkflowAssets(result.workflow.assets ?? defaultWorkflowAssets());
      setStageStatuses(result.workflow.stageStatuses ?? {});
      if (variant !== 'with-props') {
        await refreshCanvasAfterAssetReferenceChange();
      }
      setGenerationMessage(variant === 'with-props'
        ? `${assetName} 道具版资产图已生成到历史图。需要使用时点“道具版”选择并设为当前图。${assetGenerationAspectRatio} / ${assetGenerationResolution.toUpperCase()}`
        : `${assetName}资产图已生成并写回资产，可在历史图中切换当前图。${assetGenerationAspectRatio} / ${assetGenerationResolution.toUpperCase()}`);
      if (
        assetHistoryTarget &&
        assetHistoryTarget.kind === kind &&
        normalizeCompareText(assetHistoryTarget.asset.name ?? '') === normalizeCompareText(assetName)
      ) {
        const refreshed = await apiClient.listWorkflowAssetImages(projectId, { assetKind: kind, assetName, episodeId: activeEpisodeId });
        setAssetHistoryItems(refreshed.images);
      }
    } catch (error) {
      setGenerationMessage(error instanceof Error ? error.message : '资产图生成失败');
    } finally {
      setAssetGenerationBusyKeys((current) => current.filter((key) => key !== busyKey));
    }
  };

  const applyWorkflowBreakdownResult = async (
    workflow: WorkflowState,
    options: {
      stage: 'assets' | 'storyboard';
      assetsFallback: WorkflowAssets;
    },
  ) => {
    const scenes = workflow.breakdownScenes as BreakdownScene[];
    const workflowEpisodeId = workflow.episodeId || activeEpisodeId;
    applyWorkflowSnapshot(workflow, {
      setEpisodeList,
      setActiveEpisodeId,
      setSourceText,
      setSourceName,
      setSelectedEpisode,
      setBreakdownScenes,
      setClips,
      setWorkflowAssets,
      setStageStatuses,
    });
    setWorkflowProgressText('');
    setWorkflowDraftProjectId(`${projectId}:${workflowEpisodeId}`);
    setActiveWorkflowStage(options.stage === 'assets' ? 'assets' : 'storyboard');
    showCanvasDropStatus(
      options.stage === 'assets'
        ? `已完成资产提取：可按需要为角色、场景、道具生成或上传资产图，也可以直接进入分镜脚本。`
        : `已重新拆解分镜：${workflow.clips?.length ?? 0} 个 Clip、${scenes.length} 条分镜。请确认分镜后再生成视频提示词并同步画布。`,
    );
  };

  const recoverWorkflowBreakdownAfterRequestError = async (
    error: unknown,
    options: WorkflowBreakdownRecoveryOptions,
  ) => {
    if (!shouldRecoverWorkflowAfterRequestError(error)) return false;
    try {
      const remote = await apiClient.getProjectWorkflow(projectId, { episodeId: activeEpisodeId });
      const hasCompletedResult = options.stage === 'assets'
        ? workflowHasAssetResult(remote)
        : workflowHasBreakdownResult(remote);
      if (hasCompletedResult && workflowRunCompletedAfter(remote, options.startedAtMs)) {
        await applyWorkflowBreakdownResult(remote, options);
        workflowBreakdownRecoveryRef.current = null;
        setWorkflowError(null);
        showCanvasDropStatus(options.stage === 'assets' ? '后端已完成资产提取，已从最新结果恢复到资产阶段。' : '后端已完成拆解，已从最新结果恢复到分镜阶段。');
        return true;
      }
      if (remote && workflowHasRunningStage(remote.stageStatuses) && workflowRunStartedAfter(remote, options.startedAtMs)) {
        workflowBreakdownRecoveryRef.current = options;
        applyWorkflowSnapshot(remote, {
          setEpisodeList,
          setActiveEpisodeId,
          setSourceText,
          setSourceName,
          setSelectedEpisode,
          setBreakdownScenes,
          setClips,
          setWorkflowAssets,
          setStageStatuses,
        });
        setWorkflowProgressText(workflowRunProgressText(remote) || (options.stage === 'assets' ? '资产提取仍在后端运行，请等待远端结果。' : '分镜拆解仍在后端运行，请等待远端结果。'));
        setWorkflowDraftProjectId(`${projectId}:${remote.episodeId || activeEpisodeId}`);
        setWorkflowError(null);
        showCanvasDropStatus('后端已收到拆解请求，前端连接中断后将继续等待远端结果。');
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const handleRunBreakdown = async () => {
    if (!sourceText.trim() || workflowRunning || workflowInferAllRunning || workflowHasRunningStage(stageStatuses)) return;
    if (projectUnavailable) {
      setWorkflowError('当前项目不存在，无法运行 AI 智能拆解。请返回「我的项目」重新进入真实项目。');
      return;
    }
    const startedAtMs = Date.now();
    setWorkflowRunning(true);
    setWorkflowError(null);
    setWorkflowProgressText('正在提交资产提取任务...');
    setStageStatuses((current) => ({ ...current, assets: 'running', storyboard: 'idle' }));
    workflowBreakdownRecoveryRef.current = {
      stage: 'assets',
      startedAtMs,
      assetsFallback: defaultWorkflowAssets(),
    };

    try {
      const result = await apiClient.runProjectWorkflow(projectId, {
        episodeId: activeEpisodeId,
        stage: 'assets',
        sourceText,
        sourceName,
        selectedEpisode,
        aiModelId: workflowAiModelId || undefined,
      });
      await applyWorkflowBreakdownResult(result.workflow, {
        stage: 'assets',
        assetsFallback: defaultWorkflowAssets(),
      });
      workflowBreakdownRecoveryRef.current = null;
      setWorkflowProgressText('');
    } catch (error) {
      const recovered = await recoverWorkflowBreakdownAfterRequestError(error, {
        stage: 'assets',
        startedAtMs,
        assetsFallback: defaultWorkflowAssets(),
      });
      if (recovered) return;
      workflowBreakdownRecoveryRef.current = null;
      setStageStatuses((current) => ({ ...current, assets: 'failed', storyboard: 'idle' }));
      setWorkflowError(error instanceof Error ? error.message : '提取资产失败');
    } finally {
      setWorkflowRunning(false);
    }
  };

  const handleRerunStoryboard = async () => {
    if (!sourceText.trim() || workflowRunning || workflowInferAllRunning || workflowHasRunningStage(stageStatuses)) return;
    if (projectUnavailable) {
      setWorkflowError('当前项目不存在，无法重新拆解分镜脚本。请返回「我的项目」重新进入真实项目。');
      return;
    }
    const assetReadiness = workflowAssetImageReadiness(workflowAssets);
    if (assetReadiness.total === 0) {
      setWorkflowError('请先提取角色、场景、道具资产后再拆分镜。');
      setActiveWorkflowStage('assets');
      setActivePanel('workflow');
      return;
    }
    const startedAtMs = Date.now();
    setWorkflowRunning(true);
    setWorkflowError(null);
    setWorkflowProgressText('正在提交分镜拆解任务...');
    setStageStatuses((current) => ({ ...current, source: 'done', storyboard: 'running' }));
    workflowBreakdownRecoveryRef.current = {
      stage: 'storyboard',
      startedAtMs,
      assetsFallback: workflowAssets,
    };

    try {
      const result = await apiClient.runProjectWorkflow(projectId, {
        episodeId: activeEpisodeId,
        stage: 'storyboard',
        sourceText,
        sourceName,
        selectedEpisode,
        aiModelId: workflowAiModelId || undefined,
      });
      await applyWorkflowBreakdownResult(result.workflow, {
        stage: 'storyboard',
        assetsFallback: workflowAssets,
      });
      workflowBreakdownRecoveryRef.current = null;
      setWorkflowProgressText('');
    } catch (error) {
      const recovered = await recoverWorkflowBreakdownAfterRequestError(error, {
        stage: 'storyboard',
        startedAtMs,
        assetsFallback: workflowAssets,
      });
      if (recovered) return;
      workflowBreakdownRecoveryRef.current = null;
      setStageStatuses((current) => ({ ...current, storyboard: 'failed' }));
      setWorkflowError(error instanceof Error ? error.message : '分镜脚本重新拆解失败');
    } finally {
      setWorkflowRunning(false);
    }
  };

  const handleSyncEpisodeBoardsToCanvas = useCallback(async (override?: EpisodeCanvasSyncRequest) => {
    setActivePanel(null);
    showCanvasDropStatus('正在同步本集故事板和视频板到画布...');
    try {
      const targetEpisodeId = override?.episodeId ?? activeEpisodeId;
      const generationStrategy = projectGenerationStrategy(currentProject);
      if (projectId && projectId !== 'local' && !override) {
        const remoteSync = await apiClient.syncEpisodeCanvas(projectId, { episodeId: targetEpisodeId, generationStrategy });
        applyRemoteCanvasScene(remoteSync);
        if (remoteSync.workflow) {
          applyWorkflowSnapshot(remoteSync.workflow, {
            setEpisodeList,
            setActiveEpisodeId,
            setSourceText,
            setSourceName,
            setSelectedEpisode,
            setBreakdownScenes,
            setClips,
            setWorkflowAssets,
            setStageStatuses,
          });
          setWorkflowDraftProjectId(`${projectId}:${remoteSync.workflow.episodeId || targetEpisodeId}`);
        }
        showCanvasDropStatus(`已从后端同步 ${remoteSync.storyboardCount} 个图片分镜故事板和 ${remoteSync.videoCount} 个视频板到画布，恢复 ${remoteSync.recoveredStoryboardCount} 张已生成故事板图，未自动生成。`);
        window.setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 0);
        return;
      }
      const targetClips = override?.clips ?? clips;
      const targetScenes = override?.scenes ?? breakdownScenes;
      const targetEpisode = override?.episode ?? selectedEpisode;
      if (targetClips.length === 0) {
        showCanvasDropStatus('当前集还没有 Clip，无法同步故事板和视频板。');
        return;
      }
      const targetAssets = override?.assets ?? await loadMergedWorkflowAssets();
      let latestStoryboardAssetReferences = storyboardAssetReferences;
      let latestBlockedStoryboardImageUrls = blockedStoryboardImageUrls;
      if (override?.refreshRecords && projectId && projectId !== 'local') {
        try {
          const latestRecords = await apiClient.listGenerationRecords(projectId, { limit: 300, compact: true });
          const targetEpisodeId = override?.episodeId ?? activeEpisodeId;
          const filteredRecords = latestRecords.filter((record) => generationRecordBelongsToEpisode(record, targetEpisodeId, targetEpisode));
          setGenerationRecords(filteredRecords);
          latestStoryboardAssetReferences = storyboardReferencesFromGenerationRecords(filteredRecords, targetClips, { episodeId: targetEpisodeId, episode: targetEpisode });
          latestBlockedStoryboardImageUrls = nonStoryboardImageUrlsFromGenerationRecords(filteredRecords);
        } catch {
          // Keep the currently loaded generation record snapshot.
        }
      }
      const result = syncEpisodeClipBoardsToCanvas({
        episodeId: override?.episodeId ?? activeEpisodeId,
        episode: targetEpisode,
        clips: targetClips,
        scenes: targetScenes,
        assets: targetAssets,
        generationStrategy,
        storyboardAssetRefs: latestStoryboardAssetReferences,
        blockedStoryboardUrls: latestBlockedStoryboardImageUrls,
        projectPromptContext,
        imageModelId: assetGenerationModelId || undefined,
        imageResolution: assetGenerationResolution,
      });
      const store = useCanvasStore.getState();
      if (!canvasNodeListsEqual(result.nodes as any[], store.nodes as any[])) {
        store.setNodes(result.nodes);
      }
      const latestStore = useCanvasStore.getState();
      if (!canvasEdgeListsEqual(result.edges as any[], latestStore.edges as any[])) {
        latestStore.setEdges(result.edges);
      }
      const clipPromptChanged = result.clips.some((nextClip) => {
        const previousClip = targetClips.find((item) => item.id === nextClip.id);
        return previousClip?.storyboardPrompt !== nextClip.storyboardPrompt || previousClip?.seedancePrompt !== nextClip.seedancePrompt;
      });
      if (clipPromptChanged) {
        setClips((current) => current.map((clip) => result.clips.find((item) => item.id === clip.id) ?? clip));
        if (projectId && projectId !== 'local') {
          void apiClient.saveProjectWorkflow(projectId, {
            episodeId: override?.episodeId ?? activeEpisodeId,
            breakdownScenes: targetScenes,
            clips: result.clips,
            assets: targetAssets,
          }, { episodeId: override?.episodeId ?? activeEpisodeId }).catch(() => {
            // Autosave will retry from local state if this immediate sync save fails.
          });
        }
      }
      if (result.removedIds.size > 0) store.markNodesDeleted(result.removedIds);
      showCanvasDropStatus(`已按 ${targetEpisode} 顺序同步 ${result.storyboardCount} 个图片分镜故事板和 ${result.videoCount} 个视频板到画布，未自动生成。`);
      window.setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 0);
    } catch (error) {
      showCanvasDropStatus(`同步本集到画布失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [
    assetGenerationModelId,
    assetGenerationResolution,
    activeEpisodeId,
    applyRemoteCanvasScene,
    blockedStoryboardImageUrls,
    breakdownScenes,
    clips,
    currentProject,
    fitView,
    loadMergedWorkflowAssets,
    projectId,
    projectPromptContext,
    selectedEpisode,
    showCanvasDropStatus,
    storyboardAssetReferences,
  ]);
  useEffect(() => {
    syncEpisodeBoardsToCanvasRef.current = handleSyncEpisodeBoardsToCanvas;
    return () => {
      if (syncEpisodeBoardsToCanvasRef.current === handleSyncEpisodeBoardsToCanvas) {
        syncEpisodeBoardsToCanvasRef.current = null;
      }
    };
  }, [handleSyncEpisodeBoardsToCanvas]);

  const handleInferBoardsAndVideoToCanvas = async (): Promise<InferBoardsAndVideoResult> => {
    if (workflowInferAllRunning || workflowRunning || generatingSeedanceClipId || workflowHasRunningStage(stageStatuses)) {
      return { ok: false, completed: 0, failed: 0 };
    }
    if (projectUnavailable) {
      setWorkflowError('当前项目不存在，无法生成视频提示词并放入画布。请返回「我的项目」重新进入真实项目。');
      return { ok: false, completed: 0, failed: 0 };
    }
    if (!projectId || projectId === 'local') {
      setWorkflowError('本地项目不能调用后端模型推理。请进入真实项目后再执行。');
      return { ok: false, completed: 0, failed: 0 };
    }
    if (clips.length === 0) {
      setWorkflowError('当前集还没有 Clip，无法生成视频提示词。请先拆解分镜脚本。');
      return { ok: false, completed: 0, failed: 0 };
    }
    const assetTotal = assetArray(workflowAssets, 'characters').length + assetArray(workflowAssets, 'scenes').length + assetArray(workflowAssets, 'props').length;
    if (assetTotal === 0) {
      setWorkflowError('当前集还没有资产条目，无法生成视频提示词。请先提取资产。');
      setActiveWorkflowStage('assets');
      return { ok: false, completed: 0, failed: 0 };
    }
    const hasClipBreakdown = clips.some((clip) => getClipScenes(clip, breakdownScenes).length > 0);
    if (!hasClipBreakdown) {
      setWorkflowError('当前集还没有可用分镜脚本，无法生成视频提示词。请先重新拆解分镜。');
      setActiveWorkflowStage('storyboard');
      return { ok: false, completed: 0, failed: 0 };
    }

    const shouldPlanStoryboard = storyboardEnabled;
    const workflowTaskLabel = shouldPlanStoryboard ? '故事板和视频提示词' : '视频提示词';
    const initialClipIds = clips.map((clip) => clip.id).filter(Boolean);
    setWorkflowInferAllRunning(true);
    workflowInferAllActiveRequestStartedAtRef.current = Date.now();
    workflowInferAllExpectedClipIdsRef.current = initialClipIds;
    workflowInferAllCompletedClipIdsRef.current = new Set();
    setWorkflowError(null);
    setActiveWorkflowStage('video');
    setStageStatuses((current) => ({
      ...current,
      storyboard: shouldPlanStoryboard ? 'running' : 'done',
      video: 'running',
    }));
    showCanvasDropStatus(`正在按顺序推理 ${clips.length} 个 Clip 的${workflowTaskLabel}...`);

    let latestClips = clips;
    let latestScenes = breakdownScenes;
    let latestAssets = workflowAssets;
    let latestEpisode = selectedEpisode;
    let completed = 0;
    let failed = 0;
    let firstError = '';

    try {
      for (const clip of clips) {
        try {
          if (shouldPlanStoryboard) {
            const storyboardResult = await apiClient.planProjectWorkflowClipStoryboard(projectId, clip.id, {
              episodeId: activeEpisodeId,
              aiModelId: workflowAiModelId || undefined,
              panelMode: 'ai',
            });
            if (storyboardResult.workflow) {
              latestClips = storyboardResult.workflow.clips ?? latestClips;
              latestScenes = storyboardResult.workflow.breakdownScenes as BreakdownScene[];
              latestAssets = storyboardResult.workflow.assets ?? latestAssets;
              latestEpisode = storyboardResult.workflow.selectedEpisode || latestEpisode;
            } else if (storyboardResult.clip) {
              latestClips = latestClips.map((item) => (item.id === storyboardResult.clip?.id ? storyboardResult.clip : item));
            }
            const plannedClip = storyboardResult.clip ?? latestClips.find((item) => item.id === clip.id) ?? clip;
            const finalPrompt = finalizeClipStoryboardPrompt(plannedClip, storyboardResult.prompt || plannedClip.storyboardPrompt || '', latestClips, latestAssets, latestScenes).prompt;
            latestClips = latestClips.map((item) => (
              item.id === clip.id
                ? {
                    ...item,
                    ...plannedClip,
                    storyboardPrompt: finalPrompt,
                    storyboardPanelCount: storyboardResult.panelCount,
                    storyboardNotes: storyboardResult.notes || plannedClip.storyboardNotes || '',
                    seedancePrompt: '',
                  }
                : item
            ));
            await apiClient.saveProjectWorkflow(projectId, {
              episodeId: activeEpisodeId,
              activeStage: 'video',
              breakdownScenes: latestScenes,
              clips: latestClips,
              assets: latestAssets,
            }, { episodeId: activeEpisodeId });
            setBreakdownScenes(latestScenes);
            setClips(latestClips);
            setWorkflowAssets(latestAssets);
            setStageStatuses((current) => ({
              ...current,
              ...(storyboardResult.workflow?.stageStatuses ?? {}),
              source: 'done',
              assets: 'done',
              storyboard: 'done',
              video: 'running',
            }));
          }

          const videoResult = await apiClient.generateProjectWorkflowClipSeedancePrompt(projectId, clip.id, {
            episodeId: activeEpisodeId,
            aiModelId: workflowAiModelId || undefined,
          });
          latestClips = videoResult.workflow.clips ?? latestClips;
          latestScenes = videoResult.workflow.breakdownScenes as BreakdownScene[];
          latestAssets = videoResult.workflow.assets ?? latestAssets;
          latestEpisode = videoResult.workflow.selectedEpisode || latestEpisode;
          setBreakdownScenes(latestScenes);
          setClips(latestClips);
          setWorkflowAssets(latestAssets);
          setStageStatuses((current) => ({
            ...current,
            ...(videoResult.workflow.stageStatuses ?? {}),
            source: 'done',
            assets: 'done',
            storyboard: 'done',
            video: 'running',
          }));
          completed += 1;
          workflowInferAllCompletedClipIdsRef.current.add(clip.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : '未知错误';
          firstError ||= `${clip.title || clip.id || 'Clip'}：${message}`;
          console.warn('[workflow] clip video prompt inference failed', { clipId: clip.id, message });
          failed += 1;
        }
      }

      const finalStageStatuses = {
        ...stageStatuses,
        source: 'done',
        assets: 'done',
        storyboard: shouldPlanStoryboard ? (completed > 0 ? 'done' : 'failed') : 'done',
        video: completed > 0 ? 'done' : 'failed',
      };
      setStageStatuses(finalStageStatuses);
      if (firstError) {
        setWorkflowError(completed > 0 ? `部分 Clip 生成失败：${firstError}` : firstError);
      }
      if (completed > 0) {
        try {
          const saved = await apiClient.saveProjectWorkflow(projectId, {
            episodeId: activeEpisodeId,
            activeStage: 'video',
            breakdownScenes: latestScenes,
            clips: latestClips,
            assets: latestAssets,
            stageStatuses: finalStageStatuses,
          }, { episodeId: activeEpisodeId });
          if (saved) {
            latestClips = saved.clips ?? latestClips;
            latestScenes = saved.breakdownScenes as BreakdownScene[];
            latestAssets = saved.assets ?? latestAssets;
            latestEpisode = saved.selectedEpisode || latestEpisode;
            const savedWithFinalStatus = {
              ...saved,
              stageStatuses: {
                ...(saved.stageStatuses ?? {}),
                storyboard: finalStageStatuses.storyboard,
                video: finalStageStatuses.video,
              },
            };
            applyWorkflowSnapshot(saved, {
              setEpisodeList,
              setActiveEpisodeId,
              setSourceText,
              setSourceName,
              setSelectedEpisode,
              setBreakdownScenes,
              setClips,
              setWorkflowAssets,
              setStageStatuses,
            });
            setActiveWorkflowStage('video');
            setStageStatuses(savedWithFinalStatus.stageStatuses);
            setWorkflowDraftProjectId(`${projectId}:${saved.episodeId || activeEpisodeId}`);
          }
        } catch {
          // The local completed state stays visible; autosave can retry from the same state.
        }
        await handleSyncEpisodeBoardsToCanvas({
          episodeId: activeEpisodeId,
          clips: latestClips,
          scenes: latestScenes,
          assets: latestAssets,
          episode: latestEpisode,
          refreshRecords: true,
        });
        showCanvasDropStatus(`已完成 ${completed} 个 Clip 的${workflowTaskLabel}推理，并同步到画布。${failed ? `失败 ${failed} 个。` : ''}`);
      } else {
        showCanvasDropStatus(`${workflowTaskLabel}推理失败，未同步到画布。`);
      }
      return { ok: completed > 0, completed, failed };
    } catch (error) {
      setStageStatuses((current) => ({ ...current, storyboard: shouldPlanStoryboard ? 'failed' : 'done', video: 'failed' }));
      setWorkflowError(error instanceof Error ? error.message : '生成视频提示词并放入画布失败');
      return { ok: false, completed, failed: failed || clips.length - completed };
    } finally {
      setWorkflowInferAllRunning(false);
      workflowInferAllActiveRequestStartedAtRef.current = 0;
      workflowInferAllExpectedClipIdsRef.current = [];
      workflowInferAllCompletedClipIdsRef.current = new Set();
    }
  };

  inferBoardsAndVideoToCanvasRef.current = handleInferBoardsAndVideoToCanvas;

  const handleFullPipelineInfer = async () => {
    if (workflowRunning || workflowInferAllRunning || fullPipelineRunning || workflowHasRunningStage(stageStatuses)) return;
    if (projectUnavailable) {
      setWorkflowError('当前项目不存在，无法生成视频提示词并同步画布。请返回「我的项目」重新进入真实项目。');
      return;
    }
    setFullPipelineRunning(true);
    setWorkflowError(null);
    try {
      const inferFn = inferBoardsAndVideoToCanvasRef.current;
      if (inferFn) {
        await inferFn();
      }
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : '生成视频提示词并同步画布失败');
    } finally {
      setFullPipelineRunning(false);
    }
  };

  const handleAddSceneNode = (scene: BreakdownScene, index: number) => {
    try {
      const sceneNodes = nodes.filter((n) => n.type === 'scene');
      addNode('scene', { x: 420 + index * 330, y: 220 + (index % 2) * 180 }, {
        title: scene.title,
        description: scene.description,
        action: scene.action,
        dialogue: scene.dialogue,
        durationSeconds: scene.durationSeconds,
        visualPrompt: scene.visualPrompt,
        directorBoardPrompt: scene.directorBoardPrompt,
        status: 'waiting',
        sourceEpisode: selectedEpisode,
        sourceEpisodeId: activeEpisodeId,
      });
      setActivePanel(null);
      showCanvasDropStatus('已把分镜放入画布。');
      if (sceneNodes.length === 0) {
        fitView({ padding: 0.25, duration: 300 });
      }
    } catch (error) {
      showCanvasDropStatus(`分镜放入画布失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleAddClipStoryboardNode = async (clip: Clip, prompt: string) => {
    setActivePanel(null);
    showCanvasDropStatus('正在放入故事板生图节点...');
    try {
      const nodeCount = useCanvasStore.getState().nodes.length;
      const x = 420 + (nodeCount % 3) * 380;
      const y = 160 + Math.floor(nodeCount / 3) * 260;
      const clipScenes = getClipScenes(clip, breakdownScenes);
      const latestAssets = await loadMergedWorkflowAssets();
      let latestStoryboardAssetReferences = storyboardAssetReferences;
      let latestBlockedStoryboardImageUrls = blockedStoryboardImageUrls;
      if (projectId && projectId !== 'local') {
        try {
          const latestRecords = await apiClient.listGenerationRecords(projectId, { limit: 300, compact: true });
          const filteredRecords = latestRecords.filter((record) => generationRecordBelongsToEpisode(record, activeEpisodeId, selectedEpisode));
          setGenerationRecords(filteredRecords);
          latestStoryboardAssetReferences = storyboardReferencesFromGenerationRecords(filteredRecords, clips, { episodeId: activeEpisodeId, episode: selectedEpisode });
          latestBlockedStoryboardImageUrls = nonStoryboardImageUrlsFromGenerationRecords(filteredRecords);
        } catch {
          // Keep the currently loaded generation record snapshot.
        }
      }
      const previousStoryboardRef = findPreviousClipStoryboardReference(
        clip,
        clips,
        useCanvasStore.getState().nodes,
        latestStoryboardAssetReferences,
        latestBlockedStoryboardImageUrls,
      );
      const savedPanelCount = Number(clip.storyboardPanelCount);
      const storyboardPanelCount = Number.isFinite(savedPanelCount) && savedPanelCount >= MIN_CLIP_STORYBOARD_PANEL_COUNT && savedPanelCount <= MAX_CLIP_STORYBOARD_PANEL_COUNT
        ? savedPanelCount
        : suggestClipStoryboardPanelCount(clip, clipScenes);
      const finalStoryboardPrompt = finalizeClipStoryboardImagePrompt(prompt, storyboardPanelCount);
      const promptWithContinuity = appendPreviousStoryboardContinuityPrompt(
        enforceClipStoryboardContinuityPrompt(finalStoryboardPrompt, clip, clipScenes, breakdownScenes, latestAssets),
        previousStoryboardRef,
      );
      const previousStoryboardNodeId = previousStoryboardRef?.nodeId || '';
      const assetReferenceLimit = previousStoryboardRef ? 8 : 9;
      const assetReferences = collectClipAssetReferences(clip, clipScenes, latestAssets, assetReferenceLimit, promptWithContinuity, { includeProps: false, includeScenes: false, allScenes: breakdownScenes });
      const references: ClipImageReference[] = [
        ...(previousStoryboardRef?.url ? [{
          kind: 'storyboard' as const,
          name: previousStoryboardRef.title || `${previousStoryboardRef.sourceClip?.title || '上一个 Clip'} 故事板`,
          label: `上一个故事板: ${previousStoryboardRef.sourceClip?.title || previousStoryboardRef.clipTitle || previousStoryboardRef.title || '上一段'}`,
          url: previousStoryboardRef.url,
          assetId: previousStoryboardRef.assetId,
          nodeId: previousStoryboardRef.nodeId,
          sourceClipId: previousStoryboardRef.sourceClip?.id || previousStoryboardRef.clipId,
          sourceClipTitle: previousStoryboardRef.sourceClip?.title || previousStoryboardRef.clipTitle,
          targetClipId: clip.id,
        }] : []),
        ...assetReferences,
      ];
      const promptWithReferenceMap = appendReferenceImageMapPrompt(
        promptWithContinuity,
        references.map(clipImageReferenceAsCanvasReference),
      );
      const storyboardResolution = assetGenerationResolution;
      const referenceGrid = canvasReferenceGridMetrics(references.length);
      const hasReferenceArea = references.length > 0;
      const referenceAreaWidth = hasReferenceArea ? referenceGrid.width : 0;
      const sectionWidth = CANVAS_SECTION_PADDING_X * 2 + (hasReferenceArea ? referenceAreaWidth + CANVAS_TARGET_SECTION_GAP : 0) + 380;
      const sectionHeight = CANVAS_SECTION_HEADER_HEIGHT + Math.max(referenceGrid.height, CANVAS_GENERATION_NODE_HEIGHT) + CANVAS_SECTION_PADDING_BOTTOM;
      const sectionPosition = {
        x: hasReferenceArea ? x - 420 : x - CANVAS_SECTION_PADDING_X,
        y: y - CANVAS_SECTION_HEADER_HEIGHT,
      };
      const referenceBasePosition = {
        x: sectionPosition.x + CANVAS_SECTION_PADDING_X,
        y: sectionPosition.y + CANVAS_SECTION_HEADER_HEIGHT,
      };
      const generationPosition = {
        x: referenceBasePosition.x + (hasReferenceArea ? referenceAreaWidth + CANVAS_TARGET_SECTION_GAP : 0),
        y: referenceBasePosition.y,
      };
      const sectionId = addCanvasSection(addNode, sectionPosition, { width: sectionWidth, height: sectionHeight }, {
        title: clipCanvasSectionTitle(clip, '故事板参考资产'),
        description: references.length ? '角色参考和上一个故事板连到右侧故事板生图；道具由角色图承载' : '当前没有匹配到可用资产参考图',
        tone: 'amber',
        itemCount: references.length + 1,
        clipId: clip.id,
        sectionKind: 'clip-storyboard-assets',
        sourceEpisode: selectedEpisode,
        sourceEpisodeId: activeEpisodeId,
      });
      const childPositions = new Map<string, { x: number; y: number }>();
      const generationNodeId = addNode('generation', generationPosition, {
        mode: 'standalone',
        title: `${clip.title || 'Clip'} 故事板`,
        description: references.length
          ? `Clip 级导演故事板生图节点，已接入 ${references.length} 张角色/场景参考图`
          : 'Clip 级导演故事板生图节点，当前没有匹配到可用资产参考图',
        prompt: promptWithReferenceMap,
        finalPrompt: promptWithReferenceMap,
        manualFinalPrompt: true,
        status: 'waiting',
        size: '16:9',
        resolution: storyboardResolution,
        quality: 'high',
        format: 'png',
        storyboardPanelCount,
        modelId: assetGenerationModelId || undefined,
        projectPromptContext,
        clipId: clip.id,
        clipTitle: clip.title,
        clipNodeKind: 'storyboard',
        storyboardForClip: true,
        previousStoryboardAssetId: previousStoryboardRef?.assetId || previousStoryboardNodeId,
        sourceEpisode: selectedEpisode,
        sourceEpisodeId: activeEpisodeId,
      });
      childPositions.set(generationNodeId, generationPosition);
      const hasPreviousStoryboardReference = references.some((reference) => reference.kind === 'storyboard' && publicImageUrl(reference.url));
      if (!hasPreviousStoryboardReference && previousStoryboardNodeId && useCanvasStore.getState().nodes.some((node) => node.id === previousStoryboardNodeId)) {
        onConnect({
          source: previousStoryboardNodeId,
          sourceHandle: null,
          target: generationNodeId,
          targetHandle: null,
        });
      }
      references.forEach((reference, index) => {
        const referencePosition = canvasReferenceGridPosition(referenceBasePosition, index);
        const referenceNodeId = addNode('imageInput', {
          x: referencePosition.x,
          y: referencePosition.y,
        }, {
          label: reference.label,
          imageUrl: reference.url,
          imageAspectRatio: reference.kind === 'storyboard' ? 1.78 : 1.45,
          fileName: `${reference.name}.png`,
          uploadStatus: 'linked',
          sourcePrompt: reference.kind === 'storyboard'
            ? `上一个故事板，用于延续 ${clip.title || 'Clip'} 的场景和角色位置`
            : `${reference.label}，用于 ${clip.title || 'Clip'} 故事板连续性参考`,
          uploadError: '',
          imageLoadError: false,
          ...(reference.kind === 'storyboard'
            ? {
                clipNodeKind: 'storyboard-reference',
                storyboardForClip: false,
                sourceClipId: reference.sourceClipId || '',
                sourceClipTitle: reference.sourceClipTitle || '',
                targetClipId: reference.targetClipId || clip.id,
              }
            : { assetKind: reference.kind, assetName: reference.name }),
          assetId: reference.assetId || '',
          sourceEpisode: selectedEpisode,
          sourceEpisodeId: activeEpisodeId,
        });
        childPositions.set(referenceNodeId, referencePosition);
        onConnect({
          source: referenceNodeId,
          sourceHandle: null,
          target: generationNodeId,
          targetHandle: null,
        });
      });
      attachNodesToCanvasSection(sectionId, childPositions);
      showCanvasDropStatus(
        references.length
          ? `已把故事板生图节点和 ${references.length} 张参考放入画布并连线。${previousStoryboardRef ? '已接入上一个故事板延续场景和站位。' : ''}`
          : '已把故事板生图节点放入画布，但没有找到带图片的相关资产参考。'
      );
      window.setTimeout(() => fitView({ padding: 0.22, duration: 300 }), 0);
    } catch (error) {
      showCanvasDropStatus(`故事板放入画布失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleAddClipStoryboardImageReferenceNode = (clip: Clip, reference: ClipStoryboardImageReference) => {
    if (!reference.url) {
      showCanvasDropStatus('这张故事板没有可用图片 URL，无法放入画布。');
      return;
    }
    setActivePanel(null);
    if (reference.nodeId && useCanvasStore.getState().nodes.some((node) => node.id === reference.nodeId)) {
      setActivePanel(null);
      window.setTimeout(() => fitView({ padding: 0.24, duration: 300 }), 0);
      showCanvasDropStatus('这张故事板图已经在画布里。');
      return;
    }
    try {
      const nodeCount = useCanvasStore.getState().nodes.length;
      addNode('imageInput', {
        x: 420 + (nodeCount % 3) * 360,
        y: 160 + Math.floor(nodeCount / 3) * 260,
      }, {
        label: reference.title || `${clip.title || 'Clip'} 故事板`,
        imageUrl: reference.url,
        fileName: `${reference.title || `${clip.title || 'Clip'}-storyboard`}.png`,
        uploadStatus: 'linked',
        sourcePrompt: reference.prompt || clip.storyboardPrompt || '',
        uploadError: '',
        imageLoadError: false,
        clipId: clip.id,
        clipNodeKind: 'storyboard',
        storyboardForClip: true,
        assetId: reference.assetId || '',
        sourceEpisode: selectedEpisode,
        sourceEpisodeId: activeEpisodeId,
      });
      showCanvasDropStatus('已把故事板图片作为参考图放入画布。');
      window.setTimeout(() => fitView({ padding: 0.24, duration: 300 }), 0);
    } catch (error) {
      showCanvasDropStatus(`故事板图片放入画布失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleAddClipPositioningBoardNode = async (
    clip: Clip,
    options: { silent?: boolean; fitViewAfter?: boolean; mode?: ClipPositioningBoardMode } = {},
  ) => {
    const boardMode = options.mode || 'storyboard';
    const boardModeLabel = boardMode === 'storyboard' ? '故事板' : '定位板';
    if (!options.silent) {
      setActivePanel(null);
      showCanvasDropStatus(`正在放入${boardModeLabel}图片流程...`);
    }
    try {
      const clipIndex = Math.max(0, clips.findIndex((item) => item.id === clip.id));
      const episodeKey = stableCanvasIdPart(activeEpisodeId || selectedEpisode, 'episode');
      const clipKey = stableCanvasIdPart(clip.id || clip.title, `clip-${clipIndex + 1}`);
      const sectionId = `clip-position-board-${activeEpisodeId}-${clipKey}`;
      const positioningNodeId = `clip-position-board-gen-${activeEpisodeId}-${clipKey}`;
      const videoSectionId = `episode-sync-video-${episodeKey}-${clipKey}`;
      const videoNodeId = `episode-sync-video-node-${episodeKey}-${clipKey}`;
      const clipScenes = getClipScenes(clip, breakdownScenes);
      const latestAssets = await loadMergedWorkflowAssets();
      const store = useCanvasStore.getState();
      let nextNodes = store.nodes as any[];
      let nextEdges = store.edges as any[];
      const oldPositioningData = nextNodes.find((node) => node.id === positioningNodeId || (
        node.type === 'generation' &&
        node.data?.positioningBoardFlow === true &&
        node.data?.clipId === clip.id &&
        (!node.data?.sourceEpisodeId || node.data.sourceEpisodeId === activeEpisodeId)
      ))?.data ?? {};
      const oldPositioningOutputImages = Array.isArray(oldPositioningData.outputImages)
        ? oldPositioningData.outputImages
        : [];
      const cleaned = removeEpisodeCanvasChildren(nextNodes, nextEdges, sectionId);
      const removedIds = new Set([...cleaned.removedIds, sectionId]);
      nextNodes = cleaned.nodes.filter((node) => node.id !== sectionId);
      nextEdges = cleaned.edges.filter((edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target));

      const positioningReferences = collectClipPositioningBoardReferences(
        clip,
        clipScenes,
        latestAssets,
        12,
        { includeMissing: true },
      );
      const positioningReferenceLabels = positioningReferences
        .map((reference) => reference.name || reference.label)
        .filter(Boolean);
      const positioningSceneLockName = positioningReferences.find((reference) => reference.kind === 'scenes')?.name;
      const visibleCharacterNames = positioningReferences
        .filter((reference) => reference.kind === 'characters')
        .map((reference) => reference.name)
        .filter(Boolean);
      const positioningPrompt = buildCanvasClipPositioningBoardPrompt({
        projectName: currentProject?.title || selectedEpisode,
        clip,
        shots: clipScenes,
        referenceLabels: positioningReferenceLabels,
        visibleCharacterNames,
        sceneLockName: positioningSceneLockName,
        mode: 'positioning',
      });
      const storyboardPrompt = buildCanvasClipPositioningBoardPrompt({
        projectName: currentProject?.title || selectedEpisode,
        clip,
        shots: clipScenes,
        referenceLabels: positioningReferenceLabels,
        visibleCharacterNames,
        sceneLockName: positioningSceneLockName,
        mode: 'storyboard',
      });
      const activeBoardPrompt = boardMode === 'storyboard' ? storyboardPrompt : positioningPrompt;
      const positioningRows = Math.ceil(positioningReferences.length / POSITIONING_BOARD_REFERENCE_COLUMNS);
      const positioningReferenceHeight = positioningRows > 0
        ? positioningRows * POSITIONING_BOARD_REFERENCE_NODE_HEIGHT + Math.max(0, positioningRows - 1) * POSITIONING_BOARD_REFERENCE_NODE_GAP_Y
        : 0;
      const positioningSectionHeight = Math.max(
        360,
        CANVAS_SECTION_HEADER_HEIGHT +
          Math.max(CANVAS_GENERATION_NODE_HEIGHT, positioningReferenceHeight) +
          CANVAS_SECTION_PADDING_BOTTOM,
      );
      const nodeById = new Map(nextNodes.map((node) => [node.id, node]));
      const relatedVideoSection = nextNodes.find((node) => (
        node.id === videoSectionId ||
        (
          node.type === 'section' &&
          node.data?.clipId === clip.id &&
          (!node.data?.sourceEpisodeId || node.data.sourceEpisodeId === activeEpisodeId) &&
          ['clip-video-assets', 'episode-sync-video'].includes(String(node.data?.sectionKind || ''))
        )
      ));
      const relatedVideoNode = nextNodes.find((node) => (
        node.id === videoNodeId ||
        (
          node.type === 'video' &&
          node.data?.clipId === clip.id &&
          (!node.data?.sourceEpisodeId || node.data.sourceEpisodeId === activeEpisodeId)
        )
      ));
      const videoAnchorNode = relatedVideoSection || relatedVideoNode;
      const videoAnchorPosition = videoAnchorNode
        ? canvasNodeAbsolutePosition(videoAnchorNode, nodeById as Map<string, { id: string; parentId?: string; position: { x: number; y: number } }>)
        : null;
      const fallbackIndex = clipIndex >= 0 ? clipIndex : nextNodes.length;
      const positioningSectionPosition = videoAnchorPosition
        ? {
            x: videoAnchorPosition.x - POSITIONING_BOARD_SECTION_WIDTH - EPISODE_CANVAS_SYNC_COLUMN_GAP,
            y: videoAnchorPosition.y,
          }
        : {
            x: 120,
            y: 120 + fallbackIndex * (positioningSectionHeight + 80),
          };
      const positioningOutputImage = publicImageUrl(oldPositioningData.outputImage);
      const hasPositioningOutput = Boolean(
        positioningOutputImage ||
        oldPositioningOutputImages.some((item: unknown) => publicImageUrl(item)),
      );

      nextNodes = upsertEpisodeCanvasNode(nextNodes, {
        id: sectionId,
        type: 'section',
        position: positioningSectionPosition,
        style: { width: POSITIONING_BOARD_SECTION_WIDTH, height: positioningSectionHeight },
        zIndex: 0,
        data: {
          title: `${clip.title || `Clip ${clipIndex + 1}`} · 故事板/定位板图片流程`,
          description: boardMode === 'storyboard'
            ? '为本 Clip 生成对应视频镜头的宫格故事板；视频生成时作为镜头构图、站位和连续性参考。'
            : '为本 Clip 生成单帧空间定位板；视频生成时作为角色站位、朝向和场景地理参考。',
          tone: 'emerald',
          itemCount: positioningReferences.length + 1,
          clipId: clip.id,
          sourceEpisode: selectedEpisode,
          sourceEpisodeId: activeEpisodeId,
          sectionKind: 'clip-positioning-board',
          positioningBoardFlow: true,
          positioningBoardMode: boardMode,
          episodeCanvasSync: true,
          clipOrder: clipIndex + 1,
        },
      });
      nextNodes = upsertEpisodeCanvasNode(nextNodes, {
        id: positioningNodeId,
        type: 'generation',
        parentId: sectionId,
        extent: 'parent',
        expandParent: false,
        position: { x: POSITIONING_BOARD_GENERATION_NODE_X, y: CANVAS_SECTION_HEADER_HEIGHT },
        style: { width: POSITIONING_BOARD_GENERATION_NODE_WIDTH },
        zIndex: 1,
        data: {
          mode: 'standalone',
          title: `${clip.title || clip.id || `Clip ${clipIndex + 1}`} ${boardModeLabel}`,
          description: boardMode === 'storyboard'
            ? `生成本 Clip 对应视频镜头的宫格故事板，已接入 ${positioningReferences.length} 张参考图。`
            : `生成本 Clip 的单帧场景/角色定位板，已接入 ${positioningReferences.length} 张参考图。`,
          prompt: activeBoardPrompt,
          finalPrompt: activeBoardPrompt,
          positioningPrompt,
          storyboardPrompt,
          manualFinalPrompt: true,
          status: hasPositioningOutput ? 'completed' : oldPositioningData.status || 'waiting',
          error: hasPositioningOutput ? oldPositioningData.error || '' : oldPositioningData.error || '',
          outputImage: oldPositioningData.outputImage || '',
          outputImageAssetId: oldPositioningData.outputImageAssetId || '',
          outputImages: oldPositioningOutputImages,
          generationStartedAt: oldPositioningData.generationStartedAt || '',
          size: '16:9',
          resolution: assetGenerationResolution || '2k',
          quality: 'high',
          format: 'png',
          modelId: assetGenerationModelId || undefined,
          projectPromptContext,
          clipId: clip.id,
          clipTitle: clip.title,
          clipNodeKind: 'positioning-board',
          sourceEpisode: selectedEpisode,
          sourceEpisodeId: activeEpisodeId,
          positioningBoardFlow: true,
          positioningBoardMode: boardMode,
          lightweightGeneration: true,
          episodeCanvasSync: true,
        },
      });

      positioningReferences.forEach((reference, refIndex) => {
        const refNodeId = `clip-position-board-ref-${activeEpisodeId}-${clipKey}-${stableCanvasIdPart(reference.kind, 'asset')}-${stableCanvasIdPart(reference.assetId || reference.name || refIndex, `ref-${refIndex}`)}`;
        const column = refIndex % POSITIONING_BOARD_REFERENCE_COLUMNS;
        const row = Math.floor(refIndex / POSITIONING_BOARD_REFERENCE_COLUMNS);
        const url = publicImageUrl(reference.url);
        nextNodes = upsertEpisodeCanvasNode(nextNodes, {
          id: refNodeId,
          type: 'imageInput',
          parentId: sectionId,
          extent: 'parent',
          expandParent: false,
          position: {
            x: CANVAS_SECTION_PADDING_X + column * (POSITIONING_BOARD_REFERENCE_NODE_WIDTH + POSITIONING_BOARD_REFERENCE_NODE_GAP_X),
            y: CANVAS_SECTION_HEADER_HEIGHT + row * (POSITIONING_BOARD_REFERENCE_NODE_HEIGHT + POSITIONING_BOARD_REFERENCE_NODE_GAP_Y),
          },
          style: { width: POSITIONING_BOARD_REFERENCE_NODE_WIDTH },
          zIndex: 1,
          data: {
            label: `${reference.kind === 'scenes' ? '场景' : reference.kind === 'props' ? '道具' : '角色'} · ${reference.name || reference.label}`,
            imageUrl: url,
            imageAspectRatio: reference.kind === 'scenes' ? 1.78 : 1.45,
            fileName: `${reference.name || reference.kind}.png`,
            uploadStatus: url ? 'linked' : 'missing',
            sourcePrompt: `${reference.label}，用于 ${clip.title || 'Clip'} 定位板空间参考`,
            uploadError: url ? '' : '该资产还没有参考图，请上传或生成后再生成定位板。',
            imageLoadError: false,
            assetKind: reference.kind,
            assetName: reference.name,
            assetId: reference.assetId || '',
            sourceClipId: clip.id,
            targetClipId: clip.id,
            sourceEpisode: selectedEpisode,
            sourceEpisodeId: activeEpisodeId,
            positioningBoardFlow: true,
            lightweightReference: true,
            episodeCanvasSync: true,
            clipSyncRole: `positioning-ref:${reference.kind}:${reference.assetId || normalizeCompareText(reference.name)}`,
            clipSyncAssetId: reference.assetId || '',
            clipSyncUrl: url,
          },
        });
        nextEdges = upsertEpisodeCanvasEdge(nextEdges, {
          id: canvasAutoEdgeId('clip-position-board-ref', refNodeId, positioningNodeId),
          source: refNodeId,
          sourceHandle: null,
          target: positioningNodeId,
          targetHandle: null,
          type: 'smoothstep',
        });
      });

      if (relatedVideoNode?.id) {
        nextEdges = upsertEpisodeCanvasEdge(nextEdges, {
          id: canvasAutoEdgeId('clip-position-board-video', positioningNodeId, relatedVideoNode.id),
          source: positioningNodeId,
          sourceHandle: null,
          target: relatedVideoNode.id,
          targetHandle: null,
          type: 'smoothstep',
        });
      }

      const positioningLayout = applyPositioningBoardLayout(nextNodes, nextEdges);
      nextNodes = positioningLayout.nodes;
      nextEdges = positioningLayout.edges;
      const latestStore = useCanvasStore.getState();
      if (!canvasNodeListsEqual(nextNodes as any[], latestStore.nodes as any[])) {
        latestStore.setNodes(nextNodes);
      }
      const postNodeStore = useCanvasStore.getState();
      if (!canvasEdgeListsEqual(nextEdges as any[], postNodeStore.edges as any[])) {
        postNodeStore.setEdges(nextEdges);
      }
      if (!options.silent) {
        showCanvasDropStatus(
          relatedVideoNode?.id
            ? `已把 ${clip.title || 'Clip'} 的故事板/定位板流程放入画布，并连接到对应视频任务。`
            : `已把 ${clip.title || 'Clip'} 的故事板/定位板流程放入画布。对应视频任务放入后可再连接使用。`,
        );
      }
      if (options.fitViewAfter !== false) {
        window.setTimeout(() => fitView({ padding: 0.22, duration: 300 }), 0);
      }
    } catch (error) {
      if (options.silent) throw error;
      showCanvasDropStatus(`故事板/定位板流程放入画布失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleAddClipPositioningBoardNodes = async (targetClips: Clip[]) => {
    const uniqueClips = targetClips.filter((clip, index, list) => clip.id && list.findIndex((item) => item.id === clip.id) === index);
    if (uniqueClips.length === 0) {
      showCanvasDropStatus('请先选择要放入故事板/定位板流程的 Clip。');
      return;
    }
    setActivePanel(null);
    showCanvasDropStatus(`正在批量放入 ${uniqueClips.length} 个故事板/定位板流程...`);
    let completed = 0;
    let failed = 0;
    let firstError = '';
    for (const clip of uniqueClips) {
      try {
        await handleAddClipPositioningBoardNode(clip, { silent: true, fitViewAfter: false });
        completed += 1;
      } catch (error) {
        failed += 1;
        firstError ||= `${clip.title || clip.id || 'Clip'}：${error instanceof Error ? error.message : '未知错误'}`;
      }
    }
    showCanvasDropStatus(
      completed > 0
        ? `已批量放入 ${completed} 个故事板/定位板流程。${failed ? `失败 ${failed} 个：${firstError}` : ''}`
        : `批量放入故事板/定位板流程失败：${firstError || '未知错误'}`,
    );
    if (completed > 0) {
      window.setTimeout(() => fitView({ padding: 0.18, duration: 300 }), 0);
    }
  };

  const handleAddClipVideoNode = async (clip: Clip, prompt: string) => {
    setActivePanel(null);
    showCanvasDropStatus('正在放入视频任务...');
    try {
      const nodeCount = useCanvasStore.getState().nodes.length;
      const x = 420 + (nodeCount % 3) * 380;
      const y = 160 + Math.floor(nodeCount / 3) * 260;
      const clipScenes = getClipScenes(clip, breakdownScenes);
      const latestAssets = await loadMergedWorkflowAssets();
      const existingNodes = useCanvasStore.getState().nodes;
      const useMultiReferenceStrategy = isSeedanceMultiReferenceStrategy(projectGenerationStrategy(currentProject));
      const currentStoryboardNode = useMultiReferenceStrategy ? null : findClipStoryboardNode(existingNodes, clip);
      const references = collectClipVideoReferences(clip, clipScenes, latestAssets, existingNodes, storyboardAssetReferences, blockedStoryboardImageUrls, prompt, {
        includeStoryboard: !useMultiReferenceStrategy,
        // 道具由角色资产图承载，不自动接道具参考节点；需要时用户手动连接。
        includeProps: false,
        includeScenes: useMultiReferenceStrategy,
        includeMissing: useMultiReferenceStrategy,
      });
      const exactStoryboardRef = useMultiReferenceStrategy ? undefined : findExactClipStoryboardReference(storyboardAssetReferences, clip, blockedStoryboardImageUrls);
      const currentStoryboardUrl = exactStoryboardRef?.url || (currentStoryboardNode ? canvasNodeReferenceUrl(currentStoryboardNode) : '');
      const currentStoryboardAssetId = exactStoryboardRef?.assetId || String(currentStoryboardNode?.data?.outputImageAssetId || currentStoryboardNode?.data?.assetId || '');
      const characterAudioRefs = collectCharacterAudioReferencesFromWorkflow(
        extractDialogueCharacterNames(prompt, clipScenes, assetArray(latestAssets, 'characters'), clip.characters),
        latestAssets,
      );
      const characterAudioMetadata = characterAudioReferenceMetadata(characterAudioRefs);
      const videoReferences = references
        .filter((reference) => reference.kind !== 'storyboard')
        .slice(0, Math.max(0, useMultiReferenceStrategy ? MAX_VIDEO_REFERENCE_IMAGES : MAX_VIDEO_REFERENCE_IMAGES - 1));
      const newReferenceCount = videoReferences.length + (useMultiReferenceStrategy ? 0 : 1);
      const audioReferenceCount = characterAudioRefs.length;
      const totalReferenceNodeCount = newReferenceCount + audioReferenceCount;
      const assetReferenceCount = videoReferences.filter((reference) => reference.kind !== 'storyboard').length;
      const storyboardReferenceCount = useMultiReferenceStrategy ? 0 : 1;
      const referenceGrid = canvasReferenceGridMetrics(totalReferenceNodeCount);
      const hasReferenceArea = totalReferenceNodeCount > 0;
      const referenceAreaWidth = hasReferenceArea ? referenceGrid.width : 0;
      const sectionWidth = CANVAS_SECTION_PADDING_X * 2 + (hasReferenceArea ? referenceAreaWidth + CANVAS_TARGET_SECTION_GAP : 0) + 540;
      const sectionHeight = CANVAS_SECTION_HEADER_HEIGHT + Math.max(referenceGrid.height, CANVAS_VIDEO_NODE_HEIGHT) + CANVAS_SECTION_PADDING_BOTTOM;
      const sectionPosition = {
        x: hasReferenceArea ? x - 420 : x - CANVAS_SECTION_PADDING_X,
        y: y - CANVAS_SECTION_HEADER_HEIGHT,
      };
      const referenceBasePosition = {
        x: sectionPosition.x + CANVAS_SECTION_PADDING_X,
        y: sectionPosition.y + CANVAS_SECTION_HEADER_HEIGHT,
      };
      const videoPosition = {
        x: referenceBasePosition.x + (hasReferenceArea ? referenceAreaWidth + CANVAS_TARGET_SECTION_GAP : 0),
        y: referenceBasePosition.y,
      };
      const sectionId = addCanvasSection(addNode, sectionPosition, { width: sectionWidth, height: sectionHeight }, {
        title: clipCanvasSectionTitle(clip, '视频参考资产'),
        description: useMultiReferenceStrategy
          ? `已接入 ${assetReferenceCount} 个多参资产节点、${audioReferenceCount} 个台词音频坑位`
          : `已接入 ${storyboardReferenceCount} 个故事板坑位、${assetReferenceCount} 张资产参考、${audioReferenceCount} 个台词音频坑位`,
        tone: 'sky',
        itemCount: totalReferenceNodeCount + 1,
        clipId: clip.id,
        sectionKind: 'clip-video-assets',
        sourceEpisode: selectedEpisode,
        sourceEpisodeId: activeEpisodeId,
        characters: clip.characters ?? [],
        ...characterAudioMetadata,
      });
      const childPositions = new Map<string, { x: number; y: number }>();
      const videoNodeId = addNode('video', videoPosition, {
        kind: 'video',
        workflowKind: 'video',
        title: `${clip.title || 'Clip'} 视频任务`,
        description: useMultiReferenceStrategy
          ? `Seedance 多参视频提示词已就绪，已接入 ${assetReferenceCount} 个资产参考节点`
          : `Seedance 视频提示词已就绪，已接入对应故事板坑位和 ${assetReferenceCount} 张资产参考图`,
        scope: '分镜视频',
        statusLabel: '待生成视频',
        prompt,
        seedancePrompt: prompt,
        videoPrompt: prompt,
        clipId: clip.id,
        duration: getClipEstimatedDuration(clip, clipScenes),
        durationSeconds: normalizeVideoDuration(getClipEstimatedDuration(clip, clipScenes)),
        resolution: '720p',
        includeAudio: true,
        ratio: 'adaptive',
        count: 1,
        videoParametersCollapsed: true,
        referenceCount: newReferenceCount,
        generationStrategy: useMultiReferenceStrategy ? SEEDANCE_MULTI_REF_STRATEGY : projectGenerationStrategy(currentProject),
        audioReferenceCount,
        sourceEpisode: selectedEpisode,
        sourceEpisodeId: activeEpisodeId,
        ...characterAudioMetadata,
      });
      childPositions.set(videoNodeId, videoPosition);
      if (!useMultiReferenceStrategy) {
        const storyboardSlotPosition = canvasReferenceGridPosition(referenceBasePosition, 0);
        const storyboardSlotNodeId = addNode('imageInput', {
          x: storyboardSlotPosition.x,
          y: storyboardSlotPosition.y,
        }, {
          ...storyboardSlotImageData(clip, currentStoryboardUrl, currentStoryboardAssetId, exactStoryboardRef?.prompt),
          sourceEpisode: selectedEpisode,
          sourceEpisodeId: activeEpisodeId,
        });
        childPositions.set(storyboardSlotNodeId, storyboardSlotPosition);
        if (currentStoryboardNode) {
          onConnect({
            source: currentStoryboardNode.id,
            sourceHandle: null,
            target: storyboardSlotNodeId,
            targetHandle: null,
          });
        }
        onConnect({
          source: storyboardSlotNodeId,
          sourceHandle: null,
          target: videoNodeId,
          targetHandle: null,
        });
      }
      let createdReferenceIndex = useMultiReferenceStrategy ? 0 : 1;
      videoReferences.forEach((reference) => {
        const url = publicImageUrl(reference.url);
        const referencePosition = canvasReferenceGridPosition(referenceBasePosition, createdReferenceIndex);
        createdReferenceIndex += 1;
        const referenceNodeId = addNode('imageInput', {
          x: referencePosition.x,
          y: referencePosition.y,
        }, {
          label: reference.label,
          imageUrl: url,
          imageAspectRatio: 1.45,
          fileName: `${reference.name}.png`,
          uploadStatus: url ? 'linked' : 'missing',
          sourcePrompt: `${reference.label}，用于 ${clip.title || 'Clip'} 视频连续性参考`,
          uploadError: url ? '' : '该资产还没有参考图，请上传或生成后再生成视频。',
          imageLoadError: false,
          ...(reference.kind === 'storyboard' ? { clipId: clip.id, clipNodeKind: 'storyboard', storyboardForClip: true } : {}),
          assetKind: reference.kind === 'storyboard' ? undefined : reference.kind,
          assetName: reference.name,
          assetId: reference.assetId || '',
          sourceEpisode: selectedEpisode,
          sourceEpisodeId: activeEpisodeId,
        });
        childPositions.set(referenceNodeId, referencePosition);
        onConnect({
          source: referenceNodeId,
          sourceHandle: null,
          target: videoNodeId,
          targetHandle: null,
        });
      });
      characterAudioRefs.forEach((reference) => {
        const referencePosition = canvasReferenceGridPosition(referenceBasePosition, createdReferenceIndex);
        createdReferenceIndex += 1;
        const audioUrl = publicAudioUrl(reference.url);
        const audioNodeId = addNode('audio', {
          x: referencePosition.x,
          y: referencePosition.y,
        }, {
          kind: 'audio',
          workflowKind: 'audio',
          label: `音频参考: ${reference.name}`,
          title: `${reference.name} 音频参考`,
          characterName: reference.name,
          assetName: reference.name,
          assetKind: 'audio',
          audioUrl,
          referenceAudioUrl: audioUrl,
          referenceAudioAssetId: reference.assetId || '',
          assetId: reference.assetId || '',
          fileName: reference.fileName || `${reference.name}-voice-reference`,
          uploadStatus: audioUrl ? 'linked' : 'missing',
          uploadError: audioUrl ? '' : '该角色还没有绑定音频参考',
          sourcePrompt: audioUrl
            ? `${reference.name} 的台词音频参考，用于 ${clip.title || 'Clip'} 视频生成`
            : `${reference.name} 在 ${clip.title || 'Clip'} 有台词，但还没有绑定音频参考`,
          sourceEpisode: selectedEpisode,
          sourceEpisodeId: activeEpisodeId,
        });
        childPositions.set(audioNodeId, referencePosition);
        onConnect({
          source: audioNodeId,
          sourceHandle: null,
          target: videoNodeId,
          targetHandle: null,
        });
      });
      attachNodesToCanvasSection(sectionId, childPositions);
      showCanvasDropStatus(useMultiReferenceStrategy
        ? `已把多参视频任务放入画布，并接入 ${assetReferenceCount} 个资产参考和 ${audioReferenceCount} 个台词音频坑位。`
        : `已把视频任务放入画布，并接入故事板坑位、${assetReferenceCount} 个资产参考和 ${audioReferenceCount} 个台词音频坑位。`);
      window.setTimeout(() => fitView({ padding: 0.22, duration: 300 }), 0);
    } catch (error) {
      showCanvasDropStatus(`视频任务放入画布失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleUpdateScene = (scene: BreakdownScene) => {
    setBreakdownScenes((current) => current.map((item) => (item.id === scene.id ? scene : item)));
  };

  const handleDeleteScene = (sceneId: string) => {
    setBreakdownScenes((current) => current.filter((scene) => scene.id !== sceneId));
  };

  const handleAcceptClip = (clipId: string) => {
    setClips((current) => current.map((clip) => {
      if (clip.id !== clipId) return clip;
      const preflight = clip.preflight && typeof clip.preflight === 'object' ? clip.preflight : {};
      return {
        ...clip,
        preflight: {
          ...preflight,
          pass: true,
          status: '已接受',
          warnings: [],
          risks: [],
          riskTips: [],
          issues: [],
        },
      };
    }));
  };

  const handleUpdateClipStoryboard = (clipId: string, patch: { prompt?: string; panelCount?: number; notes?: string }) => {
    setClips((current) => current.map((clip) => {
      if (clip.id !== clipId) return clip;
      return {
        ...clip,
        ...(patch.prompt !== undefined ? { storyboardPrompt: patch.prompt } : {}),
        ...(patch.panelCount !== undefined ? { storyboardPanelCount: patch.panelCount } : {}),
        ...(patch.notes !== undefined ? { storyboardNotes: patch.notes } : {}),
        ...(patch.prompt !== undefined ? { seedancePrompt: '' } : {}),
      };
    }));
    if (patch.prompt !== undefined) {
      setStageStatuses((current) => ({ ...current, video: 'idle' }));
    }
  };

  const handleOptimizeClip = async (clipId: string) => {
    if (optimizingClipId) return;
    if (projectUnavailable) {
      setWorkflowError('当前项目不存在，无法优化 Clip。请返回「我的项目」重新进入真实项目。');
      return;
    }
    setOptimizingClipId(clipId);
    setWorkflowError(null);
    try {
      const workflow = await apiClient.optimizeProjectWorkflowClip(projectId, clipId, {
        episodeId: activeEpisodeId,
        aiModelId: workflowAiModelId || undefined,
      });
      applyWorkflowSnapshot(workflow, {
        setEpisodeList,
        setActiveEpisodeId,
        setSourceText,
        setSourceName,
        setSelectedEpisode,
        setBreakdownScenes,
        setClips,
        setWorkflowAssets,
        setStageStatuses,
      });
      setWorkflowDraftProjectId(`${projectId}:${workflow.episodeId || activeEpisodeId}`);
      setActiveWorkflowStage('storyboard');
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : 'AI优化 Clip 失败');
    } finally {
      setOptimizingClipId(null);
    }
  };

  const handleGenerateClipSeedancePrompt = async (clipId: string, options: { skipCanvasSync?: boolean } = {}): Promise<ClipVideoPromptInferenceResult> => {
    if (generatingSeedanceClipId) return { ok: false };
    if (projectUnavailable) {
      setWorkflowError('当前项目不存在，无法生成视频提示词。请返回「我的项目」重新进入真实项目。');
      return { ok: false };
    }
    setGeneratingSeedanceClipId(clipId);
    setWorkflowError(null);
    try {
      const result = await apiClient.generateProjectWorkflowClipSeedancePrompt(projectId, clipId, {
        episodeId: activeEpisodeId,
        aiModelId: workflowAiModelId || undefined,
      });
      applyWorkflowSnapshot(result.workflow, {
        setEpisodeList,
        setActiveEpisodeId,
        setSourceText,
        setSourceName,
        setSelectedEpisode,
        setBreakdownScenes,
        setClips,
        setWorkflowAssets,
        setStageStatuses,
      });
      setWorkflowDraftProjectId(`${projectId}:${result.workflow.episodeId || activeEpisodeId}`);
      setActiveWorkflowStage('video');
      if (result.prompt) {
        let changed = false;
        const nextNodes = useCanvasStore.getState().nodes.map((node) => {
          if (!isVideoCanvasNode(node) || node.data?.clipId !== clipId) return node;
          changed = true;
          return {
            ...node,
            data: {
              ...node.data,
              prompt: result.prompt,
              seedancePrompt: result.prompt,
              videoPrompt: result.prompt,
              statusLabel: '视频提示词已更新',
              videoError: '',
            },
          };
        });
        if (changed) setNodes(nextNodes as any);
      }
      const nextAssets = result.workflow.assets ?? workflowAssets;
      if (!options.skipCanvasSync) {
        void handleSyncEpisodeBoardsToCanvas({
          episodeId: result.workflow.episodeId || activeEpisodeId,
          clips: result.workflow.clips ?? [],
          scenes: result.workflow.breakdownScenes as BreakdownScene[],
          assets: nextAssets,
          episode: result.workflow.selectedEpisode,
          refreshRecords: true,
        });
      }
      return {
        ok: true,
        clips: result.workflow.clips ?? [],
        scenes: result.workflow.breakdownScenes as BreakdownScene[],
        assets: nextAssets,
        episode: result.workflow.selectedEpisode,
      };
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : '视频提示词生成失败');
      return { ok: false };
    } finally {
      setGeneratingSeedanceClipId(null);
    }
  };

  const handleFitView = () => {
    fitView({ padding: 0.2, duration: 300 });
  };

  // --- Context menu state ---
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number;
    flowX: number; flowY: number;
    nodeId?: string;
  } | null>(null);
  const [selectedCanvasNodeIds, setSelectedCanvasNodeIds] = useState<string[]>([]);
  const [selectedCanvasEdgeIds, setSelectedCanvasEdgeIds] = useState<string[]>([]);
  const selectedCanvasNodeIdSet = useMemo(() => new Set(selectedCanvasNodeIds), [selectedCanvasNodeIds]);
  const selectedCanvasEdgeIdSet = useMemo(() => new Set(selectedCanvasEdgeIds), [selectedCanvasEdgeIds]);
  const selectedCanvasNodes = useMemo(() => nodes.filter((node) => selectedCanvasNodeIdSet.has(node.id)), [nodes, selectedCanvasNodeIdSet]);
  const selectedCanvasEdges = useMemo(() => edges.filter((edge) => selectedCanvasEdgeIdSet.has(edge.id)), [edges, selectedCanvasEdgeIdSet]);
  const selectedContentNodes = useMemo(
    () => selectedCanvasNodes.filter((node) => node.type !== 'section'),
    [selectedCanvasNodes],
  );
  const selectedSectionNodes = useMemo(
    () => selectedCanvasNodes.filter((node) => node.type === 'section'),
    [selectedCanvasNodes],
  );
  const contextMenuNode = useMemo(
    () => (contextMenu?.nodeId ? nodes.find((node) => node.id === contextMenu.nodeId) : null),
    [contextMenu?.nodeId, nodes],
  );
  const contextMenuIsSection = contextMenuNode?.type === 'section';
  const [connectionStart, setConnectionStart] = useState<ConnectionStartSnapshot | null>(null);
  const [connectionCreateMenu, setConnectionCreateMenu] = useState<ConnectionCreateMenu | null>(null);
  const connectionStartRef = useRef<ConnectionStartSnapshot | null>(null);
  const connectionMenuJustOpenedRef = useRef(false);
  useOnSelectionChange({
    onChange: useCallback(({ nodes: selectedNodes, edges: selectedEdges }) => {
      const nextNodeIds = selectedNodes.map((node) => node.id).sort();
      const nextEdgeIds = selectedEdges.map((edge) => edge.id).sort();
      setSelectedCanvasNodeIds((current) => canvasIdListsEqual(current, nextNodeIds) ? current : nextNodeIds);
      setSelectedCanvasEdgeIds((current) => canvasIdListsEqual(current, nextEdgeIds) ? current : nextEdgeIds);
    }, []),
  });

  // --- Node editing drawer ---
  const [editingNode, setEditingNode] = useState<string | null>(null);
  const editingNodeData = useMemo(() => {
    if (!editingNode) return null;
    return nodes.find((n) => n.id === editingNode) ?? null;
  }, [editingNode, nodes]);

  const handleEditNodeField = useCallback((field: string, value: string) => {
    if (!editingNode) return;
    const updateNodeData = useCanvasStore.getState().updateNodeData;
    updateNodeData(editingNode, { [field]: value });
  }, [editingNode]);

  const handlePaneDoubleClick = useCallback((event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('.react-flow__node')) return;
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      flowX: 0,
      flowY: 0,
    });
  }, []);

  const handlePaneContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      flowX: 0,
      flowY: 0,
    });
  }, []);

  const handleNodeContextMenu = useCallback((event: React.MouseEvent, node: { id: string }) => {
    event.preventDefault();
    event.stopPropagation();
    const nodeIsAlreadySelected = selectedCanvasNodeIdSet.has(node.id);
    if (!nodeIsAlreadySelected) {
      setSelectedCanvasNodeIds([node.id]);
      setSelectedCanvasEdgeIds([]);
    }
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      flowX: 0,
      flowY: 0,
      nodeId: node.id,
    });
  }, [selectedCanvasNodeIdSet]);

  const closeFloatingMenus = useCallback(() => {
    if (connectionMenuJustOpenedRef.current) return;
    setContextMenu(null);
    setConnectionCreateMenu(null);
  }, []);

  const handleContextAddNode = useCallback((type: CanvasNodeKind) => {
    if (!contextMenu) return;
    const position = screenToFlowPosition({ x: contextMenu.x, y: contextMenu.y });
    addNode(type, position);
    setContextMenu(null);
  }, [contextMenu, addNode, screenToFlowPosition]);

  const handleCreateSectionFromSelection = useCallback(() => {
    const selectedNodeIds = selectedCanvasNodeIds;
    const selectedNodes = useCanvasStore.getState().nodes.filter((node) => selectedNodeIds.includes(node.id) && node.type !== 'section');
    if (selectedNodes.length === 0) {
      showCanvasDropStatus('请先框选要放入分区的节点。');
      setContextMenu(null);
      return;
    }
    const allNodes = useCanvasStore.getState().nodes;
    const bounds = canvasNodesBoundingBox(selectedNodes, allNodes);
    if (!bounds) {
      showCanvasDropStatus('选中节点无法计算分区范围。');
      setContextMenu(null);
      return;
    }
    const sectionPosition = {
      x: bounds.minX - CANVAS_SECTION_PADDING_X,
      y: bounds.minY - CANVAS_SECTION_HEADER_HEIGHT,
    };
    const sectionSize = {
      width: Math.max(360, bounds.width + CANVAS_SECTION_PADDING_X * 2),
      height: Math.max(220, bounds.height + CANVAS_SECTION_HEADER_HEIGHT + CANVAS_SECTION_PADDING_BOTTOM),
    };
    const title = selectedNodes.length > 1 ? `分区 · ${selectedNodes.length} 个节点` : '分区 · 1 个节点';
    const sectionId = addCanvasSection(addNode, sectionPosition, sectionSize, {
      title,
      description: '框选节点生成的分区',
      tone: 'zinc',
      itemCount: selectedNodes.length,
      sectionKind: 'manual-selection',
    });
    const childPositions = new Map<string, { x: number; y: number }>();
    const nodeById = new Map(allNodes.map((item) => [item.id, item]));
    for (const node of selectedNodes) {
      if (node.id === sectionId || node.type === 'section') continue;
      childPositions.set(node.id, canvasNodeAbsolutePosition(node, nodeById));
    }
    attachNodesToCanvasSection(sectionId, childPositions);
    setContextMenu(null);
    showCanvasDropStatus(`已把 ${childPositions.size} 个节点放入分区。`);
  }, [addNode, selectedCanvasNodeIds, showCanvasDropStatus]);

  const handleUngroupSelection = useCallback(() => {
    const store = useCanvasStore.getState();
    const allNodes = store.nodes;
    const selectedNodeIds = selectedCanvasNodeIds;
    const selectedNodes = allNodes.filter((node) => selectedNodeIds.includes(node.id));
    const selectedSectionIds = new Set(selectedNodes.filter((node) => node.type === 'section').map((node) => node.id));
    const selectedParentIds = new Set(selectedNodes.map((node) => node.parentId).filter((value): value is string => Boolean(value)));
    const targetSectionIds = new Set([...selectedSectionIds, ...selectedParentIds]);
    if (targetSectionIds.size === 0) {
      showCanvasDropStatus('没有选中可取消的分区。');
      setContextMenu(null);
      return;
    }
    const nodeById = new Map(allNodes.map((node) => [node.id, node]));
    const childIds = new Set<string>();
    for (const node of allNodes) {
      if (node.parentId && targetSectionIds.has(node.parentId)) childIds.add(node.id);
    }
    const nextNodes = allNodes
      .filter((node) => !targetSectionIds.has(node.id))
      .map((node) => {
        if (!childIds.has(node.id)) return node;
        const absolutePosition = canvasNodeAbsolutePosition(node, nodeById);
        return {
          ...node,
          parentId: undefined,
          extent: node.extent === 'parent' ? undefined : node.extent,
          expandParent: undefined,
          position: absolutePosition,
          selected: true,
        };
      });
    const nextEdges = store.edges.filter((edge) => !targetSectionIds.has(edge.source) && !targetSectionIds.has(edge.target));
    store.setNodes(recalculateCanvasSectionItemCounts(nextNodes));
    store.setEdges(nextEdges);
    setContextMenu(null);
    showCanvasDropStatus(`已取消 ${targetSectionIds.size} 个分区。`);
  }, [selectedCanvasNodeIds, showCanvasDropStatus]);

  const openConnectionCreateMenu = useCallback((point: { x: number; y: number }, start: ConnectionStartSnapshot) => {
    const menuPoint = clampConnectionMenuPoint(point);
    const flowPosition = screenToFlowPosition(point);
    connectionMenuJustOpenedRef.current = true;
    setConnectionCreateMenu({
      x: menuPoint.x,
      y: menuPoint.y,
      flowX: flowPosition.x,
      flowY: flowPosition.y,
      nodeId: start.nodeId,
      handleId: start.handleId,
      handleType: start.handleType,
    });
    setContextMenu(null);
    window.setTimeout(() => {
      connectionMenuJustOpenedRef.current = false;
    }, 250);
  }, [screenToFlowPosition]);

  const handleConnectStart: OnConnectStart = useCallback((_event, params) => {
    if (!params.nodeId || !params.handleType) return;
    const start = {
      nodeId: params.nodeId,
      handleId: params.handleId,
      handleType: params.handleType,
    };
    connectionStartRef.current = start;
    setConnectionStart(start);
    setConnectionCreateMenu(null);
    setContextMenu(null);
  }, []);

  const handleConnectEnd: OnConnectEnd = useCallback((event, connectionState) => {
    if (connectionState.toNode) {
      connectionStartRef.current = null;
      setConnectionStart(null);
      setConnectionCreateMenu(null);
      return;
    }

    const point = clientPointFromConnectionEvent(event);
    const fromHandle = connectionState.fromHandle;
    const start = fromHandle?.nodeId && fromHandle?.type
      ? {
          nodeId: fromHandle.nodeId,
          handleId: fromHandle.id ?? null,
          handleType: fromHandle.type,
        }
      : connectionStartRef.current ?? connectionStart;
    if (!point || !start) {
      connectionStartRef.current = null;
      setConnectionStart(null);
      return;
    }

    openConnectionCreateMenu(point, start);
    connectionStartRef.current = null;
    setConnectionStart(null);
  }, [connectionStart, openConnectionCreateMenu]);

  const handleCanvasPointerUpCapture = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = connectionStartRef.current;
    if (!start) return;
    const target = event.target as HTMLElement;
    if (target.closest('.react-flow__handle')) return;
    const point = { x: event.clientX, y: event.clientY };
    window.setTimeout(() => {
      const latestStart = connectionStartRef.current;
      if (!latestStart) return;
      openConnectionCreateMenu(point, latestStart);
      connectionStartRef.current = null;
      setConnectionStart(null);
    }, 0);
  }, [openConnectionCreateMenu]);

  useEffect(() => {
    if (!connectionStart) return;
    const handleDocumentPointerUp = (event: PointerEvent) => {
      const point = { x: event.clientX, y: event.clientY };
      window.setTimeout(() => {
        const latestStart = connectionStartRef.current;
        if (!latestStart) return;
        openConnectionCreateMenu(point, latestStart);
        connectionStartRef.current = null;
        setConnectionStart(null);
      }, 0);
    };
    document.addEventListener('pointerup', handleDocumentPointerUp, true);
    return () => {
      document.removeEventListener('pointerup', handleDocumentPointerUp, true);
    };
  }, [connectionStart, openConnectionCreateMenu]);

  const handleConnectionCreateNode = useCallback((option: ConnectionCreateOption) => {
    if (!connectionCreateMenu) return;
    const newNodeId = addNode(option.type, {
      x: connectionCreateMenu.flowX,
      y: connectionCreateMenu.flowY,
    }, option.data);
    const connection: Connection = connectionCreateMenu.handleType === 'target'
      ? {
          source: newNodeId,
          sourceHandle: null,
          target: connectionCreateMenu.nodeId,
          targetHandle: connectionCreateMenu.handleId,
        }
      : {
          source: connectionCreateMenu.nodeId,
          sourceHandle: connectionCreateMenu.handleId,
          target: newNodeId,
          targetHandle: null,
        };
    onConnect(connection);
    setConnectionCreateMenu(null);
  }, [addNode, connectionCreateMenu, onConnect]);

  const connectionCreateOptions = useMemo<ConnectionCreateOption[]>(() => {
    if (!connectionCreateMenu) return [];
    if (connectionCreateMenu.handleType === 'target') {
      return [
        { key: 'image-input', type: 'imageInput', label: '图片输入', desc: '作为上游参考图', icon: ImageIcon, tone: 'text-sky-300' },
        { key: 'image-generation', type: 'generation', label: '图片', desc: '生成或重绘图片', icon: ImagePlay, tone: 'text-emerald-300', data: { mode: 'standalone', title: '自由生图' } },
        { key: 'character', type: 'character', label: '角色', desc: '引用角色资产', icon: Users, tone: 'text-primary' },
        { key: 'asset', type: 'asset', label: '资产', desc: '引用项目资产', icon: Package, tone: 'text-amber-300' },
      ];
    }
    return [
      { key: 'text', type: 'workflow', label: '文本', desc: '脚本、广告词、品牌文案', icon: FileText, tone: 'text-zinc-100', data: { title: '文本生成', description: '引用该节点生成文本', workflowKind: 'text' } },
      { key: 'translation', type: 'translation', label: '翻译', desc: '把上游提示词翻译后继续连接', icon: Languages, tone: 'text-cyan-300', data: { title: '提示词翻译' } },
      { key: 'prompt-optimizer', type: 'promptOptimizer', label: '优化', desc: '手动优化不过审提示词', icon: Wand2, tone: 'text-primary', data: { title: '提示词优化' } },
      { key: 'prompt-inspector', type: 'promptInspector', label: '检查', desc: '向上游提示词提问', icon: ClipboardCheck, tone: 'text-amber-300', data: { title: '提示词检查' } },
      { key: 'agent', type: 'agent', label: '智能体', desc: '连接后按要求修改节点', icon: Bot, tone: 'text-violet-300', data: { title: '智能体' } },
      { key: 'image', type: 'generation', label: '图片', desc: '参考图、资产图、自由生图', icon: ImagePlay, tone: 'text-emerald-300', data: { mode: 'standalone', title: '自由生图' } },
      { key: 'video', type: 'video', label: '视频', desc: '引用该节点生成视频', icon: Film, tone: 'text-sky-300', data: { title: '视频生成', description: '引用该节点生成视频', workflowKind: 'video' } },
      { key: 'world', type: 'workflow', label: '3D 世界', desc: '空间、场景、世界构建', icon: Layers3, tone: 'text-zinc-100', data: { title: '3D 世界', description: '引用该节点构建空间世界', workflowKind: 'world' } },
    ];
  }, [connectionCreateMenu]);

  const addDroppedImageInputNode = useCallback((
    position: { x: number; y: number },
    data: { imageUrl: string; label: string; fileName?: string; imageAspectRatio?: number | null; uploadStatus?: string; sourcePrompt?: string },
  ) => {
    addNode('imageInput', position, {
      label: data.label || '图片输入',
      imageUrl: data.imageUrl,
      fileName: data.fileName || data.label || '',
      imageAspectRatio: data.imageAspectRatio || undefined,
      uploadStatus: data.uploadStatus || 'uploaded',
      sourcePrompt: data.sourcePrompt || '',
      uploadError: '',
      imageLoadError: false,
    });
  }, [addNode]);

  const addDroppedGenerationNode = useCallback((position: { x: number; y: number }, payload: CanvasImageDragPayload) => {
    const assetKind = normalizeWorkflowAssetKind(payload.assetKind) ?? 'characters';
    const assetName = payload.assetName || payload.label || imageLabelFromUrl(payload.url);
    const prompt = payload.prompt || payload.revisedPrompt || '';
    addNode('generation', position, {
      title: assetName,
      assetKind,
      assetName,
      prompt,
      finalPrompt: prompt,
      visualPrompt: prompt,
      status: 'completed',
      outputImage: payload.url,
      outputImageAssetId: payload.assetId || '',
      generationId: payload.generationId || '',
      revisedPrompt: payload.revisedPrompt || '',
      size: payload.size || assetGenerationAspectRatio,
      resolution: payload.resolution || assetGenerationResolution,
      quality: payload.quality || 'high',
      modelLabel: payload.modelLabel || '',
      projectPromptContext,
    });
  }, [addNode, assetGenerationAspectRatio, assetGenerationResolution, projectPromptContext]);

  const handleCanvasDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasImage(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setCanvasDropActive(true);
  }, []);

  const handleCanvasDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      setCanvasDropActive(false);
    }
  }, []);

  const handleCanvasDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasImage(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    setCanvasDropActive(false);

    const basePosition = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const dropPosition = { x: basePosition.x - 90, y: basePosition.y - 70 };
    const existingImagePayload = extractDroppedImagePayload(event.dataTransfer);
    if (existingImagePayload) {
      if (existingImagePayload.nodeType === 'generation') {
        addDroppedGenerationNode(dropPosition, existingImagePayload);
        showCanvasDropStatus('已把历史生成图和本次提示词放入画布。');
        return;
      }
      addDroppedImageInputNode(dropPosition, {
        imageUrl: existingImagePayload.url,
        label: existingImagePayload.label || imageLabelFromUrl(existingImagePayload.url),
        fileName: existingImagePayload.fileName || existingImagePayload.label || imageLabelFromUrl(existingImagePayload.url),
        sourcePrompt: existingImagePayload.prompt || '',
        uploadStatus: 'linked',
      });
      showCanvasDropStatus('已用现有图片创建图片输入节点。');
      return;
    }

    const imageFiles = Array.from(event.dataTransfer.files ?? []).filter(isImageDropFile);

    if (imageFiles.length > 0) {
      if (projectUnavailable) {
        showCanvasDropStatus('当前项目不存在，不能上传图片到画布。');
        return;
      }
      setCanvasDropStatus(`正在上传 ${imageFiles.length} 张图片...`);
      let added = 0;
      for (const [index, file] of imageFiles.entries()) {
        try {
          const [publicUrl, aspectRatio] = await Promise.all([
            uploadCanvasReferenceFile(projectId || 'local', file),
            getImageFileAspectRatio(file),
          ]);
          addDroppedImageInputNode(
            { x: dropPosition.x + index * 28, y: dropPosition.y + index * 28 },
            {
              imageUrl: publicUrl,
              label: file.name || '图片输入',
              fileName: file.name,
              imageAspectRatio: aspectRatio,
              uploadStatus: 'uploaded',
            },
          );
          added += 1;
          setCanvasDropStatus(`已添加 ${added}/${imageFiles.length} 张图片到画布。`);
        } catch (error) {
          showCanvasDropStatus(error instanceof Error ? error.message : '图片拖入上传失败。');
          return;
        }
      }
      showCanvasDropStatus(`已添加 ${added} 张图片输入节点。`);
      return;
    }

    showCanvasDropStatus('没有识别到可用图片。请拖入图片文件或公网图片。');
  }, [addDroppedGenerationNode, addDroppedImageInputNode, projectId, projectUnavailable, screenToFlowPosition, showCanvasDropStatus]);

  const handleCanvasImageFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const imageFiles = Array.from(event.target.files ?? []).filter(isImageDropFile);
    event.target.value = '';
    if (imageFiles.length === 0) return;
    if (projectUnavailable) {
      showCanvasDropStatus('当前项目不存在，不能上传图片到画布。');
      return;
    }
    const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const basePosition = { x: center.x - 130, y: center.y - 90 };
    setCanvasDropStatus(`正在上传 ${imageFiles.length} 张图片到画布...`);
    let added = 0;
    for (const [index, file] of imageFiles.entries()) {
      try {
        const [publicUrl, aspectRatio] = await Promise.all([
          uploadCanvasReferenceFile(projectId || 'local', file),
          getImageFileAspectRatio(file),
        ]);
        addDroppedImageInputNode(
          { x: basePosition.x + index * 34, y: basePosition.y + index * 34 },
          {
            imageUrl: publicUrl,
            label: file.name || '图片输入',
            fileName: file.name,
            imageAspectRatio: aspectRatio,
            uploadStatus: 'uploaded',
          },
        );
        added += 1;
      } catch (error) {
        showCanvasDropStatus(error instanceof Error ? error.message : '图片上传到画布失败。');
        return;
      }
    }
    showCanvasDropStatus(`已上传 ${added} 张图片，并创建图片输入节点。`);
  }, [addDroppedImageInputNode, projectId, projectUnavailable, screenToFlowPosition, showCanvasDropStatus]);

  const handleAddHistoryImageInputToCanvas = useCallback((imageUrl: string, label: string, sourcePrompt?: string) => {
    const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    addDroppedImageInputNode(
      { x: center.x - 130, y: center.y - 90 },
      {
        imageUrl,
        label,
        fileName: label,
        sourcePrompt: sourcePrompt || '',
        uploadStatus: 'linked',
      },
    );
    showCanvasDropStatus('已作为图片输入放入画布。');
  }, [addDroppedImageInputNode, screenToFlowPosition, showCanvasDropStatus]);

  const handleAddLibraryDirectorBoardToCanvas = useCallback((entry: DirectorBoardLibraryItem) => {
    const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    addDroppedImageInputNode(
      { x: center.x - 150, y: center.y - 100 },
      {
        imageUrl: entry.imageUrl,
        label: entry.name || '导演板',
        fileName: `${entry.episodeTitle}-${entry.name || '导演板'}.png`,
        imageAspectRatio: 1.78,
        sourcePrompt: entry.prompt,
        uploadStatus: 'linked',
      },
    );
    showCanvasDropStatus(`已把 ${entry.episodeTitle} · ${entry.name} 作为图片输入放入画布。`);
  }, [addDroppedImageInputNode, screenToFlowPosition, showCanvasDropStatus]);

  const handleContextDeleteNode = useCallback(() => {
    if (!contextMenu?.nodeId) return;
    const store = useCanvasStore.getState();
    const target = store.nodes.find((node) => node.id === contextMenu.nodeId);
    if (!target) {
      setContextMenu(null);
      return;
    }
    if (target.type === 'section') {
      const descendantIds = collectCanvasSectionDescendantIds(store.nodes, target.id);
      const removeIds = new Set([target.id, ...descendantIds]);
      if (!window.confirm(`确定删除这个分区里的 ${descendantIds.size} 个节点吗？分区和相关连线也会删除。`)) return;
      const nextNodes = store.nodes.filter((node) => !removeIds.has(node.id));
      const nextEdges = store.edges.filter((edge) => !removeIds.has(edge.source) && !removeIds.has(edge.target));
      store.markNodesDeleted(removeIds);
      store.setNodes(recalculateCanvasSectionItemCounts(nextNodes));
      store.setEdges(nextEdges);
      showCanvasDropStatus(`已删除分区和 ${descendantIds.size} 个分区内节点。`);
      setContextMenu(null);
      return;
    }
    store.removeNode(contextMenu.nodeId);
    setContextMenu(null);
  }, [contextMenu, showCanvasDropStatus]);

  const handleContextDuplicateNode = useCallback(() => {
    if (!contextMenu?.nodeId) return;
    const source = nodes.find((n) => n.id === contextMenu.nodeId);
    if (!source) return;
    if (source.type === 'section') {
      showCanvasDropStatus('分区复制暂不支持，请框选分区内节点后重新创建分区。');
      setContextMenu(null);
      return;
    }
    addNode(
      (source.type as CanvasNodeKind) || 'scene',
      { x: source.position.x + 50, y: source.position.y + 50 },
      { ...source.data }
    );
    setContextMenu(null);
  }, [contextMenu, nodes, addNode]);

  // --- Batch delete ---
  const handleDeleteSelected = useCallback(() => {
    const selectedNodeIds = selectedCanvasNodeIds;
    const selectedEdgeIds = selectedCanvasEdgeIds;
    const selectedNodes = nodes.filter((n) => selectedNodeIds.includes(n.id));
    const selectedEdges = edges.filter((e) => selectedEdgeIds.includes(e.id));
    if (selectedNodes.length === 0 && selectedEdges.length === 0) return;
    const count = selectedNodes.length + selectedEdges.length;
    if (!window.confirm(`确定删除选中的 ${count} 个元素吗？`)) return;
    const nodeIds = new Set(selectedNodes.map((n) => n.id));
    for (const node of selectedNodes) {
      if (node.type !== 'section') continue;
      for (const descendantId of collectCanvasSectionDescendantIds(nodes, node.id)) {
        nodeIds.add(descendantId);
      }
    }
    const newNodes = detachNodesFromRemovedParents(nodes, nodeIds, nodes);
    const newEdges = edges.filter((e) => !selectedEdgeIds.includes(e.id) && !nodeIds.has(e.source) && !nodeIds.has(e.target));
    markCanvasNodesDeleted(nodeIds);
    setNodes(newNodes);
    setEdges(newEdges);
    setSelectedCanvasNodeIds([]);
    setSelectedCanvasEdgeIds([]);
  }, [nodes, edges, markCanvasNodesDeleted, selectedCanvasEdgeIds, selectedCanvasNodeIds, setNodes, setEdges]);

  // --- Reset canvas ---
  const handleResetCanvas = useCallback(() => {
    if (!window.confirm('确定要清空画布吗？所有节点和连线将被删除，此操作不可撤销。')) return;
    markCanvasNodesDeleted(nodes.map((node) => node.id));
    setNodes([]);
    setEdges([]);
  }, [markCanvasNodesDeleted, nodes, setNodes, setEdges]);

  const handleBatchGenerateStoryboardImages = useCallback(async () => {
    if (batchGeneratingStoryboards) return;
    if (projectUnavailable || !projectId || projectId === 'local') {
      showCanvasDropStatus('当前项目不可用，无法批量生成故事板图片。');
      return;
    }

    const store = useCanvasStore.getState();
    const selectedSet = new Set(selectedCanvasNodeIds);
    const scopedNodes = selectedSet.size > 0
      ? store.nodes.filter((node) => selectedSet.has(node.id))
      : store.nodes;
    const targets = scopedNodes
      .filter((node) => isCurrentEpisodeStoryboardGenerationNode(node as any, activeEpisodeId))
      .filter((node) => {
        const status = String(node.data?.status || '');
        if (status === 'generating') return false;
        return isStoryboardGenerationMissingImage(node as any) || status === 'failed' || status === 'idle' || status === 'waiting';
      });

    if (targets.length === 0) {
      showCanvasDropStatus(selectedSet.size > 0 ? '选中节点里没有需要生成的故事板图片。' : '当前集没有需要生成的故事板图片。');
      return;
    }

    const defaultImageModelId = assetGenerationModelId || assetImageModels[0]?.id || '';
    let completed = 0;
    let failed = 0;
    setBatchGeneratingStoryboards(true);
    showCanvasDropStatus(`开始提交 ${targets.length} 个故事板图片生成任务...`);

    try {
      for (const target of targets) {
        const latestStore = useCanvasStore.getState();
        const latestNode = latestStore.nodes.find((node) => node.id === target.id) ?? target;
        const latestNodeById = new Map(latestStore.nodes.map((node) => [node.id, node]));
        const incomingReferences = latestStore.edges
          .filter((edge) => edge.target === latestNode.id)
          .map((edge, index) => ({ edge, index, source: latestNodeById.get(edge.source) }))
          .sort((a, b) => generationReferenceSourcePriority(a.source) - generationReferenceSourcePriority(b.source) || a.index - b.index);
        const seenRefs = new Set<string>();
        const referenceImages = incomingReferences
          .map(({ source }) => {
            if (shouldSkipCanvasGenerationReference(source as any, latestNode as any)) return null;
            const url = source ? canvasNodeReferenceUrl(source as any) : '';
            if (!url) return null;
            const ref = {
              url,
              label: String(source?.data?.label || source?.data?.title || source?.data?.name || '参考图'),
              kind: canvasReferenceImageKind(source as any),
              name: String(source?.data?.assetName || source?.data?.name || source?.data?.title || source?.data?.label || ''),
            };
            const key = canvasReferenceDedupKey(ref);
            if (seenRefs.has(key)) return null;
            seenRefs.add(key);
            return ref;
          })
          .filter((ref): ref is { url: string; label: string; kind: any; name: string } => Boolean(ref));

        const rawPrompt = String(latestNode.data?.finalPrompt || latestNode.data?.prompt || latestNode.data?.storyboardPrompt || '').trim();
        const promptForGeneration = prepareCanvasPromptForImageModel(appendReferenceImageMapPrompt(rawPrompt, referenceImages));
        const sourceLabel = canvasNodePromptLabel(latestNode as any);
        if (!promptForGeneration) {
          failed += 1;
          setNodes(useCanvasStore.getState().nodes.map((node) => node.id === latestNode.id ? {
            ...node,
            data: { ...node.data, status: 'failed', error: '故事板提示词为空，无法生成。', generationStartedAt: '', generationRequestId: '' },
          } : node));
          showCanvasDropStatus(`故事板生成进度 ${completed + failed}/${targets.length}，失败 ${failed}。`);
          continue;
        }
        if (!isCanvasPromptWithinApiLimit(promptForGeneration)) {
          failed += 1;
          setNodes(useCanvasStore.getState().nodes.map((node) => node.id === latestNode.id ? {
            ...node,
            data: {
              ...node.data,
              status: 'failed',
              error: canvasPromptTooLongError('image', promptForGeneration.length),
              generationStartedAt: '',
              generationRequestId: '',
            },
          } : node));
          showCanvasDropStatus(`故事板生成进度 ${completed + failed}/${targets.length}，失败 ${failed}。`);
          continue;
        }

        const generationStartedAt = canvasGenerationStartedAt();
        const requestToken = createCanvasGenerationRequestToken(latestNode.id, Date.now());
        setNodes(useCanvasStore.getState().nodes.map((node) => node.id === latestNode.id ? {
          ...node,
          data: {
            ...node.data,
            status: 'generating',
            progress: 0,
            error: '正在提交故事板图片生成任务...',
            canvasSubmitStatus: 'submitting',
            canvasSubmitError: '正在提交到后端...',
            canvasSubmitStartedAt: generationStartedAt,
            generationStartedAt,
            generationRequestId: requestToken,
            outputImage: '',
            outputImageAssetId: '',
            outputImages: [],
            revisedPrompt: '',
            finalPrompt: promptForGeneration,
            submittedPrompt: promptForGeneration,
            manualFinalPrompt: true,
            mode: latestNode.data?.mode || 'standalone',
          },
        } : node));

        try {
          const result = await apiClient.generateCanvasImage(projectId, {
            prompt: promptForGeneration,
            referenceImageUrls: referenceImages.map((ref) => ref.url),
            aiModelId: String(latestNode.data?.modelId || defaultImageModelId || '') || undefined,
            size: normalizeCanvasImageSize(latestNode.data?.size),
            count: 1,
            parameters: {
              quality: String(latestNode.data?.quality || 'high'),
              format: 'png',
              resolution: normalizeImageResolution(latestNode.data?.resolution),
            },
            metadata: {
              title: String(latestNode.data?.title || sourceLabel),
              clipId: String(latestNode.data?.clipId || ''),
              clipTitle: String(latestNode.data?.clipTitle || latestNode.data?.title || ''),
              clipNodeKind: String(latestNode.data?.clipNodeKind || 'storyboard'),
              storyboardForClip: latestNode.data?.storyboardForClip !== false,
              sourceEpisode: String(latestNode.data?.sourceEpisode || selectedEpisode?.title || ''),
              sourceEpisodeId: activeEpisodeId,
              requestId: requestToken,
              nodeId: latestNode.id,
            },
            submitOnly: true,
          });
          const outputImageAssetId = readObjectString(result.asset, 'id');
          const backendGenerationId = readObjectString(result.generation, 'id');
          const outputImageVariants = canvasOutputImageVariantsFromResult(result);
          setNodes(useCanvasStore.getState().nodes.map((node) => {
            if (node.id !== latestNode.id) return node;
            if (result.image?.url) {
              return {
                ...node,
                data: {
                  ...node.data,
                  status: 'completed',
                  outputImage: result.image.url,
                  outputImageAssetId: outputImageAssetId || node.data?.outputImageAssetId || '',
                  outputImages: outputImageVariants,
                  revisedPrompt: result.image.revisedPrompt,
                  finalPrompt: promptForGeneration,
                  submittedPrompt: result.prompt || promptForGeneration,
                  manualFinalPrompt: true,
                  canvasSubmitStatus: '',
                  canvasSubmitError: '',
                  canvasSubmitStartedAt: '',
                  error: '',
                  generationStartedAt: '',
                  generationRequestId: '',
                  generationId: backendGenerationId || readObjectString(node.data, 'generationId'),
                },
              };
            }
            return {
              ...node,
              data: {
                ...node.data,
                status: 'generating',
                error: '后端已接收，等待上游返回...',
                canvasSubmitStatus: '',
                canvasSubmitError: '',
                canvasSubmitStartedAt: '',
                generationStartedAt,
                generationRequestId: requestToken,
                generationId: backendGenerationId || readObjectString(node.data, 'generationId'),
                finalPrompt: promptForGeneration,
                submittedPrompt: result.prompt || promptForGeneration,
                manualFinalPrompt: true,
              },
            };
          }));
          completed += 1;
          window.dispatchEvent(new Event(CANVAS_GENERATION_RECORDS_REFRESH_EVENT));
        } catch (error) {
          failed += 1;
          const message = appendCanvasImageGenerationRetryHint(
            error instanceof Error ? error.message : '故事板图片生成提交失败',
            referenceImages.length,
            normalizeImageResolution(latestNode.data?.resolution),
          );
          setNodes(useCanvasStore.getState().nodes.map((node) => node.id === latestNode.id ? {
            ...node,
            data: {
              ...node.data,
              status: 'failed',
              error: message,
              canvasSubmitStatus: '',
              canvasSubmitError: '',
              canvasSubmitStartedAt: '',
              generationStartedAt: '',
              generationRequestId: '',
            },
          } : node));
        }
        showCanvasDropStatus(`故事板生成进度 ${completed + failed}/${targets.length}，已提交 ${completed}${failed ? `，失败 ${failed}` : ''}。`);
      }
      showCanvasDropStatus(`故事板图片批量提交完成：已提交 ${completed} 个${failed ? `，失败 ${failed} 个` : ''}。`);
    } finally {
      setBatchGeneratingStoryboards(false);
    }
  }, [
    activeEpisodeId,
    assetGenerationModelId,
    assetImageModels,
    batchGeneratingStoryboards,
    projectId,
    projectUnavailable,
    selectedCanvasNodeIds,
    selectedEpisode?.title,
    setNodes,
    showCanvasDropStatus,
  ]);

  const handleBatchTranslatePromptsToChinese = useCallback(async () => {
    if (batchTranslatingPrompts) return;
    if (projectUnavailable || !projectId || projectId === 'local') {
      showCanvasDropStatus('当前项目不可用，无法调用文本模型批量翻译。');
      return;
    }

    const selectedSet = new Set(selectedCanvasNodeIds);
    const scopeNodes = selectedSet.size > 0
      ? nodes.filter((node) => selectedSet.has(node.id) && BATCH_TRANSLATION_SELECTED_NODE_TYPES.has(String(node.type)))
      : nodes.filter((node) => isCurrentEpisodeVideoPromptNode(node as any, activeEpisodeId));
    const seenSourceIds = new Set<string>();
    const targets = scopeNodes
      .map((node) => ({ node, prompt: canvasNodePromptText(node as any) }))
      .filter(({ node, prompt }) => {
        if (!prompt || seenSourceIds.has(node.id)) return false;
        seenSourceIds.add(node.id);
        return true;
      });

    if (targets.length === 0) {
      showCanvasDropStatus(selectedSet.size > 0 ? '选中节点里没有可批量翻译的提示词。' : '当前集没有可批量翻译的视频提示词节点。请先生成视频提示词并同步画布。');
      return;
    }

    setBatchTranslatingPrompts(true);
    showCanvasDropStatus(`正在创建 ${targets.length} 个翻译节点，并用 DeepSeek 4 Flash 翻译成中文...`);
    try {
      const modelResult = await apiClient.listModelConfigs();
      const textModels = modelResult.models.filter(isWorkflowTextModel);
      const deepSeek4Flash = findDeepSeek4FlashTextModel(textModels);
      if (!deepSeek4Flash) {
        showCanvasDropStatus('没有找到已启用的 deepseek-4-flash 文本模型配置，请先在模型设置里添加/启用。');
        return;
      }

      const initialStore = useCanvasStore.getState();
      const targetSourceIds = new Set(targets.map((target) => target.node.id));
      const staleBatchTranslationIds = new Set(initialStore.nodes
        .filter((node) => node.type === 'translation' && node.data?.batchTranslation === true && targetSourceIds.has(String(node.data?.sourceNodeId || '')))
        .map((node) => node.id));
      let nextNodes = initialStore.nodes.filter((node) => !staleBatchTranslationIds.has(node.id));
      let nextEdges = initialStore.edges.filter((edge) => !staleBatchTranslationIds.has(edge.source) && !staleBatchTranslationIds.has(edge.target));
      if (staleBatchTranslationIds.size > 0) {
        markCanvasNodesDeleted(staleBatchTranslationIds);
        setNodes(nextNodes);
        setEdges(nextEdges);
      }
      let completed = 0;
      let failed = 0;
      const translationJobs: Array<{ translationNodeId: string; sourcePrompt: string; sourceLabel: string }> = [];

      for (const target of targets) {
        const source = nextNodes.find((node) => node.id === target.node.id) ?? target.node;
        const sourcePrompt = canvasNodePromptText(source as any) || target.prompt;
        const translationNodeId = batchTranslationNodeIdForSource(source.id);
        const sourceLabel = canvasNodePromptLabel(source as any);
        const translationPosition = batchTranslationNodePositionForSource(source as any, nextNodes as any[]);
        const translationNode = nextNodes.find((node) => node.id === translationNodeId);
        const startedAt = canvasGenerationStartedAt();
        if (translationNode) {
          nextNodes = nextNodes.map((node) => node.id === translationNodeId ? {
            ...node,
            position: translationPosition,
            data: {
              ...node.data,
              title: `${sourceLabel} · 中文翻译`,
              sourcePrompt,
              translatedPrompt: '',
              sourceLanguage: 'auto',
              targetLanguage: 'Chinese',
              status: 'translating',
              error: '',
              modelId: deepSeek4Flash.id,
              preserveStructure: true,
              sourceNodeId: source.id,
              sourceNodeLabel: sourceLabel,
              translationStartedAt: startedAt,
              batchTranslation: true,
              sourceEpisodeId: activeEpisodeId,
            },
          } : node);
        } else {
          nextNodes = [
            ...nextNodes,
            {
              id: translationNodeId,
              type: 'translation',
              position: translationPosition,
              style: { width: 520 },
              data: {
                title: `${sourceLabel} · 中文翻译`,
                sourceLanguage: 'auto',
                targetLanguage: 'Chinese',
                sourcePrompt,
                translatedPrompt: '',
                status: 'translating',
                modelId: deepSeek4Flash.id,
                preserveStructure: true,
                sourceNodeId: source.id,
                sourceNodeLabel: sourceLabel,
                translationStartedAt: startedAt,
                batchTranslation: true,
                sourceEpisodeId: activeEpisodeId,
              },
            } as any,
          ];
        }
        const edgeId = `batch-translation-${source.id}-${translationNodeId}`;
        if (!nextEdges.some((edge) => edge.id === edgeId || (edge.source === source.id && edge.target === translationNodeId))) {
          nextEdges = [
            ...nextEdges,
            {
              id: edgeId,
              source: source.id,
              sourceHandle: null,
              target: translationNodeId,
              targetHandle: null,
              type: 'smoothstep',
            } as Edge,
          ];
        }
        setNodes(nextNodes);
        setEdges(nextEdges);
        translationJobs.push({ translationNodeId, sourcePrompt, sourceLabel });
      }

      await Promise.all(translationJobs.map(async ({ translationNodeId, sourcePrompt, sourceLabel }) => {
        try {
          const translated = await apiClient.translateCanvasPrompt(projectId, {
            prompt: sourcePrompt,
            aiModelId: deepSeek4Flash.id,
            sourceLanguage: 'auto',
            targetLanguage: 'Chinese',
            preserveStructure: true,
            context: `Canvas batch translation. Source node: ${sourceLabel}.`,
          });
          completed += 1;
          nextNodes = useCanvasStore.getState().nodes.map((node) => node.id === translationNodeId ? {
            ...node,
            data: {
              ...node.data,
              sourcePrompt,
              translatedPrompt: translated.translatedPrompt,
              status: 'completed',
              error: '',
              lastModel: translated.model,
              lastDurationMs: translated.durationMs,
              translationStartedAt: '',
            },
          } : node);
          setNodes(nextNodes);
        } catch (error) {
          failed += 1;
          nextNodes = useCanvasStore.getState().nodes.map((node) => node.id === translationNodeId ? {
            ...node,
            data: {
              ...node.data,
              status: 'failed',
              error: error instanceof Error ? error.message : '批量翻译失败',
              translationStartedAt: '',
            },
          } : node);
          setNodes(nextNodes);
        }
        showCanvasDropStatus(`批量翻译进度 ${completed + failed}/${targets.length}，成功 ${completed}${failed ? `，失败 ${failed}` : ''}。`);
      }));

      showCanvasDropStatus(`批量中文翻译完成：成功 ${completed} 个${failed ? `，失败 ${failed} 个` : ''}。`);
      window.setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 0);
    } finally {
      setBatchTranslatingPrompts(false);
    }
  }, [
    activeEpisodeId,
    batchTranslatingPrompts,
    fitView,
    markCanvasNodesDeleted,
    nodes,
    projectId,
    projectUnavailable,
    selectedCanvasNodeIds,
    setEdges,
    setNodes,
    showCanvasDropStatus,
  ]);

  // Keyboard shortcut for delete
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
        if (selectedCanvasNodeIds.length > 0 || selectedCanvasEdgeIds.length > 0) {
          e.preventDefault();
          handleDeleteSelected();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleDeleteSelected, selectedCanvasEdgeIds.length, selectedCanvasNodeIds.length]);

  // --- Edge click to disconnect ---
  const handleEdgeClick = useCallback((_event: React.MouseEvent, edge: { id: string; source: string; target: string }) => {
    const sourceNode = nodes.find((n) => n.id === edge.source);
    const targetNode = nodes.find((n) => n.id === edge.target);
    const label = `${sourceNode?.data?.title || sourceNode?.data?.name || edge.source} → ${targetNode?.data?.title || targetNode?.data?.name || edge.target}`;
    if (window.confirm(`断开连线「${label}」？`)) {
      setEdges(edges.filter((e) => e.id !== edge.id));
    }
  }, [nodes, edges, setEdges]);

  // --- Auto-trigger downstream when upstream completes ---
  const prevNodeStatuses = useRef<Record<string, string>>({});

  useEffect(() => {
    const currentStatuses: Record<string, string> = {};
    for (const node of nodes) {
      if (node.data?.status) {
        currentStatuses[node.id] = node.data.status as string;
      }
    }

    const prev = prevNodeStatuses.current;
    for (const node of nodes) {
      const nodeStatus = node.data?.status as string | undefined;
      if (nodeStatus === 'completed' && prev[node.id] && prev[node.id] !== 'completed') {
        const downstreamEdges = edges.filter((e) => e.source === node.id);
        for (const edge of downstreamEdges) {
          const target = nodes.find((n) => n.id === edge.target);
          if (target && target.data?.status === 'waiting') {
            const updateNodeData = useCanvasStore.getState().updateNodeData;
            updateNodeData(target.id, { status: 'generating' });
            setTimeout(() => {
              updateNodeData(target.id, {
                status: 'completed',
                image: target.data?.image || 'https://images.unsplash.com/photo-1618331835717-801e976710b2?w=600&q=80',
              });
            }, 3000);
          }
        }
      }
    }

    prevNodeStatuses.current = currentStatuses;
  }, [nodes, edges]);

  const flowNodes = useMemo(() => uniqueCanvasNodesById(normalizeReactFlowCanvasNodes(nodes as any[]) as typeof nodes), [nodes]);
  const nodeStatusById = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of nodes) {
      const status = node.data?.status;
      if (typeof status === 'string') map.set(node.id, status);
    }
    return map;
  }, [nodes]);

  // Style edges based on connection status
  const styledEdges = useMemo(() => {
    let changed = false;
    const nextEdges = edges.map((edge) => {
      const sourceStatus = nodeStatusById.get(edge.source);
      const targetStatus = nodeStatusById.get(edge.target);

      let style = { ...edge.style };
      let animated = edge.animated ?? false;

      if (sourceStatus === 'completed' && targetStatus === 'generating') {
        style = { ...style, stroke: 'var(--primary)', strokeWidth: 2 };
        animated = true;
      } else if (sourceStatus === 'completed' && targetStatus === 'completed') {
        style = { ...style, stroke: '#22c55e', strokeWidth: 1.5 };
        animated = false;
      } else if (sourceStatus === 'completed') {
        style = { ...style, stroke: 'var(--primary)', strokeWidth: 1.5 };
        animated = false;
      } else {
        style = { ...style, stroke: '#3f3f46' };
        animated = false;
      }

      if (edge.animated === animated && canvasStyleValuesEqual(edge.style, style)) return edge;
      changed = true;
      return { ...edge, style, animated };
    });
    return changed ? nextEdges : edges;
  }, [edges, nodeStatusById]);

  useEffect(() => {
    const signature = flowNodes.map(canvasNodeChangeSignature).join('\n');
    if (reactFlowNodeSignatureRef.current === signature) return;
    reactFlowNodeSignatureRef.current = signature;
    setReactFlowNodes(flowNodes);
  }, [flowNodes, setReactFlowNodes]);

  useEffect(() => {
    const signature = styledEdges
      .map((edge) => [
        edge.id,
        edge.source,
        edge.target,
        edge.sourceHandle || '',
        edge.targetHandle || '',
        edge.type || '',
        edge.animated ? '1' : '0',
        stableCanvasValue(edge.style),
        stableCanvasValue(edge.data),
      ].join('|'))
      .join('\n');
    if (reactFlowEdgeSignatureRef.current === signature) return;
    reactFlowEdgeSignatureRef.current = signature;
    setReactFlowEdges(styledEdges);
  }, [styledEdges, setReactFlowEdges]);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Toolbar */}
      <div className="z-10 flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-[#141416] px-3 py-2 sm:flex-nowrap sm:px-4">
        <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto sm:gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="h-8 gap-1 bg-layer-4 text-zinc-100 hover:bg-zinc-700"
            onClick={handleAddNode}
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">添加节点</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-8 gap-1 bg-layer-4 text-zinc-100 hover:bg-zinc-700"
            onClick={() => canvasImageFileRef.current?.click()}
          >
            <UploadCloud className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">上传图片</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-8 gap-1 bg-layer-4 text-zinc-100 hover:bg-zinc-700"
            onClick={openProjectGlobalSettings}
            disabled={projectUnavailable}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">全局设定</span>
          </Button>
          <div className="mx-1 h-4 w-px shrink-0 bg-zinc-700 sm:mx-2" />
          <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-zinc-100" title="撤销">
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-zinc-100" title="重做">
            <RotateCw className="h-4 w-4" />
          </Button>
          <div className="mx-1 h-4 w-px shrink-0 bg-zinc-700 sm:mx-2" />
          <Button variant="ghost" size="sm" className="h-8 shrink-0 text-zinc-400 hover:text-zinc-100">自动布局</Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 text-zinc-400 hover:text-zinc-100"
            onClick={handleFitView}
          >
            适应屏幕
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 text-cyan-300 hover:bg-cyan-500/10 hover:text-cyan-200"
            onClick={handleBatchGenerateStoryboardImages}
            disabled={batchGeneratingStoryboards || projectUnavailable}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{batchGeneratingStoryboards ? '故事板生成中' : '一键生成故事板图'}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 text-cyan-300 hover:bg-cyan-500/10 hover:text-cyan-200"
            onClick={handleBatchTranslatePromptsToChinese}
            disabled={batchTranslatingPrompts || projectUnavailable}
          >
            <Languages className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{batchTranslatingPrompts ? '翻译中' : '批量中文翻译'}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 text-zinc-400 hover:text-zinc-100"
            onClick={handleDeleteSelected}
            disabled={selectedCanvasNodes.length === 0 && selectedCanvasEdges.length === 0}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">删除选中</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 text-zinc-400 hover:text-zinc-100"
            onClick={handleCreateSectionFromSelection}
            disabled={selectedContentNodes.length === 0}
          >
            <Layers3 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">给选中分区</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 text-zinc-400 hover:text-zinc-100"
            onClick={handleUngroupSelection}
            disabled={selectedSectionNodes.length === 0 && !selectedContentNodes.some((node) => node.parentId)}
          >
            <X className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">取消分区</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
            onClick={handleResetCanvas}
          >
            清空画布
          </Button>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button className="h-8 gap-1.5 bg-primary hover:bg-primary/90">
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">导出项目</span>
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <div
        className="relative h-full w-full flex-1 overflow-hidden"
        onContextMenu={(event) => event.preventDefault()}
        onDoubleClick={handlePaneDoubleClick}
        onClick={contextMenu || connectionCreateMenu ? closeFloatingMenus : undefined}
        onPointerUpCapture={handleCanvasPointerUpCapture}
        onDragOverCapture={handleCanvasDragOver}
        onDragOver={handleCanvasDragOver}
        onDragLeave={handleCanvasDragLeave}
        onDropCapture={handleCanvasDrop}
        onDrop={handleCanvasDrop}
      >
        <ReactFlow
          key={activeCanvasSceneId}
          nodes={flowNodes}
          edges={styledEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={handleConnectStart}
          onConnectEnd={handleConnectEnd}
          nodeTypes={nodeTypes}
          onPaneContextMenu={handlePaneContextMenu}
          onNodeContextMenu={handleNodeContextMenu}
          onEdgeClick={handleEdgeClick}
          selectionKeyCode="Control"
          multiSelectionKeyCode="Control"
          selectionMode={SelectionMode.Partial}
          deleteKeyCode={null}
          minZoom={0.08}
          maxZoom={2.5}
          onlyRenderVisibleElements
          fitView
          className="bg-background"
          colorMode="dark"
        >
          <Background color="#27272a" gap={20} size={1} />
          <Controls className="!bg-[#141416] !border-zinc-800 !fill-zinc-400" />
          <MiniMap
            className="hidden overflow-hidden rounded-lg !border-zinc-800 !bg-[#141416] sm:block"
            nodeColor={(n) => {
              if (n.type === 'scene') return '#27272a';
              return '#18181b';
            }}
            maskColor="rgba(0, 0, 0, 0.5)"
          />
        </ReactFlow>

        {/* Connection create menu */}
        {connectionCreateMenu && (
          <div
            className="fixed z-50 w-[300px] overflow-hidden rounded-xl border border-border/80 bg-[#1b1b1f]/98 p-3 shadow-2xl backdrop-blur"
            style={{ left: connectionCreateMenu.x, top: connectionCreateMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 px-1">
              <div className="text-[12px] font-semibold text-zinc-400">
                {connectionCreateMenu.handleType === 'target' ? '选择上游引用节点' : '引用该节点生成'}
              </div>
            </div>
            <div className="space-y-2">
              {connectionCreateOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.key}
                    type="button"
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-layer-4/90"
                    onClick={() => handleConnectionCreateNode(option)}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-layer-4 text-zinc-100">
                      <Icon className={cn("h-5 w-5", option.tone)} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold leading-5 text-zinc-100">{option.label}</span>
                      <span className="mt-0.5 block truncate text-[12px] leading-4 text-zinc-500">{option.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {(canvasDropActive || canvasDropStatus) && (
          <div className="pointer-events-none absolute inset-x-0 top-4 z-[70] flex justify-center px-4">
            <div
              className={cn(
                "rounded-lg border px-4 py-2 text-[12px] shadow-2xl backdrop-blur",
                canvasDropActive
                  ? "border-sky-400/70 bg-sky-500/15 text-sky-100"
                  : "border-border bg-[#141416]/95 text-zinc-200",
              )}
            >
              {canvasDropActive ? '松开鼠标，将图片作为「图片输入」节点放入画布' : canvasDropStatus}
            </div>
          </div>
        )}

        {/* Context Menu */}
        {contextMenu && (
          <div
            className="fixed z-50 min-w-[160px] rounded-lg border border-border bg-[#1a1a1e] py-1 shadow-xl"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.nodeId ? (
              <>
                {selectedContentNodes.length > 0 ? (
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-layer-4"
                    onClick={handleCreateSectionFromSelection}
                  >
                    <Layers3 className="h-3.5 w-3.5 text-zinc-300" /> 给选中节点分区
                  </button>
                ) : null}
                {(selectedSectionNodes.length > 0 || selectedContentNodes.some((node) => node.parentId)) ? (
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-layer-4"
                    onClick={handleUngroupSelection}
                  >
                    <X className="h-3.5 w-3.5 text-zinc-400" /> 取消分区
                  </button>
                ) : null}
                {(selectedContentNodes.length > 0 || selectedSectionNodes.length > 0) ? <div className="my-1 border-t border-zinc-800" /> : null}
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-layer-4"
                  onClick={handleContextDuplicateNode}
                >
                  <Copy className="h-3.5 w-3.5 text-zinc-400" /> 复制节点
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-red-400 hover:bg-layer-4"
                  onClick={handleContextDeleteNode}
                >
                  <Trash2 className="h-3.5 w-3.5" /> {contextMenuIsSection ? '删除分区内节点' : '删除节点'}
                </button>
              </>
            ) : (
              <>
                <div className="px-3 py-1.5 text-[11px] font-medium text-zinc-500">添加节点</div>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-layer-4"
                  onClick={() => handleContextAddNode('scene')}
                >
                  <ImageIcon className="h-3.5 w-3.5 text-emerald-400" /> 分镜
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-layer-4"
                  onClick={() => handleContextAddNode('character')}
                >
                  <Users className="h-3.5 w-3.5 text-primary" /> 角色
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-layer-4"
                  onClick={() => handleContextAddNode('asset')}
                >
                  <Package className="h-3.5 w-3.5 text-amber-400" /> 资产
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-layer-4"
                  onClick={() => handleContextAddNode('episode')}
                >
                  <Film className="h-3.5 w-3.5 text-sky-400" /> 章节
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-layer-4"
                  onClick={() => handleContextAddNode('workflow')}
                >
                  <Layers3 className="h-3.5 w-3.5 text-primary" /> 工作流
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-layer-4"
                  onClick={() => handleContextAddNode('video')}
                >
                  <MonitorPlay className="h-3.5 w-3.5 text-sky-400" /> 视频
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-layer-4"
                  onClick={() => handleContextAddNode('imageInput')}
                >
                  <ImageIcon className="h-3.5 w-3.5 text-sky-400" /> 图片输入
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-layer-4"
                  onClick={() => handleContextAddNode('generation')}
                >
                  <Wand2 className="h-3.5 w-3.5 text-primary" /> 生成图片
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-layer-4"
                  onClick={() => handleContextAddNode('translation')}
                >
                  <Languages className="h-3.5 w-3.5 text-cyan-400" /> 翻译提示词
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-layer-4"
                  onClick={() => handleContextAddNode('promptOptimizer')}
                >
                  <Wand2 className="h-3.5 w-3.5 text-primary" /> 优化提示词
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-layer-4"
                  onClick={() => handleContextAddNode('promptInspector')}
                >
                  <ClipboardCheck className="h-3.5 w-3.5 text-amber-400" /> 检查提示词
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-layer-4"
                  onClick={() => handleContextAddNode('agent')}
                >
                  <Bot className="h-3.5 w-3.5 text-violet-300" /> 智能体
                </button>
                {selectedContentNodes.length > 0 ? (
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-layer-4"
                    onClick={handleCreateSectionFromSelection}
                  >
                    <Layers3 className="h-3.5 w-3.5 text-zinc-300" /> 给选中节点分区
                  </button>
                ) : null}
                {(selectedSectionNodes.length > 0 || selectedContentNodes.some((node) => node.parentId)) ? (
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-layer-4"
                    onClick={handleUngroupSelection}
                  >
                    <X className="h-3.5 w-3.5 text-zinc-400" /> 取消分区
                  </button>
                ) : null}
                <div className="my-1 border-t border-zinc-800" />
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-layer-4"
                  onClick={() => { handleDeleteSelected(); setContextMenu(null); }}
                  disabled={selectedCanvasNodes.length === 0}
                >
                  <Trash2 className="h-3.5 w-3.5 text-zinc-400" /> 删除选中
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-red-400 hover:bg-layer-4"
                  onClick={() => { handleResetCanvas(); setContextMenu(null); }}
                >
                  <X className="h-3.5 w-3.5" /> 清空画布
                </button>
              </>
            )}
          </div>
        )}

        {/* Node Editing Drawer */}
        {editingNode && editingNodeData && (
          <div className="absolute right-0 top-0 z-30 flex h-full w-[340px] flex-col border-l border-zinc-800 bg-[#141416] shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <div className="text-[14px] font-semibold text-zinc-100">
                {editingNodeData.type === 'character' ? '编辑角色' : editingNodeData.type === 'scene' ? '编辑分镜' : editingNodeData.type === 'imageInput' ? '编辑图片输入' : editingNodeData.type === 'translation' ? '编辑翻译节点' : editingNodeData.type === 'promptOptimizer' ? '编辑优化节点' : editingNodeData.type === 'promptInspector' ? '编辑检查节点' : editingNodeData.type === 'agent' ? '编辑智能体' : editingNodeData.type === 'section' ? '编辑分区' : '编辑节点'}
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-zinc-100" onClick={() => setEditingNode(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {editingNodeData.type === 'character' ? (
                <>
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">角色名称</label>
                    <input
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-zinc-100 focus:border-primary focus:outline-none"
                      value={editingNodeData.data.name || ''}
                      onChange={(e) => handleEditNodeField('name', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">角色特征</label>
                    <textarea
                      className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-[13px] leading-5 text-zinc-100 focus:border-primary focus:outline-none"
                      rows={3}
                      value={editingNodeData.data.traits || ''}
                      onChange={(e) => handleEditNodeField('traits', e.target.value)}
                    />
                  </div>
                  {editingNodeData.data.avatar && (
                    <div>
                      <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">头像预览</label>
                      <img
                        src={editingNodeData.data.avatar}
                        alt="avatar"
                        className="h-20 w-20 cursor-zoom-in rounded-full border border-border object-cover"
                        onDoubleClick={(event) => previewCanvasImage(event, { url: editingNodeData.data.avatar, title: editingNodeData.data.name || '角色图', subtitle: '头像预览' })}
                      />
                    </div>
                  )}
                </>
              ) : editingNodeData.type === 'scene' ? (
                <>
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">分镜标题</label>
                    <input
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-zinc-100 focus:border-primary focus:outline-none"
                      value={editingNodeData.data.title || ''}
                      onChange={(e) => handleEditNodeField('title', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">场景描述</label>
                    <textarea
                      className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-[12px] leading-5 text-zinc-200 placeholder-zinc-600 focus:border-primary focus:outline-none"
                      rows={3}
                      value={editingNodeData.data.description || ''}
                      onChange={(e) => handleEditNodeField('description', e.target.value)}
                    />
                  </div>
                  {editingNodeData.data.image && (
                    <div>
                      <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">当前图片</label>
                      <img
                        src={editingNodeData.data.image}
                        alt="scene"
                        className="aspect-video w-full cursor-zoom-in rounded-md border border-border object-cover"
                        onDoubleClick={(event) => previewCanvasImage(event, { url: editingNodeData.data.image, title: editingNodeData.data.title || '分镜图', subtitle: editingNodeData.data.description || undefined })}
                      />
                    </div>
                  )}
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">生图提示词（完整）</label>
                    <p className="mb-1 text-[11px] text-zinc-600">此提示词将直接发送给生图模型</p>
                    <PromptTextarea
                      className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-[12px] leading-5 text-zinc-200 placeholder-zinc-600 focus:border-primary focus:outline-none"
                      rows={6}
                      placeholder="描述场景的完整视觉内容，包括环境、光线、构图、风格等..."
                      value={editingNodeData.data.visualPrompt || ''}
                      onChange={(value) => handleEditNodeField('visualPrompt', value)}
                      modalTitle={`${editingNodeData.data.title || '分镜'} · 生图提示词`}
                      modalSubtitle="完整生图提示词"
                    />
                  </div>
                  <div className="rounded-md border border-zinc-800 bg-background p-3">
                    <div className="text-[11px] font-medium text-zinc-500 mb-1">状态</div>
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", editingNodeData.data.status === 'completed' ? 'bg-green-500' : editingNodeData.data.status === 'generating' ? 'bg-yellow-500' : 'bg-zinc-600')} />
                      <span className="text-[12px] text-zinc-300">
                        {editingNodeData.data.status === 'completed' ? '已完成' : editingNodeData.data.status === 'generating' ? '生成中' : '等待生成'}
                      </span>
                    </div>
                  </div>
                </>
              ) : editingNodeData.type === 'imageInput' ? (
                <>
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">标签</label>
                    <input
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-zinc-100 focus:border-primary focus:outline-none"
                      value={editingNodeData.data.label || ''}
                      onChange={(e) => handleEditNodeField('label', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">图片 URL</label>
                    <input
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-zinc-100 focus:border-primary focus:outline-none"
                      placeholder="https://..."
                      value={editingNodeData.data.imageUrl || ''}
                      onChange={(e) => handleEditNodeField('imageUrl', e.target.value)}
                    />
                  </div>
                  {editingNodeData.data.imageUrl && (
                    <div>
                      <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">预览</label>
                      <img
                        src={editingNodeData.data.imageUrl}
                        alt="参考图"
                        className="w-full cursor-zoom-in rounded-md border border-border object-cover"
                        onDoubleClick={(event) => previewCanvasImage(event, { url: editingNodeData.data.imageUrl, title: editingNodeData.data.label || '图片输入', subtitle: '参考图' })}
                      />
                    </div>
                  )}
                  <p className="text-[11px] text-zinc-500">将此节点连线到分镜或角色节点，生成时会作为参考图输入。</p>
                </>
              ) : editingNodeData.type === 'section' ? (
                <>
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">分区标题</label>
                    <input
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-zinc-100 focus:border-primary focus:outline-none"
                      value={editingNodeData.data.title || ''}
                      onChange={(e) => handleEditNodeField('title', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">说明</label>
                    <textarea
                      className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-[12px] leading-5 text-zinc-200 placeholder-zinc-600 focus:border-primary focus:outline-none"
                      rows={3}
                      value={editingNodeData.data.description || ''}
                      onChange={(e) => handleEditNodeField('description', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">颜色</label>
                    <select
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-zinc-100 focus:border-primary focus:outline-none"
                      value={editingNodeData.data.tone || 'zinc'}
                      onChange={(e) => handleEditNodeField('tone', e.target.value)}
                    >
                      <option value="zinc">灰色</option>
                      <option value="amber">黄色</option>
                      <option value="sky">蓝色</option>
                      <option value="emerald">绿色</option>
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">节点标题</label>
                    <input
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-zinc-100 focus:border-primary focus:outline-none"
                      value={editingNodeData.data.title || ''}
                      onChange={(e) => handleEditNodeField('title', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">描述</label>
                    <textarea
                      className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-[12px] leading-5 text-zinc-200 placeholder-zinc-600 focus:border-primary focus:outline-none"
                      rows={4}
                      value={editingNodeData.data.description || ''}
                      onChange={(e) => handleEditNodeField('description', e.target.value)}
                    />
                  </div>
                </>
              )}
            </div>
            <div className="border-t border-zinc-800 px-4 py-3">
              <Button
                className="w-full bg-primary hover:bg-primary/90 text-white"
                onClick={() => setEditingNode(null)}
              >
                完成编辑
              </Button>
            </div>
          </div>
        )}

        {projectUnavailable && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 p-4">
            <div className="w-full max-w-md rounded-lg border border-red-500/30 bg-[#141416] p-5 shadow-2xl">
              <div className="mb-2 text-[15px] font-semibold text-zinc-100">项目不存在</div>
              <p className="text-[13px] leading-6 text-zinc-400">
                当前链接指向旧本地示例项目或已删除项目，后端没有对应记录。请回到「我的项目」，从真实项目卡片重新进入。
              </p>
              <div className="mt-5 flex justify-end">
                <Link to="/app/dashboard">
                  <Button className="h-8 bg-primary text-white hover:bg-primary/90">返回我的项目</Button>
                </Link>
              </div>
            </div>
          </div>
        )}
        <div className="absolute left-3 top-3 z-20 flex flex-col gap-2">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            title="流程中心"
            className={cn(
              "h-10 w-10 border border-border bg-[#141416] text-zinc-200 shadow-xl hover:bg-layer-4",
              activePanel === 'workflow' && "border-primary text-primary"
            )}
            onClick={() => setActivePanel((value) => (value === 'workflow' ? null : 'workflow'))}
          >
            <ListChecks className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            title="资产区"
            className={cn(
              "h-10 w-10 border border-border bg-[#141416] text-zinc-200 shadow-xl hover:bg-layer-4",
              activePanel === 'assets' && "border-emerald-500 text-emerald-200"
            )}
            onClick={() => setActivePanel((value) => (value === 'assets' ? null : 'assets'))}
          >
            <Boxes className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            title="全资产库"
            className={cn(
              "h-10 w-10 border border-border bg-[#141416] text-zinc-200 shadow-xl hover:bg-layer-4",
              activePanel === 'assetLibrary' && "border-amber-500 text-amber-200"
            )}
            onClick={() => setActivePanel((value) => (value === 'assetLibrary' ? null : 'assetLibrary'))}
          >
            <PackageOpen className="h-4 w-4" />
          </Button>
        </div>

        <input
          ref={sourceFileRef}
          type="file"
          accept=".txt,.md,.markdown,text/plain,text/markdown"
          className="hidden"
          onChange={handleSourceFile}
        />
        <input
          ref={canvasImageFileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleCanvasImageFile}
        />
        <input
          ref={assetImageFileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleAssetReferenceFile}
        />
        <input
          ref={assetAudioFileRef}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.opus,.webm,.flac"
          multiple
          className="hidden"
          onChange={handleAssetAudioFile}
        />

        {activePanel === 'workflow' && (
          <WorkflowCenterOverlay
            generationStrategy={currentGenerationStrategy}
            storyboardEnabled={storyboardEnabled}
            firstFrameUnavailable={firstFrameUnavailable}
            activeStage={activeWorkflowStage}
            setActiveStage={setActiveWorkflowStage}
            sourceText={sourceText}
            setSourceText={setSourceText}
            sourceName={sourceName}
            setSourceName={setSourceName}
            selectedEpisode={selectedEpisode}
            setSelectedEpisode={setSelectedEpisode}
            episodeList={episodeList}
            activeEpisodeId={activeEpisodeId}
            activeEpisodeSummary={activeEpisodeSummary}
            episodeSwitching={episodeSwitching}
            episodeCreating={episodeCreating}
            finalizeClipStoryboardPrompt={finalizeClipStoryboardPrompt}
            onSelectEpisode={(episodeId) => {
              if (episodeId !== activeEpisodeId) void loadEpisodeWorkspace(episodeId);
            }}
            onCreateNextEpisode={() => void createNextEpisodeWorkspace()}
            onSaveSource={() => void handleSaveWorkflowSource()}
            scenes={breakdownScenes}
            clips={clips}
            assets={workflowAssets}
            stageStatuses={stageStatuses}
            workflowLoading={workflowLoading}
            workflowSaving={workflowSaving}
            workflowRunning={workflowRunning}
            workflowError={workflowError}
            workflowProgressText={workflowProgressText}
            workflowModels={workflowModels}
            workflowAiModelId={workflowAiModelId}
            setWorkflowAiModelId={setWorkflowAiModelId}
            workflowModelsLoading={workflowModelsLoading}
            workflowModelError={workflowModelError}
            runBreakdown={handleRunBreakdown}
            rerunStoryboard={handleRerunStoryboard}
            inferBoardsAndVideoToCanvas={handleInferBoardsAndVideoToCanvas}
            onSyncEpisodeBoardsToCanvas={handleSyncEpisodeBoardsToCanvas}
            onFullPipelineInfer={handleFullPipelineInfer}
            fullPipelineRunning={fullPipelineRunning}
            onClose={() => setActivePanel(null)}
            onUploadClick={() => sourceFileRef.current?.click()}
            onAddWorkflowNode={handleAddWorkflowNode}
            onAddSceneNode={handleAddSceneNode}
            onAddClipStoryboardNode={handleAddClipStoryboardNode}
            onAddClipStoryboardImageReferenceNode={handleAddClipStoryboardImageReferenceNode}
            onAddClipVideoNode={handleAddClipVideoNode}
            onAddClipPositioningBoardNode={handleAddClipPositioningBoardNode}
            onAddClipPositioningBoardNodes={handleAddClipPositioningBoardNodes}
            onUpdateClipStoryboard={handleUpdateClipStoryboard}
            onUpdateScene={handleUpdateScene}
            onDeleteScene={handleDeleteScene}
            onAcceptClip={handleAcceptClip}
            onOptimizeClip={handleOptimizeClip}
            onGenerateClipSeedancePrompt={handleGenerateClipSeedancePrompt}
            onUploadAssetReference={handleUploadAssetReference}
            onUploadAudioReference={handleUploadAudioReference}
            onClearAudioReference={handleClearAudioReference}
            onBatchUploadCharacterAudioReferences={handleBatchUploadCharacterAudioReferences}
            onOpenProjectGlobalSettings={openProjectGlobalSettings}
            onOpenCharacterPropPicker={openCharacterPropPicker}
            onGenerateAssetImage={handleGenerateAssetImage}
            onOpenAssetHistory={handleOpenAssetHistory}
            onLoadAssetHistoryImages={handleLoadAssetHistoryImages}
            onPreviewAssetImage={setAssetImagePreview}
            onAddAssetToCanvas={handleAddAssetToCanvas}
            onClearAssetCurrentImage={handleClearAssetCurrentImage}
            onRemoveAsset={handleRemoveWorkflowAsset}
            onUpdateAssetPrompt={handleUpdateWorkflowAssetPrompt}
            buildAssetFinalPrompt={buildWorkflowAssetFinalPromptForItem}
            isAssetUploadBusy={isAssetUploadBusy}
            isAssetGenerationBusy={isAssetGenerationBusy}
            optimizingClipId={optimizingClipId}
            generatingSeedanceClipId={generatingSeedanceClipId}
            inferBoardsAndVideoRunning={workflowInferAllRunning}
            storyboardImageRefs={clipStoryboardImageRefs}
          />
        )}

        {activePanel === 'assetLibrary' && (
          <div className="absolute bottom-3 left-16 top-3 z-20 flex w-[34vw] min-w-[520px] max-w-[760px] max-[900px]:w-[calc(100%-5rem)] max-[900px]:min-w-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-[#111113]/95 shadow-2xl backdrop-blur">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
              <div className="flex min-w-0 items-center gap-2 text-[14px] font-semibold text-zinc-100">
                <PackageOpen className="h-4 w-4 shrink-0 text-amber-300" />
                <span className="truncate">全资产库</span>
                <span className="rounded border border-border bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                  {assetLibraryTotalCount}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px] text-zinc-400 hover:text-zinc-100"
                  disabled={assetLibraryLoading}
                  onClick={() => void loadAssetLibrary()}
                >
                  <RotateCw className={cn("h-3.5 w-3.5", assetLibraryLoading && "animate-spin")} />
                  刷新
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-100" onClick={() => setActivePanel(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="shrink-0 border-b border-zinc-800 bg-[#111113] px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={assetLibraryEpisodeId}
                  onChange={(event) => setAssetLibraryEpisodeId(event.target.value)}
                  className="h-8 min-w-[150px] rounded-md border border-zinc-800 bg-background px-2 text-[12px] text-zinc-100 outline-none focus:border-amber-500"
                >
                  <option value="all">全部剧集</option>
                  {assetLibraryEpisodes.map((episode) => (
                    <option key={episode.id} value={episode.id}>
                      {workflowEpisodeLibraryTitle(episode)}
                    </option>
                  ))}
                </select>
                <div className="flex flex-1 flex-wrap gap-1">
                  {assetLibraryCategories.map((category) => {
                    const Icon = category.icon;
                    const active = assetLibraryCategory === category.key;
                    return (
                      <button
                        key={category.key}
                        type="button"
                        className={cn(
                          "inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-[12px] transition-colors",
                          active
                            ? "border-amber-500 bg-amber-500/10 text-amber-100"
                            : "border-zinc-800 bg-background text-zinc-400 hover:border-border hover:text-zinc-100"
                        )}
                        onClick={() => setAssetLibraryCategory(category.key)}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {category.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {assetLibraryStatus && (
                <div className="mt-2 rounded-md border border-zinc-800 bg-background px-3 py-2 text-[11px] leading-4 text-zinc-400">
                  {assetLibraryStatus}
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {assetLibraryLoading ? (
                <div className="rounded-lg border border-dashed border-zinc-800 bg-background px-4 py-8 text-center text-[12px] text-zinc-500">
                  正在加载所有剧集资产...
                </div>
              ) : assetLibraryCategory === 'directorBoards' ? (
                assetLibraryDirectorItems.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-zinc-800 bg-background px-4 py-8 text-center text-[12px] text-zinc-500">
                    暂无导演板图片记录。
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 2xl:grid-cols-3">
                    {assetLibraryDirectorItems.map((item) => (
                      <div key={item.id} className="overflow-hidden rounded-md border border-zinc-800 bg-background">
                        <button
                          type="button"
                          draggable
                          className="group relative aspect-video w-full bg-zinc-950"
                          onDragStart={(event) => setImageDragData(event.dataTransfer, item.imageUrl, {
                            label: item.name,
                            fileName: `${item.episodeTitle}-${item.name}.png`,
                            prompt: item.prompt,
                            assetId: item.imageAssetId,
                            generationId: item.generationId,
                          })}
                          onClick={() => setAssetImagePreview({
                            url: item.imageUrl,
                            title: item.name,
                            subtitle: `${item.episodeTitle} · 导演板`,
                          })}
                          onDoubleClick={() => setAssetImagePreview({
                            url: item.imageUrl,
                            title: item.name,
                            subtitle: `${item.episodeTitle} · 导演板`,
                          })}
                        >
                          <img
                            src={item.imageUrl}
                            alt={item.name}
                            draggable
                            className="h-full w-full object-cover transition-transform group-hover:scale-105"
                            onDragStart={(event) => setImageDragData(event.dataTransfer, item.imageUrl, {
                              label: item.name,
                              fileName: `${item.episodeTitle}-${item.name}.png`,
                              prompt: item.prompt,
                              assetId: item.imageAssetId,
                              generationId: item.generationId,
                            })}
                          />
                          <span className="pointer-events-none absolute inset-0 hidden items-center justify-center bg-black/35 text-[10px] text-zinc-100 group-hover:flex">
                            预览 / 拖入
                          </span>
                        </button>
                        <div className="space-y-2 p-2">
                          <div className="min-w-0">
                            <div className="truncate text-[12px] font-medium text-zinc-100">{item.name}</div>
                            <div className="mt-0.5 truncate text-[10px] text-zinc-500">{item.episodeTitle}</div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 w-full text-[11px] text-amber-300 hover:bg-amber-500/10 hover:text-amber-100"
                            onClick={() => handleAddLibraryDirectorBoardToCanvas(item)}
                          >
                            <Layers3 className="h-3.5 w-3.5" />
                            放入画布
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : assetLibraryAssetItems.length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-800 bg-background px-4 py-8 text-center text-[12px] text-zinc-500">
                  当前筛选下暂无资产。
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 2xl:grid-cols-3">
                  {assetLibraryAssetItems.map((item) => {
                    const category = assetLibraryCategories.find((entry) => entry.key === item.kind);
                    const Icon = category?.icon ?? Package;
                    const preview = item.imageUrl ? {
                      url: item.imageUrl,
                      title: item.name,
                      subtitle: `${item.episodeTitle} · ${workflowAssetKindLabel(item.kind)}`,
                    } : null;
                    return (
                      <div key={item.id} className="overflow-hidden rounded-md border border-zinc-800 bg-background">
                        {item.imageUrl ? (
                          <button
                            type="button"
                            draggable
                            className="group relative aspect-square w-full bg-zinc-950"
                            onDragStart={(event) => setImageDragData(event.dataTransfer, item.imageUrl, {
                              label: item.name,
                              fileName: item.name,
                              assetKind: item.kind,
                              assetName: item.name,
                              assetId: item.imageAssetId,
                            })}
                            onClick={() => preview && setAssetImagePreview(preview)}
                            onDoubleClick={() => preview && setAssetImagePreview(preview)}
                          >
                            <img
                              src={item.imageUrl}
                              alt={item.name}
                              draggable
                              className="h-full w-full object-cover transition-transform group-hover:scale-105"
                              onDragStart={(event) => setImageDragData(event.dataTransfer, item.imageUrl, {
                                label: item.name,
                                fileName: item.name,
                                assetKind: item.kind,
                                assetName: item.name,
                                assetId: item.imageAssetId,
                              })}
                            />
                            <span className="pointer-events-none absolute inset-0 hidden items-center justify-center bg-black/35 text-[10px] text-zinc-100 group-hover:flex">
                              预览 / 拖入
                            </span>
                          </button>
                        ) : (
                          <div className="flex aspect-square w-full items-center justify-center bg-zinc-950 text-zinc-700">
                            <Icon className="h-8 w-8" />
                          </div>
                        )}
                        <div className="space-y-2 p-2">
                          <div className="min-w-0">
                            <div className="truncate text-[12px] font-medium text-zinc-100">{item.name}</div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-zinc-500">
                              <span className="truncate">{item.episodeTitle}</span>
                              <span className="shrink-0">·</span>
                              <span className="shrink-0">{workflowAssetKindLabel(item.kind)}</span>
                            </div>
                          </div>
                          {item.description && (
                            <div className="line-clamp-2 text-[10px] leading-4 text-zinc-500">
                              {item.description}
                            </div>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 w-full text-[11px] text-amber-300 hover:bg-amber-500/10 hover:text-amber-100"
                            onClick={() => handleAddLibraryAssetToCanvas(item)}
                          >
                            <Layers3 className="h-3.5 w-3.5" />
                            放入画布
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {activePanel === 'assets' && (
          <div className="absolute bottom-3 left-16 top-3 z-20 flex w-[520px] max-w-[calc(100%-5rem)] flex-col overflow-hidden rounded-lg border border-zinc-800 bg-[#111113]/95 shadow-2xl backdrop-blur">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-zinc-100">
                <Boxes className="h-4 w-4 text-emerald-300" />
                项目资产
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-100" onClick={() => setActivePanel(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-3 overflow-y-auto p-4">
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                <div className="flex items-center gap-2 text-[13px] font-medium text-primary">
                  <ImageIcon className="h-4 w-4 text-primary" />
                  资产图生成
                </div>
                <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <p className="text-[12px] leading-5 text-primary/60">
                    在下方资产卡片直接上传参考图或生成图片；也可以把同名历史图加载回当前集资产。
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 shrink-0 bg-emerald-500 text-[11px] text-black hover:bg-emerald-400"
                    disabled={assetHistoryLoadBusy}
                    onClick={() => void handleLoadAssetHistoryImages('all')}
                  >
                    <ImageIcon className="h-3.5 w-3.5" />
                    {assetHistoryLoadBusy ? '加载中...' : '一键加载历史图'}
                  </Button>
                </div>
                <div className="mt-3 space-y-2">
                  <label className="block text-[11px] font-medium text-primary/70">
                    图片模型
                    <select
                      value={assetGenerationModelId}
                      onChange={(event) => setAssetGenerationModelId(event.target.value)}
                      disabled={workflowModelsLoading || assetImageModels.length === 0}
                      className="mt-1 h-8 w-full rounded-md border border-zinc-800 bg-[#0d0d0f] px-3 text-[12px] text-zinc-100 outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="">{assetImageModels.length === 0 ? '未配置图片模型' : '使用后端默认图片模型'}</option>
                      {assetImageModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {modelOptionLabel(model)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-[11px] font-medium text-primary/70">
                      比例
                      <select
                        value={assetGenerationAspectRatio}
                        onChange={(event) => setAssetGenerationAspectRatio(event.target.value)}
                        className="mt-1 h-8 w-full rounded-md border border-zinc-800 bg-[#0d0d0f] px-2 text-[12px] text-zinc-100 outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {assetImageAspectRatioOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-[11px] font-medium text-primary/70">
                      大小
                      <select
                        value={assetGenerationResolution}
                        onChange={(event) => setAssetGenerationResolution(event.target.value)}
                        className="mt-1 h-8 w-full rounded-md border border-zinc-800 bg-[#0d0d0f] px-2 text-[12px] text-zinc-100 outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {assetImageResolutionOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="block text-[11px] font-medium text-emerald-100/70">
                    参考图识别模型
                    <select
                      value={assetUploadModelId}
                      onChange={(event) => setAssetUploadModelId(event.target.value)}
                      disabled={workflowModelsLoading || assetUploadBusyKeys.length > 0 || workflowModels.length === 0}
                      className="mt-1 h-8 w-full rounded-md border border-zinc-800 bg-[#0d0d0f] px-3 text-[12px] text-zinc-100 outline-none focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="">{workflowModelsLoading ? '加载模型中...' : '使用当前文本模型'}</option>
                      {workflowModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {modelOptionLabel(model)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {assetUploadStatus && (
                  <div className="mt-2 rounded-md border border-zinc-800 bg-[#0d0d0f] px-3 py-2 text-[11px] leading-4 text-zinc-400">
                    {assetUploadStatus}
                  </div>
                )}
                {assetGenerationStatus && (
                  <div className="mt-2 rounded-md border border-zinc-800 bg-[#0d0d0f] px-3 py-2 text-[11px] leading-4 text-zinc-400">
                    {assetGenerationStatus}
                  </div>
                )}
              </div>
              {assetHistoryTarget && (
                <div className="rounded-lg border border-zinc-800 bg-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-zinc-100">
                        {assetHistoryTarget.asset.name || '资产'} {assetHistoryVariantFilter === 'with-props' ? '道具版图片' : '历史图片'}
                      </div>
                      <div className="mt-1 text-[11px] leading-4 text-zinc-500">
                        {assetHistoryVariantFilter === 'with-props'
                          ? '这里选择已经生成好的角色道具版图，并设为当前图。新道具版请从小包裹入口生成。'
                          : '每条记录保留当次实际提示词。可拖入画布继续修改，也可设为当前图或参考生成。'}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-zinc-500 hover:text-zinc-100"
                      onClick={() => {
                        setAssetHistoryTarget(null);
                        setAssetHistoryItems([]);
                        setAssetHistoryStatus(null);
                        setAssetHistoryVariantFilter('all');
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {assetHistoryStatus && (
                    <div className="mt-2 rounded-md border border-zinc-800 bg-[#0d0d0f] px-3 py-2 text-[11px] leading-4 text-zinc-400">
                      {assetHistoryStatus}
                    </div>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {assetHistoryItems
                      .filter((image) => assetHistoryVariantFilter === 'with-props' ? assetHistoryImageIsWithProps(image) : true)
                      .map((image) => {
                        const imageUrl = normalizeReusableImageSource(image.url) || image.url;
                        const actualPrompt = image.prompt || image.revisedPrompt || '';
                        const metaItems = [
                          image.modelLabel,
                          image.size,
                          image.resolution?.toUpperCase(),
                          image.quality ? image.quality.toUpperCase() : '',
                          image.referenceImageCount ? `${image.referenceImageCount} 参考` : '',
                          formatDurationMs(image.durationMs),
                        ].filter(Boolean);
                        const dragPayload: Partial<CanvasImageDragPayload> = {
                          nodeType: 'imageInput',
                          assetKind: assetHistoryTarget.kind,
                          assetName: assetHistoryTarget.asset.name || image.title || '资产历史图',
                          assetId: image.id,
                          generationId: image.generationId,
                          label: assetHistoryTarget.asset.name || image.title || '资产历史图',
                          prompt: actualPrompt,
                          revisedPrompt: image.revisedPrompt,
                          source: image.source,
                          size: image.size,
                          resolution: image.resolution,
                          quality: image.quality,
                          modelLabel: image.modelLabel,
                        };
                        const preview = {
                          url: imageUrl,
                          title: image.title || assetHistoryTarget.asset.name || '资产历史图',
                          subtitle: `${assetImageSourceLabel(image.source)}${metaItems.length ? ` · ${metaItems.join(' · ')}` : ''}${image.createdAt ? ` · ${new Date(image.createdAt).toLocaleString()}` : ''}`,
                        };
                        return (
                          <div key={image.id} className="overflow-hidden rounded-md border border-zinc-800 bg-background">
                            <div className="relative aspect-square bg-zinc-950">
                              <button
                                type="button"
                                draggable
                                className="group h-full w-full"
                                title="拖到画布会创建图片输入节点，并保留本次实际提示词"
                                onDragStart={(event) => setImageDragData(event.dataTransfer, imageUrl, dragPayload)}
                                onClick={() => setAssetImagePreview(preview)}
                                onDoubleClick={() => setAssetImagePreview(preview)}
                              >
                                <img
                                  src={imageUrl}
                                  alt={image.title || '资产历史图'}
                                  draggable
                                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                                  onDragStart={(event) => setImageDragData(event.dataTransfer, imageUrl, dragPayload)}
                                  onDoubleClick={() => setAssetImagePreview(preview)}
                                />
                                <span className="pointer-events-none absolute inset-0 hidden items-center justify-center bg-black/35 text-[10px] text-zinc-100 group-hover:flex">
                                  图片输入 / 预览
                                </span>
                              </button>
                              {image.isCurrent && (
                                <span className="absolute left-1 top-1 rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-medium text-black">
                                  当前
                                </span>
                              )}
                            </div>
                            <div className="space-y-1 p-2">
                              <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-500">
                                <span>{assetImageSourceLabel(image.source)}</span>
                                <span>{image.createdAt ? new Date(image.createdAt).toLocaleDateString() : ''}</span>
                              </div>
                              {metaItems.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {metaItems.slice(0, 4).map((meta) => (
                                    <span key={meta} className="rounded border border-zinc-800 bg-[#141416] px-1.5 py-0.5 text-[9px] text-zinc-500">
                                      {meta}
                                    </span>
                                  ))}
                                </div>
                              )}
                              <div className="rounded border border-zinc-800 bg-[#101014] p-2">
                                <div className="mb-1 flex items-center justify-between gap-2">
                                  <span className="text-[10px] text-zinc-500">本次实际提示词</span>
                                  {actualPrompt ? (
                                    <button
                                      type="button"
                                      className="inline-flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-100"
                                      onClick={() => void navigator.clipboard?.writeText(actualPrompt).catch(() => undefined)}
                                    >
                                      <Copy className="h-3 w-3" />
                                      复制
                                    </button>
                                  ) : null}
                                </div>
                                <div className="max-h-20 overflow-y-auto whitespace-pre-wrap text-[10px] leading-4 text-zinc-400">
                                  {actualPrompt || '旧记录未保存提示词。'}
                                </div>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className={cn(
                                  "h-7 w-full text-[11px]",
                                  image.isCurrent
                                    ? "text-zinc-400 hover:bg-layer-4 hover:text-zinc-100"
                                    : "text-zinc-200 hover:bg-layer-4 hover:text-zinc-50"
                                )}
                                disabled={assetHistoryLoading}
                                onClick={() => image.isCurrent
                                  ? void handleClearAssetCurrentImage(assetHistoryTarget.kind, assetHistoryTarget.asset)
                                  : void handleSelectAssetHistoryImage(image)}
                              >
                                {image.isCurrent ? '取消当前' : '设为当前'}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-full text-[11px] text-amber-300 hover:bg-amber-500/10 hover:text-amber-100"
                                onClick={() => handleAddHistoryImageInputToCanvas(imageUrl, assetHistoryTarget.asset.name || image.title || '资产历史图', actualPrompt)}
                              >
                                作为图片输入
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-full text-[11px] text-sky-300 hover:bg-sky-500/10 hover:text-sky-100"
                                disabled={isAssetGenerationBusy(assetHistoryTarget.kind, assetHistoryTarget.asset)}
                                onClick={() => handleGenerateAssetImage(assetHistoryTarget.kind, assetHistoryTarget.asset, { referenceImageUrl: imageUrl })}
                              >
                                {isAssetGenerationBusy(assetHistoryTarget.kind, assetHistoryTarget.asset) ? '生成中...' : '用此图参考生成'}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-full text-[11px] text-red-300 hover:bg-red-500/10 hover:text-red-100"
                                disabled={assetHistoryLoading}
                                onClick={() => handleDeleteAssetHistoryImage(image)}
                              >
                                <Trash2 className="h-3 w-3" />
                                删除历史图
                              </Button>
                            </div>
                        </div>
                        );
                      })}
                  </div>
                  {assetHistoryLoading && (
                    <div className="mt-2 text-[11px] text-zinc-500">正在读取资产历史...</div>
                  )}
                </div>
              )}
              {assetGroups.map((item) => {
                const Icon = item.icon;
                const items = assetArray(workflowAssets, item.key);
                return (
                  <div key={item.title} className="rounded-lg border border-zinc-800 bg-card p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-200">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-[13px] font-medium text-zinc-100">
                            <span>{item.title}</span>
                            <span className="rounded border border-border bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400">{items.length}</span>
                          </div>
                          <div className="mt-1 text-[12px] leading-5 text-zinc-500">{item.desc}</div>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 text-[11px] text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-100"
                        onClick={() => handleAddWorkflowNode('asset', item.title, item.desc)}
                      >
                        放入画布
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-3 h-7 text-[11px] text-sky-300 hover:bg-sky-500/10 hover:text-sky-100"
                      disabled={assetHistoryLoadBusy || items.length === 0}
                      onClick={() => void handleLoadAssetHistoryImages(item.key)}
                    >
                      <ImageIcon className="h-3.5 w-3.5" />
                      加载本组历史图
                    </Button>
                    {item.key === 'characters' ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mt-3 ml-2 h-7 text-[11px] text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-100"
                        disabled={assetUploadBusyKeys.length > 0 || items.length === 0}
                        onClick={handleBatchUploadCharacterAudioReferences}
                        title="一次选择 1-5 音频：1 Bob，2 Chloe，3 Leo，4 Tiffany，5 Eugene"
                      >
                        <Mic className="h-3.5 w-3.5" />
                        批量上传音频
                      </Button>
                    ) : null}
                    <AssetMiniList
                      assetKind={item.key}
                      items={items}
                      emptyText="暂无提取资产"
                      onUploadReference={(asset) => handleUploadAssetReference(item.key, asset)}
                      onUploadAudioReference={item.key === 'characters' ? handleUploadAudioReference : undefined}
                      onClearAudioReference={item.key === 'characters' ? handleClearAudioReference : undefined}
                      onOpenCharacterPropPicker={item.key === 'characters' ? openCharacterPropPicker : undefined}
                      onGenerateImage={(asset, options) => handleGenerateAssetImage(item.key, asset, options)}
                      onOpenHistory={(asset, variantFilter) => handleOpenAssetHistory(item.key, asset, variantFilter)}
                      onPreviewImage={setAssetImagePreview}
                      onAddToCanvas={handleAddAssetToCanvas}
                      onClearCurrentImage={(asset) => void handleClearAssetCurrentImage(item.key, asset)}
                      onRemoveAsset={handleRemoveWorkflowAsset}
                      onUpdateAssetPrompt={handleUpdateWorkflowAssetPrompt}
                      buildAssetFinalPrompt={buildWorkflowAssetFinalPromptForItem}
                      propPickerCharacter={item.key === 'characters' ? propPickerCharacter : null}
                      workflowAssets={workflowAssets}
                      propGenerationPrompt={propGenerationPrompt}
                      propBindingBusy={propBindingBusy}
                      propBindingStatus={propBindingStatus}
                      onPropGenerationPromptChange={setPropGenerationPrompt}
                      onCloseCharacterPropPicker={() => {
                        setPropPickerCharacter(null);
                        setPropBindingStatus(null);
                      }}
                      onSaveCharacterPropBinding={(character, prop, shouldBind) => void saveCharacterPropBinding(character, prop, shouldBind)}
                      onGenerateCharacterPropImage={(character, customPrompt) => handleGenerateAssetImage('characters', character, { useCurrentReference: true, variant: 'with-props', customPrompt, preservePromptExact: true })}
                      isUploadBusy={(asset) => isAssetUploadBusy(item.key, asset)}
                      isGenerationBusy={(asset) => isAssetGenerationBusy(item.key, asset)}
                    />
                  </div>
                );
              })}
              <div className="rounded-lg border border-zinc-800 bg-card p-3">
                <div className="flex items-center gap-2 text-[13px] font-medium text-zinc-100">
                  <Film className="h-4 w-4 text-amber-300" />
                  导演板资产
                </div>
                <div className="mt-1 text-[12px] leading-5 text-zinc-500">空间图、六宫格、上一板连续性参考</div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-3 h-7 text-[11px] text-amber-300 hover:bg-amber-500/10 hover:text-amber-100"
                  onClick={() => handleAddWorkflowNode('directorBoard', '章节导演板资产', '空间图、六宫格、上一板连续性参考')}
                >
                  放入画布
                </Button>
              </div>
            </div>
          </div>
        )}

        {assetImagePreview && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 p-5 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            onClick={() => setAssetImagePreview(null)}
          >
            <div
              className="inline-flex max-h-[calc(100vh-2.5rem)] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-lg border border-zinc-800 bg-[#111113] shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold text-zinc-100">{assetImagePreview.title}</div>
                  {assetImagePreview.subtitle && (
                    <div className="truncate text-[11px] text-zinc-500">{assetImagePreview.subtitle}</div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 px-2 text-[12px] text-zinc-400 hover:text-zinc-100"
                    onClick={() => void downloadCanvasImagePreview(assetImagePreview)}
                  >
                    <Download className="h-3.5 w-3.5" />
                    下载
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-zinc-500 hover:text-zinc-100"
                    onClick={() => setAssetImagePreview(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center bg-background p-3">
                <img
                  src={assetImagePreview.url}
                  alt={assetImagePreview.title}
                  className="block h-auto max-h-[calc(100vh-8rem)] w-auto max-w-[calc(100vw-4rem)] rounded-md object-contain"
                />
              </div>
            </div>
          </div>
        )}
        <ProjectGlobalSettingsModal
          open={projectGlobalSettingsOpen}
          draft={projectGlobalSettingsDraft}
          saving={projectGlobalSettingsSaving}
          error={projectGlobalSettingsError}
          onChange={(patch) => setProjectGlobalSettingsDraft((current) => ({ ...current, ...patch }))}
          onClose={() => {
            if (projectGlobalSettingsSaving) return;
            setProjectGlobalSettingsOpen(false);
            setProjectGlobalSettingsError(null);
          }}
          onSave={() => void saveProjectGlobalSettings()}
        />
      </div>
    </div>
  );
}

export function ProjectCanvasPage() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
