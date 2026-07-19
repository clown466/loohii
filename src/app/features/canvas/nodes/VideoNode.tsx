import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Position } from '@xyflow/react';
import { ArrowRight, ChevronDown, Mic, MonitorPlay, RotateCw, SlidersHorizontal, Wand2 } from 'lucide-react';
import { useParams } from 'react-router';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { cn } from '../../../utils/cn';
import { useCanvasStore } from '../../../stores/useCanvasStore';
import {
  apiClient,
  type CanvasVideoGenerationInput,
  type CanvasVideoGenerationResponse,
} from '../../../lib/apiClient';
import {
  type CanvasNodeProps,
  CanvasNodeResizer,
  CanvasHandle,
  PromptTextarea,
  publicImageUrl,
  publicAudioUrl,
  previewCanvasImage,
  readObjectString,
  canvasGenerationStartedAt,
  canvasNodeEpisodeId,
  canvasIncomingRelationKey,
  canvasNodeReferenceUrl,
  canvasVideoPromptText,
  isCanvasPromptWithinApiLimit,
  isDreaminaWebVideoPromptWithinLimit,
  canvasPromptTooLongError,
  dreaminaWebVideoPromptTooLongError,
  normalizeVideoResolution,
  normalizeVideoDuration,
  normalizeVideoRatio,
  normalizeGenerationCount,
  modelOptionLabel,
  canvasVideoProviderFailed,
  canvasVideoResultErrorMessage,
  canvasVideoPollErrorMessage,
  shouldRetryCanvasVideoPollError,
  canvasVideoReferencePreviewMessage,
  isStoryboardReferenceNodeForVideo,
  isStoryboardSlotNodeForVideo,
  videoReferenceSourcePriority,
  videoReferenceLabel,
  characterAudioReferencesFromNodeData,
  mergeVideoAudioReferencesWithIncoming,
  uniqueClipNames,
  videoResolutionOptions,
  videoDurationOptions,
  videoRatioOptions,
  MAX_VIDEO_REFERENCE_IMAGES,
  CANVAS_VIDEO_POLL_INTERVAL_MS,
  CANVAS_VIDEO_POLL_TIMEOUT_MS,
} from './shared';
import { useVideoModelOptions } from './modelOptions';

