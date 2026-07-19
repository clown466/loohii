import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Position } from '@xyflow/react';
import { Download, Image as ImageIcon, Package, Wand2 } from 'lucide-react';
import { useParams } from 'react-router';
import { Button } from '../../../components/ui/button';
import { ThumbImage } from '../../../components/ThumbImage';
import { cn } from '../../../utils/cn';
import { useCanvasStore } from '../../../stores/useCanvasStore';
import { useProjectStore } from '../../../stores/useProjectStore';
import {
  apiClient,
  type ModelConfig,
  type ProjectCharacterRecord,
  type ProjectSceneRecord,
  type WorkflowState,
} from '../../../lib/apiClient';
import {
  type CanvasNodeProps,
  type CanvasReferenceImage,
  type WorkflowAssetKind,
  type WorkflowAssets,
  CanvasNodeResizer,
  CanvasHandle,
  PromptTextarea,
  publicImageUrl,
  previewCanvasImage,
  downloadCanvasImagePreview,
  syncWorkflowAssetsFromCanvas,
  readObjectString,
  positiveNumber,
  ratioToNumber,
  normalizeCanvasImageSize,
  normalizeImageResolution,
  normalizeWorkflowAssetKind,
  normalizeCompareText,
  canvasGenerationStartedAt,
  createCanvasGenerationRequestToken,
  canvasGenerationAgeMs,
  isCanvasGenerationStale,
  canvasGenerationWaitLabel,
  shouldKeepCanvasGenerationPendingAfterError,
  appendCanvasImageGenerationRetryHint,
  isCanvasPromptWithinApiLimit,
  canvasPromptTooLongError,
  canvasNodeEpisodeId,
  canvasIncomingRelationKey,
  compactProjectPromptContext,
  buildCanvasAssetFinalPrompt,
  isRawAssetPrompt,
  hasManualCanvasGenerationPrompt,
  modelOptionLabel,
  isWorkflowImageModel,
  isDreaminaWebImageModel,
  workflowAssetKindLabel,
  workflowAssetKindSelectLabel,
  workflowAssetName,
  assetArray,
  defaultWorkflowAssets,
  mergeWorkflowAssetsWithProjectRecords,
  canvasOutputImageVariantsFromResult,
  recoverCanvasImageFromGenerationRecords,
  findLatestCanvasImageGenerationRecord,
  generationRecordStartedAt,
  appendReferenceImageMapPrompt,
  prepareCanvasPromptForImageModel,
  generationReferenceSourcePriority,
  shouldSkipCanvasGenerationReference,
  canvasReferenceImageKind,
  canvasReferenceDedupKey,
  canvasReferenceImageBadgeLabel,
  CANVAS_IMAGE_RATIO_OPTIONS,
  CANVAS_GENERATION_STALE_MS,
  WORKFLOW_ASSET_SYNC_EVENT,
} from './shared';
import { invalidateGenerationRecords } from '../../../lib/queries/generationRecords';
import { useImageModelOptions } from './modelOptions';

type GenerationAssetContext = {
  workflow: WorkflowState | null;
  characters: ProjectCharacterRecord[];
  scenes: ProjectSceneRecord[];
};

const generationAssetContextCache = new Map<string, GenerationAssetContext>();
const generationAssetContextPending = new Map<string, Promise<GenerationAssetContext>>();

function loadGenerationAssetContext(projectId: string, episodeId: string | undefined): Promise<GenerationAssetContext> {
  const key = `${projectId}:${episodeId || ''}`;
  const cached = generationAssetContextCache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = generationAssetContextPending.get(key);
  if (pending) return pending;
  const request = Promise.all([
    apiClient.getProjectWorkflow(projectId, { episodeId }),
    apiClient.listProjectCharacters(projectId).catch(() => []),
    apiClient.listProjectScenes(projectId).catch(() => []),
  ])
    .then(([workflow, characters, scenes]) => {
      const context = { workflow, characters, scenes };
      generationAssetContextCache.set(key, context);
      return context;
    })
    .finally(() => {
      generationAssetContextPending.delete(key);
    });
  generationAssetContextPending.set(key, request);
  return request;
}

