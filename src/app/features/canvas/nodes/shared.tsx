/**
 * Shared utilities, types, constants, and components for canvas node components.
 *
 * This file re-exports from canvasUtils so that node files have a
 * single import source without depending on ProjectCanvasPage directly.
 */
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
export {
  // Types
  type CanvasNodeProps,
  type CanvasProjectPromptContext,
  type CanvasReferenceImage,
  type CharacterAudioReference,
  type WorkflowAssetKind,
  type WorkflowAssets,
  type WorkflowAssetItem,
  type AssetImagePreview,

  // Constants
  CANVAS_IMAGE_RATIO_OPTIONS,
  CANVAS_GENERATION_STALE_MS,
  CANVAS_TRANSLATION_STALE_MS,
  CANVAS_VIDEO_POLL_INTERVAL_MS,
  CANVAS_VIDEO_POLL_TIMEOUT_MS,
  WORKFLOW_ASSET_SYNC_EVENT,
  MAX_VIDEO_REFERENCE_IMAGES,
  videoResolutionOptions,
  videoDurationOptions,
  videoRatioOptions,

  // Components
  CanvasNodeResizer,
  CanvasHandle,

  // Utility functions
  publicImageUrl,
  publicAudioUrl,
  previewCanvasImage,
  downloadCanvasImagePreview,
  syncWorkflowAssetsFromCanvas,
  readObjectString,
  positiveNumber,
  ratioToNumber,
  canvasGenerationStartedAt,
  createCanvasGenerationRequestToken,
  canvasGenerationAgeMs,
  isCanvasGenerationStale,
  canvasGenerationWaitLabel,
  shouldKeepCanvasGenerationPendingAfterError,
  appendCanvasImageGenerationRetryHint,
  canvasPromptTooLongError,
  isCanvasPromptWithinApiLimit,
  isDreaminaWebVideoPromptWithinLimit,
  dreaminaWebVideoPromptTooLongError,
  normalizeCanvasImageSize,
  normalizeImageResolution,
  normalizeVideoResolution,
  normalizeVideoDuration,
  normalizeVideoRatio,
  normalizeGenerationCount,
  normalizeWorkflowAssetKind,
  normalizeCompareText,
  modelOptionLabel,
  isWorkflowImageModel,
  isWorkflowTextModel,
  isWorkflowVideoModel,
  isDreaminaWebImageModel,
  formatDurationMs,
  canvasSectionToneClasses,
  canvasNodeEpisodeId,
  canvasNodePromptText,
  canvasVideoPromptText,
  canvasNodePromptLabel,
  canvasNodeReferenceUrl,
  translatedPromptPatchForNode,
  compactProjectPromptContext,
  buildCanvasCharacterFinalPrompt,
  buildCanvasAssetFinalPrompt,
  isRawCharacterAssetPrompt,
  isRawAssetPrompt,
  hasManualCanvasGenerationPrompt,
  finalPromptSatisfiesProjectIdentity,
  stripLegacyCanvasAssetPromptScaffold,
  uploadCanvasReferenceFile,
  canvasVideoProviderFailed,
  canvasVideoResultErrorMessage,
  canvasVideoPollErrorMessage,
  shouldRetryCanvasVideoPollError,
  canvasVideoReferencePreviewMessage,
  isStoryboardReferenceNodeForVideo,
  isStoryboardSlotNodeForVideo,
  videoReferenceSourcePriority,
  videoReferenceLabel,
  characterAudioReferencesFromNodeData,
  mergeVideoAudioReferencesWithIncoming,
  uniqueClipNames,
  generationReferenceSourcePriority,
  shouldSkipCanvasGenerationReference,
  canvasReferenceImageKind,
  canvasReferenceDedupKey,
  canvasReferenceImageBadgeLabel,
  defaultWorkflowAssets,
  assetArray,
  workflowAssetName,
  workflowAssetKindLabel,
  workflowAssetKindSelectLabel,
  mergeWorkflowAssetsWithProjectRecords,
  canvasOutputImageVariantsFromResult,
  recoverCanvasImageFromGenerationRecords,
  findLatestCanvasImageGenerationRecord,
  generationRecordStartedAt,
  appendReferenceImageMapPrompt,
  prepareCanvasPromptForImageModel,
} from '../canvasUtils';

type PromptTextareaProps = Omit<ComponentProps<'textarea'>, 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
  onExpandedSave?: (value: string) => void;
  modalTitle?: string;
  modalSubtitle?: string;
  maxChars?: number;
};

function PromptCharacterCount({ length, maxChars }: { length: number; maxChars?: number }) {
  const overLimit = typeof maxChars === 'number' && maxChars > 0 && length > maxChars;
  return (
    <div className={`mt-1 text-right text-[10px] leading-4 ${overLimit ? 'text-red-300' : 'text-zinc-500'}`}>
      字符数：{length.toLocaleString()}{maxChars ? ` / ${maxChars.toLocaleString()}` : ''}
    </div>
  );
}

