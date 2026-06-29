import { SlidersHorizontal, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import {
  type ProjectGlobalSettingsDraft,
  PROJECT_GLOBAL_GENERATION_STRATEGIES,
  PROJECT_GLOBAL_RATIO_OPTIONS,
  PROJECT_GLOBAL_STYLE_OPTIONS,
  PROJECT_SCRIPT_RULE_TEMPLATES,
} from '../canvasUtils';
import { PromptTextarea } from '../nodes/shared';

export function ProjectGlobalSettingsModal({
  open,
  draft,
  saving,
  error,
  onChange,
  onClose,
  onSave,
}: {
  open: boolean;
  draft: ProjectGlobalSettingsDraft;
  saving: boolean;
  error: string | null;
  onChange: (patch: Partial<ProjectGlobalSettingsDraft>) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  if (!open) return null;
  const finalStyle = draft.style === '自定义' ? draft.customStyleName : draft.style;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-[1080px] flex-col overflow-hidden rounded-lg border border-zinc-800 bg-[#111113] shadow-2xl">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-zinc-100">
              <SlidersHorizontal className="h-4 w-4 text-amber-300" />
              项目全局设定
            </div>
            <div className="mt-0.5 truncate text-[11px] text-zinc-500">本项目后续资产、分镜、故事板和视频提示词推理都会读取这份设定</div>
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-zinc-500 hover:text-zinc-100" onClick={onClose} disabled={saving}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <section className="space-y-4 rounded-lg border border-zinc-800 bg-[#141416] p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">项目名称</label>
                  <input
                    className="h-9 w-full rounded-md border border-border bg-background px-3 text-[13px] text-zinc-100 outline-none focus:border-amber-500"
                    value={draft.title}
                    onChange={(event) => onChange({ title: event.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">默认比例</label>
                  <select
                    className="h-9 w-full rounded-md border border-border bg-background px-3 text-[13px] text-zinc-100 outline-none focus:border-amber-500"
                    value={draft.ratio}
                    onChange={(event) => onChange({ ratio: event.target.value })}
                  >
                    {PROJECT_GLOBAL_RATIO_OPTIONS.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">项目描述</label>
                <PromptTextarea
                  className="h-20 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-[13px] leading-5 text-zinc-100 outline-none focus:border-amber-500"
                  value={draft.description}
                  onChange={(value) => onChange({ description: value })}
                  modalTitle="项目描述"
                  modalSubtitle="完整项目描述"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">风格</label>
                  <select
                    className="h-9 w-full rounded-md border border-border bg-background px-3 text-[13px] text-zinc-100 outline-none focus:border-amber-500"
                    value={draft.style}
                    onChange={(event) => onChange({ style: event.target.value })}
                  >
                    {PROJECT_GLOBAL_STYLE_OPTIONS.map((style) => <option key={style} value={style}>{style}</option>)}
                    {draft.style && !PROJECT_GLOBAL_STYLE_OPTIONS.includes(draft.style as any) ? <option value={draft.style}>{draft.style}</option> : null}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">默认生成策略</label>
                  <select
                    className="h-9 w-full rounded-md border border-border bg-background px-3 text-[13px] text-zinc-100 outline-none focus:border-amber-500"
                    value={draft.generationStrategy}
                    onChange={(event) => onChange({ generationStrategy: event.target.value })}
                  >
                    {PROJECT_GLOBAL_GENERATION_STRATEGIES.map((strategy) => (
                      <option key={strategy.id} value={strategy.id} disabled={'disabled' in strategy && strategy.disabled}>
                        {strategy.title}{'disabled' in strategy && strategy.disabled ? '（暂未开发）' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {draft.style === '自定义' ? (
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">自定义风格名称</label>
                  <input
                    className="h-9 w-full rounded-md border border-border bg-background px-3 text-[13px] text-zinc-100 outline-none focus:border-amber-500"
                    value={draft.customStyleName}
                    onChange={(event) => onChange({ customStyleName: event.target.value })}
                    placeholder="例如：高饱和 3D 美漫黑色幽默"
                  />
                </div>
              ) : null}
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">风格补充</label>
                <PromptTextarea
                  className="h-24 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-[13px] leading-5 text-zinc-100 outline-none focus:border-amber-500"
                  value={draft.customStylePrompt}
                  onChange={(value) => onChange({ customStylePrompt: value })}
                  modalTitle="风格补充"
                  modalSubtitle="完整风格补充"
                  placeholder="补充画面质感、色彩、渲染方式。"
                />
              </div>
              <div className="rounded-md border border-zinc-800 bg-[#0d0d0f] px-3 py-2 text-[11px] leading-4 text-zinc-500">
                当前最终风格：{finalStyle || '未设置'}
              </div>
            </section>

            <section className="space-y-4 rounded-lg border border-zinc-800 bg-[#141416] p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">项目调性</label>
                  <PromptTextarea
                    className="h-24 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-[13px] leading-5 text-zinc-100 outline-none focus:border-amber-500"
                    value={draft.projectTone}
                    onChange={(value) => onChange({ projectTone: value })}
                    modalTitle="项目调性"
                    modalSubtitle="完整项目调性"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">导演人工指导</label>
                  <PromptTextarea
                    className="h-24 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-[13px] leading-5 text-zinc-100 outline-none focus:border-amber-500"
                    value={draft.directorNotes}
                    onChange={(value) => onChange({ directorNotes: value })}
                    modalTitle="导演人工指导"
                    modalSubtitle="完整导演指导"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">角色身份约束</label>
                  <PromptTextarea
                    className="h-24 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-[13px] leading-5 text-zinc-100 outline-none focus:border-amber-500"
                    value={draft.characterIdentityRules}
                    onChange={(value) => onChange({ characterIdentityRules: value })}
                    modalTitle="角色身份约束"
                    modalSubtitle="完整角色身份约束"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">负面约束</label>
                  <PromptTextarea
                    className="h-24 w-full resize-none rounded-md border border-border bg-background px-3 py-2 font-mono text-[12px] leading-5 text-zinc-100 outline-none focus:border-amber-500"
                    value={draft.negativePrompt}
                    onChange={(value) => onChange({ negativePrompt: value })}
                    modalTitle="负面约束"
                    modalSubtitle="完整负面约束"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">全局画面提示词</label>
                <PromptTextarea
                  className="h-28 w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-[12px] leading-5 text-zinc-100 outline-none focus:border-amber-500"
                  value={draft.globalPrompt}
                  onChange={(value) => onChange({ globalPrompt: value })}
                  modalTitle="全局画面提示词"
                  modalSubtitle="完整全局画面提示词"
                />
              </div>
              <div>
                <div className="mb-2 text-[12px] font-medium text-zinc-400">详细剧本规则</div>
                <div className="grid gap-3 md:grid-cols-2">
                  {PROJECT_SCRIPT_RULE_TEMPLATES.map((rule) => (
                    <div key={rule.id} className="rounded-md border border-zinc-800 bg-[#0d0d0f] p-3">
                      <div className="mb-1.5 text-[12px] font-medium text-zinc-200">{rule.title}</div>
                      <PromptTextarea
                        className="h-20 w-full resize-none rounded border border-zinc-800 bg-background px-2.5 py-2 text-[12px] leading-5 text-zinc-300 outline-none focus:border-amber-500"
                        value={draft.scriptRules[rule.id] ?? ''}
                        onChange={(value) => onChange({ scriptRules: { ...draft.scriptRules, [rule.id]: value } })}
                        modalTitle={`${rule.title} · 剧本规则`}
                        modalSubtitle="完整规则"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-zinc-800 px-4 py-3">
          <div className="min-w-0 text-[12px] text-red-300">{error}</div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="secondary" className="h-8 border border-border bg-zinc-900 text-zinc-100 hover:bg-layer-4" onClick={onClose} disabled={saving}>
              取消
            </Button>
            <Button type="button" className="h-8 bg-amber-500 text-black hover:bg-amber-400" onClick={onSave} disabled={saving}>
              {saving ? '保存中...' : '保存全局设定'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