export const GenerationNode = ({ id, data, selected }: CanvasNodeProps) => {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const setNodesTransient = useCanvasStore((s) => s.setNodesTransient);
  const addNode = useCanvasStore((s) => s.addNode);
  // 只订阅与本节点相连的入边+源节点内容指纹，不裸订整个 edges/nodes 数组（P4-B 性能治理）
  const relationKey = useCanvasStore((s) => canvasIncomingRelationKey(s, id));  const { id: projectId } = useParams();
  const currentProject = useProjectStore((s) => s.projects.find((project) => project.id === projectId));
  const sourceEpisode = typeof data.sourceEpisode === 'string' ? data.sourceEpisode : '';
  const sourceEpisodeId = canvasNodeEpisodeId(data);
  const isLightweightGeneration = data.lightweightGeneration === true || data.positioningBoardFlow === true;
  const projectPromptContext = useMemo(
    () => currentProject ? compactProjectPromptContext(currentProject) : (data.projectPromptContext || {}),
    [currentProject, data.projectPromptContext],
  );
  const { imageModels } = useImageModelOptions();
  const [targetAssets, setTargetAssets] = useState<WorkflowAssets>(defaultWorkflowAssets());
  const [targetAssetCatalog, setTargetAssetCatalog] = useState<{ characters: ProjectCharacterRecord[]; scenes: ProjectSceneRecord[] }>({ characters: [], scenes: [] });
  const [targetAssetKind, setTargetAssetKind] = useState<WorkflowAssetKind>('characters');
  const [targetAssetName, setTargetAssetName] = useState('');
  const [targetAssetCustomMode, setTargetAssetCustomMode] = useState(false);
  const [targetAssetsError, setTargetAssetsError] = useState('');

  const referenceImages = useMemo(() => {
    const { nodes, edges } = useCanvasStore.getState();
    const targetNode = nodes.find((node) => node.id === id);
    const incomingEdges = edges
      .filter((e) => e.target === id)
      .map((edge, index) => ({ edge, index, source: nodes.find((n) => n.id === edge.source) }))
      .sort((a, b) => generationReferenceSourcePriority(a.source) - generationReferenceSourcePriority(b.source) || a.index - b.index);
    const refs: CanvasReferenceImage[] = [];
    const seen = new Set<string>();
    for (const { source } of incomingEdges) {
      if (shouldSkipCanvasGenerationReference(source, targetNode)) continue;
      const imageInputUrl = source?.type === 'imageInput' ? publicImageUrl(source.data?.imageUrl) : '';
      const characterUrl = source?.type === 'character' ? publicImageUrl(source.data?.avatar) : '';
      const generationUrl = source?.type === 'generation' ? publicImageUrl(source.data?.outputImage) : '';
      if (imageInputUrl) {
        const ref = {
          url: imageInputUrl,
          label: (source?.data.label as string) || '参考图',
          kind: canvasReferenceImageKind(source),
          name: String(source?.data.assetName || source?.data.name || source?.data.label || ''),
          sourceClipId: typeof source?.data?.sourceClipId === 'string' ? source.data.sourceClipId : undefined,
          targetClipId: typeof source?.data?.targetClipId === 'string' ? source.data.targetClipId : undefined,
        };
        const key = canvasReferenceDedupKey(ref);
        if (seen.has(key)) continue;
        seen.add(key);
        refs.push(ref);
      } else if (characterUrl) {
        const ref = {
          url: characterUrl,
          label: (source?.data.name as string) || '角色',
          kind: canvasReferenceImageKind(source),
          name: String(source?.data.name || ''),
        };
        const key = canvasReferenceDedupKey(ref);
        if (seen.has(key)) continue;
        seen.add(key);
        refs.push(ref);
      } else if (generationUrl) {
        const ref = {
          url: generationUrl,
          label: String(source?.data.title || '上游生成图'),
          kind: canvasReferenceImageKind(source),
          name: String(source?.data.title || ''),
        };
        const key = canvasReferenceDedupKey(ref);
        if (seen.has(key)) continue;
        seen.add(key);
        refs.push(ref);
      }
    }
    return refs;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- relationKey 已覆盖 edges/nodes 中与本节点相关的变化；data 覆盖自身数据变化
  }, [relationKey, id, data]);
  const explicitAssetKind = normalizeWorkflowAssetKind(data.assetKind);
  const hasBoundAssetName = Boolean(String(data.assetName || '').trim());
  const isStandaloneGeneration = !explicitAssetKind || !hasBoundAssetName;
  const nodeAssetKind = explicitAssetKind ?? 'scenes';
  const nodeAssetLabel = isStandaloneGeneration ? '自由图片' : workflowAssetKindLabel(nodeAssetKind);
  const previousStoryboardReference = referenceImages.find((ref) => ref.kind === 'storyboard');
  const renderedDescription = previousStoryboardReference
    ? `已接入 ${referenceImages.length} 张参考图，含上一个故事板`
    : data.description || data.visualPrompt || `${nodeAssetLabel}生图节点`;
  const hasManualPrompt = hasManualCanvasGenerationPrompt(data);
  const rawPrompt = hasManualPrompt ? String(data.finalPrompt ?? '') : String(data.prompt ?? '');
  const autoFinalPrompt = useMemo(
    () => isStandaloneGeneration ? '' : buildCanvasAssetFinalPrompt(nodeAssetKind, data, referenceImages.length, projectPromptContext),
    [data, isStandaloneGeneration, nodeAssetKind, projectPromptContext, referenceImages.length],
  );
  const generationPrompt = hasManualPrompt ? rawPrompt : rawPrompt && !isRawAssetPrompt(data, rawPrompt) ? rawPrompt : autoFinalPrompt;
  const nodeAssetName = isStandaloneGeneration
    ? String(data.title || '自由生图')
    : String(data.assetName || data.title || generationPrompt.slice(0, 120) || 'canvas-generation');
  const isPositioningBoardGeneration = data.positioningBoardFlow === true;
  const positioningBoardMode = data.positioningBoardMode === 'positioning' ? 'positioning' : 'storyboard';
  const positioningBoardLabel = isPositioningBoardGeneration
    ? positioningBoardMode === 'storyboard' ? '故事板' : '定位板'
    : '提示词';
  const positioningBoardModalSubtitle = positioningBoardMode === 'storyboard'
    ? '宫格故事板完整生图提示词'
    : '单帧定位板完整生图提示词';
  const positioningPromptValue = typeof data.positioningPrompt === 'string'
    ? data.positioningPrompt
    : positioningBoardMode === 'positioning' ? generationPrompt : '';
  const storyboardPromptValue = typeof data.storyboardPrompt === 'string'
    ? data.storyboardPrompt
    : positioningBoardMode === 'storyboard' ? generationPrompt : '';
  const selectedSize = normalizeCanvasImageSize(data.size);
  const selectedResolution = normalizeImageResolution(data.resolution);
  const outputImageAspectRatio = positiveNumber(data.outputImageAspectRatio) ?? ratioToNumber(selectedSize);
  const selectedQuality = String(data.quality || 'high');
  const outputImageVariants = useMemo(
    () => {
      const variants = Array.isArray(data.outputImages)
        ? data.outputImages
            .map((item) => {
              const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
              const url = publicImageUrl(record.url);
              return url ? {
                url,
                assetId: readObjectString(record, 'assetId'),
                title: readObjectString(record, 'title'),
                revisedPrompt: readObjectString(record, 'revisedPrompt'),
              } : null;
            })
            .filter((item): item is { url: string; assetId?: string; title?: string; revisedPrompt?: string } => Boolean(item))
        : [];
      if (variants.length > 0) return variants;
      const outputImage = publicImageUrl(data.outputImage);
      return outputImage ? [{
        url: outputImage,
        assetId: String(data.outputImageAssetId || ''),
        title: nodeAssetName || '生成图片',
        revisedPrompt: String(data.revisedPrompt || ''),
      }] : [];
    },
    [data.outputImage, data.outputImageAssetId, data.outputImages, data.revisedPrompt, nodeAssetName],
  );
  const selectedImageModel = data.modelId ? imageModels.find((model) => model.id === data.modelId) : undefined;
  const generationOutputCount = isDreaminaWebImageModel(selectedImageModel) ? 4 : 1;
  const generationStalled = data.status === 'generating' && isCanvasGenerationStale(data.generationStartedAt);
  const isSubmittingGeneration = data.canvasSubmitStatus === 'submitting';
  const standaloneGenerationMetadata = useMemo(() => {
    if (!isStandaloneGeneration) return undefined;
    const clipId = typeof data.clipId === 'string' ? data.clipId : '';
    const clipNodeKind = typeof data.clipNodeKind === 'string' ? data.clipNodeKind : '';
    const storyboardForClip = data.storyboardForClip === true;
    if (!clipId && !clipNodeKind && !storyboardForClip) return undefined;
    return {
      title: String(data.title || ''),
      clipId,
      clipTitle: String(data.clipTitle || data.title || ''),
      clipNodeKind,
      storyboardForClip,
      previousStoryboardAssetId: typeof data.previousStoryboardAssetId === 'string' ? data.previousStoryboardAssetId : '',
    };
  }, [data.clipId, data.clipNodeKind, data.clipTitle, data.previousStoryboardAssetId, data.storyboardForClip, data.title, isStandaloneGeneration]);
  const [promptDraft, setPromptDraft] = useState(generationPrompt);
  const [promptEditing, setPromptEditing] = useState(false);
  const promptComposingRef = useRef(false);
  const generationInFlightRef = useRef(false);
  const generationAbortRef = useRef<AbortController | null>(null);
  const generationRequestIdRef = useRef(0);
  const targetAssetOptions = useMemo(
    () => {
      const seen = new Set<string>();
      return assetArray(targetAssets, targetAssetKind)
        .map(workflowAssetName)
        .filter((name) => {
          if (!name) return false;
          const key = normalizeCompareText(name);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    },
    [targetAssets, targetAssetKind],
  );

  useEffect(() => {
    if (!promptEditing && promptDraft !== generationPrompt) {
      setPromptDraft(generationPrompt);
    }
  }, [generationPrompt, promptDraft, promptEditing]);

  const commitPromptDraft = useCallback((nextPrompt = promptDraft) => {
    const patch: Record<string, unknown> = { finalPrompt: nextPrompt, manualFinalPrompt: true };
    if (isPositioningBoardGeneration) {
      patch.prompt = nextPrompt;
      if (positioningBoardMode === 'storyboard') {
        patch.storyboardPrompt = nextPrompt;
      } else {
        patch.positioningPrompt = nextPrompt;
      }
    }
    updateNodeData(id, patch);
  }, [id, isPositioningBoardGeneration, positioningBoardMode, promptDraft, updateNodeData]);

  const switchPositioningBoardMode = useCallback((nextMode: 'storyboard' | 'positioning') => {
    if (!isPositioningBoardGeneration || nextMode === positioningBoardMode) return;
    const nextPrompt = nextMode === 'storyboard'
      ? (storyboardPromptValue || generationPrompt)
      : (positioningPromptValue || generationPrompt);
    setPromptEditing(false);
    setPromptDraft(nextPrompt);
    const patch: Record<string, unknown> = {
      positioningBoardMode: nextMode,
      prompt: nextPrompt,
      finalPrompt: nextPrompt,
      manualFinalPrompt: true,
      description: nextMode === 'storyboard'
        ? String(data.description || '').replace('单帧空间定位板', '对应视频镜头的宫格故事板') || '生成本 Clip 对应视频镜头的宫格故事板。'
        : String(data.description || '').replace('对应视频镜头的宫格故事板', '单帧空间定位板') || '生成本 Clip 的单帧空间定位板。',
    };
    if (positioningBoardMode === 'storyboard') {
      patch.storyboardPrompt = promptDraft;
    } else {
      patch.positioningPrompt = promptDraft;
    }
    updateNodeData(id, patch);
  }, [
    data.description,
    generationPrompt,
    id,
    isPositioningBoardGeneration,
    positioningBoardMode,
    positioningPromptValue,
    promptDraft,
    storyboardPromptValue,
    updateNodeData,
  ]);

  useEffect(() => {
    if (!isStandaloneGeneration || !projectId || projectId === 'local') return;
    let cancelled = false;
    loadGenerationAssetContext(projectId, sourceEpisodeId || undefined)
      .then(({ workflow, characters, scenes }) => {
        if (cancelled) return;
        setTargetAssetCatalog({ characters, scenes });
        setTargetAssets(mergeWorkflowAssetsWithProjectRecords(workflow?.assets ?? defaultWorkflowAssets(), characters, scenes));
        setTargetAssetsError('');
      })
      .catch((error) => {
        if (!cancelled) setTargetAssetsError(error instanceof Error ? error.message : '资产列表加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [isStandaloneGeneration, projectId, sourceEpisodeId]);

  useEffect(() => {
    if (targetAssetCustomMode || targetAssetName || targetAssetOptions.length === 0) return;
    setTargetAssetName(targetAssetOptions[0]);
  }, [targetAssetCustomMode, targetAssetName, targetAssetOptions]);

  useEffect(() => {
    if (!isStandaloneGeneration) return;
    const handleSync = (event: Event) => {
      const workflow = (event as CustomEvent<{ workflow?: WorkflowState }>).detail?.workflow;
      if (!workflow) return;
      setTargetAssets(mergeWorkflowAssetsWithProjectRecords(
        workflow.assets ?? defaultWorkflowAssets(),
        targetAssetCatalog.characters,
        targetAssetCatalog.scenes,
      ));
    };
    window.addEventListener(WORKFLOW_ASSET_SYNC_EVENT, handleSync);
    return () => window.removeEventListener(WORKFLOW_ASSET_SYNC_EVENT, handleSync);
  }, [isStandaloneGeneration, targetAssetCatalog]);

  useEffect(() => () => {
    generationAbortRef.current?.abort();
  }, []);

  const updateTransientSubmitState = useCallback((submitData: Record<string, unknown>) => {
    const currentNodes = useCanvasStore.getState().nodes;
    setNodesTransient(currentNodes.map((node) => (
      node.id === id
        ? { ...node, data: { ...node.data, ...submitData } }
        : node
    )));
  }, [id, setNodesTransient]);

  const clearTransientSubmitState = useCallback(() => {
    updateTransientSubmitState({
      canvasSubmitStatus: '',
      canvasSubmitError: '',
      canvasSubmitStartedAt: '',
    });
  }, [updateTransientSubmitState]);

  const handleGenerate = async () => {
    if (data.status === 'generating' && !generationStalled) {
      updateNodeData(id, {
        error: `${canvasGenerationWaitLabel(data.generationStartedAt)}。Airelayzone 多参考图/2K 可能需要 3-4 分钟。`,
      });
      return;
    }
    if (generationInFlightRef.current) {
      updateTransientSubmitState({
        canvasSubmitStatus: 'submitting',
        canvasSubmitError: '上一条请求还在提交后端，请等待返回；如需放弃请点停止。',
        canvasSubmitStartedAt: data.canvasSubmitStartedAt || canvasGenerationStartedAt(),
      });
      return;
    }
    const promptForGeneration = prepareCanvasPromptForImageModel(
      isStandaloneGeneration && data.clipNodeKind === 'storyboard'
        ? appendReferenceImageMapPrompt(promptDraft, referenceImages)
        : promptDraft,
    );
    if (!promptForGeneration.trim()) {
      updateNodeData(id, {
        status: 'failed',
        error: '请先输入最终生图提示词。',
        generationStartedAt: '',
        generationRequestId: '',
      });
      return;
    }
    if (!isCanvasPromptWithinApiLimit(promptForGeneration)) {
      updateNodeData(id, {
        status: 'failed',
        error: canvasPromptTooLongError('image', promptForGeneration.length),
        generationStartedAt: '',
        generationRequestId: '',
      });
      return;
    }
    const finalPromptForNode = isStandaloneGeneration && data.clipNodeKind === 'storyboard'
      ? promptForGeneration
      : promptDraft;
    const requestId = generationRequestIdRef.current + 1;
    const generationRequestToken = createCanvasGenerationRequestToken(id, requestId);
    generationRequestIdRef.current = requestId;
    const abortController = new AbortController();
    generationAbortRef.current = abortController;
    generationInFlightRef.current = true;
    const generationStartedAt = canvasGenerationStartedAt();
    setPromptEditing(false);
    updateTransientSubmitState({
      canvasSubmitStatus: 'submitting',
      canvasSubmitError: '正在提交到后端...',
      canvasSubmitStartedAt: generationStartedAt,
    });
    try {
      const result = isStandaloneGeneration
        ? await apiClient.generateCanvasImage(projectId || 'local', {
            prompt: promptForGeneration,
            referenceImageUrls: referenceImages.map((r) => r.url),
            aiModelId: data.modelId || undefined,
            size: selectedSize,
            count: generationOutputCount,
            parameters: { quality: selectedQuality, format: 'png', resolution: selectedResolution },
            metadata: {
              ...(standaloneGenerationMetadata ?? {}),
              sourceEpisode,
              sourceEpisodeId,
              requestId: generationRequestToken,
              nodeId: id,
            },
            submitOnly: true,
          }, { signal: abortController.signal })
        : await apiClient.generateWorkflowAssetImage(projectId || 'local', {
            episodeId: sourceEpisodeId || undefined,
            assetKind: nodeAssetKind,
            assetName: nodeAssetName,
            prompt: promptForGeneration,
            usePromptAsFinal: true,
            referenceImageUrls: referenceImages.map((r) => r.url),
            aiModelId: data.modelId || undefined,
            size: selectedSize,
            parameters: { quality: selectedQuality, format: 'png', resolution: selectedResolution },
          }, { signal: abortController.signal });
      if (generationRequestIdRef.current !== requestId || abortController.signal.aborted) return;
      const outputImageAssetId = readObjectString(result.asset, 'id');
      const backendGenerationId = readObjectString(result.generation, 'id');
      const outputImageVariants = canvasOutputImageVariantsFromResult(result);
      if (result.image?.url) {
        clearTransientSubmitState();
        updateNodeData(id, {
          status: 'completed',
          outputImage: result.image.url,
          outputImageAssetId: outputImageAssetId || data.outputImageAssetId || '',
          outputImages: outputImageVariants,
          revisedPrompt: result.image.revisedPrompt,
          finalPrompt: finalPromptForNode,
          submittedPrompt: result.prompt || promptForGeneration,
          manualFinalPrompt: true,
          ...(isStandaloneGeneration ? { mode: 'standalone' } : { assetKind: nodeAssetKind, assetName: nodeAssetName }),
          quality: selectedQuality,
          format: 'png',
          generationStartedAt: '',
          generationRequestId: '',
          generationId: backendGenerationId || readObjectString(data, 'generationId'),
        });
        if (isStandaloneGeneration) {
          invalidateGenerationRecords(projectId);
        }
        if (result.workflow) syncWorkflowAssetsFromCanvas(result.workflow);
      } else if (isStandaloneGeneration && backendGenerationId) {
        clearTransientSubmitState();
        updateNodeData(id, {
          status: 'generating',
          progress: 0,
          error: '后端已接收，等待上游返回...',
          generationStartedAt,
          generationStoppedAt: '',
          stoppedSubmittedPrompt: '',
          generationRequestId: generationRequestToken,
          generationId: backendGenerationId,
          finalPrompt: finalPromptForNode,
          submittedPrompt: result.prompt || promptForGeneration,
          manualFinalPrompt: true,
          outputImage: '',
          outputImageAssetId: '',
          revisedPrompt: '',
          mode: 'standalone',
          size: selectedSize,
          resolution: selectedResolution,
          quality: selectedQuality,
          format: 'png',
        });
        invalidateGenerationRecords(projectId);
      } else {
        clearTransientSubmitState();
        updateNodeData(id, { status: 'failed', error: '后端未确认生成任务，请重新生成。', generationStartedAt: '', generationRequestId: '' });
      }
    } catch (err: any) {
      if (generationRequestIdRef.current !== requestId || abortController.signal.aborted) return;
      if (isStandaloneGeneration && projectId && projectId !== 'local') {
        try {
          const records = await apiClient.listGenerationRecords(projectId);
          const recovered = recoverCanvasImageFromGenerationRecords(records, promptForGeneration, {
            notBefore: generationStartedAt,
            requestId: generationRequestToken,
            generationId: readObjectString(data, 'generationId'),
          });
          if (recovered?.image?.url) {
            const recoveredAssetId = readObjectString(recovered.asset, 'id');
            const recoveredGenerationId = readObjectString(recovered.generation, 'id');
            const recoveredOutputImageVariants = canvasOutputImageVariantsFromResult(recovered);
            clearTransientSubmitState();
            updateNodeData(id, {
              status: 'completed',
              outputImage: recovered.image.url,
              outputImageAssetId: recoveredAssetId || data.outputImageAssetId || '',
              outputImages: recoveredOutputImageVariants,
              revisedPrompt: recovered.image.revisedPrompt,
              finalPrompt: finalPromptForNode,
              submittedPrompt: recovered.prompt || promptForGeneration,
              manualFinalPrompt: true,
              mode: 'standalone',
              quality: selectedQuality,
              format: 'png',
              error: '刚才的长请求已在后台完成，已自动恢复生成结果。',
              generationStartedAt: '',
              generationRequestId: '',
              generationId: recoveredGenerationId || readObjectString(data, 'generationId'),
            });
            invalidateGenerationRecords(projectId);
            return;
          }
          const runningRecord = findLatestCanvasImageGenerationRecord(records, promptForGeneration, {
            notBefore: generationStartedAt,
            requestId: generationRequestToken,
            generationId: readObjectString(data, 'generationId'),
          });
          if (runningRecord && (runningRecord.status === 'RUNNING' || runningRecord.status === 'QUEUED')) {
            clearTransientSubmitState();
            updateNodeData(id, {
              status: 'generating',
              progress: 0,
              error: '后端已接收，等待上游返回...',
              generationStartedAt: generationRecordStartedAt(runningRecord) || generationStartedAt,
              generationStoppedAt: '',
              stoppedSubmittedPrompt: '',
              generationRequestId: generationRequestToken,
              generationId: runningRecord.id,
              finalPrompt: finalPromptForNode,
              submittedPrompt: runningRecord.prompt || promptForGeneration,
              manualFinalPrompt: true,
              outputImage: '',
              outputImageAssetId: '',
              revisedPrompt: '',
              mode: 'standalone',
              size: selectedSize,
              resolution: selectedResolution,
              quality: selectedQuality,
              format: 'png',
            });
            invalidateGenerationRecords(projectId);
            return;
          }
        } catch {
          // Keep the original generation error when record recovery is unavailable.
        }
      }
      const errorMessage = appendCanvasImageGenerationRetryHint(
        err?.message || '生成失败',
        referenceImages.length,
        selectedResolution,
      );
      clearTransientSubmitState();
      updateNodeData(id, {
        status: 'failed',
        error: shouldKeepCanvasGenerationPendingAfterError(errorMessage)
          ? `请求没有确认到后端生成任务：${errorMessage}`
          : errorMessage,
        generationStartedAt: '',
        generationRequestId: '',
      });
    } finally {
      if (generationRequestIdRef.current === requestId) {
        generationInFlightRef.current = false;
        generationAbortRef.current = null;
      }
    }
  };

  const handleStopGeneration = () => {
    const stoppedSubmittedPrompt = String(data.submittedPrompt || data.finalPrompt || data.prompt || promptDraft || '');
    generationRequestIdRef.current += 1;
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
    generationInFlightRef.current = false;
    clearTransientSubmitState();
    if (isSubmittingGeneration && data.status !== 'generating') {
      updateNodeData(id, {
        status: 'failed',
        error: '已停止提交，可重新生成。',
        generationStartedAt: '',
        generationRequestId: '',
        generationStoppedAt: canvasGenerationStartedAt(),
        stoppedSubmittedPrompt,
      });
      return;
    }
    updateNodeData(id, {
      status: 'failed',
      error: '已停止本地等待。上游任务可能仍在处理并消耗额度；完成后可在生成记录查看，可重新生成。',
      generationStartedAt: '',
      generationRequestId: '',
      generationStoppedAt: canvasGenerationStartedAt(),
      stoppedSubmittedPrompt,
    });
  };

  useEffect(() => {
    if (data.status !== 'generating') return;
    const age = canvasGenerationAgeMs(data.generationStartedAt);
    if (age === null || age > CANVAS_GENERATION_STALE_MS) {
      updateNodeData(id, {
        status: 'failed',
        error: '上次生成请求已中断，可重新生成。',
        generationStartedAt: '',
        generationRequestId: '',
      });
      return;
    }
    const timer = window.setTimeout(() => {
      updateNodeData(id, {
        status: 'failed',
        error: '生成等待超过 15 分钟，已停止。可重新生成。',
        generationStartedAt: '',
        generationRequestId: '',
      });
    }, CANVAS_GENERATION_STALE_MS - age);
    return () => window.clearTimeout(timer);
  }, [data.status, data.generationStartedAt, id, updateNodeData]);

  const handleSetAsCurrentImage = async () => {
    const imageUrl = String(data.outputImage || '');
    const assetId = String(data.outputImageAssetId || '');
    if (!imageUrl) return;
    updateNodeData(id, { currentImageStatus: assetId ? 'saving' : 'local', currentImageError: '' });
    if (!projectId || projectId === 'local' || !assetId) {
      updateNodeData(id, { currentImageStatus: 'local' });
      return;
    }
    try {
      const result = await apiClient.selectWorkflowAssetImage(projectId, {
        episodeId: sourceEpisodeId || undefined,
        assetKind: nodeAssetKind,
        assetName: nodeAssetName,
        assetId,
      });
      syncWorkflowAssetsFromCanvas(result.workflow);
      updateNodeData(id, { currentImageStatus: 'saved', currentImageError: '' });
    } catch (err: any) {
      updateNodeData(id, { currentImageStatus: 'failed', currentImageError: err?.message || '设为当前图失败' });
    }
  };

  const handleAssignStandaloneImageToAsset = async () => {
    const imageUrl = String(data.outputImage || '');
    const assetId = String(data.outputImageAssetId || '');
    const assetName = targetAssetName.trim();
    if (!imageUrl || !assetId) {
      updateNodeData(id, { currentImageStatus: 'failed', currentImageError: '这张图缺少可写入资产库的图片 ID。' });
      return;
    }
    if (!assetName) {
      updateNodeData(id, { currentImageStatus: 'failed', currentImageError: '请先选择或输入要写入的资产名称。' });
      return;
    }
    if (!projectId || projectId === 'local') {
      updateNodeData(id, { currentImageStatus: 'local', currentImageError: '本地项目不能写入资产库。' });
      return;
    }
    updateNodeData(id, { currentImageStatus: 'saving', currentImageError: '' });
    try {
      const result = await apiClient.selectWorkflowAssetImage(projectId, {
        episodeId: sourceEpisodeId || undefined,
        assetKind: targetAssetKind,
        assetName,
        assetId,
      });
      syncWorkflowAssetsFromCanvas(result.workflow);
      setTargetAssets(mergeWorkflowAssetsWithProjectRecords(
        result.workflow.assets ?? defaultWorkflowAssets(),
        targetAssetCatalog.characters,
        targetAssetCatalog.scenes,
      ));
      updateNodeData(id, {
        currentImageStatus: 'saved',
        currentImageError: '',
        lastAssignedAssetKind: targetAssetKind,
        lastAssignedAssetName: assetName,
      });
    } catch (err: any) {
      updateNodeData(id, { currentImageStatus: 'failed', currentImageError: err?.message || '写入资产失败' });
    }
  };

  const handleAddOutputAsImageInput = () => {
    const imageUrl = String(data.outputImage || '').trim();
    if (!imageUrl) return;
    const nodes = useCanvasStore.getState().nodes; // 点击时取最新快照即可，无需订阅
    const currentNode = nodes.find((node) => node.id === id);
    const width = positiveNumber(currentNode?.style?.width) ?? 360;
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const absolutePosition = (nodeId: string, seen = new Set<string>()): { x: number; y: number } => {
      const node = nodeById.get(nodeId);
      if (!node || seen.has(nodeId)) return { x: 0, y: 0 };
      if (!node.parentId) return { x: node.position.x, y: node.position.y };
      seen.add(nodeId);
      const parent = absolutePosition(node.parentId, seen);
      return { x: parent.x + node.position.x, y: parent.y + node.position.y };
    };
    const origin = currentNode ? absolutePosition(currentNode.id) : { x: 0, y: 0 };
    addNode('imageInput', {
      x: origin.x + width + 80,
      y: origin.y,
    }, {
      label: `${nodeAssetName || '生成图片'} 输入`,
      imageUrl,
      fileName: `${nodeAssetName || 'generated-image'}.png`,
      imageAspectRatio: outputImageAspectRatio,
      uploadStatus: 'linked',
      sourcePrompt: String(data.finalPrompt || data.prompt || data.submittedPrompt || data.revisedPrompt || promptDraft || ''),
      uploadError: '',
      imageLoadError: false,
    });
    updateNodeData(id, { outputImageInputStatus: '已放入图片输入节点' });
  };

  return (
    <>
      <CanvasNodeResizer selected={selected} minWidth={320} minHeight={300} />
      <div className={cn("scrollbar-none h-full w-full min-w-[320px] overflow-y-auto overflow-x-hidden rounded-[14px] border lh-node transition-colors hover:border-[#3A3A40]", (selected || data.status === 'generating') && "lh-node-active")}>
      <div className="flex items-center gap-3 p-3 cursor-grab active:cursor-grabbing">
        <div className="h-10 w-10 rounded-full bg-layer-4 overflow-hidden shrink-0">
          {data.outputImage ? (
            <ThumbImage
              src={data.outputImage}
              thumbWidth={1024}
              alt={nodeAssetName}
              className="h-full w-full cursor-zoom-in object-cover"
              onClick={(event) => previewCanvasImage(event, { url: data.outputImage, title: nodeAssetName || '生成图片', subtitle: `${nodeAssetLabel}生成结果` })}
              onDoubleClick={(event) => previewCanvasImage(event, { url: data.outputImage, title: nodeAssetName || '生成图片', subtitle: `${nodeAssetLabel}生成结果` })}
            />
          ) : (
	            <div className="flex h-full w-full items-center justify-center text-zinc-600">
	              {isStandaloneGeneration ? <Wand2 className="h-5 w-5" /> : nodeAssetKind === 'scenes' ? <ImageIcon className="h-5 w-5" /> : <Package className="h-5 w-5" />}
	            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-zinc-100">{nodeAssetName}</div>
	          <div className="line-clamp-2 text-[11px] text-zinc-500">{isStandaloneGeneration && !previousStoryboardReference ? '独立生图节点，不自动写入资产库' : renderedDescription}</div>
        </div>
        <span className={cn(
          "shrink-0 text-[10px]",
          isSubmittingGeneration ? 'animate-pulse text-[#F7C24E]' : generationStalled ? 'text-red-400' : data.status === 'generating' ? 'animate-pulse text-yellow-400' : data.status === 'completed' ? 'text-green-400' : data.status === 'failed' ? 'text-red-400' : 'text-zinc-500',
        )}>
          {isSubmittingGeneration ? '提交中' : data.status === 'generating' && !generationStalled ? '生成中' : data.status === 'completed' ? '已完成' : data.status === 'failed' || generationStalled ? '失败' : '等待生成'}
        </span>
      </div>

      {!isLightweightGeneration && referenceImages.length > 0 && (
        <div className="border-t border-[#26262B] px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[10px] text-[#F7C24E] shrink-0">{referenceImages.length} 参考</span>
            {previousStoryboardReference && (
              <button
                type="button"
                className="nodrag nopan min-w-0 truncate rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-left text-[10px] font-medium text-amber-200 hover:bg-amber-500/15"
                title={previousStoryboardReference.label}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => previewCanvasImage(event, {
                  url: previousStoryboardReference.url,
                  title: previousStoryboardReference.label,
                  subtitle: `${nodeAssetLabel}连续性参考图`,
                })}
              >
                已接入 {previousStoryboardReference.label}
              </button>
            )}
          </div>
          <div className="flex gap-1 overflow-x-auto">
            {referenceImages.map((ref, i) => (
              <div key={i} className="relative shrink-0">
                <ThumbImage
                  src={ref.url}
                  thumbWidth={1024}
                  alt={ref.label}
                  className={cn(
                    "h-8 w-8 cursor-zoom-in rounded border object-cover",
                    ref.kind === 'storyboard' ? 'border-amber-400 ring-1 ring-amber-400/40' : 'border-border',
                  )}
                  onClick={(event) => previewCanvasImage(event, { url: ref.url, title: ref.label, subtitle: `${nodeAssetLabel}参考图` })}
                  onDoubleClick={(event) => previewCanvasImage(event, { url: ref.url, title: ref.label, subtitle: `${nodeAssetLabel}参考图` })}
                />
                <span className={cn(
                  "absolute -top-1 -left-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[8px] font-bold text-white",
                  ref.kind === 'storyboard' ? 'bg-amber-500' : 'bg-[#F5A623]',
                )}>
                  {canvasReferenceImageBadgeLabel(ref, i)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isLightweightGeneration ? (
      <div className="border-t border-[#26262B] px-3 py-2">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[10px] font-medium text-zinc-400">最终生图提示词</span>
	          <button
	            type="button"
	            className="nodrag nopan text-[10px] text-zinc-500 hover:text-zinc-300"
	            onPointerDown={(e) => e.stopPropagation()}
	            onClick={(e) => {
	              e.stopPropagation();
	              setPromptDraft(autoFinalPrompt);
	              setPromptEditing(false);
	              updateNodeData(id, { finalPrompt: autoFinalPrompt, manualFinalPrompt: true });
            }}
          >
            重置
          </button>
        </div>
	        <PromptTextarea
	          className="nodrag nopan w-full resize-y rounded border border-border bg-background px-2.5 py-2 text-[12px] leading-5 text-zinc-200 placeholder-zinc-600 focus:border-primary focus:outline-none min-h-[80px]"
	          rows={8}
	          placeholder="输入最终发送给图片模型的提示词..."
	          value={promptDraft}
	          onChange={(value) => setPromptDraft(value)}
	          onExpandedSave={(value) => {
	            setPromptEditing(false);
	            commitPromptDraft(value);
	          }}
	          modalTitle={`${nodeAssetName} · 最终生图提示词`}
	          modalSubtitle="完整提示词"
	          onFocus={() => setPromptEditing(true)}
	          onBlur={() => {
	            if (promptComposingRef.current) return;
	            setPromptEditing(false);
	            commitPromptDraft();
	          }}
	          onCompositionStart={() => {
	            promptComposingRef.current = true;
	          }}
	          onCompositionEnd={(e) => {
	            promptComposingRef.current = false;
	            setPromptDraft(e.currentTarget.value);
	          }}
	          onPointerDown={(e) => e.stopPropagation()}
	          onClick={(e) => e.stopPropagation()}
	          onKeyDown={(e) => e.stopPropagation()}
	          onKeyUp={(e) => e.stopPropagation()}
	        />
      </div>
      ) : (
        <div className="border-t border-[#26262B] px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[10px] font-medium text-zinc-400">{positioningBoardLabel}提示词</span>
            {isPositioningBoardGeneration ? (
              <div
                className="nodrag nopan flex shrink-0 rounded border border-[#26262B] bg-zinc-950 p-0.5 text-[10px]"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className={cn(
                    'rounded px-2 py-0.5 text-zinc-500 transition',
                    positioningBoardMode === 'storyboard' && 'bg-emerald-500/15 text-emerald-200',
                  )}
                  onClick={() => switchPositioningBoardMode('storyboard')}
                >
                  故事板
                </button>
                <button
                  type="button"
                  className={cn(
                    'rounded px-2 py-0.5 text-zinc-500 transition',
                    positioningBoardMode === 'positioning' && 'bg-emerald-500/15 text-emerald-200',
                  )}
                  onClick={() => switchPositioningBoardMode('positioning')}
                >
                  定位板
                </button>
              </div>
            ) : (
              <span className="text-[10px] text-zinc-600">双击放大编辑</span>
            )}
          </div>
          <PromptTextarea
            className="nodrag nopan h-[74px] w-full resize-none rounded border border-[#26262B] bg-zinc-950/50 px-2.5 py-2 text-[11px] leading-4 text-zinc-300 placeholder-zinc-600 focus:border-primary focus:outline-none"
            placeholder={`输入${positioningBoardLabel}生图提示词...`}
            value={promptDraft}
            onChange={(value) => setPromptDraft(value)}
            onExpandedSave={(value) => {
              setPromptEditing(false);
              commitPromptDraft(value);
            }}
            modalTitle={`${nodeAssetName} · ${positioningBoardLabel}提示词`}
            modalSubtitle={positioningBoardModalSubtitle}
            onFocus={() => setPromptEditing(true)}
            onBlur={() => {
              if (promptComposingRef.current) return;
              setPromptEditing(false);
              commitPromptDraft();
            }}
            onCompositionStart={() => {
              promptComposingRef.current = true;
            }}
            onCompositionEnd={(e) => {
              promptComposingRef.current = false;
              setPromptDraft(e.currentTarget.value);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onKeyUp={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <div className="px-3 pb-2 flex flex-nowrap items-center gap-1 text-[10px]">
	        <select
	          className="nodrag nopan h-7 min-w-0 flex-1 truncate rounded bg-layer-4 border border-border px-1.5 py-1 text-zinc-300 focus:outline-none focus:border-primary"
	          value={data.modelId || ''}
	          onChange={(e) => updateNodeData(id, { modelId: e.target.value })}
	          onPointerDown={(e) => e.stopPropagation()}
	          onClick={(e) => e.stopPropagation()}
	        >
          <option value="">默认模型</option>
          {data.modelId && !imageModels.some((model) => model.id === data.modelId) ? (
            <option value={data.modelId}>当前模型不可用</option>
          ) : null}
          {imageModels.map((model) => (
            <option key={model.id} value={model.id}>
              {modelOptionLabel(model)}
            </option>
          ))}
        </select>
	        <select
	          className="nodrag nopan h-7 w-[66px] shrink-0 rounded bg-layer-4 border border-border px-1.5 py-1 text-zinc-300 focus:outline-none focus:border-primary"
	          value={selectedSize}
	          onChange={(e) => updateNodeData(id, { size: e.target.value })}
	          onPointerDown={(e) => e.stopPropagation()}
	          onClick={(e) => e.stopPropagation()}
	        >
          {CANVAS_IMAGE_RATIO_OPTIONS.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
        </select>
	        <select
	          className="nodrag nopan h-7 w-[52px] shrink-0 rounded bg-layer-4 border border-border px-1.5 py-1 text-zinc-300 focus:outline-none focus:border-primary"
	          value={selectedResolution}
	          onChange={(e) => updateNodeData(id, { resolution: e.target.value })}
	          onPointerDown={(e) => e.stopPropagation()}
	          onClick={(e) => e.stopPropagation()}
	        >
          <option value="1k">1K</option>
          <option value="2k">2K</option>
          <option value="4k">4K</option>
        </select>
	        <select
	          className="nodrag nopan h-7 w-[60px] shrink-0 rounded bg-layer-4 border border-border px-1.5 py-1 text-zinc-300 focus:outline-none focus:border-primary"
	          value={selectedQuality}
	          onChange={(e) => updateNodeData(id, { quality: e.target.value })}
	          onPointerDown={(e) => e.stopPropagation()}
	          onClick={(e) => e.stopPropagation()}
	        >
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      <div className="border-t border-[#26262B] px-3 py-2">
	        <Button
	          size="sm"
	          className="nodrag nopan w-full h-8 text-[12px] bg-primary hover:bg-primary/90 text-white gap-1.5"
	          onClick={handleGenerate}
	          onPointerDown={(e) => e.stopPropagation()}
	          disabled={isSubmittingGeneration || (data.status === 'generating' && !generationStalled)}
	        >
          <Wand2 className="h-3.5 w-3.5" />
          {isSubmittingGeneration ? '提交中...' : data.status === 'generating' && !generationStalled ? '生成中...' : data.status === 'completed' || generationStalled ? '重新生成' : '生成'}
        </Button>
      </div>

      {(isSubmittingGeneration || (data.status === 'generating' && !generationStalled)) && (
        <div className="px-3 pb-3">
          <div className="aspect-square rounded border border-border bg-[#141417]/50 flex flex-col items-center justify-center gap-2">
            <div className="h-1.5 w-24 bg-[#26262B] rounded-full overflow-hidden">
              <div className="h-full bg-[linear-gradient(90deg,#F5A623,#F7C24E)] animate-pulse w-[60%]" />
            </div>
            <span className="px-3 text-center text-[11px] text-zinc-500">
              {isSubmittingGeneration ? String(data.canvasSubmitError || '正在提交到后端...') : canvasGenerationWaitLabel(data.generationStartedAt)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="nodrag nopan h-6 text-[10px] text-zinc-400 hover:text-zinc-100"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                handleStopGeneration();
              }}
            >
              停止
            </Button>
          </div>
        </div>
      )}

      {data.status === 'completed' && data.outputImage && (
        <div className="px-3 pb-2">
          <div className="group relative overflow-hidden rounded border border-border bg-zinc-950">
            <ThumbImage
              src={data.outputImage}
              thumbWidth={1024}
              alt="Generated"
              className="w-full cursor-zoom-in object-contain"
              style={{ aspectRatio: String(outputImageAspectRatio) }}
              onClick={(event) => previewCanvasImage(event, { url: data.outputImage, title: nodeAssetName || '生成图片', subtitle: data.revisedPrompt || undefined })}
              onDoubleClick={(event) => previewCanvasImage(event, { url: data.outputImage, title: nodeAssetName || '生成图片', subtitle: data.revisedPrompt || undefined })}
              onLoad={(event) => {
                const img = event.currentTarget;
                const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : null;
                if (ratio && Math.abs(ratio - outputImageAspectRatio) > 0.01) {
                  updateNodeData(id, { outputImageAspectRatio: ratio });
                }
              }}
            />
            <div
              className="absolute inset-0 hidden cursor-zoom-in items-center justify-center gap-2 bg-black/60 group-hover:flex"
              onClick={(event) => previewCanvasImage(event, { url: data.outputImage, title: nodeAssetName || '生成图片', subtitle: data.revisedPrompt || undefined })}
              onDoubleClick={(event) => previewCanvasImage(event, { url: data.outputImage, title: nodeAssetName || '生成图片', subtitle: data.revisedPrompt || undefined })}
            >
              <Button
                size="sm"
                variant="secondary"
                className="h-7 text-[10px] bg-layer-4/80 hover:bg-zinc-700"
                onClick={(event) => {
                  event.stopPropagation();
                  void downloadCanvasImagePreview({ url: data.outputImage, title: nodeAssetName || '生成图片', subtitle: data.revisedPrompt || undefined });
                }}
              >
                <Download className="h-3 w-3 mr-1" /> 保存
              </Button>
              {!isStandaloneGeneration && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 text-[10px] bg-layer-4/80 hover:bg-zinc-700"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleSetAsCurrentImage();
                  }}
                >
                  {data.currentImageStatus === 'saving' ? '写入中...' : '设为当前图'}
                </Button>
              )}
            </div>
          </div>
          {outputImageVariants.length > 1 ? (
            <div className="mt-2 grid grid-cols-4 gap-1">
              {outputImageVariants.map((variant, index) => {
                const active = publicImageUrl(data.outputImage) === variant.url;
                return (
                  <button
                    key={`${variant.url}-${index}`}
                    type="button"
                    className={cn(
                      "nodrag nopan relative aspect-square overflow-hidden rounded border bg-zinc-950",
                      active ? "border-primary ring-1 ring-primary/60" : "border-border hover:border-[#3A3A40]",
                    )}
                    title={variant.title || `结果 ${index + 1}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      updateNodeData(id, {
                        outputImage: variant.url,
                        outputImageAssetId: variant.assetId || '',
                        revisedPrompt: variant.revisedPrompt || data.revisedPrompt || '',
                      });
                    }}
                  >
                    <img src={variant.url} alt={`结果 ${index + 1}`} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                    <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[9px] font-medium text-zinc-100">
                      {index + 1}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="nodrag nopan mt-2 h-7 w-full text-[11px] text-[#F7C24E] hover:bg-[#F5A623]/10 hover:text-[#F5A623]"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              handleAddOutputAsImageInput();
            }}
          >
            <ImageIcon className="mr-1 h-3.5 w-3.5" />
            作为图片输入放入画布
          </Button>
          {data.outputImageInputStatus ? (
            <div className="mt-1 text-center text-[10px] text-emerald-300">
              {String(data.outputImageInputStatus)}
            </div>
          ) : null}
          {isStandaloneGeneration && (
            <div className="mt-2 rounded border border-[#26262B] bg-[#141417] p-2">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-[10px] font-medium text-zinc-400">写入资产库</span>
                {data.lastAssignedAssetName ? (
                  <span className="truncate text-[10px] text-emerald-400">
                    已设为 {workflowAssetKindSelectLabel(data.lastAssignedAssetKind || targetAssetKind)} / {data.lastAssignedAssetName}
                  </span>
                ) : null}
              </div>
              <div className="flex gap-1.5">
                <select
                  className="nodrag nopan h-7 w-[82px] shrink-0 rounded border border-border bg-[#141417] px-1.5 text-[10px] text-zinc-300 focus:border-primary focus:outline-none"
                  value={targetAssetKind}
                  onChange={(e) => {
                    const nextKind = e.target.value as WorkflowAssetKind;
                    setTargetAssetKind(nextKind);
                    const nextNames = assetArray(targetAssets, nextKind).map(workflowAssetName).filter(Boolean);
                    setTargetAssetCustomMode(false);
                    setTargetAssetName(nextNames[0] || '');
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <option value="characters">角色</option>
                  <option value="scenes">场景</option>
                  <option value="props">道具</option>
                </select>
                {targetAssetOptions.length > 0 ? (
                  <select
                    className="nodrag nopan h-7 min-w-0 flex-1 rounded border border-border bg-[#141417] px-2 text-[10px] text-zinc-200 focus:border-primary focus:outline-none"
                    value={targetAssetCustomMode ? '__custom__' : targetAssetName}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === '__custom__') {
                        setTargetAssetCustomMode(true);
                        setTargetAssetName('');
                        return;
                      }
                      setTargetAssetCustomMode(false);
                      setTargetAssetName(value);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {targetAssetOptions.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                    <option value="__custom__">手动输入...</option>
                  </select>
                ) : null}
              </div>
              {(targetAssetCustomMode || targetAssetOptions.length === 0) ? (
                <input
                  className="nodrag nopan mt-1.5 h-7 w-full rounded border border-border bg-[#141417] px-2 text-[10px] text-zinc-200 placeholder-zinc-600 focus:border-primary focus:outline-none"
                  value={targetAssetName}
                  placeholder="输入资产名"
                  onChange={(e) => setTargetAssetName(e.target.value)}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : null}
              <div className="mt-1 text-[10px] text-zinc-500">
                已加载 {targetAssetOptions.length} 个{workflowAssetKindSelectLabel(targetAssetKind)}
              </div>
              <Button
                type="button"
                size="sm"
                className="nodrag nopan mt-2 h-7 w-full bg-emerald-600 text-[11px] text-white hover:bg-emerald-500"
                disabled={data.currentImageStatus === 'saving'}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleAssignStandaloneImageToAsset();
                }}
              >
                {data.currentImageStatus === 'saving' ? '写入中...' : '设为所选资产当前图'}
              </Button>
              {targetAssetsError ? <div className="mt-1 text-[10px] text-amber-400">{targetAssetsError}</div> : null}
            </div>
          )}
          {data.currentImageError ? <div className="mt-1 text-[10px] text-red-400">{data.currentImageError}</div> : null}
        </div>
      )}

      {data.status === 'failed' && data.error && (
        <div className="px-3 pb-2 text-[11px] text-red-400">{data.error}</div>
      )}

      {generationStalled && (
        <div className="px-3 pb-2 text-[10px] text-amber-400">上次生成状态已中断，可点击重新生成。</div>
      )}

        <CanvasHandle type="target" position={Position.Left} />
        <CanvasHandle type="source" position={Position.Right} />
      </div>
    </>
  );
};
