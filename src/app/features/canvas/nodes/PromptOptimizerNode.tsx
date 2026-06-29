import { useEffect, useMemo, useRef } from 'react';
import { Position } from '@xyflow/react';
import { RotateCw, Wand2 } from 'lucide-react';
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
  formatDurationMs,
  CANVAS_TRANSLATION_STALE_MS,
} from './shared';
import {
  availableTextModelId,
  shouldShowUnavailableTextModel,
  textModelSelectPlaceholder,
  useTextModelOptions,
} from './modelOptions';

export const PromptOptimizerNode = ({ id, data, selected }: CanvasNodeProps) => {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const edges = useCanvasStore((s) => s.edges);
  const nodes = useCanvasStore((s) => s.nodes);
  const { id: projectId } = useParams();
  const { textModels, loading: modelsLoading, failed: modelLoadFailed } = useTextModelOptions();
  const optimizeAbortRef = useRef<AbortController | null>(null);
  const optimizeRequestIdRef = useRef(0);
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
  const optimizedPrompt = String(data.optimizedPrompt || '').trim();
  const status = String(data.status || 'waiting');
  const isOptimizing = status === 'optimizing';
  const optimizeAge = canvasGenerationAgeMs(data.optimizeStartedAt);
  const optimizeStalled = isOptimizing && (optimizeAge === null || optimizeAge > CANVAS_TRANSLATION_STALE_MS);

  useEffect(() => {
    if (!incomingPrompt || data.sourcePrompt) return;
    updateNodeData(id, { sourcePrompt: incomingPrompt, sourceNodeId: incomingSource?.id || '', sourceNodeLabel: canvasNodePromptLabel(incomingSource) });
  }, [data.sourcePrompt, id, incomingPrompt, incomingSource, updateNodeData]);

  useEffect(() => () => {
    optimizeAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!isOptimizing) return;
    const age = canvasGenerationAgeMs(data.optimizeStartedAt);
    if (age === null || age > CANVAS_TRANSLATION_STALE_MS) {
      optimizeAbortRef.current?.abort();
      optimizeAbortRef.current = null;
      updateNodeData(id, {
        status: 'failed',
        error: '优化等待超过 2 分钟，已停止。可换用更快文本模型后重试。',
        optimizeStartedAt: '',
      });
      return;
    }
    const timer = window.setTimeout(() => {
      optimizeAbortRef.current?.abort();
      optimizeAbortRef.current = null;
      updateNodeData(id, {
        status: 'failed',
        error: '优化等待超过 2 分钟，已停止。可换用更快文本模型后重试。',
        optimizeStartedAt: '',
      });
    }, CANVAS_TRANSLATION_STALE_MS - age);
    return () => window.clearTimeout(timer);
  }, [data.optimizeStartedAt, id, isOptimizing, updateNodeData]);

  const refreshFromIncoming = () => {
    updateNodeData(id, {
      sourcePrompt: incomingPrompt,
      sourceNodeId: incomingSource?.id || '',
      sourceNodeLabel: canvasNodePromptLabel(incomingSource),
      status: incomingPrompt ? 'waiting' : 'failed',
      error: incomingPrompt ? '' : '左侧没有可读取的提示词。',
    });
  };

  const handleOptimize = async () => {
    const prompt = String(data.sourcePrompt || incomingPrompt || '').trim();
    if (!prompt) {
      updateNodeData(id, { status: 'failed', error: '请先输入提示词，或从左侧连入带 prompt 的节点。' });
      return;
    }
    if (!isCanvasPromptWithinApiLimit(prompt)) {
      updateNodeData(id, { status: 'failed', error: canvasPromptTooLongError('video', prompt.length) });
      return;
    }
    optimizeAbortRef.current?.abort();
    const requestId = optimizeRequestIdRef.current + 1;
    optimizeRequestIdRef.current = requestId;
    const abortController = new AbortController();
    optimizeAbortRef.current = abortController;
    updateNodeData(id, {
      status: 'optimizing',
      error: '',
      sourcePrompt: prompt,
      optimizedPrompt: '',
      optimizeStartedAt: canvasGenerationStartedAt(),
      sourceNodeId: incomingSource?.id || data.sourceNodeId || '',
      sourceNodeLabel: canvasNodePromptLabel(incomingSource) || data.sourceNodeLabel || '',
    });
    try {
      const result = await apiClient.optimizeCanvasPrompt(projectId || 'local', {
        prompt,
        aiModelId: availableTextModelId(data.modelId, textModels, modelsLoading),
        targetProvider: String(data.targetProvider || 'Dreamina Web Seedance 2.0'),
        failureReason: String(data.failureReason || ''),
        context: String(data.context || ''),
      }, { signal: abortController.signal });
      if (optimizeRequestIdRef.current !== requestId || abortController.signal.aborted) return;
      updateNodeData(id, {
        status: 'completed',
        error: '已优化提示词。请人工确认后再写回或写入右侧节点。',
        optimizedPrompt: result.optimizedPrompt,
        lastModel: result.model,
        lastDurationMs: result.durationMs,
        optimizeStartedAt: '',
      });
    } catch (error: any) {
      if (optimizeRequestIdRef.current !== requestId || abortController.signal.aborted) return;
      updateNodeData(id, {
        status: 'failed',
        error: error?.message || '优化失败，请检查文本模型配置。',
        optimizeStartedAt: '',
      });
    } finally {
      if (optimizeRequestIdRef.current === requestId) {
        optimizeAbortRef.current = null;
      }
    }
  };

  const handleStopOptimize = () => {
    optimizeRequestIdRef.current += 1;
    optimizeAbortRef.current?.abort();
    optimizeAbortRef.current = null;
    updateNodeData(id, {
      status: 'failed',
      error: '已停止本地等待，可重新优化。',
      optimizeStartedAt: '',
    });
  };

  const applyToOutgoingTargets = () => {
    if (!optimizedPrompt) {
      updateNodeData(id, { status: 'failed', error: '没有可写入的优化结果。' });
      return;
    }
    if (outgoingTargets.length === 0) {
      updateNodeData(id, { error: '右侧没有连接目标节点。' });
      return;
    }
    for (const target of outgoingTargets) {
      updateNodeData(target.id, translatedPromptPatchForNode(target, optimizedPrompt));
    }
    updateNodeData(id, { error: `已写入 ${outgoingTargets.length} 个右侧节点。` });
  };

  const applyToIncomingSource = () => {
    if (!incomingSource || !optimizedPrompt) return;
    updateNodeData(incomingSource.id, translatedPromptPatchForNode(incomingSource, optimizedPrompt));
    updateNodeData(id, { error: `已写回 ${canvasNodePromptLabel(incomingSource)}。` });
  };

  return (
    <>
      <CanvasNodeResizer selected={selected} minWidth={460} minHeight={360} />
      <div className="scrollbar-none h-full w-full min-w-[460px] overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-[#141416] shadow-xl transition-colors hover:border-primary/70">
        <div className="flex cursor-grab items-center gap-3 border-b border-zinc-800 p-3 active:cursor-grabbing">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Wand2 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-zinc-100">{data.title || '提示词优化'}</div>
            <div className="mt-0.5 truncate text-[11px] text-zinc-500">
              {incomingSource ? `读取：${canvasNodePromptLabel(incomingSource)}` : '用于手动优化不过审提示词'}
            </div>
          </div>
          <Badge className={cn(
            "shrink-0 border text-[10px] hover:bg-zinc-900",
            status === 'completed'
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : status === 'failed' || optimizeStalled
                ? "border-red-500/30 bg-red-500/10 text-red-300"
                : isOptimizing
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                  : "border-border bg-zinc-900 text-zinc-400"
          )}>
            {optimizeStalled ? '已中断' : isOptimizing ? '优化中' : status === 'completed' ? '已完成' : status === 'failed' ? '失败' : '待优化'}
          </Badge>
        </div>

        <div className="space-y-3 p-3">
          <select
            className="nodrag nopan h-8 w-full rounded-md border border-border bg-zinc-900 px-2 text-[12px] text-zinc-200 outline-none focus:border-primary"
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

          <div className="grid grid-cols-2 gap-2">
            <input
              className="nodrag nopan h-8 rounded-md border border-border bg-zinc-900 px-2 text-[12px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-primary"
              value={String(data.targetProvider || 'Dreamina Web Seedance 2.0')}
              placeholder="目标平台"
              onChange={(event) => updateNodeData(id, { targetProvider: event.target.value })}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            />
            <input
              className="nodrag nopan h-8 rounded-md border border-border bg-zinc-900 px-2 text-[12px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-primary"
              value={String(data.failureReason || '')}
              placeholder="失败原因，例如 prompt may violate"
              onChange={(event) => updateNodeData(id, { failureReason: event.target.value })}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            />
          </div>

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
              placeholder="输入不过审的提示词，或从左侧连入视频/图片/分镜节点。"
              modalTitle={`${data.title || '提示词优化'} · 原提示词`}
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
              <span className="text-[11px] font-medium text-zinc-400">优化结果</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="nodrag nopan h-6 px-2 text-[10px] text-zinc-400 hover:text-zinc-100"
                disabled={!optimizedPrompt}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  void navigator.clipboard?.writeText(optimizedPrompt).catch(() => undefined);
                }}
              >
                复制
              </Button>
            </div>
            <PromptTextarea
              className="nodrag nopan min-h-[130px] w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-[12px] leading-5 text-zinc-200 placeholder-zinc-600 outline-none focus:border-primary"
              value={optimizedPrompt}
              placeholder="优化完成后显示在这里。台词和大概原意会被保留。"
              modalTitle={`${data.title || '提示词优化'} · 优化结果`}
              modalSubtitle="完整优化结果"
              onChange={(value) => updateNodeData(id, { optimizedPrompt: value })}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              onKeyUp={(event) => event.stopPropagation()}
            />
          </div>

          {data.error ? (
            <div className={cn(
              "rounded border px-2 py-1 text-[11px] leading-4",
              status === 'failed' ? "border-red-500/20 bg-red-500/10 text-red-300" : "border-primary/20 bg-primary/10 text-primary",
            )}>
              {data.error}
            </div>
          ) : null}
          {modelLoadFailed ? <div className="text-[11px] text-amber-300">文本模型列表加载失败。</div> : null}
          {data.lastDurationMs ? (
            <div className="text-[10px] text-zinc-500">上次优化耗时 {formatDurationMs(Number(data.lastDurationMs))}</div>
          ) : null}
        </div>

        <div className="flex items-center gap-2 border-t border-zinc-800 px-3 py-2">
          <Button
            type="button"
            size="sm"
            className="nodrag nopan h-8 flex-1 bg-primary text-[12px] text-white hover:bg-primary/90"
            disabled={isOptimizing && !optimizeStalled}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              void handleOptimize();
            }}
          >
            {isOptimizing ? <RotateCw className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-1 h-3.5 w-3.5" />}
            {isOptimizing && !optimizeStalled ? '优化中...' : optimizedPrompt || optimizeStalled ? '重新优化' : '优化提示词'}
          </Button>
          {isOptimizing && !optimizeStalled ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="nodrag nopan h-8 text-[11px] text-zinc-400 hover:text-zinc-100"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                handleStopOptimize();
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
            disabled={!optimizedPrompt || outgoingTargets.length === 0}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              applyToOutgoingTargets();
            }}
          >
            写入右侧
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="nodrag nopan h-8 text-[11px] text-zinc-400 hover:text-zinc-100"
            disabled={!optimizedPrompt || !incomingSource}
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