export function PromptTextarea({
  value,
  onChange,
  onExpandedSave,
  modalTitle = '提示词编辑',
  modalSubtitle = '完整提示词',
  maxChars,
  className = '',
  onBlur,
  onFocus,
  onCompositionStart,
  onCompositionEnd,
  onPointerDown,
  onClick,
  onKeyDown,
  onKeyUp,
  ...props
}: PromptTextareaProps) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(value);
  const composingRef = useRef(false);

  useEffect(() => {
    if (!expanded) setDraft(value);
  }, [expanded, value]);

  const openExpanded = () => {
    setDraft(value);
    setExpanded(true);
  };
  const closeExpanded = () => {
    setDraft(value);
    setExpanded(false);
  };
  const saveExpanded = () => {
    onChange(draft);
    onExpandedSave?.(draft);
    setExpanded(false);
  };

  const expandedModal =
    expanded && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="fixed inset-0 z-[9999] flex h-screen w-screen items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={closeExpanded}
          >
            <div
              className="flex h-[min(920px,calc(100vh-48px))] w-[min(1720px,calc(100vw-48px))] max-w-none flex-col overflow-hidden rounded-lg border border-[#2E2E34] bg-[#111113] shadow-2xl"
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <div className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-[#26262B] px-5">
                <div className="min-w-0">
                  <div className="truncate text-[17px] font-semibold text-zinc-100">{modalTitle}</div>
                  <div className="mt-1 text-[13px] text-zinc-500">{modalSubtitle}</div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 shrink-0 text-zinc-500 hover:text-zinc-100"
                  onClick={closeExpanded}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <div className="min-h-0 flex-1 p-5">
                <textarea
                  className="nodrag nopan h-full w-full resize-none rounded-md border border-[#26262B] bg-background px-5 py-4 font-mono text-[16px] leading-7 text-zinc-100 outline-none focus:border-primary"
                  value={draft}
                  autoFocus
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setDraft(event.target.value)}
                  onCompositionStart={() => {
                    composingRef.current = true;
                  }}
                  onCompositionEnd={(event) => {
                    composingRef.current = false;
                    setDraft(event.currentTarget.value);
                  }}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault();
                      saveExpanded();
                    }
                    if (event.key === 'Escape' && !composingRef.current) {
                      event.preventDefault();
                      closeExpanded();
                    }
                  }}
                />
              </div>
              <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[#26262B] px-5 py-4">
                <div className="min-w-0">
                  <div className="truncate text-[13px] text-zinc-500">保存后会同步回当前画布节点。</div>
                  <div className={`mt-1 text-[12px] ${maxChars && draft.length > maxChars ? 'text-red-300' : 'text-zinc-500'}`}>
                    字符数：{draft.length.toLocaleString()}{maxChars ? ` / ${maxChars.toLocaleString()}` : ''}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-10 px-4 text-[14px] text-zinc-400 hover:bg-layer-4 hover:text-zinc-100"
                    onClick={closeExpanded}
                  >
                    <X className="h-4 w-4" />
                    取消
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-10 bg-[linear-gradient(135deg,#F5A623,#E08D0C)] px-5 text-[14px] font-bold text-[#0D0D0F] hover:opacity-90"
                    onClick={saveExpanded}
                  >
                    保存
                  </Button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <textarea
        {...props}
        className={className}
        title={props.title || '双击打开弹窗编辑'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        onFocus={onFocus}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        onPointerDown={onPointerDown}
        onClick={onClick}
        onDoubleClick={(event) => {
          event.stopPropagation();
          openExpanded();
        }}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
      />
      <PromptCharacterCount length={value.length} maxChars={maxChars} />
      {expandedModal}
    </>
  );
}

/**
 * 与本节点相连的入边 + 源节点内容指纹（P4-B 画布性能治理）。
 *
 * 节点组件原先裸订阅 useCanvasStore 的整个 edges/nodes 数组——任何节点拖动都会让
 * 数组换引用、触发全画布每个节点组件重渲染。改为订阅这个字符串指纹后，
 * 只有与本节点相连的边或其源节点 data 实际变化时才重渲染；派生计算在 memo 内
 * 用 useCanvasStore.getState() 取最新数据完成。
 */
interface CanvasRelationState {
  nodes: Array<{ id: string; type?: string; data?: unknown }>;
  edges: Array<{ id: string; source: string; target: string }>;
}

function safeJsonStringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

export function canvasIncomingRelationKey(state: CanvasRelationState, nodeId: string): string {
  let key = '';
  for (const edge of state.edges) {
    if (edge.target !== nodeId) continue;
    const source = state.nodes.find((node) => node.id === edge.source);
    key += `${edge.id}:${edge.source}→${edge.target}#${source ? `${source.type ?? ''}~${safeJsonStringify(source.data)}` : '∅'};`;
  }
  return key;
}
