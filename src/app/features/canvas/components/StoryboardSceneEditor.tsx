import { useEffect, useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import {
  type BreakdownScene,
  type Clip,
  getDialoguePacing,
} from '../canvasUtils';
import { PromptTextarea } from '../nodes/shared';

export function StoryboardSceneEditor({
  scene,
  selectedEpisode,
  onBack,
  onSave,
  onDelete,
  onAddSceneNode,
}: {
  scene: BreakdownScene;
  selectedEpisode: string;
  onBack: () => void;
  onSave: (scene: BreakdownScene) => void;
  onDelete: (sceneId: string) => void;
  onAddSceneNode: (scene: BreakdownScene, index: number) => void;
}) {
  const [draft, setDraft] = useState<BreakdownScene>(scene);

  useEffect(() => {
    setDraft(scene);
  }, [scene]);

  const update = (patch: Partial<BreakdownScene>) => setDraft((current) => ({ ...current, ...patch }));
  const fieldClass = "w-full rounded-md border border-zinc-800 bg-background px-3 py-2 text-[12px] leading-5 text-zinc-100 outline-none focus:border-amber-500";
  const labelClass = "mb-1.5 block text-[11px] font-medium text-zinc-500";
  const pacing = getDialoguePacing(draft);

  const save = () => {
    onSave({
      ...draft,
      durationSeconds: Number(draft.durationSeconds) || 3,
      characters: Array.isArray(draft.characters)
        ? draft.characters
        : String(draft.characters ?? '').split(',').map((item) => item.trim()).filter(Boolean),
      status: 'ready',
    });
  };

  return (
    <section className="min-h-full rounded-lg border border-zinc-800 bg-[#141416]">
      <div className="flex flex-col gap-3 border-b border-zinc-800 p-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <button type="button" className="mb-2 text-[12px] text-zinc-500 hover:text-zinc-200" onClick={onBack}>
            ← 返回分镜列表
          </button>
          <div className="text-[15px] font-semibold text-zinc-100">{selectedEpisode} · 分镜修改</div>
          <div className="mt-1 truncate text-[12px] text-zinc-500">{draft.title}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" className="h-8 border border-border bg-zinc-900 text-zinc-100 hover:bg-layer-4" onClick={save}>
            <Save className="h-3.5 w-3.5" />
            保存分镜
          </Button>
          <Button variant="ghost" size="sm" className="h-8 text-primary hover:bg-primary/10 hover:text-primary" onClick={() => onAddSceneNode(draft, 0)}>
            放入画布
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-red-300 hover:bg-red-500/10 hover:text-red-100"
            onClick={() => {
              if (window.confirm(`删除分镜「${draft.title}」？`)) {
                onDelete(draft.id);
                onBack();
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </Button>
        </div>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
            <label>
              <span className={labelClass}>分镜标题</span>
              <input className={fieldClass} value={draft.title} onChange={(event) => update({ title: event.target.value })} />
            </label>
            <label>
              <span className={labelClass}>时长秒数</span>
              <input className={fieldClass} type="number" min={1} max={15} value={draft.durationSeconds ?? 3} onChange={(event) => update({ durationSeconds: Number(event.target.value) })} />
            </label>
          </div>
          <label>
            <span className={labelClass}>画面描述</span>
            <textarea className={`${fieldClass} min-h-[96px] resize-y`} value={draft.description} onChange={(event) => update({ description: event.target.value })} />
          </label>
          <label>
            <span className={labelClass}>动作</span>
            <textarea className={`${fieldClass} min-h-[76px] resize-y`} value={draft.action ?? ''} onChange={(event) => update({ action: event.target.value })} />
          </label>
          <label>
            <span className={labelClass}>台词</span>
            <textarea className={`${fieldClass} min-h-[88px] resize-y`} value={draft.dialogue ?? ''} onChange={(event) => update({ dialogue: event.target.value })} />
          </label>

          <div className="grid gap-3 md:grid-cols-3">
            <label>
              <span className={labelClass}>景别</span>
              <input className={fieldClass} value={draft.shotSize ?? ''} onChange={(event) => update({ shotSize: event.target.value })} />
            </label>
            <label>
              <span className={labelClass}>拍摄角度</span>
              <input className={fieldClass} value={draft.cameraAngle ?? ''} onChange={(event) => update({ cameraAngle: event.target.value })} />
            </label>
            <label>
              <span className={labelClass}>镜头运动</span>
              <input className={fieldClass} value={draft.cameraMove ?? ''} onChange={(event) => update({ cameraMove: event.target.value })} />
            </label>
          </div>

          <label>
            <span className={labelClass}>构图与调度</span>
            <textarea className={`${fieldClass} min-h-[76px] resize-y`} value={draft.composition ?? ''} onChange={(event) => update({ composition: event.target.value })} />
          </label>

          <div className="grid gap-3 md:grid-cols-4">
            <label>
              <span className={labelClass}>焦距</span>
              <input className={fieldClass} value={draft.lens ?? ''} onChange={(event) => update({ lens: event.target.value })} />
            </label>
            <label>
              <span className={labelClass}>光圈</span>
              <input className={fieldClass} value={draft.aperture ?? ''} onChange={(event) => update({ aperture: event.target.value })} />
            </label>
            <label>
              <span className={labelClass}>快门</span>
              <input className={fieldClass} value={draft.shutter ?? ''} onChange={(event) => update({ shutter: event.target.value })} />
            </label>
            <label>
              <span className={labelClass}>ISO</span>
              <input className={fieldClass} value={draft.iso ?? ''} onChange={(event) => update({ iso: event.target.value })} />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label>
              <span className={labelClass}>场景</span>
              <input className={fieldClass} value={draft.setting ?? ''} onChange={(event) => update({ setting: event.target.value })} />
            </label>
            <label>
              <span className={labelClass}>角色，逗号分隔</span>
              <input className={fieldClass} value={(draft.characters ?? []).join(', ')} onChange={(event) => update({ characters: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label>
              <span className={labelClass}>声音/环境音</span>
              <input className={fieldClass} value={draft.sound ?? ''} onChange={(event) => update({ sound: event.target.value })} />
            </label>
            <label>
              <span className={labelClass}>音乐/节奏</span>
              <input className={fieldClass} value={draft.music ?? ''} onChange={(event) => update({ music: event.target.value })} />
            </label>
          </div>

          <label>
            <span className={labelClass}>视觉提示词</span>
            <PromptTextarea
              className={`${fieldClass} min-h-[96px] resize-y`}
              value={draft.visualPrompt ?? ''}
              onChange={(value) => update({ visualPrompt: value })}
              modalTitle={`${draft.title || '分镜'} · 视觉提示词`}
              modalSubtitle="完整视觉提示词"
            />
          </label>
          <label>
            <span className={labelClass}>参考信息</span>
            <textarea className={`${fieldClass} min-h-[76px] resize-y`} value={draft.references ?? ''} onChange={(event) => update({ references: event.target.value })} />
          </label>
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border border-zinc-800 bg-[#0d0d0f] p-4">
            <div className="text-[13px] font-semibold text-zinc-100">故事板层级</div>
            <div className="mt-2 text-[12px] leading-5 text-zinc-500">
              当前页面只编辑单个镜头。多宫格导演故事板应按 Clip 生成，请返回 Clip 列表，在对应 Clip 详情里生成和修改故事板提示词。
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-[#0d0d0f] p-4">
            <div className="text-[13px] font-semibold text-zinc-100">脚本检查</div>
            <div className="mt-3 space-y-2 text-[12px] text-zinc-500">
              <div className="flex justify-between"><span>角色</span><span>{(draft.characters ?? []).length}</span></div>
              <div className="flex justify-between"><span>时长</span><span>{draft.durationSeconds ?? 0}s</span></div>
              <div className="flex justify-between"><span>台词词数</span><span>{pacing.words}</span></div>
              <div className="flex justify-between"><span>台词密度</span><span className={pacing.tooDense ? 'text-red-300' : 'text-zinc-300'}>{pacing.wordsPerSecond.toFixed(1)} w/s</span></div>
              <div className="flex justify-between"><span>建议最短时长</span><span>{pacing.recommendedSeconds || 0}s</span></div>
              <div className="flex justify-between"><span>故事板入口</span><span>Clip 层</span></div>
            </div>
            {pacing.tooDense && (
              <div className="mt-3 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] leading-5 text-red-200">
                台词过密。美式快节奏动画建议约 2.8-3.4 w/s，超过 3.6 w/s 应拆成多个反应镜头或动作切镜。
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
