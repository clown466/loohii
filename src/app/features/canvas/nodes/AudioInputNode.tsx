import { Position } from '@xyflow/react';
import { Mic } from 'lucide-react';
import { cn } from '../../../utils/cn';
import {
  publicAudioUrl,
  type CanvasNodeProps,
  CanvasNodeResizer,
  CanvasHandle,
} from './shared';

export const AudioInputNode = ({ data, selected }: CanvasNodeProps) => {
  const audioUrl = publicAudioUrl(data.audioUrl || data.referenceAudioUrl || data.url);
  const characterName = String(data.characterName || data.assetName || data.name || '').trim();
  const title = String(data.title || data.label || (characterName ? `${characterName} 音频参考` : '音频参考'));
  const fileName = String(data.fileName || data.voiceReferenceFileName || '').trim();
  const missing = !audioUrl;

  return (
    <>
      <CanvasNodeResizer selected={selected} minWidth={240} minHeight={96} />
      <div className={cn(
        "h-full w-full overflow-hidden rounded-lg border bg-[#141416] shadow-xl transition-colors",
        missing ? "border-zinc-700 hover:border-zinc-500" : "border-emerald-500/60 ring-1 ring-emerald-500/20 hover:border-emerald-400",
      )}>
        <div className="flex cursor-grab items-center gap-2 border-b border-zinc-800 bg-zinc-800/40 px-3 py-2 text-xs font-medium text-zinc-200 active:cursor-grabbing">
          <Mic className={cn("h-3.5 w-3.5 shrink-0", missing ? "text-zinc-500" : "text-emerald-300")} />
          <span className="min-w-0 flex-1 truncate">{title}</span>
          <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px]", missing ? "bg-zinc-800 text-zinc-500" : "bg-emerald-500/15 text-emerald-200")}>
            {missing ? '缺音频' : '已绑定'}
          </span>
        </div>
        <div className="space-y-1 px-3 py-2">
          <div className="truncate text-[11px] text-zinc-300">{characterName || '未命名角色'}</div>
          <div className="truncate text-[10px] text-zinc-500" title={fileName || audioUrl || String(data.uploadError || '')}>
            {missing ? (data.uploadError || '该角色还没有绑定音频参考') : (fileName || audioUrl)}
          </div>
          {audioUrl ? (
            <audio
              controls
              src={audioUrl}
              className="nodrag nopan mt-1 h-7 w-full"
              onPointerDown={(event) => event.stopPropagation()}
            />
          ) : null}
        </div>
        <CanvasHandle type="source" position={Position.Right} tone="emerald" />
      </div>
    </>
  );
};
