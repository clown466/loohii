import { useEffect, useMemo, useRef, useState } from 'react';
import { Position } from '@xyflow/react';
import { Download, Wand2 } from 'lucide-react';
import { useParams } from 'react-router';
import { Button } from '../../../components/ui/button';
import { ThumbImage } from '../../../components/ThumbImage';
import '../../../utils/cn';
import { useCanvasStore } from '../../../stores/useCanvasStore';
import { useProjectStore } from '../../../stores/useProjectStore';
import { apiClient } from '../../../lib/apiClient';
import {
  type CanvasNodeProps,
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
  canvasGenerationStartedAt,
  canvasGenerationAgeMs,
  isCanvasGenerationStale,
  canvasGenerationWaitLabel,
  isCanvasPromptWithinApiLimit,
  canvasPromptTooLongError,
  canvasNodeEpisodeId,
  compactProjectPromptContext,
  buildCanvasCharacterFinalPrompt,
  isRawCharacterAssetPrompt,
  finalPromptSatisfiesProjectIdentity,
  stripLegacyCanvasAssetPromptScaffold,
  modelOptionLabel,
  CANVAS_IMAGE_RATIO_OPTIONS,
  CANVAS_GENERATION_STALE_MS,
} from './shared';
import { useImageModelOptions } from './modelOptions';

