import { Layers3 } from 'lucide-react';
import { cn } from '../../../utils/cn';
import { useCanvasStore } from '../../../stores/useCanvasStore';
import {
  positiveNumber,
  canvasSectionToneClasses,
  type CanvasNodeProps,
  CanvasNodeResizer,
} from './shared';

export const SectionNode = ({ id, data, selected }: CanvasNodeProps) => {
  const tone = canvasSectionToneClasses(data.tone);
  const nodes = useCanvasStore((s) => s.nodes);
  const itemCount = nodes.filter((node) => node.parentId === id).length || positiveNumber(data.itemCount);
  return (
    <>
      <CanvasNodeResizer selected={selected} minWidth={320} minHeight={180} />
      <div className={cn(
        "h-full w-full overflow-hidden rounded-lg border border-dashed shadow-[0_0_0_1px_rgba(0,0,0,0.24)] transition-colors",
        tone.border,
        tone.background,
        selected && "border-solid",
      )}>
        <div className={cn("flex h-[42px] items-center gap-2 border-b px-3", tone.header)}>
          <Layers3 className={cn("h-3.5 w-3.5 shrink-0", tone.icon)} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold text-zinc-100">{data.title || '画布分区'}</div>
            {data.description ? (
              <div className="truncate text-[10px] text-zinc-500">{data.description}</div>
            ) : null}
          </div>
          {itemCount ? (
            <span className={cn("shrink-0 rounded border px-1.5 py-0.5 text-[10px]", tone.badge)}>
              {itemCount} 节点
            </span>
          ) : null}
        </div>
      </div>
    </>
  );
};
