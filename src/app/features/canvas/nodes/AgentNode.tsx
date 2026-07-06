import { useMemo } from 'react';
import { Bot, Send, RefreshCw } from 'lucide-react';
import { Position } from '@xyflow/react';
import { useParams } from 'react-router';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { cn } from '../../../utils/cn';
import { useCanvasStore } from '../../../stores/useCanvasStore';
import { AGENT_ACTIONS_APPLIED_EVENT, useAgentStore } from '../../../stores/useAgentStore';
import { apiClient, type AgentHistoryMessage } from '../../../lib/apiClient';
import {
  type CanvasNodeProps,
  CanvasHandle,
  CanvasNodeResizer,
  PromptTextarea,
  canvasNodePromptLabel,
  canvasNodePromptText,
  modelOptionLabel,
} from './shared';
import {
  availableTextModelId,
  shouldShowUnavailableTextModel,
  textModelSelectPlaceholder,
  useTextModelOptions,
} from './modelOptions';

const AGENT_LINKED_PROMPT_CONTEXT_LIMIT = 20000;
const AGENT_MESSAGE_PROMPT_PREVIEW_LIMIT = 2200;

function nodeSummary(node: any) {
  const data = node?.data && typeof node.data === 'object' ? node.data : {};
  const prompt = canvasNodePromptText(node);
  return {
    id: String(node?.id || ''),
    type: String(node?.type || ''),
    label: canvasNodePromptLabel(node),
    clipId: String(data.clipId || data.sourceClipId || data.targetClipId || ''),
    title: String(data.title || data.label || data.name || ''),
    promptLength: prompt.length,
    promptPreview: prompt ? prompt.slice(0, AGENT_MESSAGE_PROMPT_PREVIEW_LIMIT) : '',
  };
}

function linkedPromptContext(node: any) {
  const data = node?.data && typeof node.data === 'object' ? node.data : {};
  const prompt = canvasNodePromptText(node);
  return {
    id: String(node?.id || ''),
    type: String(node?.type || ''),
    label: canvasNodePromptLabel(node),
    clipId: String(data.clipId || data.sourceClipId || data.targetClipId || ''),
    title: String(data.title || data.label || data.name || ''),
    prompt,
    promptLength: prompt.length,
    truncated: prompt.length > AGENT_LINKED_PROMPT_CONTEXT_LIMIT,
    promptForModel: prompt.length > AGENT_LINKED_PROMPT_CONTEXT_LIMIT
      ? prompt.slice(0, AGENT_LINKED_PROMPT_CONTEXT_LIMIT)
      : prompt,
  };
}

