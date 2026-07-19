import { useEffect, useMemo, useRef, useState } from 'react';
import { Position } from '@xyflow/react';
import { Image as ImageIcon } from 'lucide-react';
import { useParams } from 'react-router';
import { Button } from '../../../components/ui/button';
import { ThumbImage } from '../../../components/ThumbImage';
import { cn } from '../../../utils/cn';
import { useCanvasStore } from '../../../stores/useCanvasStore';
import {
  type CanvasNodeProps,
  CanvasNodeResizer,
  CanvasHandle,
  publicImageUrl,
  previewCanvasImage,
  positiveNumber,
  uploadCanvasReferenceFile,
  canvasIncomingRelationKey,
} from './shared';

export const ImageInputNode = ({ id, data, selected }: CanvasNodeProps) => {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  // 只订阅与本节点相连的入边+源节点内容指纹，不裸订整个 edges/nodes 数组（P4-B 性能治理）
  const relationKey = useCanvasStore((s) => canvasIncomingRelationKey(s, id));
  const fileRef = useRef<HTMLInputElement>(null);
  const { id: projectId } = useParams();
  const [uploading, setUploading] = useState(false);
  const imageUrl = typeof data.imageUrl === 'string' ? data.imageUrl : '';
  const imageAspectRatio = positiveNumber(data.imageAspectRatio) ?? 1;
  const clampedImageAspectRatio = Math.min(Math.max(imageAspectRatio, 0.45), 3.4);
  const imageIsLandscape = clampedImageAspectRatio > 1.15;
  const isPreviousStoryboardReference = data.clipNodeKind === 'storyboard-reference';
  const isStoryboardSlot = data.storyboardSlotForClip === true || data.clipSyncRole === 'storyboard-slot';
  const isStoryboardSpecialNode = isPreviousStoryboardReference || isStoryboardSlot;
  const isLightweightReference = data.lightweightReference === true || data.positioningBoardFlow === true;
  const upstreamStoryboardOutput = useMemo(() => {
    if (!isStoryboardSlot) return null;
    const { nodes, edges } = useCanvasStore.getState();
    for (const edge of edges.filter((item) => item.target === id)) {
      const source = nodes.find((node) => node.id === edge.source);
      const sourceUrl = source?.type === 'generation'
        ? publicImageUrl(source.data?.outputImage)
        : source?.type === 'imageInput'
          ? publicImageUrl(source.data?.imageUrl)
          : '';
      if (!sourceUrl) continue;
      return {
        url: sourceUrl,
        assetId: String(source?.data?.outputImageAssetId || source?.data?.assetId || ''),
        title: String(source?.data?.title || source?.data?.label || data.label || '对应故事板'),
      };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- relationKey 已覆盖 edges/nodes 中与本节点相关的变化
  }, [data.label, relationKey, id, isStoryboardSlot]);
  const displayImageUrl = imageUrl || upstreamStoryboardOutput?.url || '';
  const imageUnavailable = Boolean(data.imageLoadError || (displayImageUrl && displayImageUrl.startsWith('blob:')));
  const effectivePublicImageUrl = publicImageUrl(displayImageUrl);

  useEffect(() => {
    if (!isStoryboardSlot || !upstreamStoryboardOutput?.url) return;
    if (publicImageUrl(imageUrl) === upstreamStoryboardOutput.url && String(data.assetId || '') === upstreamStoryboardOutput.assetId) return;
    updateNodeData(id, {
      imageUrl: upstreamStoryboardOutput.url,
      assetId: upstreamStoryboardOutput.assetId,
      clipSyncAssetId: upstreamStoryboardOutput.assetId,
      clipSyncUrl: upstreamStoryboardOutput.url,
      fileName: `${upstreamStoryboardOutput.title || 'storyboard'}.png`,
      uploadStatus: 'linked',
      imageLoadError: false,
      uploadError: '',
    });
  }, [data.assetId, id, imageUrl, isStoryboardSlot, updateNodeData, upstreamStoryboardOutput]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      updateNodeData(id, { uploadError: '请选择图片文件。' });
      return;
    }
    if (!projectId || projectId === 'local') {
      updateNodeData(id, { uploadError: '当前项目不存在，无法上传参考图。' });
      return;
    }
    setUploading(true);
    updateNodeData(id, { uploadError: '', uploadStatus: 'uploading', imageLoadError: false, fileName: file.name });
    try {
      const publicUrl = await uploadCanvasReferenceFile(projectId, file);
      updateNodeData(id, {
        imageUrl: publicUrl,
        fileName: file.name,
        uploadStatus: 'uploaded',
        uploadError: '',
        imageLoadError: false,
      });
    } catch (error) {
      updateNodeData(id, {
        uploadStatus: 'failed',
        uploadError: error instanceof Error ? error.message : '参考图上传失败',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleUrlPaste = () => {
    const url = window.prompt('输入图片 URL：');
    if (url) {
      const cleanUrl = url.trim();
      updateNodeData(id, {
        imageUrl: cleanUrl,
        fileName: '',
        imageLoadError: false,
        uploadError: publicImageUrl(cleanUrl) ? '' : '参考图需要公网 http(s) URL，图片模型才能读取。',
      });
    }
  };

  return (
    <>
      <CanvasNodeResizer selected={selected} minWidth={isLightweightReference ? 170 : imageIsLandscape ? 340 : 260} minHeight={isLightweightReference ? 86 : 180} />
      <div className={cn(
        "h-full w-full overflow-hidden rounded-[14px] border lh-node transition-colors hover:border-[#3A3A40]",
        isStoryboardSpecialNode ? "border-amber-500/70 ring-1 ring-amber-500/30" : "",
        selected && "lh-node-active",
        isLightweightReference ? "min-w-[170px]" : imageIsLandscape ? "min-w-[340px]" : "min-w-[260px]",
      )}>
      <div className={cn(
        "px-3 py-2 text-xs font-medium flex items-center gap-1.5 cursor-grab active:cursor-grabbing",
        isStoryboardSpecialNode ? "bg-amber-500/15 text-amber-100" : "bg-layer-4/50 text-zinc-300",
      )}>
        <ImageIcon className={cn("h-3.5 w-3.5", isStoryboardSpecialNode ? "text-amber-300" : "text-[#F7C24E]")} />
        {isPreviousStoryboardReference ? <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-100">上一板</span> : null}
        {isStoryboardSlot ? <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-100">故事板</span> : null}
        {data.label || '图片输入'}
      </div>
      {isLightweightReference ? (
        <div className="p-2">
          <div className="rounded border border-[#26262B] bg-zinc-950/50 px-2 py-2">
            <div className="truncate text-[11px] font-medium text-zinc-200">{data.assetName || data.label || '参考图'}</div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-zinc-500">
              <span className="truncate">{data.assetKind === 'scenes' ? '场景参考' : data.assetKind === 'props' ? '道具参考' : '角色参考'}</span>
              {displayImageUrl && !imageUnavailable ? (
                <button
                  type="button"
                  className="nodrag nopan shrink-0 text-[#F5A623] hover:text-[#F7C24E]"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => previewCanvasImage(event, {
                    url: displayImageUrl,
                    title: data.label || '图片输入',
                    subtitle: data.fileName || '参考图',
                  })}
                >
                  查看
                </button>
              ) : (
                <button
                  type="button"
                  className="nodrag nopan shrink-0 text-zinc-400 hover:text-zinc-200"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    fileRef.current?.click();
                  }}
                >
                  上传
                </button>
              )}
            </div>
            {data.uploadError ? (
              <div className="mt-1 text-[10px] leading-4 text-red-400">{data.uploadError}</div>
            ) : null}
          </div>
        </div>
      ) : (
      <div className="p-2">
        {displayImageUrl && !imageUnavailable ? (
          <div className="relative group">
            <ThumbImage
              src={displayImageUrl}
              thumbWidth={1024}
              alt="参考图"
              className="w-full cursor-zoom-in rounded border border-[#26262B] object-cover"
              style={{ aspectRatio: String(clampedImageAspectRatio) }}
              onClick={(event) => previewCanvasImage(event, {
                url: displayImageUrl,
                title: data.label || '图片输入',
                subtitle: data.fileName || '参考图',
              })}
              onDoubleClick={(event) => previewCanvasImage(event, {
                url: displayImageUrl,
                title: data.label || '图片输入',
                subtitle: data.fileName || '参考图',
              })}
              onLoad={(event) => {
                const img = event.currentTarget;
                const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : null;
                if (ratio && Math.abs(ratio - imageAspectRatio) > 0.01) {
                  updateNodeData(id, { imageAspectRatio: ratio, imageLoadError: false });
                }
              }}
              onError={() => {
                if (!data.imageLoadError) updateNodeData(id, { imageLoadError: true });
              }}
            />
            <div
              className="absolute inset-0 hidden cursor-zoom-in items-center justify-center gap-1 rounded bg-black/60 group-hover:flex"
              onClick={(event) => previewCanvasImage(event, {
                url: displayImageUrl,
                title: data.label || '图片输入',
                subtitle: data.fileName || '参考图',
              })}
              onDoubleClick={(event) => previewCanvasImage(event, {
                url: displayImageUrl,
                title: data.label || '图片输入',
                subtitle: data.fileName || '参考图',
              })}
            >
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] text-zinc-200 hover:bg-zinc-700"
                onClick={(event) => {
                  event.stopPropagation();
                  fileRef.current?.click();
                }}
              >
                替换
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] text-red-300 hover:bg-red-500/20"
                onClick={(event) => {
                  event.stopPropagation();
                  updateNodeData(id, { imageUrl: '', fileName: '', imageLoadError: false, uploadError: '' });
                }}
              >
                移除
              </Button>
            </div>
            {data.fileName && <div className="mt-1 truncate text-[10px] text-zinc-500">{data.fileName}</div>}
          </div>
        ) : (
          <div
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded border border-dashed border-border bg-[#141417]/50 hover:border-[#3A3A40] hover:bg-[#141417]"
            style={{ aspectRatio: imageIsLandscape ? String(clampedImageAspectRatio) : "1" }}
            onClick={() => fileRef.current?.click()}
          >
            <ImageIcon className="h-6 w-6 text-zinc-600" />
            <span className="text-[11px] text-zinc-500">{uploading ? '上传中...' : imageUnavailable ? '图片已失效，重新上传' : isStoryboardSlot ? '等待故事板' : '点击上传'}</span>
            <button
              type="button"
              className="text-[10px] text-[#F5A623] hover:text-[#F7C24E]"
              onClick={(e) => { e.stopPropagation(); handleUrlPaste(); }}
            >
              或粘贴 URL
            </button>
          </div>
        )}
        {data.uploadError ? (
          <div className="mt-1 text-[10px] leading-4 text-red-400">{data.uploadError}</div>
        ) : displayImageUrl && !effectivePublicImageUrl ? (
          <div className="mt-1 text-[10px] leading-4 text-amber-400">这不是公网 URL，不能作为图生图参考。</div>
        ) : null}
      </div>
      )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} disabled={uploading} />
        {isStoryboardSlot ? <CanvasHandle type="target" position={Position.Left} tone="sky" /> : null}
        <CanvasHandle type="source" position={Position.Right} tone="sky" />
      </div>
    </>
  );
};
