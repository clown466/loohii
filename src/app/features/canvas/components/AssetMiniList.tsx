import { useState } from 'react';
import { Check, Image as ImageIcon, Layers3, Mic, Package, Trash2, UploadCloud, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { ThumbImage } from '../../../components/ThumbImage';
import { Badge } from '../../../components/ui/badge';
import { cn } from '../../../utils/cn';
import { CharacterPropPickerPanel } from './CharacterPropPickerPanel';
import {
  type AssetImagePreview,
  type GenerateAssetImageOptions,
  type WorkflowAssetItem,
  type WorkflowAssetKind,
  type WorkflowAssets,
  buildCanvasAssetFinalPrompt,
  normalizeCompareText,
  normalizeReusableImageSource,
  setImageDragData,
  stripLegacyCanvasAssetPromptScaffold,
  workflowAssetName,
} from '../canvasUtils';

export function AssetMiniList({
  assetKind,
  items,
  emptyText,
  onUploadReference,
  onUploadAudioReference,
  onClearAudioReference,
  onOpenCharacterPropPicker,
  onGenerateImage,
  onOpenHistory,
  onPreviewImage,
  onAddToCanvas,
  onClearCurrentImage,
  onRemoveAsset,
  onUpdateAssetPrompt,
  buildAssetFinalPrompt,
  isUploadBusy,
  propPickerCharacter,
  workflowAssets,
  propGenerationPrompt,
  propBindingBusy,
  propBindingStatus,
  onPropGenerationPromptChange,
  onCloseCharacterPropPicker,
  onSaveCharacterPropBinding,
  onGenerateCharacterPropImage,
  uploadDisabled,
  generationDisabled,
  isGenerationBusy,
}: {
  assetKind: WorkflowAssetKind;
  items: WorkflowAssetItem[];
  emptyText: string;
  onUploadReference?: (item: WorkflowAssetItem) => void;
  onUploadAudioReference?: (item: WorkflowAssetItem) => void;
  onClearAudioReference?: (item: WorkflowAssetItem) => void | Promise<void>;
  onOpenCharacterPropPicker?: (item: WorkflowAssetItem) => void;
  onGenerateImage?: (item: WorkflowAssetItem, options?: GenerateAssetImageOptions) => void;
  onOpenHistory?: (item: WorkflowAssetItem, variantFilter?: 'all' | 'with-props') => void;
  onPreviewImage?: (preview: AssetImagePreview) => void;
  onAddToCanvas?: (kind: WorkflowAssetKind, item: WorkflowAssetItem) => void;
  onClearCurrentImage?: (item: WorkflowAssetItem) => void;
  onRemoveAsset?: (kind: WorkflowAssetKind, item: WorkflowAssetItem) => void;
  onUpdateAssetPrompt?: (kind: WorkflowAssetKind, item: WorkflowAssetItem, prompt: string) => void | Promise<void>;
  buildAssetFinalPrompt?: (kind: WorkflowAssetKind, item: WorkflowAssetItem) => string;
  isUploadBusy?: (item: WorkflowAssetItem) => boolean;
  propPickerCharacter?: WorkflowAssetItem | null;
  workflowAssets?: WorkflowAssets;
  propGenerationPrompt?: string;
  propBindingBusy?: boolean;
  propBindingStatus?: string | null;
  onPropGenerationPromptChange?: (value: string) => void;
  onCloseCharacterPropPicker?: () => void;
  onSaveCharacterPropBinding?: (character: WorkflowAssetItem, prop: WorkflowAssetItem, shouldBind: boolean) => void;
  onGenerateCharacterPropImage?: (character: WorkflowAssetItem, customPrompt: string) => void;
  uploadDisabled?: boolean;
  generationDisabled?: boolean;
  isGenerationBusy?: (item: WorkflowAssetItem) => boolean;
}) {
  const [editingPromptKey, setEditingPromptKey] = useState('');
  const [editingPromptValue, setEditingPromptValue] = useState('');
  const [editingPromptTarget, setEditingPromptTarget] = useState<{ kind: WorkflowAssetKind; item: WorkflowAssetItem; title: string } | null>(null);
  const [savingPromptKey, setSavingPromptKey] = useState('');
  const [sceneImageModeByKey, setSceneImageModeByKey] = useState<Record<string, NonNullable<GenerateAssetImageOptions['sceneImageMode']>>>({});

  const startPromptEdit = (promptKey: string, item: WorkflowAssetItem, prompt: string) => {
    if (!onUpdateAssetPrompt) return;
    setEditingPromptKey(promptKey);
    setEditingPromptTarget({ kind: assetKind, item, title: workflowAssetName(item) || item.title || '未命名资产' });
    setEditingPromptValue(prompt);
  };

  const closePromptEdit = () => {
    if (savingPromptKey) return;
    setEditingPromptKey('');
    setEditingPromptTarget(null);
  };

  if (items.length === 0) {
    return <div className="mt-3 rounded-md border border-dashed border-zinc-800 px-3 py-2 text-[14px] text-zinc-500">{emptyText}</div>;
  }
  const sceneGroups = assetKind === 'scenes' ? getSceneContinuityGroups(items) : [];

  return (
    <div className="mt-3 space-y-2">
      {sceneGroups.length > 0 ? (
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/[0.04] p-2">
          <div className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-emerald-200">
            <Layers3 className="h-3.5 w-3.5" />
            视觉场景结构
          </div>
          <div className="space-y-1.5">
            {sceneGroups.map((group) => (
              <div key={group.authorityName} className="rounded border border-zinc-800 bg-zinc-950/70 px-2 py-1.5">
                <div className="flex items-center gap-1.5 text-[13px] text-zinc-100">
                  <Badge className="border border-emerald-500/30 bg-emerald-500/10 text-[12px] text-emerald-200 hover:bg-emerald-500/10">
                    主场景
                  </Badge>
                  <span className="truncate">{group.authorityName}</span>
                </div>
                {group.children.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {group.children.map((child) => (
                      <span key={child} className="max-w-full truncate rounded border border-zinc-800 bg-background px-1.5 py-0.5 text-[12px] text-zinc-400">
                        子区域：{child}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="mt-1 text-[12px] text-zinc-500">当前没有拆出独立子区域。</div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {items.map((item, index) => {
        const currentImageUrl = normalizeReusableImageSource(item.referenceImageUrl || item.generatedImageUrl || '');
        const generating = Boolean(isGenerationBusy?.(item));
        const uploading = Boolean(isUploadBusy?.(item));
        const sceneContinuity = assetKind === 'scenes' ? getSceneContinuityView(item) : null;
        const promptKey = assetPromptEditKey(assetKind, item, index);
        const assetPromptText = getEditableAssetPromptText(assetKind, item, buildAssetFinalPrompt);
        const isSavingPrompt = savingPromptKey === promptKey;
        const selectedSceneImageMode = sceneImageModeByKey[promptKey] ?? 'single';
        const propPickerOpen = Boolean(
          assetKind === 'characters' &&
          propPickerCharacter &&
          normalizeCompareText(workflowAssetName(propPickerCharacter)) === normalizeCompareText(workflowAssetName(item))
        );

        return (
        <div key={item.id ?? `${item.name}-${index}`} className="rounded-md border border-zinc-800 bg-background px-3 py-2">
          <div className="flex gap-3">
            {currentImageUrl ? (
              <button
                type="button"
                draggable
                className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 text-left"
                onDragStart={(event) => setImageDragData(event.dataTransfer, currentImageUrl)}
                onClick={() => onPreviewImage?.({
                  url: currentImageUrl,
                  title: item.name || '资产参考图',
                  subtitle: item.referenceImageUrl ? '当前参考图' : '当前生成图',
                })}
                onDoubleClick={() => onPreviewImage?.({
                  url: currentImageUrl,
                  title: item.name || '资产参考图',
                  subtitle: item.referenceImageUrl ? '当前参考图' : '当前生成图',
                })}
              >
                <ThumbImage
                  src={currentImageUrl}
                  thumbWidth={300}
                  alt={item.name || '资产参考图'}
                  draggable
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  onDragStart={(event) => setImageDragData(event.dataTransfer, currentImageUrl)}
                  onDoubleClick={() => onPreviewImage?.({
                    url: currentImageUrl,
                    title: item.name || '资产参考图',
                    subtitle: item.referenceImageUrl ? '当前参考图' : '当前生成图',
                  })}
                />
                <span className="pointer-events-none absolute inset-0 hidden items-center justify-center bg-black/35 text-[12px] text-zinc-100 group-hover:flex">
                  预览
                </span>
              </button>
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-[14px] font-medium text-zinc-100">{item.name || `资产 ${index + 1}`}</div>
                {(item.role || item.timeOfDay || item.referenceAnalysisStatus) && (
                  <Badge className="shrink-0 border border-border bg-zinc-900 text-[12px] text-zinc-400 hover:bg-zinc-900">
                    {item.referenceAnalysisStatus === 'succeeded' ? '已识图' : item.role || item.timeOfDay || item.referenceAnalysisStatus}
                  </Badge>
                )}
              </div>

              {sceneContinuity ? (
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge className="border border-emerald-500/30 bg-emerald-500/10 text-[12px] text-emerald-200 hover:bg-emerald-500/10">
                    {sceneContinuity.isChild ? '子场景/区域' : '主场景'}
                  </Badge>
                  <span className="min-w-0 max-w-full truncate rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[12px] text-zinc-300">
                    主场景：{sceneContinuity.authorityName}
                  </span>
                  {sceneContinuity.isChild && sceneContinuity.zone ? (
                    <span className="min-w-0 max-w-full truncate rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[12px] text-zinc-400">
                      区域：{sceneContinuity.zone}
                    </span>
                  ) : null}
                  <span className="rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[12px] text-amber-200">
                    视觉锁已启用
                  </span>
                </div>
              ) : null}

              {assetPromptText ? (
                <div className="mt-1 flex items-start gap-1.5">
                  <button
                    type="button"
                    className="min-w-0 flex-1 rounded border border-transparent px-0 py-0 text-left text-[13px] leading-4 text-zinc-500 hover:border-zinc-800 hover:bg-zinc-950/60 hover:text-zinc-300"
                    title="点击编辑资产提示词"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      startPromptEdit(promptKey, item, assetPromptText);
                    }}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      startPromptEdit(promptKey, item, assetPromptText);
                    }}
                  >
                    <span className="line-clamp-2">{assetPromptText}</span>
                  </button>
                </div>
              ) : onUpdateAssetPrompt ? (
                <button
                  type="button"
                  className="mt-1 rounded border border-dashed border-zinc-800 px-2 py-1 text-left text-[13px] text-zinc-600 hover:border-amber-500/40 hover:text-amber-200"
                  title="点击添加资产提示词"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    startPromptEdit(promptKey, item, '');
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    startPromptEdit(promptKey, item, '');
                  }}
                >
                  添加完整生图提示词
                </button>
              ) : null}
              {assetKind === 'characters' ? (
                <div className="mt-1 flex items-center gap-1.5 text-[12px] text-zinc-500">
                  <Mic className={cn("h-3 w-3", item.referenceAudioUrl ? "text-emerald-300" : "text-zinc-600")} />
                  <span className="truncate">{item.referenceAudioUrl ? (item.voiceReferenceFileName || '已有角色音频参考') : '未上传角色音频参考'}</span>
                </div>
              ) : null}

              <div className="mt-2 flex flex-wrap gap-1.5">
                {assetKind === 'scenes' && onGenerateImage && item.name ? (
                  <div className="flex h-7 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950" title="场景全新生成模式">
                    {([
                      ['single', '单图'],
                      ['quad-grid', '4宫格'],
                    ] as const).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        className={cn(
                          "px-2 text-[13px] transition-colors",
                          selectedSceneImageMode === mode
                            ? "bg-primary/15 text-primary"
                            : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                        )}
                        disabled={generationDisabled || generating}
                        onClick={() => setSceneImageModeByKey((current) => ({ ...current, [promptKey]: mode }))}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}
                {onGenerateImage && item.name ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[13px] text-primary hover:bg-primary/10 hover:text-primary"
                    disabled={generationDisabled || generating}
                    onClick={() => onGenerateImage(item, assetKind === 'scenes' ? { sceneImageMode: selectedSceneImageMode } : undefined)}
                  >
                    <ImageIcon className="h-3.5 w-3.5" />
                    {generating ? '生成中...' : '全新生成'}
                  </Button>
                ) : null}
                {onGenerateImage && item.name && (item.referenceImageUrl || item.generatedImageUrl) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[13px] text-sky-300 hover:bg-sky-500/10 hover:text-sky-100"
                    disabled={generationDisabled || generating}
                    onClick={() => onGenerateImage(item, { useCurrentReference: true })}
                  >
                    <ImageIcon className="h-3.5 w-3.5" />
                    {generating ? '生成中...' : '参考生成'}
                  </Button>
                ) : null}
                {assetKind === 'characters' && onOpenHistory && item.name ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[13px] text-amber-300 hover:bg-amber-500/10 hover:text-amber-100"
                    onClick={() => onOpenHistory?.(item, 'with-props')}
                  >
                    <Package className="h-3.5 w-3.5" />
                    道具版
                  </Button>
                ) : null}
                {assetKind === 'characters' && onOpenCharacterPropPicker && item.name ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    title="选择绑定道具"
                    className={cn(
                      "h-7 px-2 text-[13px] text-orange-300 hover:bg-orange-500/10 hover:text-orange-100",
                      propPickerOpen && "bg-orange-500/10 text-orange-100"
                    )}
                    disabled={uploadDisabled || uploading || generating}
                    onClick={() => onOpenCharacterPropPicker(item)}
                  >
                    <Package className="h-3.5 w-3.5" />
                    绑定道具
                  </Button>
                ) : null}
                {onUploadReference && item.name ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[13px] text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-100"
                    disabled={uploadDisabled || uploading}
                    onClick={() => onUploadReference(item)}
                  >
                    <UploadCloud className="h-3.5 w-3.5" />
                    {uploading ? '上传中...' : '上传参考图'}
                  </Button>
                ) : null}
                {assetKind === 'characters' && onUploadAudioReference && item.name ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[13px] text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-100"
                    disabled={uploadDisabled || uploading}
                    onClick={() => onUploadAudioReference(item)}
                  >
                    <Mic className="h-3.5 w-3.5" />
                    上传音频
                  </Button>
                ) : null}
                {assetKind === 'characters' && onClearAudioReference && item.name && item.referenceAudioUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[13px] text-zinc-400 hover:bg-layer-4 hover:text-zinc-100"
                    disabled={uploadDisabled || uploading}
                    onClick={() => void onClearAudioReference(item)}
                  >
                    <X className="h-3.5 w-3.5" />
                    取消音频
                  </Button>
                ) : null}
                {onOpenHistory && item.name ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[13px] text-zinc-300 hover:bg-layer-4 hover:text-zinc-100"
                    onClick={() => onOpenHistory(item)}
                  >
                    <ImageIcon className="h-3.5 w-3.5" />
                    历史
                  </Button>
                ) : null}
                {onAddToCanvas && item.name ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[13px] text-amber-300 hover:bg-amber-500/10 hover:text-amber-100"
                    onClick={() => onAddToCanvas(assetKind, item)}
                  >
                    <Layers3 className="h-3.5 w-3.5" />
                    放入画布
                  </Button>
                ) : null}
                {onClearCurrentImage && item.name && currentImageUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[13px] text-zinc-400 hover:bg-layer-4 hover:text-zinc-100"
                    disabled={generating || uploading}
                    onClick={() => onClearCurrentImage(item)}
                  >
                    <X className="h-3.5 w-3.5" />
                    取消当前
                  </Button>
                ) : null}
                {onRemoveAsset && item.name ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[13px] text-red-300 hover:bg-red-500/10 hover:text-red-100"
                    disabled={generating}
                    onClick={() => onRemoveAsset(assetKind, item)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    移除
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
          {propPickerOpen && workflowAssets && onPropGenerationPromptChange && onCloseCharacterPropPicker && onSaveCharacterPropBinding && onGenerateCharacterPropImage ? (
            <CharacterPropPickerPanel
              character={item}
              workflowAssets={workflowAssets}
              prompt={propGenerationPrompt ?? ''}
              status={propBindingStatus}
              busy={propBindingBusy}
              generating={generating}
              onPromptChange={onPropGenerationPromptChange}
              onClose={onCloseCharacterPropPicker}
              onSaveBinding={onSaveCharacterPropBinding}
              onGenerate={onGenerateCharacterPropImage}
            />
          ) : null}
        </div>
        );
      })}
      {editingPromptTarget ? (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/75 p-5 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={closePromptEdit}
        >
          <div
            className="flex h-[min(760px,calc(100vh-40px))] w-[min(980px,calc(100vw-40px))] flex-col overflow-hidden rounded-lg border border-amber-500/40 bg-[#111113] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-4">
              <div className="min-w-0">
                <div className="truncate text-[16px] font-semibold text-zinc-100">{editingPromptTarget.title}</div>
                <div className="mt-0.5 text-[13px] text-zinc-500">完整最终生图提示词</div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-zinc-500 hover:text-zinc-100"
                disabled={Boolean(savingPromptKey)}
                onClick={closePromptEdit}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 p-4">
              <textarea
                className="h-full w-full resize-none rounded-md border border-zinc-800 bg-background px-3 py-2 font-mono text-[14px] leading-5 text-zinc-100 outline-none focus:border-amber-400"
                value={editingPromptValue}
                autoFocus
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => setEditingPromptValue(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault();
                    void saveAssetPromptEdit(
                      editingPromptTarget.kind,
                      editingPromptTarget.item,
                      editingPromptKey,
                      editingPromptValue,
                      onUpdateAssetPrompt,
                      setSavingPromptKey,
                      setEditingPromptKey,
                      setEditingPromptTarget,
                    );
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    closePromptEdit();
                  }
                }}
              />
            </div>
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-zinc-800 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-[13px] text-zinc-500">保存后，“全新生成/参考生成”会优先提交这份完整提示词。</div>
                <div className="mt-1 text-[13px] text-zinc-500">字符数：{editingPromptValue.length.toLocaleString()}</div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-3 text-[14px] text-zinc-400 hover:bg-layer-4 hover:text-zinc-100"
                  disabled={Boolean(savingPromptKey)}
                  onClick={closePromptEdit}
                >
                  <X className="h-3.5 w-3.5" />
                  取消
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 bg-emerald-500 px-3 text-[14px] text-black hover:bg-emerald-400"
                  disabled={Boolean(savingPromptKey)}
                  onClick={() => void saveAssetPromptEdit(
                    editingPromptTarget.kind,
                    editingPromptTarget.item,
                    editingPromptKey,
                    editingPromptValue,
                    onUpdateAssetPrompt,
                    setSavingPromptKey,
                    setEditingPromptKey,
                    setEditingPromptTarget,
                  )}
                >
                  <Check className="h-3.5 w-3.5" />
                  {savingPromptKey ? '保存中...' : '保存'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function getSceneContinuityView(item: WorkflowAssetItem): {
  authorityName: string;
  zone: string;
  isChild: boolean;
} | null {
  const lock = String(item.sceneVisualLock ?? '').trim();
  if (!lock) return null;
  const authorityName = lock.match(/Scene visual authority:\s*([^.;]+)/i)?.[1]?.trim() || item.canonicalSceneId || '已锁定主场景';
  const zone = String(item.sceneZone ?? '').trim() || lock.match(/Current zone:\s*([^,.]+)/i)?.[1]?.trim() || '';
  const name = workflowAssetName(item);
  const isChild = Boolean(zone && normalizeCompareText(zone) !== normalizeCompareText(authorityName) && normalizeCompareText(zone) !== normalizeCompareText(name))
    || Boolean(name && normalizeCompareText(name) !== normalizeCompareText(authorityName));
  return { authorityName, zone: zone || name, isChild };
}

function getSceneContinuityGroups(items: WorkflowAssetItem[]): Array<{ authorityName: string; children: string[] }> {
  const groups = new Map<string, Set<string>>();
  for (const item of items) {
    const view = getSceneContinuityView(item);
    if (!view) continue;
    if (!groups.has(view.authorityName)) groups.set(view.authorityName, new Set());
    if (view.isChild && view.zone) groups.get(view.authorityName)?.add(view.zone);
  }
  return Array.from(groups.entries()).map(([authorityName, children]) => ({
    authorityName,
    children: Array.from(children),
  }));
}

function getEditableAssetPromptText(
  kind: WorkflowAssetKind,
  item: WorkflowAssetItem,
  buildAssetFinalPrompt: ((kind: WorkflowAssetKind, item: WorkflowAssetItem) => string) | undefined,
): string {
  const manualPrompt = stripLegacyCanvasAssetPromptScaffold(item.manualFinalPrompt);
  if (manualPrompt) return manualPrompt;
  const builtPrompt = buildAssetFinalPrompt?.(kind, item).trim();
  if (builtPrompt) return builtPrompt;
  return buildCanvasAssetFinalPrompt(kind, {
    name: workflowAssetName(item),
    assetName: workflowAssetName(item),
    role: item.role,
    visualPrompt: item.visualPrompt || item.lockedVisualIdentity || item.description,
    prompt: item.visualPrompt || item.lockedVisualIdentity || item.description,
    traits: item.lockedVisualIdentity || item.description || item.role || item.fruitIdentity || '',
    description: item.description,
    fruitIdentity: item.fruitIdentity,
    signatureProps: item.signatureProps,
    boundPropNames: item.boundPropNames,
    primaryLook: item.primaryLook,
    habitualActions: item.habitualActions,
    timeOfDay: item.timeOfDay,
    function: item.function,
    canonicalSceneId: item.canonicalSceneId,
    sceneVisualLock: item.sceneVisualLock,
    sceneZone: item.sceneZone,
    sceneAnchors: item.sceneAnchors,
  }, 0).trim();
}

function assetPromptEditKey(kind: WorkflowAssetKind, item: WorkflowAssetItem, index: number): string {
  return `${kind}:${item.id || workflowAssetName(item) || index}`;
}

async function saveAssetPromptEdit(
  kind: WorkflowAssetKind,
  item: WorkflowAssetItem,
  promptKey: string,
  prompt: string,
  onUpdateAssetPrompt: ((kind: WorkflowAssetKind, item: WorkflowAssetItem, prompt: string) => void | Promise<void>) | undefined,
  setSavingPromptKey: (value: string) => void,
  setEditingPromptKey: (value: string) => void,
  setEditingPromptTarget?: (value: { kind: WorkflowAssetKind; item: WorkflowAssetItem; title: string } | null) => void,
) {
  if (!onUpdateAssetPrompt) return;
  setSavingPromptKey(promptKey);
  try {
    await onUpdateAssetPrompt(kind, item, prompt);
    setEditingPromptKey('');
    setEditingPromptTarget?.(null);
  } finally {
    setSavingPromptKey('');
  }
}
