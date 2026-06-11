import { useEffect, useMemo, useRef, useState } from 'react';
import { Position } from '@xyflow/react';
import { ClipboardCheck, RotateCw } from 'lucide-react';
import { useParams } from 'react-router';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { cn } from '../../../utils/cn';
import { useCanvasStore } from '../../../stores/useCanvasStore';
import { apiClient, type ModelConfig } from '../../../lib/apiClient';
import {
  type CanvasNodeProps,
  CanvasNodeResizer,
  CanvasHandle,
  canvasGenerationStartedAt,
  canvasGenerationAgeMs,
  canvasNodePromptText,
  canvasNodePromptLabel,
  modelOptionLabel,
  isWorkflowTextModel,
  formatDurationMs,
  CANVAS_TRANSLATION_STALE_MS,
} from './shared';

export const PromptInspectorNode = ({ id, data, selected }: CanvasNodeProps) => {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const edges = useCanvasStore((s) => s.edges);
  const nodes = useCanvasStore((s) => s.nodes);
  const { id: projectId } = useParams();
  const [textModels, setTextModels] = useState<ModelConfig[]>([]);
  const [modelLoadFailed, setModelLoadFailed] = useState(false);
  const inspectAbortRef = useRef<AbortController | null>(null);
  const inspectRequestIdRef = useRef(0);
  const incomingSource = useMemo(() => {
    const edge = edges.find((item) => item.target === id);
    return edge ? nodes.find((node) => node.id === edge.source) : undefined;
  }, [edges, id, nodes]);
  const incomingPrompt = useMemo(() => canvasNodePromptText(incomingSource), [incomingSource]);
  const answer = String(data.answer || '').trim();
  const status = String(data.status || 'waiting');
  const isInspecting = status === 'inspecting';
  const inspectAge = canvasGenerationAgeMs(data.inspectStartedAt);
  const inspectStalled = isInspecting && (inspectAge === null || inspectAge > CANVAS_TRANSLATION_STALE_MS);

  useEffect(() => {
    let cancelled = false;
    apiClient.listModelConfigs()
      .then((result) => {
        if (cancelled) return;
        setTextModels(result.models.filter(isWorkflowTextModel));
        setModelLoadFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setTextModels([]);
        setModelLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!incomingPrompt || data.sourcePrompt) return;
    updateNodeData(id, { sourcePrompt: incomingPrompt, sourceNodeId: incomingSource?.id || '', sourceNodeLabel: canvasNodePromptLabel(incomingSource) });
  }, [data.sourcePrompt, id, incomingPrompt, incomingSource, updateNodeData]);

  useEffect(() => () => {
    inspectAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!isInspecting) return;
    const age = canvasGenerationAgeMs(data.inspectStartedAt);
    if (age === null || age > CANVAS_TRANSLATION_STALE_MS) {
      inspectAbortRef.current?.abort();
      inspectAbortRef.current = null;
      updateNodeData(id, {
        status: 'failed',
        error: '检查等待超过 2 分钟，已停止。可换用更快文本模型后重试。',
        inspectStartedAt: '',
      });
      return;
    }
    const timer = window.setTimeout(() => {
      inspectAbortRef.current?.abort();
      inspectAbortRef.current = null;
      updateNodeData(id, {
        status: 'failed',
        error: '检查等待超过 2 分钟，已停止。可换用更快文本模型后重试。',
        inspectStartedAt: '',
      });
    }, CANVAS_TRANSLATION_STALE_MS - age);
    return () => window.clearTimeout(timer);
  }, [data.inspectStartedAt, id, isInspecting, updateNodeData]);

  const refreshFromIncoming = () => {
    updateNodeData(id, {
      sourcePrompt: incomingPrompt,
      sourceNodeId: incomingSource?.id || '',
      sourceNodeLabel: canvasNodePromptLabel(incomingSource),
      status: incomingPrompt ? 'waiting' : 'failed',
      error: incomingPrompt ? '' : '左侧没有可读取的提示词。',
    });
  };

  const handleInspect = async () => {
    const prompt = String(data.sourcePrompt || incomingPrompt || '').trim();
    const nextQuestion = String(data.question || '').trim();
    if (!prompt) {
      updateNodeData(id, { status: 'failed', error: '请先输入提示词，或从左侧连入带 prompt 的节点。' });
      return;
    }
    if (!nextQuestion) {
      updateNodeData(id, { status: 'failed', error: '请先输入要检查的问题。' });
      return;
    }
    inspectAbortRef.current?.abort();
    const requestId = inspectRequestIdRef.current + 1;
    inspectRequestIdRef.current = requestId;
    const abortController = new AbortController();
    inspectAbortRef.current = abortController;
    updateNodeData(id, {
      status: 'inspecting',
      error: '',
      sourcePrompt: prompt,
      answer: '',
      inspectStartedAt: canvasGenerationStartedAt(),
      sourceNodeId: incomingSource?.id || data.sourceNodeId || '',
      sourceNodeLabel: canvasNodePromptLabel(incomingSource) || data.sourceNodeLabel || '',
    });
    try {
      const result = await apiClient.inspectCanvasPrompt(projectId || 'local', {
        prompt,
        question: nextQuestion,
        aiModelId: data.modelId || undefined,
        context: String(data.context || ''),
      }, { signal: abortController.signal });
      if (inspectRequestIdRef.current !== requestId || abortController.signal.aborted) return;
      updateNodeData(id, {
        status: 'completed',
        error: '',
        answer: result.answer,
        lastModel: result.model,
        lastDurationMs: result.durationMs,
        inspectStartedAt: '',
      });
    } catch (error: any) {
      if (inspectRequestIdRef.current !== requestId || abortController.signal.aborted) return;
      updateNodeData(id, {
        status: 'failed',
        error: error?.message || '检查失败，请检查文本模型配置。',
        inspectStartedAt: '',
      });
    } finally {
      if (inspectRequestIdRef.current === requestId) {
        inspectAbortRef.current = null;
      }
    }
  };

  const handleStopInspect = () => {
    inspectRequestIdRef.current += 1;
    inspectAbortRef.current?.abort();
    inspectAbortRef.current = null;
    updateNodeData(id, {
      status: 'failed',
      error: '已停止本地等待，可重新检查。',
      inspectStartedAt: '',
    });
  };

  return (
    <>
      <CanvasNodeResizer selected={selected} minWidth={440} minHeight={340} />
      <div className="scrollbar-none h-full w-full min-w-[440px] overflow-y-auto overflow-x-hidden rounded-lg border border-zinc-700 bg-[#141416] shadow-xl transition-colors hover:border-amber-500/70">
        <div className="flex cursor-grab items-center gap-3 border-b border-zinc-800 p-3 active:cursor-grabbing">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-300">
            <ClipboardCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-zinc-100">{data.title || '提示词检查'}</div>
            <div className="mt-0.5 truncate text-[11px] text-zinc-500">
              {incomingSource ? `读取：${canvasNodePromptLabel(incomingSource)}` : '可从左侧连接提示词节点'}
            </div>
          </div>
          <Badge className={cn(
            "shrink-0 border text-[10px] hover:bg-zinc-900",
            status === 'completed'
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : status === 'failed' || inspectStalled
                ? "border-red-500/30 bg-red-500/10 text-red-300"
                : isInspecting
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                  : "border-zinc-700 bg-zinc-900 text-zinc-400"
          )}>
            {inspectStalled ? '已中断' : isInspecting ? '检查中' : status === 'completed' ? '已完成' : status === 'failed' ? '失败' : '待检查'}
          </Badge>
        </div>

        <div className="space-y-3 p-3">
          <select
            className="nodrag nopan h-8 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 text-[12px] text-zinc-200 outline-none focus:border-amber-500"
            value={String(data.modelId || '')}
            onChange={(event) => updateNodeData(id, { modelId: event.target.value })}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <option value="">{textModels.length ? '默认文本模型' : '未配置文本模型'}</option>
            {data.modelId && !textModels.some((model) => model.id === data.modelId) ? (
              <option value={String(data.modelId)}>当前模型不可用</option>
            ) : null}
            {textModels.map((model) => (
              <option key={model.id} value={model.id}>{modelOptionLabel(model)}</option>
            ))}
          </select>

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
            <textarea
              className="nodrag nopan min-h-[105px] w-full resize-y rounded-md border border-zinc-700 bg-[#09090b] px-3 py-2 font-mono text-[12px] leading-5 text-zinc-200 placeholder-zinc-600 outline-none focus:border-amber-500"
              value={String(data.sourcePrompt || incomingPrompt || '')}
              placeholder="输入要检查的提示词，或从左侧连入图片/视频/分镜节点。"
              onChange={(event) => updateNodeData(id, { sourcePrompt: event.target.value })}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              onKeyUp={(event) => event.stopPropagation()}
            />
          </div>

          <div>
            <span className="mb-1.5 block text-[11px] font-medium text-zinc-400">问题</span>
            <textarea
              className="nodrag nopan min-h-[68px] w-full resize-y rounded-md border border-zinc-700 bg-[#09090b] px-3 py-2 text-[12px] leading-5 text-zinc-200 placeholder-zinc-600 outline-none focus:border-amber-500"
              value={String(data.question || '')}
              placeholder="例如：这个故事板提示词里有哪些角色有台词？每句台词在哪个格子？"
              onChange={(event) => updateNodeData(id, { question: event.target.value })}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              onKeyUp={(event) => event.stopPropagation()}
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-zinc-400">检查结果</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="nodrag nopan h-6 px-2 text-[10px] text-zinc-400 hover:text-zinc-100"
                disabled={!answer}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  void navigator.clipboard?.writeText(answer).catch(() => undefined);
                }}
              >
                复制
              </Button>
            </div>
            <textarea
              className="nodrag nopan min-h-[130px] w-full resize-y rounded-md border border-zinc-700 bg-[#09090b] px-3 py-2 text-[12px] leading-5 text-zinc-200 placeholder-zinc-600 outline-none focus:border-amber-500"
              value={answer}
              placeholder="检查完成后显示在这里。"
              onChange={(event) => updateNodeData(id, { answer: event.target.value })}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              onKeyUp={(event) => event.stopPropagation()}
            />
          </div>

          {data.error ? (
            <div className={cn(
              "rounded border px-2 py-1 text-[11px] leading-4",
              status === 'failed' ? "border-red-500/20 bg-red-500/10 text-red-300" : "border-amber-500/20 bg-amber-500/10 text-amber-200",
            )}>
              {data.error}
            </div>
          ) : null}
          {modelLoadFailed ? <div className="text-[11px] text-amber-300">文本模型列表加载失败。</div> : null}
          {data.lastDurationMs ? (
            <div className="text-[10px] text-zinc-500">上次检查耗时 {formatDurationMs(Number(data.lastDurationMs))}</div>
          ) : null}
        </div>

        <div className="flex items-center gap-2 border-t border-zinc-800 px-3 py-2">
          <Button
            type="button"
            size="sm"
            className="nodrag nopan h-8 flex-1 bg-amber-600 text-[12px] text-white hover:bg-amber-500"
            disabled={isInspecting && !inspectStalled}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              void handleInspect();
            }}
          >
            {isInspecting ? <RotateCw className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ClipboardCheck className="mr-1 h-3.5 w-3.5" />}
            {isInspecting && !inspectStalled ? '检查中...' : answer || inspectStalled ? '重新检查' : '检查提示词'}
          </Button>
          {isInspecting && !inspectStalled ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="nodrag nopan h-8 text-[11px] text-zinc-400 hover:text-zinc-100"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                handleStopInspect();
              }}
            >
              停止
            </Button>
          ) : null}
        </div>

        <CanvasHandle type="target" position={Position.Left} tone="sky" style={{ top: 32 }} />
        <CanvasHandle type="source" position={Position.Right} tone="sky" style={{ top: 32 }} />
      </div>
    </>
  );
};