export const VideoNode = ({ id, data, selected }: CanvasNodeProps) => {
  const { id: projectId } = useParams();
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  // 只订阅与本节点相连的入边+源节点内容指纹，不裸订整个 edges/nodes 数组（P4-B 性能治理）
  const relationKey = useCanvasStore((s) => canvasIncomingRelationKey(s, id));
  const { videoModels, failed: modelLoadFailed } = useVideoModelOptions();
  const referenceImages = useMemo(() => {
    const { nodes, edges } = useCanvasStore.getState();
    const videoNode = nodes.find((node) => node.id === id);
    const incomingEdges = edges.filter((edge) => edge.target === id);
    const incomingSources = incomingEdges
      .map((edge) => nodes.find((node) => node.id === edge.source))
      .filter((node): node is typeof nodes[number] => Boolean(node));
    const hasUsableStoryboardSlot = incomingSources.some((source) => isStoryboardSlotNodeForVideo(source, videoNode ?? { data }) && Boolean(canvasNodeReferenceUrl(source)));
    const refs: { url: string; label: string }[] = [];
    const seen = new Set<string>();
    const addRef = (url: unknown, label: string) => {
      const normalized = publicImageUrl(url);
      if (!normalized || seen.has(normalized) || refs.length >= MAX_VIDEO_REFERENCE_IMAGES) return;
      seen.add(normalized);
      refs.push({ url: normalized, label });
    };
    const orderedEdges = [...incomingEdges].sort((a, b) => {
      const sourceA = nodes.find((node) => node.id === a.source);
      const sourceB = nodes.find((node) => node.id === b.source);
      return videoReferenceSourcePriority(sourceA ?? {}, videoNode ?? { data }) - videoReferenceSourcePriority(sourceB ?? {}, videoNode ?? { data });
    });
    for (const edge of orderedEdges) {
      const source = nodes.find((node) => node.id === edge.source);
      if (!source) continue;
      if (
        hasUsableStoryboardSlot &&
        isStoryboardReferenceNodeForVideo(source, videoNode ?? { data }) &&
        !isStoryboardSlotNodeForVideo(source, videoNode ?? { data })
      ) {
        continue;
      }
      addRef(canvasNodeReferenceUrl(source), videoReferenceLabel(source, videoNode ?? { data }));
    }
    const persistedReferenceUrls = Array.isArray(data.referenceImageUrls) ? data.referenceImageUrls : [];
    for (const url of persistedReferenceUrls) {
      addRef(url, refs.length === 0 ? '对应故事板' : '保存的参考图');
    }
    const storyboardFallback = publicImageUrl(data.storyboardImageUrl || data.storyboardUrl);
    if (refs.length === 0 && storyboardFallback) {
      addRef(storyboardFallback, '对应故事板');
    }
    return refs.slice(0, MAX_VIDEO_REFERENCE_IMAGES);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- relationKey 已覆盖 edges/nodes 中与本节点相关的变化
  }, [relationKey, id, data]);

  const referenceImageUrls = useMemo(
    () => referenceImages.slice(0, MAX_VIDEO_REFERENCE_IMAGES).map((ref) => ref.url),
    [referenceImages],
  );
  const sourceEpisode = typeof data.sourceEpisode === 'string' ? data.sourceEpisode : '';
  const sourceEpisodeId = canvasNodeEpisodeId(data);
  const clipId = typeof data.clipId === 'string' ? data.clipId : '';
  const clipTitle = typeof data.title === 'string' ? data.title : '';
  const prompt = canvasVideoPromptText(data);
  const selectedResolution = normalizeVideoResolution(data.resolution);
  const selectedDuration = normalizeVideoDuration(data.durationSeconds ?? data.duration);
  const includeAudio = data.includeAudio !== false;
  const characterAudioRefs = useMemo(
    () => {
      const { nodes, edges } = useCanvasStore.getState();
      return mergeVideoAudioReferencesWithIncoming(characterAudioReferencesFromNodeData(data), id, nodes, edges);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- relationKey 已覆盖 edges/nodes 中与本节点相关的变化
    [data, id, relationKey],
  );
  const referenceAudioUrls = useMemo(
    () => characterAudioRefs.map((ref) => publicAudioUrl(ref.url)).filter((url, index, urls) => Boolean(url) && urls.indexOf(url) === index),
    [characterAudioRefs],
  );
  const dialogueCharacterNames = useMemo(
    () => uniqueClipNames([
      ...(Array.isArray(data.dialogueCharacterNames) ? data.dialogueCharacterNames.map(String) : []),
      ...characterAudioRefs.map((ref) => ref.name),
    ]),
    [data.dialogueCharacterNames, characterAudioRefs],
  );
  const missingAudioNames = characterAudioRefs.filter((ref) => !publicAudioUrl(ref.url)).map((ref) => ref.name);
  const selectedRatio = normalizeVideoRatio(data.ratio ?? data.size);
  const selectedCount = normalizeGenerationCount(data.count);
  const videoStatus = String(data.videoStatus || data.status || 'waiting');
  const videoCost = Number.isFinite(Number(data.estimatedCost)) ? Number(data.estimatedCost) : 6;
  const outputVideo = typeof data.outputVideo === 'string' ? data.outputVideo : '';
  const videoSubmitId = typeof data.videoSubmitId === 'string' ? data.videoSubmitId.trim() : '';
  const ratioLabel = videoRatioOptions.find((item) => item.value === selectedRatio)?.label || selectedRatio;
  const rawModelId = String(data.modelId || '').trim();
  const selectedModel = rawModelId ? videoModels.find((model) => model.id === rawModelId) : undefined;
  const effectiveVideoModelId = selectedModel ? rawModelId : '';
  const staleModelSelected = Boolean(rawModelId && !selectedModel);
  const modelSummary = selectedModel
    ? selectedModel.displayName || selectedModel.model || String(data.modelId)
    : staleModelSelected
      ? '默认视频模型'
      : '默认模型';
  const parametersCollapsed = data.videoParametersCollapsed !== false;
  const videoGenerating = videoStatus === 'submitted' || videoStatus === 'generating';
  const audioSummary = includeAudio ? `${referenceAudioUrls.length} 音频` : '无音频';
  const referenceSummary = `${referenceImages.length} 参考图 · ${audioSummary}`;
  const parameterSummary = `${staleModelSelected ? '旧模型已停用 -> ' : ''}${modelSummary} / ${selectedResolution} / ${selectedDuration}s / ${audioSummary} / ${ratioLabel} / ${selectedCount}x`;
  const statusLabel =
    videoStatus === 'submitted'
      ? '自动查询中'
      : videoStatus === 'generating'
        ? '生成中'
        : videoStatus === 'completed'
          ? '已完成'
          : videoStatus === 'failed'
            ? '失败'
            : '待生成';
  const videoPollTimerRef = useRef<number | null>(null);
  const videoPollAbortRef = useRef<AbortController | null>(null);
  const videoPollRunIdRef = useRef(0);
  const videoPollActiveRef = useRef(false);
  const videoPollSubmitIdRef = useRef('');
  const latestVideoRequestRef = useRef<CanvasVideoGenerationInput | null>(null);
  const previewInFlightRef = useRef(false);
  const [previewInFlight, setPreviewInFlight] = useState(false);
  const promptOptimizeAbortRef = useRef<AbortController | null>(null);
  const promptOptimizeRequestIdRef = useRef(0);
  const [promptOptimizing, setPromptOptimizing] = useState(false);

  const videoRequestInput = useMemo<CanvasVideoGenerationInput>(() => ({
    prompt,
    aiModelId: effectiveVideoModelId || undefined,
    resolution: selectedResolution,
    durationSeconds: selectedDuration,
    ratio: selectedRatio,
    count: selectedCount,
    referenceImageUrls,
    referenceAudioUrls: includeAudio && referenceAudioUrls.length ? referenceAudioUrls : undefined,
    parameters: {
      requestedModelId: effectiveVideoModelId,
      staleRequestedModelId: staleModelSelected ? rawModelId : '',
      requestedModelLabel: modelSummary,
      referenceAudioUrls: includeAudio ? referenceAudioUrls : [],
    },
    metadata: {
      clipId,
      clipTitle,
      sourceEpisode,
      sourceEpisodeId,
      nodeId: id,
      dialogueCharacterNames,
      characterAudioReferences: characterAudioRefs,
    },
  }), [
    prompt,
    effectiveVideoModelId,
    selectedResolution,
    selectedDuration,
    selectedRatio,
    selectedCount,
    referenceImageUrls,
    includeAudio,
    referenceAudioUrls,
    staleModelSelected,
    rawModelId,
    modelSummary,
    clipId,
    clipTitle,
    sourceEpisode,
    sourceEpisodeId,
    id,
    dialogueCharacterNames,
    characterAudioRefs,
  ]);

  useEffect(() => {
    latestVideoRequestRef.current = videoRequestInput;
  }, [videoRequestInput]);

  const stopCanvasVideoPolling = useCallback(() => {
    videoPollRunIdRef.current += 1;
    videoPollActiveRef.current = false;
    videoPollSubmitIdRef.current = '';
    if (videoPollTimerRef.current !== null) {
      window.clearTimeout(videoPollTimerRef.current);
      videoPollTimerRef.current = null;
    }
    videoPollAbortRef.current?.abort();
    videoPollAbortRef.current = null;
  }, []);

  const applyCanvasVideoResult = useCallback((result: CanvasVideoGenerationResponse, fallbackSubmitId = ''): 'completed' | 'failed' | 'pending' => {
    const videoUrl = result.video?.url || '';
    const nextSubmitId = (result.submitId || fallbackSubmitId || '').trim();
    if (videoUrl) {
      updateNodeData(id, {
        videoStatus: 'completed',
        status: 'completed',
        statusLabel: '视频已完成',
        videoError: '',
        outputVideo: videoUrl,
        outputVideoAssetId: readObjectString(result.asset, 'id'),
        videoSubmitId: nextSubmitId,
        videoProviderStatus: result.genStatus || 'succeeded',
        generationStartedAt: '',
        generationId: readObjectString(result.generation, 'id') || readObjectString(data, 'generationId'),
      });
      return 'completed';
    }
    if (canvasVideoProviderFailed(result.genStatus)) {
      const resultError = canvasVideoResultErrorMessage(result);
      updateNodeData(id, {
        videoStatus: 'failed',
        status: 'failed',
        statusLabel: '视频生成失败',
        videoError: resultError || `即梦视频生成失败${result.genStatus ? `：${result.genStatus}` : '。'}`,
        videoSubmitId: nextSubmitId,
        videoProviderStatus: result.genStatus || 'failed',
        generationStartedAt: '',
        generationId: readObjectString(result.generation, 'id') || readObjectString(data, 'generationId'),
      });
      return 'failed';
    }
    if (!nextSubmitId) {
      updateNodeData(id, {
        videoStatus: 'failed',
        status: 'failed',
        statusLabel: '视频生成失败',
        videoError: '即梦任务没有返回 submitId，无法自动查询结果。',
        videoProviderStatus: result.genStatus || 'missing-submit-id',
        generationStartedAt: '',
        generationId: readObjectString(result.generation, 'id') || readObjectString(data, 'generationId'),
      });
      return 'failed';
    }
    updateNodeData(id, {
      videoStatus: 'submitted',
      status: 'generating',
      statusLabel: '即梦生成中',
      videoError: `即梦任务已提交：${nextSubmitId}。正在自动查询结果，完成后会自动写入预览节点。`,
      videoSubmitId: nextSubmitId,
      videoProviderStatus: result.genStatus || 'querying',
      generationId: readObjectString(result.generation, 'id') || readObjectString(data, 'generationId'),
    });
    return 'pending';
  }, [id, updateNodeData]);

  const startCanvasVideoPolling = useCallback((submitId: string, options: { immediate?: boolean } = {}) => {
    const trimmedSubmitId = submitId.trim();
    if (!trimmedSubmitId) return;
    if (videoPollActiveRef.current && videoPollSubmitIdRef.current === trimmedSubmitId && !options.immediate) return;
    if (videoPollTimerRef.current !== null) {
      window.clearTimeout(videoPollTimerRef.current);
      videoPollTimerRef.current = null;
    }
    videoPollAbortRef.current?.abort();
    videoPollAbortRef.current = null;
    videoPollRunIdRef.current += 1;
    const runId = videoPollRunIdRef.current;
    const startedAt = Date.now();
    videoPollActiveRef.current = true;
    videoPollSubmitIdRef.current = trimmedSubmitId;

    const finishPolling = () => {
      if (videoPollRunIdRef.current !== runId) return;
      videoPollActiveRef.current = false;
      videoPollSubmitIdRef.current = '';
      if (videoPollTimerRef.current !== null) {
        window.clearTimeout(videoPollTimerRef.current);
        videoPollTimerRef.current = null;
      }
    };

    const scheduleAttempt = (delayMs: number) => {
      if (videoPollRunIdRef.current !== runId) return;
      if (videoPollTimerRef.current !== null) window.clearTimeout(videoPollTimerRef.current);
      videoPollTimerRef.current = window.setTimeout(async () => {
        videoPollTimerRef.current = null;
        if (videoPollRunIdRef.current !== runId) return;
        if (Date.now() - startedAt > CANVAS_VIDEO_POLL_TIMEOUT_MS) {
          updateNodeData(id, {
            videoStatus: 'failed',
            status: 'failed',
            statusLabel: '视频生成超时',
            videoError: '自动查询已超过 30 分钟，已停止。上游任务可能仍在处理，可从生成记录或任务后台核对。',
            videoSubmitId: trimmedSubmitId,
            videoProviderStatus: 'poll-timeout',
          });
          finishPolling();
          return;
        }

        const requestInput = latestVideoRequestRef.current;
        if (!requestInput?.prompt?.trim()) {
          updateNodeData(id, {
            videoStatus: 'failed',
            status: 'failed',
            statusLabel: '视频生成失败',
            videoError: '视频提示词为空，无法自动查询结果。',
            videoSubmitId: trimmedSubmitId,
          });
          finishPolling();
          return;
        }

        const abortController = new AbortController();
        videoPollAbortRef.current = abortController;
        try {
          updateNodeData(id, {
            videoStatus: 'submitted',
            status: 'generating',
            statusLabel: '即梦生成中',
            videoError: `即梦任务已提交：${trimmedSubmitId}。正在自动查询结果，完成后会自动写入预览节点。`,
            videoSubmitId: trimmedSubmitId,
          });
          const result = await apiClient.generateCanvasVideo(projectId || 'local', {
            ...requestInput,
            submitId: trimmedSubmitId,
          }, { signal: abortController.signal });
          if (videoPollRunIdRef.current !== runId) return;
          const nextState = applyCanvasVideoResult(result, trimmedSubmitId);
          if (nextState === 'pending') {
            scheduleAttempt(CANVAS_VIDEO_POLL_INTERVAL_MS);
          } else {
            finishPolling();
          }
        } catch (error: any) {
          if (abortController.signal.aborted || videoPollRunIdRef.current !== runId) return;
          if (shouldRetryCanvasVideoPollError(error)) {
            updateNodeData(id, {
              videoStatus: 'submitted',
              status: 'generating',
              statusLabel: '即梦生成中',
              videoError: `即梦任务已提交：${trimmedSubmitId}。上次查询暂时失败，仍在自动查询结果。`,
              videoSubmitId: trimmedSubmitId,
              videoProviderStatus: 'poll-retrying',
            });
            scheduleAttempt(CANVAS_VIDEO_POLL_INTERVAL_MS);
            return;
          }
          updateNodeData(id, {
            videoStatus: 'failed',
            status: 'failed',
            statusLabel: '视频生成失败',
            videoError: canvasVideoPollErrorMessage(error) || '即梦视频生成失败。',
            videoSubmitId: trimmedSubmitId,
            videoProviderStatus: 'poll-failed',
          });
          finishPolling();
        } finally {
          if (videoPollAbortRef.current === abortController) videoPollAbortRef.current = null;
        }
      }, delayMs);
    };

    scheduleAttempt(options.immediate ? 0 : CANVAS_VIDEO_POLL_INTERVAL_MS);
  }, [applyCanvasVideoResult, id, projectId, updateNodeData]);

  useEffect(() => {
    if (videoSubmitId && !outputVideo && videoStatus === 'submitted') {
      startCanvasVideoPolling(videoSubmitId);
      return;
    }
    if (outputVideo || videoStatus === 'completed' || videoStatus === 'failed' || videoStatus === 'waiting') {
      stopCanvasVideoPolling();
    }
  }, [outputVideo, startCanvasVideoPolling, stopCanvasVideoPolling, videoStatus, videoSubmitId]);

  useEffect(() => () => {
    stopCanvasVideoPolling();
    promptOptimizeAbortRef.current?.abort();
  }, [stopCanvasVideoPolling]);

  const updatePrompt = (nextPrompt: string) => {
    updateNodeData(id, {
      prompt: nextPrompt,
      seedancePrompt: nextPrompt,
      videoPrompt: nextPrompt,
    });
  };

  const handleSubmit = async () => {
    if (previewInFlightRef.current) {
      updateNodeData(id, { videoStatus: 'waiting', status: 'waiting', videoError: '素材预检还在进行中，请等待预检结束后再提交生成。' });
      return;
    }
    if (!prompt) {
      updateNodeData(id, { videoStatus: 'failed', videoError: '请先输入视频提示词。' });
      return;
    }
    if (!isCanvasPromptWithinApiLimit(prompt)) {
      updateNodeData(id, { videoStatus: 'failed', videoError: canvasPromptTooLongError('video', prompt.length) });
      return;
    }
    if (!isDreaminaWebVideoPromptWithinLimit(prompt)) {
      updateNodeData(id, {
        videoStatus: 'failed',
        status: 'failed',
        statusLabel: '视频生成失败',
        videoError: dreaminaWebVideoPromptTooLongError(prompt.length),
      });
      return;
    }
    if (referenceImages.length === 0) {
      updateNodeData(id, { videoStatus: 'failed', videoError: '即梦图生视频需要至少连接 1 张故事板或图片作为首帧。' });
      return;
    }
    stopCanvasVideoPolling();
    const generationStartedAt = canvasGenerationStartedAt();
    updateNodeData(id, {
      videoStatus: 'generating',
      status: 'generating',
      statusLabel: '提交即梦任务',
      videoError: '正在提交即梦 Seedance 2.0 图生视频任务...',
      outputVideo: '',
      outputVideoAssetId: '',
      videoSubmitId: '',
      videoProviderStatus: '',
      resolution: selectedResolution,
      durationSeconds: selectedDuration,
      includeAudio,
      ratio: selectedRatio,
      count: selectedCount,
      referenceImageUrls,
      referenceAudioUrls,
      characterAudioReferences: characterAudioRefs,
      referenceAudioCount: referenceAudioUrls.length,
      generationStartedAt,
      generationId: '',
    });
    try {
      const result = await apiClient.generateCanvasVideo(projectId || 'local', {
        ...videoRequestInput,
      });
      const backendGenerationId = readObjectString(result.generation, 'id');
      if (backendGenerationId) updateNodeData(id, { generationId: backendGenerationId });
      const nextState = applyCanvasVideoResult(result);
      if (nextState === 'pending' && result.submitId) {
        startCanvasVideoPolling(result.submitId);
      }
    } catch (error: any) {
      updateNodeData(id, {
        videoStatus: 'failed',
        status: 'failed',
        statusLabel: '视频生成失败',
        videoError: error?.message || '即梦视频生成失败。',
      });
    }
  };

  const handlePreviewReferences = async () => {
    if (!prompt) {
      updateNodeData(id, { videoStatus: 'failed', videoError: '请先输入视频提示词。' });
      return;
    }
    if (!isCanvasPromptWithinApiLimit(prompt)) {
      updateNodeData(id, { videoStatus: 'failed', videoError: canvasPromptTooLongError('video', prompt.length) });
      return;
    }
    if (!isDreaminaWebVideoPromptWithinLimit(prompt)) {
      updateNodeData(id, {
        videoStatus: 'failed',
        status: 'failed',
        statusLabel: '视频素材预检失败',
        videoError: dreaminaWebVideoPromptTooLongError(prompt.length),
      });
      return;
    }
    if (previewInFlightRef.current) return;
    previewInFlightRef.current = true;
    setPreviewInFlight(true);
    updateNodeData(id, {
      videoError: '正在预检视频素材，不会提交 Dreamina 任务...',
      referenceImageUrls,
      referenceAudioUrls,
      characterAudioReferences: characterAudioRefs,
      referenceAudioCount: referenceAudioUrls.length,
    });
    try {
      const result = await apiClient.generateCanvasVideo(projectId || 'local', {
        ...videoRequestInput,
        dryRun: true,
      });
      updateNodeData(id, {
        videoStatus: outputVideo ? 'completed' : 'waiting',
        status: outputVideo ? 'completed' : 'waiting',
        videoError: canvasVideoReferencePreviewMessage(result),
        referenceImageUrls: result.references?.referenceImageUrls ?? referenceImageUrls,
        referenceAudioUrls: result.references?.referenceAudioUrls ?? referenceAudioUrls,
      });
    } catch (error: any) {
      updateNodeData(id, {
        videoStatus: 'failed',
        status: 'failed',
        statusLabel: '素材预检失败',
        videoError: error?.message || '视频素材预检失败。',
      });
    } finally {
      previewInFlightRef.current = false;
      setPreviewInFlight(false);
    }
  };

  const handleOptimizePrompt = async () => {
    if (!prompt) {
      updateNodeData(id, { videoStatus: 'failed', status: 'failed', videoError: '请先输入要优化的视频提示词。' });
      return;
    }
    if (!isCanvasPromptWithinApiLimit(prompt)) {
      updateNodeData(id, { videoStatus: 'failed', status: 'failed', videoError: canvasPromptTooLongError('video', prompt.length) });
      return;
    }
    promptOptimizeAbortRef.current?.abort();
    const requestId = promptOptimizeRequestIdRef.current + 1;
    promptOptimizeRequestIdRef.current = requestId;
    const abortController = new AbortController();
    promptOptimizeAbortRef.current = abortController;
    setPromptOptimizing(true);
    updateNodeData(id, {
      promptOptimizationStatus: 'optimizing',
      promptOptimizationError: '',
      originalRejectedPrompt: prompt,
      videoError: '正在手动优化不过审提示词，台词和大概原意会尽量保持不变...',
    });
    try {
      const result = await apiClient.optimizeCanvasPrompt(projectId || 'local', {
        prompt,
        targetProvider: 'Dreamina Web Seedance 2.0',
        failureReason: String(data.videoError || data.promptOptimizationFailureReason || 'The prompt may contain content that violates Community Guidelines'),
        context: [
          clipId ? `Clip ID: ${clipId}` : '',
          clipTitle ? `Clip title: ${clipTitle}` : '',
          sourceEpisode ? `Episode: ${sourceEpisode}` : '',
          selectedDuration ? `Duration: ${selectedDuration}s` : '',
          selectedRatio ? `Ratio: ${selectedRatio}` : '',
          referenceImages.length ? `Reference images: ${referenceImages.map((ref) => ref.label).join(', ')}` : '',
          dialogueCharacterNames.length ? `Dialogue characters: ${dialogueCharacterNames.join(', ')}` : '',
        ].filter(Boolean).join('\n'),
      }, { signal: abortController.signal });
      if (promptOptimizeRequestIdRef.current !== requestId || abortController.signal.aborted) return;
      updatePrompt(result.optimizedPrompt);
      updateNodeData(id, {
        videoStatus: outputVideo ? 'completed' : 'waiting',
        status: outputVideo ? 'completed' : 'waiting',
        promptOptimizationStatus: 'completed',
        promptOptimizationError: '',
        originalRejectedPrompt: prompt,
        optimizedPrompt: result.optimizedPrompt,
        promptOptimizationModel: result.model,
        promptOptimizationDurationMs: result.durationMs,
        videoError: '提示词已优化，请人工确认后再重新提交生成。',
      });
    } catch (error: any) {
      if (promptOptimizeRequestIdRef.current !== requestId || abortController.signal.aborted) return;
      updateNodeData(id, {
        videoStatus: 'failed',
        status: 'failed',
        promptOptimizationStatus: 'failed',
        promptOptimizationError: error?.message || '提示词优化失败。',
        videoError: error?.message || '提示词优化失败，请检查文本模型配置。',
      });
    } finally {
      if (promptOptimizeRequestIdRef.current === requestId) {
        promptOptimizeAbortRef.current = null;
        setPromptOptimizing(false);
      }
    }
  };

  return (
    <>
      <CanvasNodeResizer selected={selected} minWidth={520} minHeight={300} />
      <div className={cn("scrollbar-none h-full w-full overflow-y-auto overflow-x-hidden rounded-[14px] border lh-node transition-colors hover:border-[#3A3A40]", selected && "lh-node-active")}>
        <div className="flex items-center gap-3 border-b border-[#26262B] p-3 cursor-grab active:cursor-grabbing">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#F5A623]/10 text-[#F7C24E]">
            <MonitorPlay className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-zinc-100">{data.title || '视频生成'}</div>
            <div className="mt-0.5 truncate text-[11px] text-zinc-500">
              {selectedResolution} / {selectedDuration}s / {referenceSummary} / {ratioLabel}
            </div>
          </div>
          <Badge className={cn(
            "shrink-0 border text-[10px] hover:bg-[#141417]",
            videoStatus === 'completed'
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : videoStatus === 'failed'
                ? "border-red-500/30 bg-red-500/10 text-red-300"
                : videoStatus === 'submitted' || videoStatus === 'generating'
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                  : "border-border bg-[#141417] text-zinc-400"
          )}>
            {statusLabel}
          </Badge>
        </div>

        <div className="border-b border-[#26262B] px-3 py-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex rounded-md border border-border bg-[#141417] p-0.5 text-[11px]">
              <button type="button" className="rounded bg-zinc-700 px-3 py-1 font-medium text-zinc-100">全能参考</button>
              <button type="button" className="px-3 py-1 font-medium text-zinc-400">首帧视频</button>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-[11px]">
              <span className="text-[#F7C24E]">{referenceImages.length} 参考图</span>
              <span className={cn(
                "inline-flex items-center gap-1",
                includeAudio && referenceAudioUrls.length ? "text-emerald-300" : "text-zinc-500"
              )}>
                <Mic className="h-3 w-3" />
                {audioSummary}
              </span>
            </div>
          </div>
          {referenceImages.length > 0 ? (
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {referenceImages.map((ref, index) => (
                <img
                  key={`${ref.url}-${index}`}
                  src={ref.url}
                  alt={ref.label}
                  title={ref.label}
                  loading="lazy"
                  decoding="async"
                  className="h-12 w-12 shrink-0 cursor-zoom-in rounded border border-border object-cover"
                  onClick={(event) => previewCanvasImage(event, { url: ref.url, title: ref.label, subtitle: '视频参考图' })}
                  onDoubleClick={(event) => previewCanvasImage(event, { url: ref.url, title: ref.label, subtitle: '视频参考图' })}
                />
              ))}
            </div>
          ) : (
            <div className="flex h-16 items-center justify-center rounded border border-dashed border-border bg-[#141417]/40 text-[12px] text-zinc-500">
              从左侧连入图片输入、角色图或资产图作为参考
            </div>
          )}
          <div className="mt-2 rounded-md border border-[#26262B] bg-[#141417] px-2 py-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-zinc-300">
                <Mic className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                <span className="truncate">台词音频参考</span>
              </div>
              <span className="shrink-0 text-[11px] text-emerald-300">{referenceAudioUrls.length} 音频</span>
            </div>
            {characterAudioRefs.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {characterAudioRefs.map((ref, index) => {
                  const hasAudio = Boolean(publicAudioUrl(ref.url));
                  return (
                    <span
                      key={`${ref.name}-${index}`}
                      className={cn(
                        "inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]",
                        hasAudio
                          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
                          : "border-border bg-[#141417] text-zinc-500"
                      )}
                      title={hasAudio ? ref.fileName || ref.url : '该台词角色还没有音频参考'}
                    >
                      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", hasAudio ? "bg-emerald-400" : "bg-zinc-600")} />
                      <span className="truncate">{ref.name}</span>
                    </span>
                  );
                })}
              </div>
            ) : (
              <div className="text-[11px] text-zinc-500">未识别到台词角色，或还没有给角色上传音频参考。</div>
            )}
            {missingAudioNames.length > 0 ? (
              <div className="mt-1 text-[10px] leading-4 text-zinc-500">
                缺少音频：{missingAudioNames.slice(0, 6).join('、')}{missingAudioNames.length > 6 ? '等' : ''}
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-3 px-3 py-3">
          <div>
            <div className="mb-1.5 text-[11px] font-medium text-zinc-400">视频提示词</div>
            <PromptTextarea
              className="nodrag nopan min-h-[130px] w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-[12px] leading-5 text-zinc-200 placeholder-zinc-600 outline-none focus:border-primary"
              value={prompt}
              placeholder="描述你想要生成的内容，并连接参考图。"
              modalTitle={`${data.title || '视频节点'} · 视频提示词`}
              modalSubtitle="完整视频提示词"
              onChange={updatePrompt}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              onKeyUp={(event) => event.stopPropagation()}
            />
          </div>

          <div className="overflow-hidden rounded-lg border border-[#26262B] bg-[#141417]">
            <button
              type="button"
              className="nodrag nopan flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[#141417]/70"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                updateNodeData(id, { videoParametersCollapsed: !parametersCollapsed });
              }}
            >
              <SlidersHorizontal className="h-4 w-4 shrink-0 text-[#F7C24E]" />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium text-zinc-300">生成参数</div>
                <div className="mt-0.5 truncate text-[11px] text-zinc-500">{parameterSummary}</div>
              </div>
              <ChevronDown className={cn("h-4 w-4 shrink-0 text-zinc-500 transition-transform", !parametersCollapsed && "rotate-180")} />
            </button>

            {!parametersCollapsed ? (
              <div className="space-y-3 border-t border-[#26262B] p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 text-[11px] text-zinc-500">视频模型</div>
                    <select
                      className="nodrag nopan h-8 w-full rounded-md border border-border bg-[#141417] px-2 text-[12px] text-zinc-200 outline-none focus:border-primary"
                      value={String(data.modelId || '')}
                      onChange={(event) => updateNodeData(id, { modelId: event.target.value })}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <option value="">{videoModels.length ? '默认视频模型' : '未配置视频模型'}</option>
                      {data.modelId && !videoModels.some((model) => model.id === data.modelId) ? (
                        <option value={String(data.modelId)}>旧模型已停用，提交时使用默认模型</option>
                      ) : null}
                      {videoModels.map((model) => (
                        <option key={model.id} value={model.id}>{modelOptionLabel(model)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] text-zinc-500">生成数量</div>
                    <select
                      className="nodrag nopan h-8 w-full rounded-md border border-border bg-[#141417] px-2 text-[12px] text-zinc-200 outline-none focus:border-primary"
                      value={selectedCount}
                      onChange={(event) => updateNodeData(id, { count: Number(event.target.value) })}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <option value={1}>1x</option>
                      <option value={2}>2x</option>
                      <option value={4}>4x</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-[11px] font-medium text-zinc-400">分辨率</div>
                  <div className="grid grid-cols-6 gap-1">
                    {videoResolutionOptions.map((resolution) => (
                      <button
                        key={resolution}
                        type="button"
                        className={cn(
                          "nodrag nopan h-8 rounded-md text-[11px] transition-colors",
                          selectedResolution === resolution ? "bg-zinc-600 text-zinc-50" : "bg-[#141417] text-zinc-400 hover:bg-layer-4"
                        )}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          updateNodeData(id, { resolution });
                        }}
                      >
                        {resolution}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-[11px] font-medium text-zinc-400">生成时长</div>
                  <div className="grid grid-cols-6 gap-1">
                    {videoDurationOptions.map((seconds) => (
                      <button
                        key={seconds}
                        type="button"
                        className={cn(
                          "nodrag nopan h-8 rounded-md text-[11px] transition-colors",
                          selectedDuration === seconds ? "bg-zinc-600 text-zinc-50" : "bg-[#141417] text-zinc-400 hover:bg-layer-4"
                        )}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          updateNodeData(id, { durationSeconds: seconds });
                        }}
                      >
                        {seconds}s
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-[11px] font-medium text-zinc-400">生成视频音频</div>
                  <div className="grid grid-cols-2 gap-1 rounded-md bg-[#141417] p-0.5">
                    {[true, false].map((value) => (
                      <button
                        key={String(value)}
                        type="button"
                        className={cn(
                          "nodrag nopan h-8 rounded text-[12px]",
                          includeAudio === value ? "bg-zinc-600 text-zinc-50" : "text-zinc-400 hover:bg-layer-4"
                        )}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          updateNodeData(id, { includeAudio: value });
                        }}
                      >
                        {value ? '是' : '否'}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-[11px] font-medium text-zinc-400">比例</div>
                  <div className="grid grid-cols-4 gap-2">
                    {videoRatioOptions.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        className={cn(
                          "nodrag nopan flex h-11 flex-col items-center justify-center gap-1 rounded-md border text-[10px] transition-colors",
                          selectedRatio === item.value ? "border-[#F5A623] bg-[#F5A623]/10 text-[#F7C24E]" : "border-[#26262B] bg-[#141417] text-zinc-400 hover:border-border"
                        )}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          updateNodeData(id, { ratio: item.value });
                        }}
                      >
                        <span className={cn(
                          "block rounded-sm border border-current",
                          item.value === '16:9' ? 'h-2 w-5' : item.value === '4:3' ? 'h-3 w-5' : item.value === '1:1' ? 'h-4 w-4' : item.value === '3:4' ? 'h-5 w-4' : item.value === '9:16' ? 'h-6 w-3' : item.value === '21:9' ? 'h-2 w-7' : 'h-4 w-4'
                        )} />
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {outputVideo ? (
            <video src={outputVideo} controls className="aspect-video w-full rounded-md border border-border bg-black" />
          ) : null}

          {data.videoError ? <div className="rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[11px] leading-4 text-amber-200">{data.videoError}</div> : null}
          {modelLoadFailed ? <div className="text-[11px] text-amber-300">视频模型列表加载失败。</div> : null}
        </div>

        <div className="flex items-center gap-2 border-t border-[#26262B] px-3 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-zinc-400">
            <MonitorPlay className="h-3.5 w-3.5 text-[#F7C24E]" />
            <span className="truncate">{selectedResolution} / {selectedDuration}s / {includeAudio ? '是' : '否'} / {ratioLabel}</span>
          </div>
          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[13px] font-semibold text-emerald-300">¥ {videoCost}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            title="手动优化不过审提示词，不会提交 Dreamina 任务"
            disabled={promptOptimizing || videoGenerating || previewInFlight}
            className="nodrag nopan h-9 border-primary/40 bg-primary/10 px-3 text-[12px] text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              void handleOptimizePrompt();
            }}
          >
            {promptOptimizing ? <RotateCw className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-1 h-3.5 w-3.5" />}
            {promptOptimizing ? '优化中' : '优化提示词'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            title="只预检将上传给 Dreamina 的图片和音频，不提交任务"
            disabled={videoStatus === 'generating' || previewInFlight || promptOptimizing}
            className="nodrag nopan h-9 border-border bg-[#141417] px-3 text-[12px] text-zinc-200 hover:bg-layer-4 disabled:cursor-not-allowed disabled:opacity-60"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              void handlePreviewReferences();
            }}
          >
            预检素材
          </Button>
          <Button
            type="button"
            size="icon"
            title="提交新的即梦视频任务"
            disabled={videoStatus === 'generating' || previewInFlight || promptOptimizing}
            className="nodrag nopan h-9 w-9 rounded-full bg-zinc-100 text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              void handleSubmit();
            }}
          >
            {videoGenerating || previewInFlight ? <RotateCw className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          </Button>
        </div>

        <CanvasHandle type="target" position={Position.Left} tone="sky" style={{ top: 32 }} />
        <CanvasHandle type="source" position={Position.Right} tone="sky" style={{ top: 32 }} />
      </div>
    </>
  );
};
