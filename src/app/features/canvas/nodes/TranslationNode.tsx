import { useEffect, useMemo, useRef } from 'react';
import { Position } from '@xyflow/react';
import { ClipboardCheck, Languages, RotateCw } from 'lucide-react';
import { useParams } from 'react-router';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { cn } from '../../../utils/cn';
import { useCanvasStore } from '../../../stores/useCanvasStore';
import { apiClient } from '../../../lib/apiClient';
import {
  type CanvasNodeProps,
  CanvasNodeResizer,
  CanvasHandle,
  PromptTextarea,
  canvasGenerationStartedAt,
  canvasGenerationAgeMs,
  canvasNodePromptText,
  canvasNodePromptLabel,
  translatedPromptPatchForNode,
  isCanvasPromptWithinApiLimit,
  canvasPromptTooLongError,
  modelOptionLabel,
  CANVAS_TRANSLATION_STALE_MS,
} from './shared';
import {
  availableTextModelId,
  shouldShowUnavailableTextModel,
  textModelSelectPlaceholder,
  useTextModelOptions,
} from './modelOptions';

export const TranslationNode = ({ id, data, selected }: CanvasNodeProps) => {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const edges = useCanvasStore((s) => s.edges);
  const nodes = useCanvasStore((s) => s.nodes);
  const { id: projectId } = useParams();
  const { textModels, loading: modelsLoading, failed: modelLoadFailed } = useTextModelOptions();
  const translationAbortRef = useRef<AbortController | null>(null);
  const translationRequestIdRef = useRef(0);
  const incomingSource = useMemo(() => {
    const edge = edges.find((item) => item.target === id);
    return edge ? nodes.find((node) => node.id === edge.source) : undefined;
  }, [edges, id, nodes]);
  const outgoingTargets = useMemo(() => (
    edges
      .filter((item) => item.source === id)
      .map((edge) => nodes.find((node) => node.id === edge.target))
      .filter((node): node is NonNullable<typeof node> => Boolean(node))
  ), [edges, id, nodes]);
  const incomingPrompt = useMemo(() => canvasNodePromptText(incomingSource), [incomingSource]);
  const incomingSourceId = incomingSource?.id || '';
  const incomingSourceLabel = useMemo(() => canvasNodePromptLabel(incomingSource), [incomingSource]);
  const translatedPrompt = String(data.translatedPrompt || '').trim();
  const targetLanguage = data.targetLanguage === 'Chinese' ? 'Chinese' : 'English';
  const sourceLanguage = data.sourceLanguage === 'Chinese' || data.sourceLanguage === 'English' ? data.sourceLanguage : 'auto';
  const status = String(data.status || 'waiting');
  const isTranslating = status === 'translating';
  const translationAge = canvasGenerationAgeMs(data.translationStartedAt);
  const translationStalled = isTranslating && (translationAge === null || translationAge > CANVAS_TRANSLATION_STALE_MS);

  useEffect(() => {
    if (!incomingPrompt || data.sourcePrompt) return;
    updateNodeData(id, { sourcePrompt: incomingPrompt, sourceNodeId: incomingSourceId, sourceNodeLabel: incomingSourceLabel });
  }, [data.sourcePrompt, id, incomingPrompt, incomingSourceId, incomingSourceLabel, updateNodeData]);

  useEffect(() => {
    if (!incomingPrompt || !incomingSourceId || isTranslating) return;
    const storedSourcePrompt = String(data.sourcePrompt || '').trim();
    if (!storedSourcePrompt || storedSourcePrompt === incomingPrompt) return;
    const storedSourceNodeId = String(data.sourceNodeId || '');
    const shouldFollowSource = data.batchTranslation === true || !storedSourceNodeId || storedSourceNodeId === incomingSourceId;
    if (!shouldFollowSource) return;
    updateNodeData(id, {
      sourcePrompt: incomingPrompt,
      sourceNodeId: incomingSourceId,
      sourceNodeLabel: incomingSourceLabel,
      translatedPrompt: '',
      status: 'waiting',
      error: '左侧提示词已更新，旧译文已清空，请重新翻译。',
      translationStartedAt: '',
    });
  }, [data.batchTranslation, data.sourceNodeId, data.sourcePrompt, id, incomingPrompt, incomingSourceId, incomingSourceLabel, isTranslating, updateNodeData]);

  useEffect(() => () => {
    translationAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!isTranslating) return;
    const age = canvasGenerationAgeMs(data.translationStartedAt);
    if (age === null || age > CANVAS_TRANSLATION_STALE_MS) {
      translationAbortRef.current?.abort();
      translationAbortRef.current = null;
      updateNodeData(id, {
        status: 'failed',
        error: '翻译等待超过 2 分钟，已停止。可换用更快文本模型后重试。',
        translationStartedAt: '',
      });
      return;
    }
    const timer = window.setTimeout(() => {
      translationAbortRef.current?.abort();
      translationAbortRef.current = null;
      updateNodeData(id, {
        status: 'failed',
        error: '翻译等待超过 2 分钟，已停止。可换用更快文本模型后重试。',
        translationStartedAt: '',
      });
    }, CANVAS_TRANSLATION_STALE_MS - age);
    return () => window.clearTimeout(timer);
  }, [data.translationStartedAt, id, isTranslating, updateNodeData]);

  const refreshFromIncoming = () => {
    updateNodeData(id, {
      sourcePrompt: incomingPrompt,
      sourceNodeId: incomingSourceId,
      sourceNodeLabel: incomingSourceLabel,
      status: incomingPrompt ? 'waiting' : 'failed',
      error: incomingPrompt ? '' : '左侧没有可读取的提示词。',
    });
  };

  const handleTranslate = async () => {
    const prompt = String(data.sourcePrompt || incomingPrompt || '').trim();
    if (!prompt) {
      updateNodeData(id, { status: 'failed', error: '请先输入提示词，或从左侧连入带 prompt 的节点。' });
      return;
    }
    if (translationAbortRef.current) {
      translationAbortRef.current.abort();
    }
    const requestId = translationRequestIdRef.current + 1;
    translationRequestIdRef.current = requestId;
    const abortController = new AbortController();
    translationAbortRef.current = abortController;
    updateNodeData(id, {
      status: 'translating',
      error: '',
      sourcePrompt: prompt,
      translatedPrompt: '',
      translationStartedAt: canvasGenerationStartedAt(),
      sourceNodeId: incomingSource?.id || data.sourceNodeId || '',
      sourceNodeLabel: canvasNodePromptLabel(incomingSource) || data.sourceNodeLabel || '',
    });
    try {
      const result = await apiClient.translateCanvasPrompt(projectId || 'local', {
        prompt,
        aiModelId: availableTextModelId(data.modelId, textModels, modelsLoading),
        sourceLanguage,
        targetLanguage,
        preserveStructure: data.preserveStructure !== false,
        context: String(data.context || ''),
      }, { signal: abortController.signal });
      if (translationRequestIdRef.current !== requestId || abortController.signal.aborted) return;
      updateNodeData(id, {
        status: 'completed',
        error: '',
        translatedPrompt: result.translatedPrompt,
        lastModel: result.model,
        lastDurationMs: result.durationMs,
        translationStartedAt: '',
      });
    } catch (error: any) {
      if (translationRequestIdRef.current !== requestId || abortController.signal.aborted) return;
      updateNodeData(id, {
        status: 'failed',
        error: error?.message || '翻译失败，请检查文本模型配置。',
        translationStartedAt: '',
      });
    } finally {
      if (translationRequestIdRef.current === requestId) {
        translationAbortRef.current = null;
      }
    }
  };

  const handleStopTranslation = () => {
    translationRequestIdRef.current += 1;
    translationAbortRef.current?.abort();
    translationAbortRef.current = null;
    updateNodeData(id, {
      status: 'failed',
      error: '已停止本地等待，可重新翻译。',
      translationStartedAt: '',
    });
  };

  const applyToOutgoingTargets = () => {
    if (!translatedPrompt) {
      updateNodeData(id, { status: 'failed', error: '没有可写入的译文。' });
      return;
    }
    if (outgoingTargets.length === 0) {
      updateNodeData(id, { error: '右侧没有连接目标节点。' });
      return;
    }
    for (const target of outgoingTargets) {
      updateNodeData(target.id, translatedPromptPatchForNode(target, translatedPrompt));
    }
    updateNodeData(id, { error: `已写入 ${outgoingTargets.length} 个右侧节点。` });
  };

  const applyToIncomingSource = () => {
    if (!incomingSource || !translatedPrompt) return;
    updateNodeData(incomingSource.id, translatedPromptPatchForNode(incomingSource, translatedPrompt));
    updateNodeData(id, { error: `已写回 ${canvasNodePromptLabel(incomingSource)}。` });
  };

  return (
    <>
      <CanvasNodeResizer selected={selected} minWidth={420} minHeight={300} />
      <div className={cn("scrollbar-none h-full w-full min-w-[420px] overflow-y-auto overflow-x-hidden rounded-[14px] border lh-node transition-colors hover:border-[#3A3A40]", selected && "lh-node-active")}>
        <div className="flex items-center gap-3 border-b border-[#26262B] p-3 cursor-grab active:cursor-grabbing">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#F5A623]/10 text-[#F7C24E]">
            <Languages className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-zinc-100">{data.title || '提示词翻译'}</div>
            <div className="mt-0.5 truncate text-[11px] text-zinc-500">
              {incomingSource ? `读取：${canvasNodePromptLabel(incomingSource)}` : '可从左侧连接提示词节点'}
            </div>
          </div>
          <Badge className={cn(
            "shrink-0 border text-[10px] hover:bg-[#141417]",
            status === 'completed'
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : status === 'failed' || translationStalled
                ? "border-red-500/30 bg-red-500/10 text-red-300"
                : isTranslating
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                  : "border-border bg-[#141417] text-zinc-400"
          )}>
            {translationStalled ? '已中断' : isTranslating ? '翻译中' : status === 'completed' ? '已完成' : status === 'failed' ? '失败' : '待翻译'}
          </Badge>
        </div>

        <div className="space-y-3 p-3">
          <div className="grid grid-cols-2 gap-2">
            <select
              className="nodrag nopan h-8 rounded-md border border-border bg-[#141417] px-2 text-[12px] text-zinc-200 outline-none focus:border-primary"
              value={sourceLanguage}
              onChange={(event) => updateNodeData(id, { sourceLanguage: event.target.value })}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <option value="auto">自动识别</option>
              <option value="Chinese">中文</option>
              <option value="English">英文</option>
            </select>
            <select
              className="nodrag nopan h-8 rounded-md border border-border bg-[#141417] px-2 text-[12px] text-zinc-200 outline-none focus:border-primary"
              value={targetLanguage}
              onChange={(event) => updateNodeData(id, { targetLanguage: event.target.value })}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <option value="English">翻译成英文</option>
              <option value="Chinese">翻译成中文</option>
            </select>
          </div>

          <select
            className="nodrag nopan h-8 w-full rounded-md border border-border bg-[#141417] px-2 text-[12px] text-zinc-200 outline-none focus:border-primary"
            value={String(data.modelId || '')}
            onChange={(event) => updateNodeData(id, { modelId: event.target.value })}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <option value="">{textModelSelectPlaceholder(textModels, modelsLoading)}</option>
            {shouldShowUnavailableTextModel(data.modelId, textModels, modelsLoading) ? (
              <option value={String(data.modelId)}>当前模型不可用</option>
            ) : null}
            {textModels.map((model) => (
              <option key={model.id} value={model.id}>{modelOptionLabel(model)}</option>
            ))}
          </select>

          <label className="nodrag nopan flex items-center gap-2 text-[11px] text-zinc-400" onPointerDown={(event) => event.stopPropagation()}>
            <input
              type="checkbox"
              checked={data.preserveStructure !== false}
              onChange={(event) => updateNodeData(id, { preserveStructure: event.target.checked })}
            />
            保留换行、编号、参数和角色名结构
          </label>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-zinc-400">原提示词</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="nodrag nopan h-6 px-2 text-[10px] text-zinc-400 hover:text-zinc-100"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  refreshFromIncoming();
                }}
              >
                读取左侧
              </Button>
            </div>
            <PromptTextarea
              className="nodrag nopan min-h-[110px] w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-[12px] leading-5 text-zinc-200 placeholder-zinc-600 outline-none focus:border-primary"
              value={String(data.sourcePrompt || incomingPrompt || '')}
              placeholder="输入要翻译的提示词，或从左侧连入图片/视频/分镜节点。"
              modalTitle={`${data.title || '提示词翻译'} · 原提示词`}
              modalSubtitle="完整原提示词"
              onChange={(value) => updateNodeData(id, { sourcePrompt: value })}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              onKeyUp={(event) => event.stopPropagation()}
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-zinc-400">翻译结果</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="nodrag nopan h-6 px-2 text-[10px] text-zinc-400 hover:text-zinc-100"
                disabled={!translatedPrompt}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  void navigator.clipboard?.writeText(translatedPrompt).catch(() => undefined);
                }}
              >
                复制
              </Button>
            </div>
            <PromptTextarea
              className="nodrag nopan min-h-[120px] w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-[12px] leading-5 text-zinc-200 placeholder-zinc-600 outline-none focus:border-primary"
              value={translatedPrompt}
              placeholder="翻译完成后显示在这里。"
              modalTitle={`${data.title || '提示词翻译'} · 翻译结果`}
              modalSubtitle="完整翻译结果"
              onChange={(value) => updateNodeData(id, { translatedPrompt: value })}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              onKeyUp={(event) => event.stopPropagation()}
            />
          </div>

          {data.error ? (
            <div className={cn(
              "rounded border px-2 py-1 text-[11px] leading-4",
              status === 'failed' ? "border-red-500/20 bg-red-500/10 text-red-300" : "border-[#F5A623]/20 bg-[#F5A623]/10 text-[#F7C24E]",
            )}>
              {data.error}
            </div>
          ) : null}
          {modelLoadFailed ? <div className="text-[11px] text-amber-300">文本模型列表加载失败。</div> : null}
        </div>

        <div className="flex items-center gap-2 border-t border-[#26262B] px-3 py-2">
          <Button
            type="button"
            size="sm"
            className="nodrag nopan h-8 flex-1 bg-[linear-gradient(135deg,#F5A623,#E08D0C)] text-[12px] font-bold text-[#0D0D0F] hover:opacity-90"
            disabled={isTranslating && !translationStalled}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              void handleTranslate();
            }}
          >
            {isTranslating ? <RotateCw className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Languages className="mr-1 h-3.5 w-3.5" />}
            {isTranslating && !translationStalled ? '翻译中...' : translatedPrompt || translationStalled ? '重新翻译' : '翻译提示词'}
          </Button>
          {isTranslating && !translationStalled ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="nodrag nopan h-8 text-[11px] text-zinc-400 hover:text-zinc-100"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                handleStopTranslation();
              }}
            >
              停止
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="nodrag nopan h-8 bg-layer-4 text-[11px] text-zinc-200 hover:bg-zinc-700"
            disabled={!translatedPrompt || outgoingTargets.length === 0}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              applyToOutgoingTargets();
            }}
          >
            <ClipboardCheck className="mr-1 h-3.5 w-3.5" />
            写入右侧
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="nodrag nopan h-8 text-[11px] text-zinc-400 hover:text-zinc-100"
            disabled={!translatedPrompt || !incomingSource}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              applyToIncomingSource();
            }}
          >
            写回左侧
          </Button>
        </div>

        <CanvasHandle type="target" position={Position.Left} tone="sky" style={{ top: 32 }} />
        <CanvasHandle type="source" position={Position.Right} tone="sky" style={{ top: 32 }} />
      </div>
    </>
  );
};
