import { ListChecks, Pencil, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { cn } from '../../../utils/cn';
import {
  type BreakdownScene,
  getDialoguePacing,
} from '../canvasUtils';

type StoryboardSceneListProps = {
  scenes: BreakdownScene[];
  onAddSceneNode: (scene: BreakdownScene, index: number) => void;
  onEditScene: (sceneId: string) => void;
  onDeleteScene: (sceneId: string) => void;
  emptyTitle?: string;
  emptyDescription?: string;
};

export function StoryboardSceneList({
  scenes,
  onAddSceneNode,
  onEditScene,
  onDeleteScene,
  emptyTitle = '还没有分镜脚本',
  emptyDescription = '先导入小说/剧本，提取资产并准备资产图，再拆解分镜。',
}: StoryboardSceneListProps) {
  if (scenes.length === 0) {
    return (
      <div className="flex min-h-[180px] flex-col items-center justify-center p-6 text-center">
        <ListChecks className="mb-3 h-6 w-6 text-zinc-700" />
        <div className="text-[15px] font-medium text-zinc-300">{emptyTitle}</div>
        <div className="mt-1 text-[14px] text-zinc-600">{emptyDescription}</div>
      </div>
    );
  }

  return (
    <div className="divide-y divide-zinc-800">
      {scenes.map((scene, index) => {
        const pacing = getDialoguePacing(scene);
        return (
        <div key={scene.id} className="grid gap-3 p-4 xl:grid-cols-[minmax(0,1fr)_210px]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[15px] font-semibold text-zinc-100">
                {String(index + 1).padStart(2, '0')} · {scene.title}
              </span>
              <Badge className={cn(
                "border text-[12px]",
                scene.status === 'ready'
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/10"
                  : "border-border bg-zinc-900 text-zinc-400 hover:bg-zinc-900"
              )}>
                {scene.status === 'ready' ? '可继续' : '待确认'}
              </Badge>
              {scene.durationSeconds !== undefined && (
                <Badge className="border border-amber-500/20 bg-amber-500/10 text-[12px] text-amber-200 hover:bg-amber-500/10">
                  {scene.durationSeconds}s
                </Badge>
              )}
              {pacing.words > 0 && (
                <Badge className={cn(
                  "border text-[12px]",
                  pacing.tooDense
                    ? "border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/10"
                    : "border-sky-500/20 bg-sky-500/10 text-sky-200 hover:bg-sky-500/10"
                )}>
                  台词 {pacing.wordsPerSecond.toFixed(1)} w/s
                </Badge>
              )}
            </div>
            <p className="mt-2 line-clamp-2 text-[14px] leading-5 text-zinc-400">{scene.description}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-[13px] text-zinc-500">
              {scene.setting && <span className="rounded border border-zinc-800 bg-[#0d0d0f] px-2 py-1">场景：{scene.setting}</span>}
              {scene.characters?.length ? <span className="rounded border border-zinc-800 bg-[#0d0d0f] px-2 py-1">角色：{scene.characters.join(', ')}</span> : null}
              {(scene.shotSize || scene.cameraAngle || scene.cameraMove) && (
                <span className="rounded border border-zinc-800 bg-[#0d0d0f] px-2 py-1">
                  镜头：{[scene.shotSize, scene.cameraAngle, scene.cameraMove].filter(Boolean).join(' · ')}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-start justify-start gap-2 xl:justify-end">
            <Button
              variant="secondary"
              size="sm"
              className="h-8 border border-border bg-zinc-900 text-zinc-100 hover:bg-layer-4"
              onClick={() => onEditScene(scene.id)}
            >
              <Pencil className="h-3.5 w-3.5" />
              编辑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-primary hover:bg-primary/10 hover:text-primary"
              onClick={() => onAddSceneNode(scene, index)}
            >
              放入画布
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-red-300 hover:bg-red-500/10 hover:text-red-100"
              title="删除分镜"
              onClick={() => {
                if (window.confirm(`删除分镜「${scene.title}」？`)) onDeleteScene(scene.id);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        );
      })}
    </div>
  );
}