function agentConversationId(projectId: string | undefined, nodeId: string) {
  if (!projectId) return '';
  return `project:${projectId}:canvas-agent:${nodeId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function actionResultsFromMetadata(metadata: unknown): Array<Record<string, unknown>> {
  if (!isRecord(metadata) || !Array.isArray(metadata.actionResults)) return [];
  return metadata.actionResults.filter(isRecord);
}

function actionResultChangesCanvas(result: Record<string, unknown>) {
  return Boolean(result.canvasChanged || result.generationId || result.videoUrl || result.submitId || result.workflowChanged || result.projectChanged || result.recordsChanged);
}

function latestAssistantMessage(messages: AgentHistoryMessage[]) {
  return [...messages].reverse().find((message) => message.role === 'assistant');
}

export const AgentNode = ({ id, data, selected }: CanvasNodeProps) => {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const edges = useCanvasStore((s) => s.edges);
  const nodes = useCanvasStore((s) => s.nodes);
  const loadConversationMessages = useAgentStore((s) => s.loadConversationMessages);
  const { id: projectId } = useParams();
  const { textModels, loading: modelsLoading, failed: modelLoadFailed } = useTextModelOptions();
  const linkedNodes = useMemo(() => {
    const linkedIds = new Set<string>();
    for (const edge of edges) {
      if (edge.source === id && edge.target) linkedIds.add(edge.target);
      if (edge.target === id && edge.source) linkedIds.add(edge.source);
    }
    return nodes.filter((node) => linkedIds.has(node.id));
  }, [edges, id, nodes]);
  const request = String(data.request || '').trim();
  const status = String(data.status || 'waiting');
  const resultText = String(data.resultText || '');

  const refreshLinkedContext = () => {
    updateNodeData(id, {
      linkedNodeCount: linkedNodes.length,
      linkedNodeLabels: linkedNodes.map(canvasNodePromptLabel).join('、'),
      status: linkedNodes.length ? 'waiting' : 'failed',
      error: linkedNodes.length ? '' : '请先把智能体节点连接到要处理的节点。',
    });
  };

  const runAgent = async () => {
    if (!projectId || projectId === 'local') {
      updateNodeData(id, { status: 'failed', error: '当前项目不可用，无法调用项目智能体。' });
      return;
    }
    if (!request) {
      updateNodeData(id, { status: 'failed', error: '请先写清楚要智能体做什么。' });
      return;
    }
    if (linkedNodes.length === 0) {
      updateNodeData(id, { status: 'failed', error: '请先连接至少一个目标或上游节点。' });
      return;
    }
    const linkedSummary = linkedNodes.map(nodeSummary);
    const linkedPromptContexts = linkedNodes.map(linkedPromptContext);
    const conversationId = agentConversationId(projectId, id);
    const message = [
      '你是画布智能体节点。请在当前项目内根据用户要求产出草稿。',
      '你必须先读取/利用当前项目的小说原文、全局设定、前置推理规则、workflow 分镜、clip、画布节点和连接关系，再决定如何撰写草稿。',
      '默认只把结果返回到本智能体节点的“智能体返回”区域，不要直接写回、更新、覆盖或清空任何相连节点。',
      '如果用户要求修改提示词，请输出完整可审阅的新提示词草稿，并说明它应该应用到哪个相连节点；等待用户之后手动写回。',
      '除非用户要求里明确写了删除、移除、去掉、断开连接，否则禁止删除节点、移除资产引用、断开连线或清空参考图。',
      '不要改无关节点，不要删除用户手动内容，保持原剧情、对白顺序、角色身份和参考图绑定。',
      '',
      `用户要求：${request}`,
      '',
      `智能体节点ID：${id}`,
      `连接节点：${JSON.stringify(linkedSummary, null, 2)}`,
    ].join('\n');
    updateNodeData(id, {
      status: 'running',
      error: '',
      resultText: '已发送给智能体，正在等待返回...',
      lastMetadata: {},
      lastRequest: request,
      linkedNodeCount: linkedNodes.length,
      linkedNodeLabels: linkedNodes.map(canvasNodePromptLabel).join('、'),
      lastSentAt: new Date().toISOString(),
      lastConversationId: conversationId,
    });
    try {
      const response = await apiClient.sendAgentMessage({
        content: message,
        projectId,
        conversationId,
        modelId: availableTextModelId(data.modelId, textModels, modelsLoading),
        context: {
          activeSceneId: useCanvasStore.getState().activeSceneId,
          source: 'canvas-agent-node',
          agentMode: 'draft_only',
          agentNodeId: id,
          linkedNodeIds: linkedNodes.map((node) => node.id),
          linkedNodePrompts: linkedPromptContexts,
        },
      });
      updateNodeData(id, {
        resultText: response?.content || '请求已提交，正在等待后端返回...',
        lastMetadata: response?.metadata || {},
      });
      await pollAgentResult(conversationId);
    } catch (error) {
      updateNodeData(id, {
        status: 'failed',
        error: error instanceof Error ? error.message : '智能体请求失败。',
        resultText: '智能体请求失败。',
      });
    }
  };

  const pollAgentResult = async (conversationId: string) => {
    const startedAt = Date.now();
    let lastAssistant: AgentHistoryMessage | undefined;
    while (Date.now() - startedAt < 120000) {
      await new Promise((resolve) => window.setTimeout(resolve, 1800));
      const messages = await apiClient.loadAgentConversationMessages(projectId!, conversationId);
      lastAssistant = latestAssistantMessage(messages);
      if (!lastAssistant) continue;
      const metadata = isRecord(lastAssistant.metadata) ? lastAssistant.metadata : {};
      updateNodeData(id, {
        resultText: lastAssistant.content || '智能体正在处理...',
        lastMetadata: metadata,
      });
      if (metadata.status !== 'RUNNING') {
        const results = actionResultsFromMetadata(metadata);
        if (results.some(actionResultChangesCanvas) && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(AGENT_ACTIONS_APPLIED_EVENT, {
            detail: { projectId, actionResults: results },
          }));
        }
        await loadConversationMessages(projectId!, conversationId, { silent: true });
        updateNodeData(id, {
          status: metadata.status === 'FAILED' ? 'failed' : 'completed',
          error: metadata.status === 'FAILED' ? (lastAssistant.content || '智能体执行失败。') : '',
          resultText: lastAssistant.content || '智能体已完成。',
          lastCompletedAt: new Date().toISOString(),
          lastMetadata: metadata,
        });
        return;
      }
    }
    updateNodeData(id, {
      status: 'failed',
      error: '智能体仍在后台处理，节点轮询已超时。可稍后刷新或查看右侧项目总控对话。',
      resultText: lastAssistant?.content || '智能体仍在后台处理。',
    });
  };

  return (
    <>
      <CanvasNodeResizer selected={selected} minWidth={500} minHeight={560} />
      <div className={cn("scrollbar-none h-full w-full min-w-[440px] overflow-y-auto overflow-x-hidden rounded-[14px] border lh-node transition-colors hover:border-[#3A3A40]", selected && "lh-node-active")}>
        <div className="flex cursor-grab items-center gap-3 border-b border-[#26262B] p-3 active:cursor-grabbing">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-violet-500/10 text-violet-300">
            <Bot className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-zinc-100">{data.title || '智能体'}</div>
            <div className="mt-0.5 truncate text-[11px] text-zinc-500">
              {linkedNodes.length ? `已连接 ${linkedNodes.length} 个节点` : '连接节点后让智能体修改提示词/画布'}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge className={cn(
              'border text-[10px] hover:bg-[#141417]',
              status === 'running'
                ? 'border-violet-500/30 bg-violet-500/10 text-violet-200'
                : status === 'failed'
                  ? 'border-red-500/30 bg-red-500/10 text-red-300'
                  : status === 'completed'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-border bg-[#141417] text-zinc-400',
            )}>
              {status === 'running' ? '处理中' : status === 'failed' ? '失败' : status === 'completed' ? '完成' : '待命'}
            </Badge>
            <Button
              size="sm"
              className="nodrag nopan h-7 gap-1 bg-violet-500 px-2 text-[11px] text-white hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={status === 'running'}
              onClick={runAgent}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Send className="h-3.5 w-3.5" /> {status === 'running' ? '等待' : '发送'}
            </Button>
          </div>
        </div>

        <div className="space-y-3 p-3">
          <div className="rounded-md border border-[#26262B] bg-[#0d0d0f] p-2">
            <div className="mb-1 text-[11px] font-medium text-zinc-400">连接上下文</div>
            <div className="line-clamp-3 text-[12px] leading-5 text-zinc-300">
              {linkedNodes.length
                ? linkedNodes.map((node) => {
                    const promptLength = canvasNodePromptText(node).length;
                    return `${canvasNodePromptLabel(node)}${promptLength ? `（提示词 ${promptLength} 字）` : ''}`;
                  }).join('、')
                : '暂无连接节点'}
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-zinc-400">智能体文本模型</span>
            <select
              className="nodrag nopan h-8 w-full rounded-md border border-border bg-zinc-950 px-2 text-[12px] text-zinc-200 outline-none focus:border-violet-400"
              value={String(data.modelId || '')}
              onChange={(event) => updateNodeData(id, { modelId: event.target.value })}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <option value="">{textModelSelectPlaceholder(textModels, modelsLoading, '使用后端默认文本模型')}</option>
              {shouldShowUnavailableTextModel(data.modelId, textModels, modelsLoading) ? (
                <option value={String(data.modelId)}>当前模型不可用</option>
              ) : null}
              {textModels.map((model) => (
                <option key={model.id} value={model.id}>{modelOptionLabel(model)}</option>
              ))}
            </select>
            {modelLoadFailed ? <span className="mt-1 block text-[11px] text-amber-300">文本模型列表加载失败。</span> : null}
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-zinc-400">给智能体的要求</span>
            <PromptTextarea
              className="nodrag nopan h-28 w-full resize-none rounded-md border border-border bg-zinc-950 p-2 font-mono text-[12px] leading-5 text-zinc-100 outline-none focus:border-violet-400"
              value={String(data.request || '')}
              placeholder="例如：把连接的视频节点提示词重新整理，补全每个 S 镜头动作，不要截断对白。"
              onChange={(value) => updateNodeData(id, { request: value })}
              modalTitle={`${data.title || '智能体'} · 给智能体的要求`}
              modalSubtitle="完整要求"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            />
          </label>

          {data.error ? <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-[12px] text-red-200">{String(data.error)}</div> : null}
          {data.lastSentAt ? <div className="text-[11px] text-zinc-500">最近提交：{new Date(String(data.lastSentAt)).toLocaleString()}</div> : null}

          <div className="rounded-md border border-[#26262B] bg-[#0d0d0f] p-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-zinc-400">智能体返回草稿</span>
              {data.lastCompletedAt ? <span className="text-[10px] text-zinc-600">{new Date(String(data.lastCompletedAt)).toLocaleString()}</span> : null}
            </div>
            <PromptTextarea
              className="nodrag nopan h-40 w-full resize-none rounded border border-zinc-900 bg-black/30 p-2 font-mono text-[12px] leading-5 text-zinc-200 outline-none focus:border-violet-400"
              value={resultText}
              placeholder="发送后返回消息会显示在这里。双击可放大查看/编辑。"
              onChange={(value) => updateNodeData(id, { resultText: value })}
              modalTitle={`${data.title || '智能体'} · 返回草稿`}
              modalSubtitle="智能体节点内保存的草稿，不会自动写回其他节点"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            />
          </div>

          <div className="flex gap-2">
            <Button size="sm" variant="secondary" className="nodrag nopan gap-1" onClick={refreshLinkedContext}>
              <RefreshCw className="h-3.5 w-3.5" /> 刷新连接
            </Button>
            <Button size="sm" className="nodrag nopan flex-1 gap-1 bg-violet-500 text-white hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-60" disabled={status === 'running'} onClick={runAgent}>
              <Send className="h-3.5 w-3.5" /> {status === 'running' ? '等待返回...' : '发送给智能体'}
            </Button>
          </div>
        </div>
      </div>
      <CanvasHandle type="target" position={Position.Left} />
      <CanvasHandle type="source" position={Position.Right} />
    </>
  );
};
