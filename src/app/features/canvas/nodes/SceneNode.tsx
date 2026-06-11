import { useMemo } from 'react';
import { Position } from '@xyflow/react';
import { Image as ImageIcon, ImagePlay } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { useCanvasStore } from '../../../stores/useCanvasStore';
import {
  publicImageUrl,
  previewCanvasImage,
  type CanvasNodeProps,
  CanvasNodeResizer,
  CanvasHandle,
} from './shared';

export const SceneNode = ({ id, data, selected }: CanvasNodeProps) => {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const edges = useCanvasStore((s) => s.edges);
  const nodes = useCanvasStore((s) => s.nodes);

  const referenceImages = useMemo(() => {
    const incomingEdges = edges.filter((e) => e.target === id);
    const refs: { url: string; label: string }[] = [];
    for (const edge of incomingEdges) {
      const source = nodes.find((n) => n.id === edge.source);
      const imageInputUrl = source?.type === 'imageInput' ? publicImageUrl(source.data?.imageUrl) : '';
      const characterUrl = source?.type === 'character' ? publicImageUrl(source.data?.avatar) : '';
      if (imageInputUrl) {
        refs.push({ url: imageInputUrl, label: String(source?.data.label || '参考图') });
      } else if (characterUrl) {
        refs.push({ url: characterUrl, label: String(source?.data.name || '角色') });
      }
    }
    return refs;
  }, [edges, nodes, id]);

  const handleGenerate = () => {
    updateNodeData(id, { status: 'generating' });
    setTimeout(() => {
      updateNodeData(id, {
        status: 'completed',
        image: 'https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?w=600&q=80',
      });
    }, 2000);
  };

  return (
    <>
      <CanvasNodeResizer selected={selected} minWidth={240} minHeight={210} />
      <div className="h-full w-full min-w-[240px] overflow-hidden rounded-lg border border-zinc-700 bg-[#141416] shadow-xl transition-colors hover:border-zinc-500">
      <div className="bg-zinc-800/50 px-3 py-2 text-xs font-medium text-zinc-300 flex justify-between items-center cursor-grab active:cursor-grabbing">
        <div className="flex items-center gap-1.5">
          <ImagePlay className="h-3.5 w-3.5 text-indigo-400" />
          {data.title || "分镜"}
        </div>
        {referenceImages.length > 0 && (
          <span className="text-[10px] text-sky-400">{referenceImages.length} 参考</span>
        )}
      </div>

      {referenceImages.length > 0 && (
        <div className="flex gap-1 px-3 pt-2 overflow-x-auto">
          {referenceImages.map((ref, i) => (
            <div key={i} className="relative shrink-0">
              <img
                src={ref.url}
                alt={ref.label}
                className="h-10 w-10 cursor-zoom-in rounded border border-zinc-700 object-cover"
                onClick={(event) => previewCanvasImage(event, { url: ref.url, title: ref.label, subtitle: '分镜参考图' })}
                onDoubleClick={(event) => previewCanvasImage(event, { url: ref.url, title: ref.label, subtitle: '分镜参考图' })}
              />
              <span className="absolute -top-1 -left-1 flex h-4 w-4 items-center justify-center rounded-full bg-sky-500 text-[9px] font-bold text-white">
                {i + 1}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="p-3 pb-0">
        <div className="aspect-video bg-zinc-900 rounded border border-zinc-800 flex items-center justify-center overflow-hidden mb-3 relative group">
          {data.status === 'completed' && data.image ? (
            <img
              src={data.image}
              alt="Scene"
              className="h-full w-full cursor-zoom-in object-cover"
              onClick={(event) => previewCanvasImage(event, { url: data.image, title: data.title || '分镜图', subtitle: data.description || undefined })}
              onDoubleClick={(event) => previewCanvasImage(event, { url: data.image, title: data.title || '分镜图', subtitle: data.description || undefined })}
            />
          ) : data.status === 'generating' ? (
            <div className="flex flex-col items-center justify-center gap-2">
              <div className="h-1.5 w-24 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 w-[45%] animate-pulse" />
              </div>
              <span className="text-xs text-zinc-500 font-mono">生成中...</span>
            </div>
          ) : (
            <ImageIcon className="h-6 w-6 text-zinc-700" />
          )}
        </div>

        <p className="text-xs text-zinc-400 line-clamp-2 min-h-[32px] mb-3">
          {data.description || "点击输入分镜描述..."}
        </p>
      </div>

      <div className="px-3 py-2 border-t border-zinc-800 flex items-center justify-between bg-zinc-900/50">
        <div className="flex items-center gap-1.5">
          {data.status === 'completed' ? (
            <span className="flex h-2 w-2 rounded-full bg-green-500" />
          ) : data.status === 'generating' ? (
            <span className="flex h-2 w-2 rounded-full bg-yellow-500" />
          ) : (
            <span className="flex h-2 w-2 rounded-full bg-zinc-600" />
          )}
          <span className="text-[10px] text-zinc-500">
            {data.status === 'completed' ? '已完成' : data.status === 'generating' ? '生成中' : '等待生成'}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[10px] px-2 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20"
          onClick={handleGenerate}
        >
          {data.status === 'completed' ? '重新生成' : '生成'}
        </Button>
      </div>

        <CanvasHandle type="target" position={Position.Left} />
        <CanvasHandle type="source" position={Position.Right} />
      </div>
    </>
  );
};