export const CharacterNode = ({ id, data, selected }: CanvasNodeProps) => {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const edges = useCanvasStore((s) => s.edges);
  const nodes = useCanvasStore((s) => s.nodes);
  const { id: projectId } = useParams();
  const currentProject = useProjectStore((s) => s.projects.find((project) => project.id === projectId));
  const sourceEpisode = typeof data.sourceEpisode === 'string' ? data.sourceEpisode : '';
  const sourceEpisodeId = canvasNodeEpisodeId(data);
  const projectPromptContext = useMemo(
    () => currentProject ? compactProjectPromptContext(currentProject) : (data.projectPromptContext || {}),
    [currentProject, data.projectPromptContext],
  );
  const { imageModels } = useImageModelOptions();

  const referenceImages = useMemo(() => {
    const incomingEdges = edges.filter((e) => e.target === id);
    const refs: { url: string; label: string }[] = [];
    for (const edge of incomingEdges) {
      const source = nodes.find((n) => n.id === edge.source);
      const imageInputUrl = source?.type === 'imageInput' ? publicImageUrl(source.data?.imageUrl) : '';
      if (imageInputUrl) {
        refs.push({ url: imageInputUrl, label: (source?.data.label as string) || '参考图' });
      }
    }
    return refs;
  }, [edges, nodes, id]);

  const autoFinalPrompt = useMemo(() => buildCanvasCharacterFinalPrompt(data, referenceImages.length, projectPromptContext), [data, referenceImages.length, projectPromptContext]);
  const rawFinalPrompt = stripLegacyCanvasAssetPromptScaffold(data.finalPrompt);
  const finalPrompt =
    rawFinalPrompt &&
    !isRawCharacterAssetPrompt(data, rawFinalPrompt) &&
    finalPromptSatisfiesProjectIdentity(rawFinalPrompt, projectPromptContext, data)
      ? rawFinalPrompt
      : autoFinalPrompt;
  const assetName = String(data.assetName || data.name || 'character');
  const selectedRatio = normalizeCanvasImageSize(data.ratio);
  const selectedResolution = normalizeImageResolution(data.resolution);
  const selectedQuality = String(data.quality || 'high');
  const generatedImageAspectRatio = positiveNumber(data.generatedImageAspectRatio) ?? ratioToNumber(selectedRatio);
  const generationStalled = data.genStatus === 'generating' && isCanvasGenerationStale(data.generationStartedAt);
  const generationInFlightRef = useRef(false);
  const generationAbortRef = useRef<AbortController | null>(null);
  const generationRequestIdRef = useRef(0);

  useEffect(() => () => {
    generationAbortRef.current?.abort();
  }, []);

  const handleGenerate = async () => {
    if (data.genStatus === 'generating' && !generationStalled) {
      updateNodeData(id, {
        genError: `${canvasGenerationWaitLabel(data.generationStartedAt)}。Airelayzone 多参考图/2K 可能需要 3-4 分钟。`,
      });
      return;
    }
    if (generationInFlightRef.current) {
      updateNodeData(id, {
        genStatus: 'generating',
        genError: '上一条生成请求仍在提交中，请等待返回；如需放弃请点停止。',
        generationStartedAt: data.generationStartedAt || canvasGenerationStartedAt(),
      });
      return;
    }
    const requestId = generationRequestIdRef.current + 1;
    generationRequestIdRef.current = requestId;
    const abortController = new AbortController();
    generationAbortRef.current = abortController;
    generationInFlightRef.current = true;
    updateNodeData(id, {
      genStatus: 'generating',
      genError: '已提交上游，等待返回...',
      generationStartedAt: canvasGenerationStartedAt(),
      finalPrompt,
      ratio: selectedRatio,
      resolution: selectedResolution,
      quality: selectedQuality,
      format: 'png',
    });
    try {
      if (!isCanvasPromptWithinApiLimit(finalPrompt)) {
        throw new Error(canvasPromptTooLongError('image', finalPrompt.length));
      }
      const result = await apiClient.generateWorkflowAssetImage(projectId || 'local', {
        episodeId: sourceEpisodeId || undefined,
        assetKind: 'characters',
        assetName,
        prompt: finalPrompt,
        usePromptAsFinal: true,
        referenceImageUrls: referenceImages.map((r) => r.url),
        aiModelId: data.modelId || undefined,
        size: selectedRatio,
        parameters: { n: Number(data.count) || 1, resolution: selectedResolution, quality: selectedQuality, format: 'png' },
      }, { signal: abortController.signal });
      if (generationRequestIdRef.current !== requestId || abortController.signal.aborted) return;
      const generatedImageAssetId = readObjectString(result.asset, 'id');
      if (result.image?.url) {
        updateNodeData(id, {
          genStatus: 'completed',
          generatedImage: result.image.url,
          generatedImageAssetId: generatedImageAssetId || data.generatedImageAssetId || '',
          finalPrompt: result.prompt || finalPrompt,
          assetKind: 'characters',
          assetName,
          quality: selectedQuality,
          format: 'png',
          generationStartedAt: '',
        });
        syncWorkflowAssetsFromCanvas(result.workflow);
      } else {
        throw new Error('no image');
      }
    } catch (err: any) {
      if (generationRequestIdRef.current !== requestId || abortController.signal.aborted) return;
      updateNodeData(id, {
        genStatus: 'failed',
        genError: err?.message || '生成失败，请检查模型配置',
        generationStartedAt: '',
      });
    } finally {
      if (generationRequestIdRef.current === requestId) {
        generationInFlightRef.current = false;
        generationAbortRef.current = null;
      }
    }
  };

  const handleStopGeneration = () => {
    generationRequestIdRef.current += 1;
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
    generationInFlightRef.current = false;
    updateNodeData(id, {
      genStatus: 'failed',
      genError: '已停止本地等待，可重新生成。若上游已开始处理，原请求可能仍会消耗一次额度。',
      generationStartedAt: '',
    });
  };

  useEffect(() => {
    if (data.genStatus !== 'generating') return;
    const age = canvasGenerationAgeMs(data.generationStartedAt);
    if (age === null || age > CANVAS_GENERATION_STALE_MS) {
      updateNodeData(id, {
        genStatus: 'failed',
        genError: '上次生成请求已中断，可重新生成。',
        generationStartedAt: '',
      });
      return;
    }
    const timer = window.setTimeout(() => {
      updateNodeData(id, {
        genStatus: 'failed',
        genError: '生成等待超过 15 分钟，已停止。可重新生成。',
        generationStartedAt: '',
      });
    }, CANVAS_GENERATION_STALE_MS - age);
    return () => window.clearTimeout(timer);
  }, [data.genStatus, data.generationStartedAt, id, updateNodeData]);

  const handleSetAsAvatar = async () => {
    const imageUrl = String(data.generatedImage || '');
    if (!imageUrl) return;
    const assetId = String(data.generatedImageAssetId || '');
    updateNodeData(id, { avatar: imageUrl, avatarStatus: assetId ? 'saving' : 'local', avatarError: '' });
    if (!projectId || projectId === 'local' || !assetId) {
      updateNodeData(id, { avatarStatus: 'local' });
      return;
    }
    try {
      const result = await apiClient.selectWorkflowAssetImage(projectId, {
        episodeId: sourceEpisodeId || undefined,
        assetKind: 'characters',
        assetName,
        assetId,
      });
      syncWorkflowAssetsFromCanvas(result.workflow);
      updateNodeData(id, { avatar: imageUrl, avatarStatus: 'saved', avatarError: '' });
    } catch (err: any) {
      updateNodeData(id, { avatarStatus: 'failed', avatarError: err?.message || '设为当前图失败' });
    }
  };

  return (
    <>
      <CanvasNodeResizer selected={selected} minWidth={320} minHeight={320} />
      <div className="scrollbar-none h-full w-full min-w-[320px] overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-[#141416] shadow-xl transition-colors hover:border-zinc-500">
      <div className="flex items-center gap-3 p-3 cursor-grab active:cursor-grabbing">
        <div className="h-10 w-10 rounded-full bg-layer-4 overflow-hidden shrink-0">
          {data.avatar ? (
            <ThumbImage
              src={data.avatar}
              thumbWidth={1024}
              alt="Character"
              className="h-full w-full cursor-zoom-in object-cover"
              onClick={(event) => previewCanvasImage(event, { url: data.avatar, title: data.name || '角色图', subtitle: '头像预览' })}
              onDoubleClick={(event) => previewCanvasImage(event, { url: data.avatar, title: data.name || '角色图', subtitle: '头像预览' })}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-600">&#128100;</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-zinc-100">{data.name}</div>
          <div className="text-[11px] text-zinc-500 line-clamp-2">{data.traits}</div>
        </div>
      </div>

      {referenceImages.length > 0 && (
        <div className="border-t border-zinc-800 px-3 py-2 flex items-center gap-1.5">
          <span className="text-[10px] text-sky-400 shrink-0">{referenceImages.length} 参考</span>
          <div className="flex gap-1 overflow-x-auto">
            {referenceImages.map((ref, i) => (
              <div key={i} className="relative shrink-0">
                <ThumbImage
                  src={ref.url}
                  thumbWidth={1024}
                  alt={ref.label}
                  className="h-8 w-8 cursor-zoom-in rounded border border-border object-cover"
                  onClick={(event) => previewCanvasImage(event, { url: ref.url, title: ref.label, subtitle: '角色参考图' })}
                  onDoubleClick={(event) => previewCanvasImage(event, { url: ref.url, title: ref.label, subtitle: '角色参考图' })}
                />
                <span className="absolute -top-1 -left-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-sky-500 text-[8px] font-bold text-white">
                  {i + 1}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-zinc-800 px-3 py-2">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[10px] font-medium text-zinc-400">最终生图提示词</span>
          <button
            type="button"
            className="text-[10px] text-zinc-500 hover:text-zinc-300"
            onClick={(e) => {
              e.stopPropagation();
              updateNodeData(id, { finalPrompt: '' });
            }}
          >
            重置
          </button>
        </div>
        <PromptTextarea
          className="w-full resize-y rounded border border-border bg-background px-2.5 py-2 text-[12px] leading-5 text-zinc-200 placeholder-zinc-600 focus:border-primary focus:outline-none min-h-[80px]"
          rows={8}
          placeholder="输入最终发送给图片模型的提示词..."
          value={finalPrompt}
          onChange={(value) => updateNodeData(id, { finalPrompt: value })}
          modalTitle={`${data.name || '角色'} · 最终生图提示词`}
          modalSubtitle="完整提示词"
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      <div className="px-3 pb-2 flex flex-nowrap items-center gap-1 text-[10px]">
        <select
          className="h-7 min-w-0 flex-1 truncate rounded bg-layer-4 border border-border px-1.5 py-1 text-zinc-300 focus:outline-none focus:border-primary"
          value={data.modelId || ''}
          onChange={(e) => updateNodeData(id, { modelId: e.target.value })}
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
          className="h-7 w-[66px] shrink-0 rounded bg-layer-4 border border-border px-1.5 py-1 text-zinc-300 focus:outline-none focus:border-primary"
          value={selectedRatio}
          onChange={(e) => updateNodeData(id, { ratio: e.target.value })}
          onClick={(e) => e.stopPropagation()}
        >
          {CANVAS_IMAGE_RATIO_OPTIONS.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
        </select>
        <select
          className="h-7 w-[52px] shrink-0 rounded bg-layer-4 border border-border px-1.5 py-1 text-zinc-300 focus:outline-none focus:border-primary"
          value={selectedResolution}
          onChange={(e) => updateNodeData(id, { resolution: e.target.value })}
          onClick={(e) => e.stopPropagation()}
        >
          <option value="1k">1K</option>
          <option value="2k">2K</option>
          <option value="4k">4K</option>
        </select>
        <select
          className="h-7 w-[60px] shrink-0 rounded bg-layer-4 border border-border px-1.5 py-1 text-zinc-300 focus:outline-none focus:border-primary"
          value={selectedQuality}
          onChange={(e) => updateNodeData(id, { quality: e.target.value })}
          onClick={(e) => e.stopPropagation()}
        >
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          className="h-7 w-[52px] shrink-0 rounded bg-layer-4 border border-border px-1.5 py-1 text-zinc-300 focus:outline-none focus:border-primary"
          value={data.count || '1'}
          onChange={(e) => updateNodeData(id, { count: e.target.value })}
          onClick={(e) => e.stopPropagation()}
        >
          <option value="1">1 张</option>
          <option value="2">2 张</option>
          <option value="4">4 张</option>
        </select>
      </div>

      <div className="border-t border-zinc-800 px-3 py-2">
        <Button
          size="sm"
          className="w-full h-8 text-[12px] bg-primary hover:bg-primary/90 text-white gap-1.5"
          onClick={handleGenerate}
          disabled={data.genStatus === 'generating' && !generationStalled}
        >
          <Wand2 className="h-3.5 w-3.5" />
          {data.genStatus === 'generating' && !generationStalled ? '生成中...' : data.genStatus === 'completed' || generationStalled ? '重新生成' : '生成'}
        </Button>
      </div>

      {data.genStatus === 'generating' && !generationStalled && (
        <div className="px-3 pb-3">
          <div className="aspect-square rounded border border-border bg-zinc-900/50 flex flex-col items-center justify-center gap-2">
            <div className="h-1.5 w-24 bg-layer-4 rounded-full overflow-hidden">
              <div className="h-full bg-primary/90 animate-pulse w-[60%]" />
            </div>
            <span className="px-3 text-center text-[11px] text-zinc-500">
              {canvasGenerationWaitLabel(data.generationStartedAt)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] text-zinc-400 hover:text-zinc-100"
              onClick={handleStopGeneration}
            >
              停止
            </Button>
          </div>
        </div>
      )}

      {data.genStatus === 'completed' && data.generatedImage && (
        <div className="px-3 pb-3">
          <div className="relative group overflow-hidden rounded border border-border bg-zinc-950">
            <ThumbImage
              src={data.generatedImage}
              thumbWidth={1024}
              alt="Generated"
              className="w-full cursor-zoom-in object-contain"
              style={{ aspectRatio: String(generatedImageAspectRatio) }}
              onClick={(event) => previewCanvasImage(event, { url: data.generatedImage, title: data.name || '生成图片', subtitle: '角色生成结果' })}
              onDoubleClick={(event) => previewCanvasImage(event, { url: data.generatedImage, title: data.name || '生成图片', subtitle: '角色生成结果' })}
              onLoad={(event) => {
                const img = event.currentTarget;
                const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : null;
                if (ratio && Math.abs(ratio - generatedImageAspectRatio) > 0.01) {
                  updateNodeData(id, { generatedImageAspectRatio: ratio });
                }
              }}
            />
            <div
              className="absolute inset-0 hidden cursor-zoom-in items-center justify-center gap-2 bg-black/60 group-hover:flex"
              onClick={(event) => previewCanvasImage(event, { url: data.generatedImage, title: data.name || '生成图片', subtitle: '角色生成结果' })}
              onDoubleClick={(event) => previewCanvasImage(event, { url: data.generatedImage, title: data.name || '生成图片', subtitle: '角色生成结果' })}
            >
              <Button
                size="sm"
                variant="secondary"
                className="h-7 text-[10px] bg-layer-4/80 hover:bg-zinc-700"
                onClick={(event) => {
                  event.stopPropagation();
                  void downloadCanvasImagePreview({ url: data.generatedImage, title: data.name || '生成图片', subtitle: '角色生成结果' });
                }}
              >
                <Download className="h-3 w-3 mr-1" /> 保存
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-7 text-[10px] bg-layer-4/80 hover:bg-zinc-700"
                onClick={(event) => {
                  event.stopPropagation();
                  handleSetAsAvatar();
                }}
              >
                {data.avatarStatus === 'saving' ? '写入中...' : '设为当前图'}
              </Button>
            </div>
          </div>
          {data.avatarError ? <div className="mt-1 text-[10px] text-red-400">{data.avatarError}</div> : null}
        </div>
      )}

      {data.genStatus === 'failed' && (
        <div className="px-3 pb-2 text-[10px] text-red-400">{data.genError || '生成失败，请重试'}</div>
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
