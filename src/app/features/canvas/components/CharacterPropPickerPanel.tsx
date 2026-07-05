import { Package, Wand2, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../utils/cn';
import {
  type WorkflowAssetItem,
  type WorkflowAssets,
  assetArray,
  findCharacterPropReferences,
  propIsBoundToCharacter,
  workflowAssetImageUrl,
  workflowAssetName,
} from '../canvasUtils';
import { PromptTextarea } from '../nodes/shared';

export function CharacterPropPickerPanel({
  character,
  workflowAssets,
  prompt,
  status,
  busy,
  generating,
  onPromptChange,
  onClose,
  onSaveBinding,
  onGenerate,
}: {
  character: WorkflowAssetItem;
  workflowAssets: WorkflowAssets;
  prompt: string;
  status?: string | null;
  busy?: boolean;
  generating?: boolean;
  onPromptChange: (value: string) => void;
  onClose: () => void;
  onSaveBinding: (character: WorkflowAssetItem, prop: WorkflowAssetItem, shouldBind: boolean) => void;
  onGenerate: (character: WorkflowAssetItem, customPrompt: string) => void;
}) {
  const props = assetArray(workflowAssets, 'props');
  const selectedPropRefs = findCharacterPropReferences(character, workflowAssets);
  const characterName = workflowAssetName(character) || '角色';

  return (
    <div className="mt-3 rounded-md border border-orange-500/25 bg-[#111113] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[12px] font-medium text-orange-100">
            <Package className="h-3.5 w-3.5 text-orange-300" />
            {characterName} · 绑定道具
          </div>
          <div className="mt-1 text-[11px] leading-4 text-zinc-500">
            点选下方道具，再输入本次合成要求生成角色道具版图。
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-zinc-500 hover:text-zinc-100"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {status && (
        <div className="mt-2 rounded-md border border-zinc-800 bg-[#0d0d0f] px-3 py-2 text-[11px] leading-4 text-zinc-400">
          {status}
        </div>
      )}
      {props.length === 0 ? (
        <div className="mt-3 rounded-md border border-dashed border-zinc-800 bg-background px-3 py-3 text-[12px] text-zinc-500">
          暂无道具资产。先在“道具资产”里生成或上传道具图。
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {props.map((prop, index) => {
            const propName = workflowAssetName(prop) || `道具 ${index + 1}`;
            const imageUrl = workflowAssetImageUrl(prop);
            const bound = propIsBoundToCharacter(character, prop);
            return (
              <button
                key={prop.id ?? `${propName}-${index}`}
                type="button"
                className={cn(
                  "group overflow-hidden rounded-md border bg-background text-left transition-colors",
                  bound ? "border-orange-400 bg-orange-500/10" : "border-zinc-800 hover:border-orange-500/50",
                  busy && "cursor-wait opacity-70"
                )}
                disabled={busy}
                onClick={() => onSaveBinding(character, prop, !bound)}
              >
                <div className="relative aspect-square bg-zinc-950">
                  {imageUrl ? (
                    <img loading="lazy" decoding="async" src={imageUrl} alt={propName} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-zinc-600">
                      <Package className="h-5 w-5" />
                    </div>
                  )}
                  <span className={cn(
                    "absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded border text-[10px]",
                    bound ? "border-orange-300 bg-orange-400 text-black" : "border-border bg-black/60 text-zinc-400"
                  )}>
                    <Package className="h-3 w-3" />
                  </span>
                </div>
                <div className="truncate px-2 py-1.5 text-[11px] text-zinc-200">{propName}</div>
              </button>
            );
          })}
        </div>
      )}
      <div className="mt-3 space-y-2">
        <PromptTextarea
          value={prompt}
          onChange={onPromptChange}
          modalTitle={`${characterName} · 道具版提示词`}
          modalSubtitle="完整自定义提示词"
          placeholder={`自定义道具版提示词，例如：让 ${characterName} 自然拿着已选道具，保持当前角色脸型和服装。`}
          className="min-h-[84px] w-full resize-y rounded-md border border-zinc-800 bg-background px-3 py-2 text-[12px] leading-5 text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-orange-500"
        />
        <Button
          type="button"
          size="sm"
          className="h-8 w-full bg-orange-500 text-black hover:bg-orange-400"
          disabled={busy || generating || selectedPropRefs.length === 0}
          onClick={() => onGenerate(character, prompt)}
        >
          <Wand2 className="h-3.5 w-3.5" />
          {generating ? '生成中...' : '生成角色道具版图'}
        </Button>
      </div>
    </div>
  );
}
