import { Position } from '@xyflow/react';
import { Boxes, Clapperboard, Layers3, ListChecks, Sparkles } from 'lucide-react';
import { Badge } from '../../../components/ui/badge';
import { type CanvasNodeProps, CanvasNodeResizer, CanvasHandle } from './shared';
import { VideoNode } from './VideoNode';

export const WorkflowNode = ({ id, data, selected }: CanvasNodeProps) => {
  const isStoryboardGeneration = data.clipNodeKind === 'storyboard' || data.storyboardForClip === true;
  if (!isStoryboardGeneration && (data.workflowKind === 'video' || data.seedancePrompt || data.videoPrompt)) {
    return <VideoNode id={id} data={data} selected={selected} />;
  }

  const iconMap: Record<string, React.ReactNode> = {
    episode: <Layers3 className="h-4 w-4 text-[#F7C24E]" />,
    asset: <Boxes className="h-4 w-4 text-emerald-300" />,
    workflow: <ListChecks className="h-4 w-4 text-primary" />,
    directorBoard: <Clapperboard className="h-4 w-4 text-amber-300" />,
  };

  return (
    <>
      <CanvasNodeResizer selected={selected} minWidth={240} minHeight={120} />
      <div className={`h-full w-full min-w-[240px] rounded-[14px] border lh-node p-3 transition-colors hover:border-[#3A3A40] ${selected ? "lh-node-active" : ""}`}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {iconMap[String(data.kind ?? 'workflow')] ?? iconMap.workflow}
            <div className="truncate text-[15px] font-semibold text-zinc-100">{data.title ?? '流程节点'}</div>
          </div>
          <Badge className="border border-border bg-[#141417] text-[12px] text-zinc-400 hover:bg-[#141417]">
            {data.statusLabel ?? '待处理'}
          </Badge>
        </div>
        <p className="min-h-[40px] text-[14px] leading-5 text-zinc-400">{data.description ?? '等待接入生产任务'}</p>
        <div className="mt-3 flex items-center gap-2 border-t border-[#26262B] pt-2 text-[13px] text-zinc-500">
          <Sparkles className="h-3.5 w-3.5" />
          <span className="truncate">{data.scope ?? '当前项目'}</span>
        </div>
        <CanvasHandle type="target" position={Position.Left} />
        <CanvasHandle type="source" position={Position.Right} />
      </div>
    </>
  );
};
