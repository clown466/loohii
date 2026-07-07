/**
 * Canvas utility functions, types, and constants.
 *
 * Extracted from ProjectCanvasPage.tsx to reduce file size.
 * Contains pure utility functions, type definitions, constants,
 * and small shared components (CanvasNodeResizer, CanvasHandle).
 */
import React from 'react';
import {
  Handle,
  Position,
  NodeResizer,
  type NodeChange,
  type Edge,
} from '@xyflow/react';
import {
  Boxes,
  Clapperboard,
  Image as ImageIcon,
  Package,
  Users,
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { CanvasNodeKind, useCanvasStore } from '../../stores/useCanvasStore';
import { useProjectStore } from '../../stores/useProjectStore';
import {
  assetHistoryImageIsWithProps as assetHistoryImageIsWithPropsCore,
  orderedReusableAssetHistoryImages as orderedReusableAssetHistoryImagesCore,
  reusableAssetHistoryImages as reusableAssetHistoryImagesCore,
} from './assetHistorySelection';
import { type SceneImageMode, sceneImageModeInstruction } from './sceneImageMode';
import {
  apiClient,
  type ModelConfig,
  type GenerationRecord,
  type ProjectCharacterRecord,
  type ProjectSceneRecord,
  type WorkflowAssetImageHistoryItem,
  type WorkflowAssetImageGenerationResponse,
  type WorkflowClip,
  type WorkflowEpisodeListResponse,
  type WorkflowEpisodeSummary,
  type WorkflowState,
  type CanvasVideoGenerationInput,
  type CanvasVideoGenerationResponse,
} from '../../lib/apiClient';

export const workflowSteps = [
  {
    key: 'import',
    title: '导入小说/剧本',
    desc: '按项目内的集/章组织原文',
    nodeType: 'episode' as CanvasNodeKind,
    nodeTitle: '第 1 集 / 章节容器',
  },
  {
    key: 'assets',
    title: '提取资产',
    desc: '角色、场景、道具进入资产区',
    nodeType: 'asset' as CanvasNodeKind,
    nodeTitle: '资产提取任务',
  },
  {
    key: 'storyboard',
    title: '拆解分镜脚本',
    desc: '把章节拆成镜头、对白、动作和时长',
    nodeType: 'workflow' as CanvasNodeKind,
    nodeTitle: '分镜脚本拆解',
  },
  {
    key: 'director-board',
    title: '生成导演板',
    desc: '空间图、六宫格图、连续性参考',
    nodeType: 'directorBoard' as CanvasNodeKind,
    nodeTitle: '章节导演板',
  },
  {
    key: 'video',
    title: '视频生成',
    desc: '导演板、角色图、音频进入视频模型',
    nodeType: 'workflow' as CanvasNodeKind,
    nodeTitle: '视频生成任务',
  },
];

export type WorkflowStageKey = 'source' | 'assets' | 'storyboard' | 'video' | 'voice' | 'preview' | 'edit';
export type BreakdownScene = {
  id: string;
  title: string;
  description: string;
  references?: string;
  action?: string;
  dialogue?: string;
  durationSeconds?: number;
  shotSize?: string;
  cameraAngle?: string;
  cameraMove?: string;
  composition?: string;
  lens?: string;
  aperture?: string;
  shutter?: string;
  iso?: string;
  sound?: string;
  music?: string;
  subtitle?: string;
  characters?: string[];
  setting?: string;
  visualPrompt?: string;
  directorBoardPrompt?: string;
  status?: string;
};

export type Clip = WorkflowClip;
export type ClipPositioningBoardMode = 'positioning' | 'storyboard';
export type WorkflowAssets = NonNullable<WorkflowState['assets']>;
export type ClipPanelCountChoice = 'ai' | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
export type ClipStoryboardPlan = { panelCount?: number; notes?: string };
export type ClipPromptBatchKind = 'storyboard' | 'video-prompt';
export type ClipStoryboardInferenceResult = { ok: boolean; clip?: Clip };
export type ClipVideoPromptInferenceResult = {
  ok: boolean;
  clips?: Clip[];
  scenes?: BreakdownScene[];
  assets?: WorkflowAssets;
  episode?: string;
};
export type InferBoardsAndVideoResult = {
  ok: boolean;
  completed: number;
  failed: number;
};
export type PersistedClipPromptBatch = {
  version: 1;
  kind: ClipPromptBatchKind;
  projectId: string;
  episodeId?: string;
  clipIds: string[];
  completedClipIds: string[];
  failedClipIds?: string[];
  currentClipId?: string;
  panelChoices?: Record<string, ClipPanelCountChoice>;
  aiModelId?: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowAssetKind = 'characters' | 'scenes' | 'props';
export type AssetLibraryCategory = WorkflowAssetKind | 'directorBoards';
export type AssetLibraryEpisodeFilter = 'all' | string;
export type AssetHistoryLoadKind = WorkflowAssetKind | 'all';
export const MAX_VIDEO_REFERENCE_IMAGES = 9;
export const CANVAS_SECTION_PADDING_X = 12;
export const CANVAS_SECTION_HEADER_HEIGHT = 42;
export const CANVAS_SECTION_PADDING_BOTTOM = 12;
export const CANVAS_REFERENCE_NODE_WIDTH = 340;
export const CANVAS_REFERENCE_NODE_HEIGHT = 248;
export const CANVAS_REFERENCE_NODE_GAP_X = 12;
export const CANVAS_REFERENCE_NODE_GAP_Y = 10;
export const CANVAS_REFERENCE_ROWS_PER_COLUMN = 4;
export const CANVAS_TARGET_SECTION_GAP = 18;
export const CANVAS_GENERATION_NODE_HEIGHT = 560;
export const CANVAS_VIDEO_NODE_HEIGHT = 620;
export const POSITIONING_BOARD_SECTION_WIDTH = 1180;
export const POSITIONING_BOARD_REFERENCE_NODE_WIDTH = 220;
export const POSITIONING_BOARD_REFERENCE_NODE_HEIGHT = 180;
export const POSITIONING_BOARD_REFERENCE_NODE_GAP_X = 18;
export const POSITIONING_BOARD_REFERENCE_NODE_GAP_Y = 16;
export const POSITIONING_BOARD_REFERENCE_COLUMNS = 3;
export const POSITIONING_BOARD_GENERATION_NODE_WIDTH = 420;
export const POSITIONING_BOARD_GENERATION_NODE_X =
  CANVAS_SECTION_PADDING_X +
  POSITIONING_BOARD_REFERENCE_COLUMNS * POSITIONING_BOARD_REFERENCE_NODE_WIDTH +
  Math.max(0, POSITIONING_BOARD_REFERENCE_COLUMNS - 1) * POSITIONING_BOARD_REFERENCE_NODE_GAP_X +
  CANVAS_TARGET_SECTION_GAP;
export const CANVAS_VIDEO_POLL_INTERVAL_MS = 15 * 1000;
export const CANVAS_VIDEO_POLL_TIMEOUT_MS = 30 * 60 * 1000;
export const CANVAS_SINGLE_ASSET_NODE_HEIGHT = 560;
export const EPISODE_CANVAS_SYNC_START_X = 120;
export const EPISODE_CANVAS_SYNC_START_Y = 120;
export const EPISODE_CANVAS_SYNC_COLUMN_GAP = 36;
export const EPISODE_CANVAS_SYNC_ROW_GAP = 28;
export const EPISODE_CANVAS_SYNC_ROW_STRIDE =
  CANVAS_SECTION_HEADER_HEIGHT +
  Math.max(
    CANVAS_REFERENCE_ROWS_PER_COLUMN * CANVAS_REFERENCE_NODE_HEIGHT + Math.max(0, CANVAS_REFERENCE_ROWS_PER_COLUMN - 1) * CANVAS_REFERENCE_NODE_GAP_Y,
    CANVAS_GENERATION_NODE_HEIGHT,
    CANVAS_VIDEO_NODE_HEIGHT,
  ) +
  CANVAS_SECTION_PADDING_BOTTOM +
  EPISODE_CANVAS_SYNC_ROW_GAP;
export const CLIP_PROMPT_BATCH_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export type WorkflowAssetItem = {
  id?: string;
  name?: string;
  title?: string;
  aliases?: string[];
  role?: string;
  description?: string;
  visualPrompt?: string;
  timeOfDay?: string;
  canonicalSceneId?: string;
  sceneVisualLock?: string;
  sceneZone?: string;
  sceneAnchors?: string[];
  function?: string;
  fruitIdentity?: string;
  personality?: string;
  height?: string;
  primaryLook?: string;
  expressionNotes?: string;
  habitualActions?: string;
  variantNotes?: string;
  signatureProps?: string;
  colorPalette?: string;
  boundPropNames?: string[];
  lockedVisualIdentity?: string;
  referencePolicy?: string;
  referenceImageUrl?: string;
  referenceImageAssetId?: string;
  referenceAnalysisStatus?: string;
  generatedImageUrl?: string;
  generatedImageAssetId?: string;
  generatedImagePrompt?: string;
  manualFinalPrompt?: string;
  referenceAudioUrl?: string;
  referenceAudioAssetId?: string;
  voiceReferenceStatus?: string;
  voiceReferenceFileName?: string;
  voiceReferenceMimeType?: string;
};

export type AssetHistoryTarget = {
  kind: WorkflowAssetKind;
  asset: WorkflowAssetItem;
};

export type AssetImagePreview = {
  url: string;
  title: string;
  subtitle?: string;
};

export type EpisodeWorkflowAssetBundle = {
  episode: WorkflowEpisodeSummary;
  workflow: WorkflowState | null;
};

export type AssetLibraryItem = {
  id: string;
  kind: WorkflowAssetKind;
  episodeId: string;
  episodeTitle: string;
  name: string;
  description: string;
  imageUrl: string;
  imageAssetId: string;
  asset: WorkflowAssetItem;
};

export type DirectorBoardLibraryItem = {
  id: string;
  episodeId: string;
  episodeTitle: string;
  name: string;
  description: string;
  imageUrl: string;
  imageAssetId: string;
  prompt: string;
  generationId: string;
  createdAt: string;
};

export type ProjectGlobalSettingsDraft = {
  title: string;
  description: string;
  ratio: string;
  style: string;
  customStyleName: string;
  customStylePrompt: string;
  generationStrategy: string;
  projectTone: string;
  directorNotes: string;
  characterIdentityRules: string;
  globalPrompt: string;
  negativePrompt: string;
  scriptRules: Record<string, string>;
};

export const PROJECT_GLOBAL_STYLE_OPTIONS = ['动漫风', '3D美漫黑色幽默', '美漫风格', '3D 渲染', '写实电影', '自定义'] as const;
export const CANVAS_IMAGE_RATIO_OPTIONS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '2:1', '1:2', '21:9', '9:21', '3:1', '1:3'] as const;
export const PROJECT_GLOBAL_RATIO_OPTIONS = CANVAS_IMAGE_RATIO_OPTIONS;
export const SEEDANCE_MULTI_REF_STRATEGY = 'seedance-multi-ref';
export const CHAPTER_BOARD_STRATEGY = 'chapter-board';
export const FIRST_FRAME_STRATEGY = 'first-frame';
export const PROJECT_GLOBAL_GENERATION_STRATEGIES = [
  { id: SEEDANCE_MULTI_REF_STRATEGY, title: 'Seedance 多参' },
  { id: CHAPTER_BOARD_STRATEGY, title: '章节导演板' },
  { id: FIRST_FRAME_STRATEGY, title: '首帧衔接', disabled: true },
] as const;
export const PROJECT_SCRIPT_RULE_TEMPLATES = [
  { id: 'continuity', title: '人物与气质一致性', hint: 'Keep character appearance, personality, carried items, wardrobe state, and performance state continuous across shots and clips.' },
  { id: 'world', title: '叙事与世界观', hint: 'Respect the story world, era, location, technology level, and physical rules established by the source text and assets.' },
  { id: 'camera', title: '镜头与节奏', hint: 'Use fast short-drama pacing with clear camera changes, visible actions, readable dialogue timing, and 1-3 second shots unless the story requires otherwise.' },
  { id: 'safety', title: '边界与禁用元素', hint: 'Avoid watermarks, random text, low quality output, identity drift, and visual details that conflict with locked assets.' },
] as const;
export const PROJECT_DEFAULT_GLOBAL_PROMPT = 'masterpiece, best quality, highly detailed, cinematic lighting, consistent character design';
export const PROJECT_DEFAULT_NEGATIVE_PROMPT = 'No text, no watermarks, low quality, bad anatomy';
export const PROJECT_DEFAULT_COVER = 'https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?q=80&w=800&auto=format&fit=crop';

export function projectDefaultScriptRules(): Record<string, string> {
  return Object.fromEntries(PROJECT_SCRIPT_RULE_TEMPLATES.map((item) => [item.id, item.hint]));
}

export function projectFirstLineAfterLabel(value: string | undefined, label: string): string | undefined {
  if (!value) return undefined;
  const line = value.split('\n').find((item) => item.trim().startsWith(label));
  return line?.slice(label.length).trim() || undefined;
}

export function projectGenerationStrategyFromPrompt(value: string | undefined): string | undefined {
  const stored = projectFirstLineAfterLabel(value, 'Default generation strategy:');
  if (!stored) return undefined;
  return PROJECT_GLOBAL_GENERATION_STRATEGIES.find((item) => item.id === stored || item.title === stored)?.id;
}

export function isSeedanceMultiReferenceStrategy(value: unknown): boolean {
  const normalized = String(value || '').trim();
  return normalized === SEEDANCE_MULTI_REF_STRATEGY || normalized === 'Seedance 多参';
}

export function isChapterBoardStrategy(value: unknown): boolean {
  const normalized = String(value || '').trim();
  return normalized === CHAPTER_BOARD_STRATEGY || normalized === '章节导演板';
}

export function isFirstFrameStrategy(value: unknown): boolean {
  const normalized = String(value || '').trim();
  return normalized === FIRST_FRAME_STRATEGY || normalized === '首帧衔接';
}

export function projectStrategySupportsStoryboard(value: unknown): boolean {
  return isChapterBoardStrategy(value);
}

export function projectGenerationStrategy(project?: { setupSettings?: Record<string, unknown>; globalPrompt?: string } | null): string {
  const setupSettings = project?.setupSettings && typeof project.setupSettings === 'object' ? project.setupSettings : {};
  return stringSettingValue(setupSettings.generationStrategy) || projectGenerationStrategyFromPrompt(project?.globalPrompt) || CHAPTER_BOARD_STRATEGY;
}

export function projectScriptRulesFromPrompt(value: string | undefined): Record<string, string> {
  if (!value) return {};
  const rules: Record<string, string> = {};
  for (const template of PROJECT_SCRIPT_RULE_TEMPLATES) {
    const prefix = `- ${template.title}:`;
    const line = value.split('\n').find((item) => item.trim().startsWith(prefix));
    const content = line?.slice(prefix.length).trim();
    if (content) rules[template.id] = content;
  }
  return rules;
}

export function stringSettingValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function createProjectGlobalSettingsDraft(project?: ReturnType<typeof useProjectStore.getState>['projects'][number]): ProjectGlobalSettingsDraft {
  const setupSettings = project?.setupSettings && typeof project.setupSettings === 'object' ? project.setupSettings : {};
  const globalPrompt = project?.globalPrompt ?? '';
  const setupStyleName = stringSettingValue(setupSettings.customStyleName);
  const style = project?.style || setupStyleName || '动漫风';
  return {
    title: project?.title || '',
    description: project?.description || '',
    ratio: project?.ratio || '16:9',
    style,
    customStyleName: setupStyleName || (PROJECT_GLOBAL_STYLE_OPTIONS.includes(style as any) ? '' : style),
    customStylePrompt: stringSettingValue(setupSettings.customStylePrompt) || projectFirstLineAfterLabel(globalPrompt, 'Custom style notes:') || '',
    generationStrategy: stringSettingValue(setupSettings.generationStrategy) || projectGenerationStrategyFromPrompt(globalPrompt) || CHAPTER_BOARD_STRATEGY,
    projectTone: stringSettingValue(setupSettings.projectTone) || projectFirstLineAfterLabel(globalPrompt, 'Project tone:') || '',
    directorNotes: stringSettingValue(setupSettings.directorNotes) || projectFirstLineAfterLabel(globalPrompt, 'Director guidance:') || '',
    characterIdentityRules: stringSettingValue(setupSettings.characterIdentityRules) || projectFirstLineAfterLabel(globalPrompt, 'Character identity rules:') || '',
    globalPrompt: stringSettingValue(setupSettings.globalPrompt) || projectFirstLineAfterLabel(globalPrompt, 'Global prompt:') || globalPrompt || PROJECT_DEFAULT_GLOBAL_PROMPT,
    negativePrompt: project?.negativePrompt || PROJECT_DEFAULT_NEGATIVE_PROMPT,
    scriptRules: {
      ...projectDefaultScriptRules(),
      ...projectScriptRulesFromPrompt(globalPrompt),
      ...(setupSettings.scriptRules && typeof setupSettings.scriptRules === 'object' ? setupSettings.scriptRules as Record<string, string> : {}),
    },
  };
}

export function translateProjectPromptSettingsDraftToEnglish(draft: ProjectGlobalSettingsDraft): ProjectGlobalSettingsDraft {
  const englishDefaults = projectDefaultScriptRules();
  const legacyDefaults: Record<string, string> = {
    continuity: '角色外观、性格、携带物、表演状态不得随镜头漂移。',
    world: '明确故事背景、时代、地点、科技或现实规则。',
    camera: '短剧节奏明确，镜头切换快，动作和对白要能落到画面。',
    safety: '避免水印、乱码文字、低质量和破坏风格的元素。',
  };
  const scriptRules = Object.fromEntries(PROJECT_SCRIPT_RULE_TEMPLATES.map((rule) => {
    const value = draft.scriptRules[rule.id]?.trim() || '';
    const normalizedLegacy = legacyDefaults[rule.id] || '';
    return [
      rule.id,
      !value || value === normalizedLegacy ? englishDefaults[rule.id] || value : value,
    ];
  }));
  return {
    ...draft,
    scriptRules,
  };
}

export function buildProjectGlobalPromptFromDraft(draft: ProjectGlobalSettingsDraft): string {
  const finalStyle = draft.style === '自定义' ? (draft.customStyleName.trim() || '自定义风格') : draft.style;
  const strategyTitle = PROJECT_GLOBAL_GENERATION_STRATEGIES.find((item) => item.id === draft.generationStrategy)?.title ?? draft.generationStrategy;
  return [
    `Base style: ${finalStyle}`,
    draft.customStylePrompt.trim() ? `Custom style notes: ${draft.customStylePrompt.trim()}` : '',
    `Default generation strategy: ${strategyTitle}`,
    draft.projectTone.trim() ? `Project tone: ${draft.projectTone.trim()}` : '',
    draft.directorNotes.trim() ? `Director guidance: ${draft.directorNotes.trim()}` : '',
    draft.characterIdentityRules.trim() ? `Character identity rules: ${draft.characterIdentityRules.trim()}` : '',
    draft.globalPrompt.trim() ? `Global prompt: ${draft.globalPrompt.trim()}` : '',
    'Script rules:',
    ...PROJECT_SCRIPT_RULE_TEMPLATES.map((item) => `- ${item.title}: ${draft.scriptRules[item.id]?.trim() || item.hint}`),
  ].filter(Boolean).join('\n');
}

export const CANVAS_IMAGE_PREVIEW_EVENT = 'loohii:canvas-image-preview';
export const WORKFLOW_ASSET_SYNC_EVENT = 'loohii:workflow-asset-sync';
export const CANVAS_GENERATION_STALE_MS = 15 * 60 * 1000;
export const CANVAS_GENERATION_SUBMIT_CONFIRM_MS = 30 * 1000;
export const CANVAS_TRANSLATION_STALE_MS = 2 * 60 * 1000;
export const CANVAS_PROMPT_API_MAX_CHARS = 20000;
export const DREAMINA_WEB_VIDEO_PROMPT_MAX_CHARS = 4000;
export const MIN_CLIP_STORYBOARD_PANEL_COUNT = 5;
export const MAX_CLIP_STORYBOARD_PANEL_COUNT = 12;
export const CLIP_STORYBOARD_PANEL_CHOICES = [5, 6, 7, 8, 9, 10, 11, 12] as const;

export function canvasGenerationStartedAt(): string {
  return new Date().toISOString();
}

export function createCanvasGenerationRequestToken(nodeId: string, requestId: number): string {
  const randomPart = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${nodeId}:${requestId}:${randomPart}`;
}

export function canvasGenerationAgeMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return Date.now() - time;
}

export function isCanvasGenerationStale(value: unknown): boolean {
  const age = canvasGenerationAgeMs(value);
  return age === null || age > CANVAS_GENERATION_STALE_MS;
}

export function canvasGenerationWaitLabel(value: unknown): string {
  const age = canvasGenerationAgeMs(value);
  if (age === null || age < 0) return '已提交上游，等待返回...';
  const totalSeconds = Math.floor(age / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `已提交上游，等待 ${seconds} 秒`;
  return `已提交上游，等待 ${minutes} 分 ${seconds.toString().padStart(2, '0')} 秒`;
}

export function shouldKeepCanvasGenerationPendingAfterError(message: string): boolean {
  if (/图片上游服务临时失败|502\/failover|Bad Gateway|<!DOCTYPE html|<html|图片生成等待超时|图片上游连接失败|后端服务暂时不可用（502）/i.test(message)) {
    return false;
  }
  return /同一图片生成请求已在进行中|AI 请求超过网关等待时间（504）|超过网关等待时间|网络请求没有连到后端|Failed to fetch|长请求被浏览器或网关中断/i.test(message);
}

export function canvasImageGenerationRetryHint(referenceCount: number, resolution: string): string {
  const normalizedResolution = resolution.trim().toLowerCase();
  if (referenceCount > 4 && normalizedResolution === '2k') {
    return `当前是 ${referenceCount} 张参考图 + 2K，图片上游更容易 502；可减少参考图、换更稳定的模型，或手动改小尺寸后重试。`;
  }
  if (referenceCount > 4) {
    return `当前有 ${referenceCount} 张参考图，建议减少参考图后重试。`;
  }
  if (normalizedResolution === '2k') {
    return '当前是 2K；可换更稳定的模型，或手动改小尺寸后重试。';
  }
  return '';
}

export function appendCanvasImageGenerationRetryHint(message: string, referenceCount: number, resolution: string): string {
  if (!/图片上游服务临时失败|502\/failover|Bad Gateway|<!DOCTYPE html|<html|图片生成等待超时|后端服务暂时不可用（502）/i.test(message)) return message;
  const hint = canvasImageGenerationRetryHint(referenceCount, resolution);
  if (!hint || message.includes(hint) || message.includes('建议先降到 1K')) return message;
  return `${message} ${hint}`;
}

export function openCanvasImagePreview(preview: AssetImagePreview) {
  if (!preview.url || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AssetImagePreview>(CANVAS_IMAGE_PREVIEW_EVENT, { detail: preview }));
}

export function previewCanvasImage(event: React.MouseEvent, preview: AssetImagePreview) {
  event.preventDefault();
  event.stopPropagation();
  openCanvasImagePreview(preview);
}

export function downloadFileNameFromPreview(preview: AssetImagePreview): string {
  const title = preview.title
    .trim()
    .replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'image';
  try {
    const extension = new URL(preview.url).pathname.split('.').pop()?.toLowerCase();
    if (extension && /^(png|jpe?g|webp|gif)$/i.test(extension)) return `${title}.${extension === 'jpeg' ? 'jpg' : extension}`;
  } catch {
    // Data URLs and malformed URLs fall through to png.
  }
  return `${title}.png`;
}

export async function downloadCanvasImagePreview(preview: AssetImagePreview) {
  const filename = downloadFileNameFromPreview(preview);
  const absoluteUrl = toBrowserAbsoluteUrl(preview.url);
  const fetchBrowserImageBlob = async (url: string) => {
    const response = await fetch(url, {
      credentials: new URL(url, window.location.origin).origin === window.location.origin ? 'same-origin' : 'omit',
    });
    if (!response.ok) throw new Error('图片下载失败');
    const blob = await response.blob();
    if (blob.size === 0) throw new Error('图片内容为空');
    const contentType = blob.type.split(';')[0]?.trim().toLowerCase();
    if (contentType && !contentType.startsWith('image/') && contentType !== 'application/octet-stream') {
      throw new Error('源地址不是图片文件');
    }
    return blob;
  };
  const downloadBlob = async () => {
    if (/^(data:image\/|blob:)/i.test(preview.url)) {
      return fetchBrowserImageBlob(preview.url);
    }
    if (/^https?:\/\//i.test(absoluteUrl)) {
      try {
        return await fetchBrowserImageBlob(absoluteUrl);
      } catch {
        // Some external image hosts do not allow browser CORS downloads; use the backend proxy as fallback.
      }
    }
    return apiClient.downloadImageBlob({
      url: absoluteUrl,
      filename,
    });
  };
  const clickDownload = (href: string, openInNewTab = false) => {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = filename;
    anchor.rel = 'noopener';
    if (openInNewTab) anchor.target = '_blank';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  try {
    const savePicker = typeof window !== 'undefined' ? (window as any).showSaveFilePicker : undefined;
    if (typeof savePicker === 'function' && window.isSecureContext) {
      let handle: any;
      try {
        handle = await savePicker({
          suggestedName: filename,
          types: [{
            description: '图片',
            accept: {
              'image/png': ['.png'],
              'image/jpeg': ['.jpg', '.jpeg'],
              'image/webp': ['.webp'],
              'image/gif': ['.gif'],
            },
          }],
        });
      } catch (error: any) {
        if (error?.name === 'AbortError') return;
        throw error;
      }
      const blob = await downloadBlob();
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    }

    const blob = await downloadBlob();
    const objectUrl = URL.createObjectURL(blob);
    clickDownload(objectUrl);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (error: any) {
    if (/^https?:\/\//i.test(absoluteUrl)) {
      clickDownload(absoluteUrl, true);
      window.alert('后端代理暂时无法下载源图，已打开原图；如果浏览器没有自动保存，请在新页面右键保存。');
      return;
    }
    window.alert(error?.message || '图片下载失败，请稍后重试。');
  }
}

export function syncWorkflowAssetsFromCanvas(workflow?: WorkflowState) {
  if (!workflow || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<{ workflow: WorkflowState }>(WORKFLOW_ASSET_SYNC_EVENT, { detail: { workflow } }));
}

export function readObjectString(value: unknown, key: string): string {
  if (!value || typeof value !== 'object') return '';
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === 'string' ? raw : '';
}

export function canvasVideoProviderFailed(status: unknown): boolean {
  const value = typeof status === 'string' ? status.toLowerCase() : '';
  return Boolean(value && /fail|error|cancel|reject/.test(value));
}

export function mediaFileNameFromUrl(value: unknown): string {
  const url = String(value || '').trim();
  if (!url) return '';
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'https://loohii.com';
    const parsed = new URL(url, base);
    return decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
  } catch {
    return decodeURIComponent(url.split(/[?#]/)[0].split('/').filter(Boolean).pop() || '');
  }
}

export function readObjectPath(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function readNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function canvasVideoReferencePreviewMessage(result: CanvasVideoGenerationResponse): string {
  const refs = result.references ?? {};
  const imageUrls = Array.isArray(refs.referenceImageUrls) ? refs.referenceImageUrls : [];
  const audioUrls = Array.isArray(refs.referenceAudioUrls) ? refs.referenceAudioUrls : [];
  const firstImage = refs.storyboardImageUrl || imageUrls[0] || '';
  const firstName = mediaFileNameFromUrl(firstImage);
  const uploadStats = readObjectPath(result.raw, ['dreaminaUploadPreflight', 'composerReferenceStatsAfterUpload']);
  const actualImageCount = readNumber(readObjectPath(uploadStats, ['imageCount']));
  const actualAudioCount = readNumber(readObjectPath(uploadStats, ['audioCount']));
  const actualVideoCount = readNumber(readObjectPath(uploadStats, ['videoCount']));
  const actualItemCount = readNumber(readObjectPath(uploadStats, ['itemCount']));
  return [
    actualItemCount !== undefined
      ? `Dreamina 页面预检通过：应上传 ${imageUrls.length} 张图 / ${audioUrls.length} 段音频；页面识别 ${actualImageCount ?? 0} 张图 / ${actualAudioCount ?? 0} 段音频${actualVideoCount ? ` / ${actualVideoCount} 个视频素材` : ''}。`
      : `素材预检通过：将上传 ${imageUrls.length} 张图 / ${audioUrls.length} 段音频。`,
    firstName ? `首图：${firstName}。` : '',
    refs.source ? `来源：${refs.source}。` : '',
  ].filter(Boolean).join(' ');
}

export function canvasVideoPollErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : '';
}

export function canvasVideoResultErrorMessage(result: CanvasVideoGenerationResponse): string {
  return (
    readObjectString(result.generation, 'errorMessage') ||
    readObjectString(result.raw, 'errorMessage') ||
    String(readObjectPath(result.raw, ['result', 'errorMessage']) || '').trim()
  );
}

export function shouldRetryCanvasVideoPollError(error: unknown): boolean {
  const message = canvasVideoPollErrorMessage(error);
  if (!message) return false;
  if (/login|登录|session|token|余额|credit|quota|额度|unauthori[sz]ed|forbidden|401|403/i.test(message)) return false;
  return /timeout|timed out|超时|502|503|504|fetch failed|network|ECONN|EHOST|ENOTFOUND|后台处理中|仍在处理|暂时|temporary/i.test(message);
}

export function normalizeWorkflowAssetKind(value: unknown): WorkflowAssetKind | null {
  return value === 'characters' || value === 'scenes' || value === 'props' ? value : null;
}

export function workflowAssetKindLabel(kind: WorkflowAssetKind): string {
  if (kind === 'characters') return '角色';
  if (kind === 'scenes') return '场景';
  return '道具';
}

export function workflowAssetKindSelectLabel(kind: WorkflowAssetKind): string {
  if (kind === 'characters') return '角色资产';
  if (kind === 'scenes') return '场景资产';
  return '道具资产';
}

export function ratioToNumber(value: unknown): number {
  const normalized = normalizeCanvasImageSize(value);
  const [width, height] = normalized.split(':').map((part) => Number(part));
  return width > 0 && height > 0 ? width / height : 1;
}

export type GenerateAssetImageOptions = {
  useCurrentReference?: boolean;
  referenceImageUrl?: string;
  extraReferenceImageUrls?: string[];
  sceneImageMode?: SceneImageMode;
  variant?: 'clean' | 'with-props';
  customPrompt?: string;
  preservePromptExact?: boolean;
};

export function defaultWorkflowAssets(): WorkflowAssets {
  return { characters: [], scenes: [], props: [] };
}

export function workflowHasRunningStage(stageStatuses?: Record<string, string>): boolean {
  return Object.values(stageStatuses ?? {}).includes('running');
}

export function workflowRunProgressText(workflow: WorkflowState | null | undefined): string {
  const lastRun = workflow?.lastRun ?? {};
  const progress = lastRun && typeof lastRun === 'object' && 'progress' in lastRun && lastRun.progress && typeof lastRun.progress === 'object'
    ? lastRun.progress as Record<string, unknown>
    : null;
  const message = typeof progress?.message === 'string' ? progress.message.trim() : '';
  const currentPart = Number(progress?.currentPart);
  const totalParts = Number(progress?.totalParts);
  const generatedShots = Number(progress?.generatedShots);
  const pieces: string[] = [];
  if (message) pieces.push(message);
  if (Number.isFinite(currentPart) && Number.isFinite(totalParts) && totalParts > 0) {
    pieces.push(`进度 ${currentPart}/${totalParts}`);
  }
  if (Number.isFinite(generatedShots) && generatedShots > 0) {
    pieces.push(`已生成 ${generatedShots} 条分镜`);
  }
  return pieces.filter(Boolean).join(' · ');
}

export function workflowHasCompleteBoardAndVideoPrompts(workflow: WorkflowState | null | undefined): boolean {
  const workflowClips = workflow?.clips ?? [];
  return workflowClips.length > 0 && workflowClips.every((clip) => (
    Boolean(clip.storyboardPrompt?.trim()) && Boolean(clip.seedancePrompt?.trim())
  ));
}

export function workflowHasCompleteVideoPrompts(workflow: WorkflowState | null | undefined): boolean {
  const workflowClips = workflow?.clips ?? [];
  return workflowClips.length > 0 && workflowClips.every((clip) => Boolean(clip.seedancePrompt?.trim()));
}

export function workflowHasCompleteBoardAndVideoPromptsForClipIds(
  workflow: WorkflowState | null | undefined,
  clipIds: string[],
  options: { requireStoryboard?: boolean } = {},
): boolean {
  const expectedClipIds = clipIds.filter(Boolean);
  const requireStoryboard = options.requireStoryboard ?? true;
  if (expectedClipIds.length === 0) {
    return requireStoryboard ? workflowHasCompleteBoardAndVideoPrompts(workflow) : workflowHasCompleteVideoPrompts(workflow);
  }
  const clipById = new Map((workflow?.clips ?? []).map((clip) => [clip.id, clip]));
  return expectedClipIds.every((clipId) => {
    const clip = clipById.get(clipId);
    return Boolean(clip?.seedancePrompt?.trim()) && (!requireStoryboard || Boolean(clip?.storyboardPrompt?.trim()));
  });
}

export function workflowLastVideoRunFinishedBatch(workflow: WorkflowState, clipIds: string[], startedAtMs: number): boolean {
  const lastClipId = clipIds.filter(Boolean).slice(-1)[0] ?? '';
  if (!lastClipId) return false;
  const lastRun = workflow.lastRun ?? {};
  const lastRunStage = String(lastRun.stage ?? '');
  const lastRunStatus = String(lastRun.status ?? '');
  const lastRunClipId = String(lastRun.clipId ?? '');
  const completedAtRaw = typeof lastRun.completedAt === 'string' ? lastRun.completedAt : '';
  const completedAtMs = Date.parse(completedAtRaw);
  return (
    lastRunStage === 'video' &&
    lastRunStatus === 'seedance-prompt-generated' &&
    lastRunClipId === lastClipId &&
    Number.isFinite(completedAtMs) &&
    completedAtMs + 5000 >= startedAtMs
  );
}

export function workflowRemoteBatchFinished(
  workflow: WorkflowState | null | undefined,
  clipIds: string[],
  startedAtMs: number,
  completedClipIds: Set<string>,
  options: { requireStoryboard?: boolean } = {},
): workflow is WorkflowState {
  if (!workflow || workflowHasRunningStage(workflow.stageStatuses)) return false;
  const expectedClipIds = clipIds.filter(Boolean);
  if (!workflowHasCompleteBoardAndVideoPromptsForClipIds(workflow, expectedClipIds, options)) return false;
  if (expectedClipIds.length > 0 && completedClipIds.size >= expectedClipIds.length) return true;
  return workflowLastVideoRunFinishedBatch(workflow, expectedClipIds, startedAtMs);
}

export function workflowRunCompletedAfter(workflow: WorkflowState | null | undefined, startedAtMs: number): boolean {
  if (!workflow) return false;
  const lastRun = workflow.lastRun ?? {};
  const lastRunStatus = String(lastRun.status ?? '');
  const completedAtRaw = typeof lastRun.completedAt === 'string' ? lastRun.completedAt : '';
  const completedAtMs = Date.parse(completedAtRaw);
  return (
    /succeeded/i.test(lastRunStatus) &&
    Number.isFinite(completedAtMs) &&
    completedAtMs + 5000 >= startedAtMs
  );
}

export function workflowRunStartedAfter(workflow: WorkflowState | null | undefined, startedAtMs: number): boolean {
  if (!workflow) return false;
  const lastRun = workflow.lastRun ?? {};
  const lastRunStatus = String(lastRun.status ?? '');
  const startedAtRaw = typeof lastRun.startedAt === 'string' ? lastRun.startedAt : '';
  const remoteStartedAtMs = Date.parse(startedAtRaw);
  return (
    /running/i.test(lastRunStatus) &&
    Number.isFinite(remoteStartedAtMs) &&
    remoteStartedAtMs + 5000 >= startedAtMs
  );
}

export function workflowHasBreakdownResult(workflow: WorkflowState | null | undefined): workflow is WorkflowState {
  if (!workflow || workflowHasRunningStage(workflow.stageStatuses)) return false;
  return (workflow.clips?.length ?? 0) > 0 || workflow.breakdownScenes.length > 0;
}

export function workflowHasAssetResult(workflow: WorkflowState | null | undefined): workflow is WorkflowState {
  if (!workflow || workflowHasRunningStage(workflow.stageStatuses)) return false;
  const assets = workflow.assets ?? defaultWorkflowAssets();
  return assetArray(assets, 'characters').length + assetArray(assets, 'scenes').length + assetArray(assets, 'props').length > 0;
}

export function shouldRecoverWorkflowAfterRequestError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /网络请求没有连到后端|Failed to fetch|fetch failed|networkerror|load failed|长请求被浏览器或网关中断/i.test(message);
}

export function defaultEpisodeList(): WorkflowEpisodeListResponse {
  return {
    activeEpisodeId: 'episode-001',
    episodes: [{
      id: 'episode-001',
      title: '第 1 集',
      selectedEpisode: '第 1 集',
      canvasSceneId: 'episode-001',
      clipCount: 0,
      sceneCount: 0,
    }],
  };
}

export function workflowEpisodeCanvasSceneId(episodeId: string) {
  return episodeId || 'default';
}

export function isWorkflowEpisodeId(value: string): boolean {
  return /^episode(?:-|$)/i.test(value.trim());
}

export function canvasNodeEpisodeId(data: any): string {
  const sourceEpisodeId = typeof data?.sourceEpisodeId === 'string' ? data.sourceEpisodeId.trim() : '';
  if (sourceEpisodeId) return sourceEpisodeId;
  const sourceEpisode = typeof data?.sourceEpisode === 'string' ? data.sourceEpisode.trim() : '';
  return isWorkflowEpisodeId(sourceEpisode) ? sourceEpisode : '';
}

export function nextEpisodeTitle(episodes: WorkflowEpisodeSummary[]): string {
  const numbers = episodes
    .map((episode) => `${episode.title} ${episode.selectedEpisode} ${episode.id}`.match(/(?:第\s*)?(\d{1,4})\s*(?:集|话|章|回)|episode[-_\s]*(\d{1,4})|ep[-_\s]*(\d{1,4})/i))
    .map((match) => match ? Number(match[1] || match[2] || match[3]) : Number.NaN)
    .filter(Number.isFinite);
  const next = numbers.length ? Math.max(...numbers) + 1 : episodes.length + 1;
  return `第 ${next} 集`;
}

export function applyWorkflowSnapshot(
  workflow: WorkflowState,
  setters: {
    setEpisodeList: (value: WorkflowEpisodeListResponse | ((current: WorkflowEpisodeListResponse) => WorkflowEpisodeListResponse)) => void;
    setActiveEpisodeId: (value: string) => void;
    setSourceText: (value: string) => void;
    setSourceName: (value: string) => void;
    setSelectedEpisode: (value: string) => void;
    setBreakdownScenes: (value: BreakdownScene[]) => void;
    setClips: (value: Clip[]) => void;
    setWorkflowAssets: (value: WorkflowAssets) => void;
    setStageStatuses: (value: Record<string, string>) => void;
  },
) {
  if (workflow.episodes) setters.setEpisodeList(workflow.episodes);
  if (workflow.episodeId) setters.setActiveEpisodeId(workflow.episodeId);
  setters.setSourceText(workflow.sourceText);
  setters.setSourceName(workflow.sourceName);
  setters.setSelectedEpisode(workflow.selectedEpisode);
  setters.setBreakdownScenes(workflow.breakdownScenes as BreakdownScene[]);
  setters.setClips(workflow.clips ?? []);
  setters.setWorkflowAssets(workflow.assets ?? defaultWorkflowAssets());
  setters.setStageStatuses(workflow.stageStatuses ?? {});
}

export function assetArray(assets: WorkflowAssets, kind: WorkflowAssetKind): WorkflowAssetItem[] {
  const value = assets[kind];
  return Array.isArray(value) ? value.filter((item): item is WorkflowAssetItem => !!item && typeof item === 'object') : [];
}

export function workflowAssetName(item: WorkflowAssetItem): string {
  return String(item.name || item.title || '').trim();
}

export function workflowAssetHasImage(item: WorkflowAssetItem): boolean {
  return Boolean(normalizeReusableImageSource(item.referenceImageUrl || item.generatedImageUrl || ''));
}

export function workflowAssetImageReadiness(assets: WorkflowAssets): {
  ready: boolean;
  total: number;
  withImage: number;
  missing: Array<{ kind: WorkflowAssetKind; name: string }>;
  summary: string;
} {
  const missing: Array<{ kind: WorkflowAssetKind; name: string }> = [];
  let total = 0;
  let withImage = 0;
  for (const kind of ['characters', 'scenes', 'props'] as WorkflowAssetKind[]) {
    for (const item of assetArray(assets, kind)) {
      const name = workflowAssetName(item);
      if (!name) continue;
      total += 1;
      if (workflowAssetHasImage(item)) {
        withImage += 1;
      } else {
        missing.push({ kind, name });
      }
    }
  }
  const ready = total > 0 && missing.length === 0;
  const summary = total === 0
    ? '还没有资产'
    : ready
      ? `${withImage}/${total} 已有图`
      : `${withImage}/${total} 已有图，缺 ${missing.length} 个`;
  return { ready, total, withImage, missing, summary };
}

export function mergeAssetItems(primary: WorkflowAssetItem[], fallback: WorkflowAssetItem[]): WorkflowAssetItem[] {
  const merged: WorkflowAssetItem[] = [];
  const indexByKey = new Map<string, number>();
  const mergeSupplementalFields = (current: WorkflowAssetItem, supplemental: WorkflowAssetItem): WorkflowAssetItem => ({
    ...current,
    referenceAudioUrl: current.referenceAudioUrl || supplemental.referenceAudioUrl,
    referenceAudioAssetId: current.referenceAudioAssetId || supplemental.referenceAudioAssetId,
    voiceReferenceStatus: current.voiceReferenceStatus || supplemental.voiceReferenceStatus,
    voiceReferenceFileName: current.voiceReferenceFileName || supplemental.voiceReferenceFileName,
    voiceReferenceMimeType: current.voiceReferenceMimeType || supplemental.voiceReferenceMimeType,
  });
  const push = (item: WorkflowAssetItem, supplemental = false) => {
    const name = workflowAssetName(item);
    if (!name) return;
    const key = normalizeCompareText(name);
    const existingIndex = indexByKey.get(key);
    if (existingIndex !== undefined) {
      if (supplemental) merged[existingIndex] = mergeSupplementalFields(merged[existingIndex], item);
      return;
    }
    indexByKey.set(key, merged.length);
    merged.push({ ...item, name, title: item.title || name });
  };
  primary.forEach(push);
  fallback.forEach((item) => push(item, true));
  return merged;
}

export function projectCharacterToWorkflowAsset(character: ProjectCharacterRecord): WorkflowAssetItem {
  const traits = character.traits && typeof character.traits === 'object' ? character.traits : {};
  const latestImage = character.assets?.find((asset) => asset.url)?.url || '';
  const referenceImageUrl =
    readObjectString(traits, 'referenceImageUrl') ||
    readObjectString(traits, 'generatedImageUrl') ||
    latestImage;
  const referenceImageAssetId = readObjectString(traits, 'referenceImageAssetId') || readObjectString(traits, 'generatedImageAssetId');
  return {
    id: character.id,
    name: character.name,
    title: character.name,
    role: character.role,
    description: character.bio,
    visualPrompt: character.prompt,
    fruitIdentity: readObjectString(traits, 'fruitIdentity'),
    lockedVisualIdentity: readObjectString(traits, 'lockedVisualIdentity'),
    referencePolicy: readObjectString(traits, 'referencePolicy'),
    referenceImageUrl,
    referenceImageAssetId,
    generatedImageUrl: readObjectString(traits, 'generatedImageUrl') || referenceImageUrl,
    generatedImageAssetId: readObjectString(traits, 'generatedImageAssetId') || referenceImageAssetId,
    generatedImagePrompt: readObjectString(traits, 'generatedImagePrompt') || character.prompt,
    referenceAudioUrl: readObjectString(traits, 'referenceAudioUrl'),
    referenceAudioAssetId: readObjectString(traits, 'referenceAudioAssetId'),
    voiceReferenceStatus: readObjectString(traits, 'voiceReferenceStatus'),
    voiceReferenceFileName: readObjectString(traits, 'voiceReferenceFileName'),
    voiceReferenceMimeType: readObjectString(traits, 'voiceReferenceMimeType'),
  };
}

export function projectSceneToWorkflowAsset(scene: ProjectSceneRecord): WorkflowAssetItem | null {
  const metadata = scene.metadata && typeof scene.metadata === 'object' ? scene.metadata : {};
  if (readObjectString(metadata, 'workflowSource') === 'script-import') return null;
  return {
    id: scene.id,
    name: scene.title,
    title: scene.title,
    description: scene.summary,
    visualPrompt: scene.prompt,
    timeOfDay: readObjectString(metadata, 'timeOfDay'),
    referenceImageUrl: readObjectString(metadata, 'referenceImageUrl') || readObjectString(metadata, 'generatedImageUrl'),
    referenceImageAssetId: readObjectString(metadata, 'referenceImageAssetId') || readObjectString(metadata, 'generatedImageAssetId'),
  };
}

export function mergeWorkflowAssetsWithProjectRecords(
  workflowAssets: WorkflowAssets,
  characters: ProjectCharacterRecord[] = [],
  scenes: ProjectSceneRecord[] = [],
): WorkflowAssets {
  const projectSceneAssets = scenes.map(projectSceneToWorkflowAsset).filter((item): item is WorkflowAssetItem => Boolean(item));
  return {
    characters: mergeAssetItems(assetArray(workflowAssets, 'characters'), characters.map(projectCharacterToWorkflowAsset)),
    scenes: mergeAssetItems(assetArray(workflowAssets, 'scenes'), projectSceneAssets),
    props: mergeAssetItems(assetArray(workflowAssets, 'props'), []),
  };
}

export function normalizeCompareText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function normalizeClipId(value: string): string {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  const explicit = text.match(/\bclip[-_\s]*(\d{1,3})\b/i);
  if (explicit) return `clip-${explicit[1].padStart(3, '0')}`;
  return text;
}

export function stableCanvasIdPart(value: unknown, fallback = 'item'): string {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || fallback;
}

export function workflowAssetBusyKey(kind: WorkflowAssetKind, assetName: string): string {
  return `${kind}:${normalizeCompareText(assetName)}`;
}

export function assetImageSourceLabel(source?: string): string {
  if (source === 'workflow-asset-image-generation') return '生成图';
  if (source === 'workflow-asset-reference-upload' || source === 'character-reference-upload') return '上传图';
  return source ? source : '资产图';
}

export function formatDurationMs(value?: number): string {
  if (!Number.isFinite(value)) return '';
  const ms = Number(value);
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export function isWorkflowTextModel(model: ModelConfig): boolean {
  if (!model.isActive) return false;
  const modality = model.modality.trim().toLowerCase();
  const capabilities = model.capabilities.map((item) => item.toLowerCase());
  const searchable = `${modality} ${capabilities.join(' ')} ${model.displayName} ${model.model}`.toLowerCase();
  if (['text', 'chat', 'llm'].includes(modality)) return true;
  if (capabilities.some((item) => ['chat', 'text-generation', 'structured-output'].includes(item))) return true;
  if (/(image|video|audio|tts|voice|seedance|flux|sdxl|stable-diffusion)/.test(searchable)) return false;
  return /(gpt|claude|gemini|deepseek|qwen|doubao|kimi|llama|mistral|chat)/.test(searchable);
}

export function isWorkflowImageModel(model: ModelConfig): boolean {
  if (!model.isActive) return false;
  const modality = model.modality.trim().toLowerCase();
  const capabilities = model.capabilities.map((item) => item.toLowerCase());
  const searchable = `${modality} ${capabilities.join(' ')} ${model.displayName} ${model.model}`.toLowerCase();
  if (modality === 'image') return true;
  if (capabilities.some((item) => ['text-to-image', 'image-to-image', 'multi-reference-image', 'image-edit'].includes(item))) return true;
  if (/(video|audio|tts|voice|seedance|kling|runway|luma)/.test(searchable)) return false;
  return /(gpt-image|dall-e|flux|sdxl|stable-diffusion|midjourney|image)/.test(searchable);
}

export function isDreaminaWebImageModel(model?: ModelConfig): boolean {
  if (!model) return false;
  const provider = `${model.provider} ${model.providerConfig?.providerType || ''} ${model.providerConfig?.displayName || ''} ${model.displayName} ${model.model}`.toLowerCase();
  return provider.includes('dreamina-web') || provider.includes('dreamina web');
}

export function isWorkflowVideoModel(model: ModelConfig): boolean {
  if (!model.isActive) return false;
  const modality = model.modality.trim().toLowerCase();
  const capabilities = model.capabilities.map((item) => item.toLowerCase());
  const searchable = `${modality} ${capabilities.join(' ')} ${model.displayName} ${model.model}`.toLowerCase();
  if (modality === 'video') return true;
  if (capabilities.some((item) => item.includes('video'))) return true;
  return /(seedance|kling|runway|luma|video)/.test(searchable);
}

export function modelOptionLabel(model: ModelConfig): string {
  const providerName = model.providerConfig?.displayName ?? model.provider;
  const provider = providerName ? ` / ${providerName}` : '';
  return `${model.displayName || model.model}${provider}`;
}

export function safeUploadKey(projectId: string, fileName: string, kind: WorkflowAssetKind = 'characters'): string {
  const safeName = fileName
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'reference-image.png';
  return `asset-references/${projectId}/${kind}/${Date.now()}-${safeName}`;
}

export function safeAudioUploadKey(projectId: string, fileName: string): string {
  const safeName = fileName
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'voice-reference.mp3';
  return `asset-audio/${projectId}/characters/${Date.now()}-${safeName}`;
}

export function safeCanvasUploadKey(projectId: string, fileName: string): string {
  const safeName = fileName
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'canvas-reference-image.png';
  return `canvas-references/${projectId}/${Date.now()}-${safeName}`;
}

export function toBrowserAbsoluteUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || typeof window === 'undefined') return trimmed;
  try {
    return new URL(trimmed, window.location.origin).href;
  } catch {
    return trimmed;
  }
}

export function normalizeReusableImageSource(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const localPublicPath = localPublicUploadPath(trimmed);
  if (localPublicPath) return toBrowserAbsoluteUrl(localPublicPath);
  if (/^https?:\/\//i.test(trimmed) || /^data:image\//i.test(trimmed) || /^blob:/i.test(trimmed)) return trimmed;
  if (/^\/api\/uploads\/public\//i.test(trimmed)) return toBrowserAbsoluteUrl(trimmed);
  return '';
}

export function publicImageUrl(value: unknown): string {
  const normalized = normalizeReusableImageSource(value);
  if (/^https?:\/\//i.test(normalized)) return normalized;
  return '';
}

export function normalizeReusableAudioSource(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const localPublicPath = localPublicUploadPath(trimmed);
  if (localPublicPath) return toBrowserAbsoluteUrl(localPublicPath);
  if (/^https?:\/\//i.test(trimmed) || /^blob:/i.test(trimmed)) return trimmed;
  if (/^\/api\/uploads\/public\//i.test(trimmed)) return toBrowserAbsoluteUrl(trimmed);
  return '';
}

export function publicAudioUrl(value: unknown): string {
  const normalized = normalizeReusableAudioSource(value);
  if (/^https?:\/\//i.test(normalized)) return normalized;
  return '';
}

export function localPublicUploadPath(value: string): string {
  if (/^\/api\/uploads\/public\//i.test(value)) return value;
  try {
    const url = new URL(value);
    if (/^(localhost|127\.0\.0\.1)$/i.test(url.hostname) && /^\/api\/uploads\/public\//i.test(url.pathname)) {
      return `${url.pathname}${url.search}`;
    }
  } catch {
    return '';
  }
  return '';
}

export function browserImageLooksReachable(value: unknown, timeoutMs = 7000): Promise<boolean> {
  const url = normalizeReusableImageSource(value);
  if (!url) return Promise.resolve(false);
  if (/^(data:image\/|blob:)/i.test(url)) return Promise.resolve(true);
  if (typeof window === 'undefined') return Promise.resolve(true);
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve(ok);
    };
    const timeout = window.setTimeout(() => finish(false), timeoutMs);
    image.onload = () => finish(Boolean(image.naturalWidth || image.naturalHeight));
    image.onerror = () => finish(false);
    image.decoding = 'async';
    image.src = url;
    if (image.complete) {
      window.setTimeout(() => finish(Boolean(image.naturalWidth || image.naturalHeight)), 0);
    }
  });
}

export function isPublicImageUrl(value: unknown): value is string {
  return Boolean(publicImageUrl(value));
}

export function normalizeCanvasImageSize(value: unknown): string {
  const raw = typeof value === 'string' ? value : '';
  if (CANVAS_IMAGE_RATIO_OPTIONS.includes(raw as (typeof CANVAS_IMAGE_RATIO_OPTIONS)[number])) return raw;
  const pixelMatch = raw.match(/^(\d{2,5})x(\d{2,5})$/i);
  if (pixelMatch) {
    const width = Number(pixelMatch[1]);
    const height = Number(pixelMatch[2]);
    if (width > 0 && height > 0) {
      const ratio = width / height;
      return CANVAS_IMAGE_RATIO_OPTIONS.reduce((best, option) => {
        const [optionWidth, optionHeight] = option.split(':').map((part) => Number(part));
        const bestParts = best.split(':').map((part) => Number(part));
        const optionDiff = Math.abs(optionWidth / optionHeight - ratio);
        const bestDiff = Math.abs(bestParts[0] / bestParts[1] - ratio);
        return optionDiff < bestDiff ? option : best;
      }, '1:1' as (typeof CANVAS_IMAGE_RATIO_OPTIONS)[number]);
    }
  }
  return '1:1';
}

export function normalizeImageResolution(value: unknown): string {
  const raw = typeof value === 'string' ? value.toLowerCase() : '';
  return ['1k', '2k', '4k'].includes(raw) ? raw : '1k';
}

export function normalizeVideoResolution(value: unknown): string {
  const raw = typeof value === 'string' ? value.toLowerCase() : '';
  return ['480p', '720p', '1080p', '2k', '4k', 'sd1080p'].includes(raw) ? raw : '720p';
}

export function normalizeVideoRatio(value: unknown): string {
  const raw = typeof value === 'string' ? value.toLowerCase() : '';
  return ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'].includes(raw) ? raw : 'adaptive';
}

export function normalizeVideoDuration(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 5;
  return Math.max(4, Math.min(15, Math.round(parsed)));
}

export function normalizeGenerationCount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(4, Math.round(parsed)));
}

export function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function preferredImageInputNodeWidth(data: any): number {
  if (data?.positioningBoardFlow === true && data?.lightweightReference === true) return POSITIONING_BOARD_REFERENCE_NODE_WIDTH;
  const ratio = positiveNumber(data?.imageAspectRatio) ?? 1;
  return ratio > 1.15 ? 340 : 260;
}

export function preferredImageInputNodeHeight(data: any): number {
  if (data?.positioningBoardFlow === true && data?.lightweightReference === true) return POSITIONING_BOARD_REFERENCE_NODE_HEIGHT;
  const ratio = Math.min(Math.max(positiveNumber(data?.imageAspectRatio) ?? 1, 0.45), 3.4);
  const width = preferredImageInputNodeWidth(data);
  return Math.round(34 + 16 + width / ratio + (data?.fileName ? 16 : 0));
}

export function isVideoCanvasNode(node: { type?: string; data?: any }): boolean {
  return node.type === 'video' || node.data?.workflowKind === 'video' || Boolean(node.data?.seedancePrompt || node.data?.videoPrompt);
}

export function hasCanvasConnection(edges: Array<{ source?: string; target?: string }>, source: string, target: string): boolean {
  return edges.some((edge) => edge.source === source && edge.target === target);
}

export function imageReferenceUrlKey(value: unknown) {
  return publicImageUrl(value).trim();
}

export function nodeStyleWidth(style: unknown): number {
  if (!style || typeof style !== 'object') return 0;
  const raw = (style as Record<string, unknown>).width;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function canvasSectionToneClasses(tone: unknown) {
  if (tone === 'sky') {
    return {
      border: 'border-sky-500/35',
      background: 'bg-sky-500/[0.045]',
      header: 'border-sky-500/20 bg-sky-500/[0.07]',
      icon: 'text-sky-300',
      badge: 'border-sky-500/25 bg-sky-500/10 text-sky-200',
    };
  }
  if (tone === 'emerald') {
    return {
      border: 'border-emerald-500/35',
      background: 'bg-emerald-500/[0.045]',
      header: 'border-emerald-500/20 bg-emerald-500/[0.07]',
      icon: 'text-emerald-300',
      badge: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200',
    };
  }
  if (tone === 'amber') {
    return {
      border: 'border-amber-500/35',
      background: 'bg-amber-500/[0.045]',
      header: 'border-amber-500/20 bg-amber-500/[0.07]',
      icon: 'text-amber-300',
      badge: 'border-amber-500/25 bg-amber-500/10 text-amber-200',
    };
  }
  return {
    border: 'border-zinc-600/70',
    background: 'bg-zinc-500/[0.04]',
    header: 'border-border/70 bg-layer-4/30',
    icon: 'text-zinc-300',
    badge: 'border-border bg-zinc-900/70 text-zinc-300',
  };
}

export function canvasSectionRelativePosition(position: { x: number; y: number }, sectionPosition: { x: number; y: number }) {
  return {
    x: position.x - sectionPosition.x,
    y: position.y - sectionPosition.y,
  };
}

export function numericCanvasSize(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function canvasNodeAbsolutePosition(
  node: { id: string; parentId?: string; position: { x: number; y: number } },
  nodeById: Map<string, { id: string; parentId?: string; position: { x: number; y: number } }>,
  seen = new Set<string>(),
): { x: number; y: number } {
  if (!node.parentId || seen.has(node.id)) return node.position;
  const parent = nodeById.get(node.parentId);
  if (!parent) return node.position;
  seen.add(node.id);
  const parentPosition = canvasNodeAbsolutePosition(parent, nodeById, seen);
  return {
    x: parentPosition.x + node.position.x,
    y: parentPosition.y + node.position.y,
  };
}

export function canvasNodeVisualSize(node: { type?: string; width?: number | null; height?: number | null; measured?: { width?: number; height?: number }; style?: Record<string, unknown> }) {
  const width =
    numericCanvasSize(node.width) ??
    numericCanvasSize(node.measured?.width) ??
    numericCanvasSize(node.style?.width) ??
    (node.type === 'video' ? 520 : node.type === 'imageInput' ? CANVAS_REFERENCE_NODE_WIDTH : node.type === 'character' || node.type === 'generation' ? 360 : node.type === 'scene' ? 280 : 260);
  const height =
    numericCanvasSize(node.height) ??
    numericCanvasSize(node.measured?.height) ??
    numericCanvasSize(node.style?.height) ??
    (node.type === 'video' ? CANVAS_VIDEO_NODE_HEIGHT : node.type === 'audio' ? 112 : node.type === 'imageInput' ? preferredImageInputNodeHeight((node as any).data) : node.type === 'character' || node.type === 'generation' ? CANVAS_SINGLE_ASSET_NODE_HEIGHT : node.type === 'scene' ? 260 : 160);
  return { width, height };
}

export function canvasNodesBoundingBox(
  nodes: Array<{ id: string; parentId?: string; position: { x: number; y: number }; type?: string; width?: number | null; height?: number | null; measured?: { width?: number; height?: number }; style?: Record<string, unknown> }>,
  allNodes = nodes,
) {
  const nodeById = new Map(allNodes.map((node) => [node.id, node]));
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    const position = canvasNodeAbsolutePosition(node, nodeById);
    const size = canvasNodeVisualSize(node);
    minX = Math.min(minX, position.x);
    minY = Math.min(minY, position.y);
    maxX = Math.max(maxX, position.x + size.width);
    maxY = Math.max(maxY, position.y + size.height);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function normalizeReactFlowCanvasNodes<T extends { id: string; type?: string; parentId?: string; position?: { x?: number; y?: number }; width?: number | null; height?: number | null; measured?: { width?: number; height?: number }; style?: Record<string, unknown>; expandParent?: boolean }>(nodes: T[]): T[] {
  if (nodes.length === 0) return nodes;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const requiredSectionSizes = new Map<string, { width: number; height: number }>();

  for (const node of nodes) {
    if (!node.parentId) continue;
    const parent = nodeById.get(node.parentId);
    if (parent?.type !== 'section') continue;
    const size = canvasNodeVisualSize(node);
    const right = Number(node.position?.x ?? 0) + size.width + CANVAS_SECTION_PADDING_X;
    const bottom = Number(node.position?.y ?? 0) + size.height + CANVAS_SECTION_PADDING_BOTTOM;
    const current = requiredSectionSizes.get(parent.id) ?? { width: 0, height: 0 };
    requiredSectionSizes.set(parent.id, {
      width: Math.max(current.width, right),
      height: Math.max(current.height, bottom),
    });
  }

  let changed = false;
  const normalized = nodes.map((node) => {
    let nextNode = node;
    if (node.parentId && node.expandParent) {
      changed = true;
      nextNode = { ...nextNode, expandParent: false };
    }
    const requiredSize = requiredSectionSizes.get(node.id);
    if (node.type === 'section' && requiredSize) {
      const currentWidth = numericCanvasSize(node.style?.width) ?? numericCanvasSize(node.width) ?? 0;
      const currentHeight = numericCanvasSize(node.style?.height) ?? numericCanvasSize(node.height) ?? 0;
      const nextWidth = Math.max(currentWidth, requiredSize.width);
      const nextHeight = Math.max(currentHeight, requiredSize.height);
      if (nextWidth !== currentWidth || nextHeight !== currentHeight) {
        changed = true;
        nextNode = {
          ...nextNode,
          style: {
            ...(nextNode.style ?? {}),
            width: nextWidth,
            height: nextHeight,
          },
        };
      }
    }
    return nextNode;
  });

  return changed ? normalized : nodes;
}

export function recalculateCanvasSectionItemCounts<T extends { id: string; type?: string; parentId?: string; data?: any }>(nodes: T[]): T[] {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    if (node.parentId) counts.set(node.parentId, (counts.get(node.parentId) ?? 0) + 1);
  }
  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (node.type !== 'section') return node;
    const itemCount = counts.get(node.id) ?? 0;
    if (node.data?.itemCount === itemCount) return node;
    changed = true;
    return {
      ...node,
      data: {
        ...node.data,
        itemCount,
      },
    };
  });
  return changed ? nextNodes : nodes;
}

export function stableCanvasValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function canvasNodeChangeSignature(node: any): string {
  return [
    node?.id,
    node?.type,
    node?.parentId || '',
    node?.extent || '',
    node?.expandParent ? '1' : '0',
    Number(node?.zIndex ?? 0),
    Number(node?.position?.x ?? 0),
    Number(node?.position?.y ?? 0),
    Number(node?.width ?? 0),
    Number(node?.height ?? 0),
    stableCanvasValue(node?.style),
    stableCanvasValue(node?.data),
  ].join('|');
}

export function canvasEdgeChangeSignature(edge: any): string {
  return [
    edge?.id,
    edge?.source,
    edge?.target,
    edge?.sourceHandle || '',
    edge?.targetHandle || '',
    edge?.type || '',
    stableCanvasValue(edge?.data),
  ].join('|');
}

export function canvasNodeListsEqual(a: any[], b: any[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (canvasNodeChangeSignature(a[index]) !== canvasNodeChangeSignature(b[index])) return false;
  }
  return true;
}

export function canvasEdgeListsEqual(a: any[], b: any[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (canvasEdgeChangeSignature(a[index]) !== canvasEdgeChangeSignature(b[index])) return false;
  }
  return true;
}

export function canvasIdListsEqual(a: string[], b: string[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

export function uniqueCanvasNodesById<T extends { id?: string }>(nodes: T[]): T[] {
  const seen = new Set<string>();
  let changed = false;
  const next: T[] = [];
  for (const node of nodes) {
    if (node.id && seen.has(node.id)) {
      changed = true;
      continue;
    }
    if (node.id) seen.add(node.id);
    next.push(node);
  }
  return changed ? next : nodes;
}

export function shouldFitViewAfterCanvasLoad(previousNodeCount: number, nextNodeCount: number): boolean {
  return previousNodeCount === 0 && nextNodeCount > 0;
}

export function canvasGraphChangeSignature(nodes: any[], edges: any[]) {
  return [
    nodes.map(canvasNodeChangeSignature).join('\n'),
    edges.map(canvasEdgeChangeSignature).join('\n'),
  ].join('\n---edges---\n');
}

export function canvasStyleValuesEqual(a: unknown, b: unknown) {
  return stableCanvasValue(a) === stableCanvasValue(b);
}

export function isTransientCanvasNodeChange(change: NodeChange) {
  if (change.type === 'select') return true;
  if (change.type === 'dimensions') return !change.setAttributes;
  if (change.type === 'position') return Boolean(change.dragging);
  return false;
}

export function isMeasurementCanvasNodeChange(change: NodeChange) {
  return change.type === 'dimensions' && !change.setAttributes && change.resizing !== false;
}

export function isAutoCanvasLayoutChange(change: NodeChange) {
  return change.type === 'dimensions' && Boolean(change.setAttributes) && change.resizing !== true;
}

export function isAutoCanvasLayoutPositionChange(change: NodeChange) {
  return change.type === 'position' && change.dragging !== true;
}

export function isAutoCanvasLayoutChangeBatch(changes: NodeChange[]) {
  const actionableChanges = changes.filter((change) => !isMeasurementCanvasNodeChange(change));
  return actionableChanges.some(isAutoCanvasLayoutChange) &&
    actionableChanges.every((change) => (
      isAutoCanvasLayoutChange(change) ||
      isAutoCanvasLayoutPositionChange(change) ||
      change.type === 'select'
    ));
}

export function isInteractiveCanvasResizeChange(change: NodeChange) {
  return change.type === 'dimensions' && change.resizing === true;
}

export function canvasNodeChangesForStore(changes: NodeChange[]): {
  durableChanges: NodeChange[];
  persist: boolean;
} {
  if (isAutoCanvasLayoutChangeBatch(changes)) {
    return { durableChanges: [], persist: false };
  }
  const durableChanges = changes.filter((change) => (
    !isMeasurementCanvasNodeChange(change) &&
    !isAutoCanvasLayoutChange(change) &&
    !isTransientCanvasNodeChange(change)
  ));
  return {
    durableChanges,
    persist: durableChanges.length > 0,
  };
}

export function collectCanvasSectionDescendantIds(nodes: Array<{ id: string; parentId?: string }>, sectionId: string): Set<string> {
  const descendants = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (!node.parentId || descendants.has(node.id)) continue;
      if (node.parentId === sectionId || descendants.has(node.parentId)) {
        descendants.add(node.id);
        changed = true;
      }
    }
  }
  return descendants;
}

export function canvasReferenceGridMetrics(count: number) {
  if (count <= 0) return { columns: 0, rows: 0, width: 0, height: 0 };
  const rows = Math.min(CANVAS_REFERENCE_ROWS_PER_COLUMN, count);
  const columns = Math.ceil(count / CANVAS_REFERENCE_ROWS_PER_COLUMN);
  return {
    columns,
    rows,
    width: columns * CANVAS_REFERENCE_NODE_WIDTH + Math.max(0, columns - 1) * CANVAS_REFERENCE_NODE_GAP_X,
    height: rows * CANVAS_REFERENCE_NODE_HEIGHT + Math.max(0, rows - 1) * CANVAS_REFERENCE_NODE_GAP_Y,
  };
}

export function canvasReferenceGridPosition(basePosition: { x: number; y: number }, index: number) {
  const column = Math.floor(index / CANVAS_REFERENCE_ROWS_PER_COLUMN);
  const row = index % CANVAS_REFERENCE_ROWS_PER_COLUMN;
  return {
    x: basePosition.x + column * (CANVAS_REFERENCE_NODE_WIDTH + CANVAS_REFERENCE_NODE_GAP_X),
    y: basePosition.y + row * (CANVAS_REFERENCE_NODE_HEIGHT + CANVAS_REFERENCE_NODE_GAP_Y),
  };
}

export function storyboardSlotImageData(clip: Clip, url: string, assetId?: string, prompt?: string) {
  return {
    label: '对应故事板',
    imageUrl: url,
    imageAspectRatio: 1.78,
    fileName: `${clip.title || 'Clip'}-storyboard.png`,
    uploadStatus: url ? 'linked' : 'waiting',
    sourcePrompt: prompt || clip.storyboardPrompt || '',
    uploadError: '',
    imageLoadError: false,
    clipId: clip.id,
    clipNodeKind: 'storyboard',
    storyboardForClip: true,
    storyboardSlotForClip: true,
    sourceClipId: clip.id,
    sourceClipTitle: clip.title,
    targetClipId: clip.id,
    assetId: assetId || '',
    clipSyncRole: 'storyboard-slot',
    clipSyncAssetId: assetId || '',
    clipSyncUrl: url,
  };
}

export function attachNodesToCanvasSection(sectionId: string, childPositions: Map<string, { x: number; y: number }>) {
  if (childPositions.size === 0) return;
  const store = useCanvasStore.getState();
  const section = store.nodes.find((node) => node.id === sectionId);
  if (!section) return;
  const nextNodes = store.nodes.map((node) => {
    const absolutePosition = childPositions.get(node.id);
    if (!absolutePosition) return node;
    return {
      ...node,
      parentId: sectionId,
      extent: 'parent' as const,
      expandParent: false,
      position: canvasSectionRelativePosition(absolutePosition, section.position),
      zIndex: Math.max(1, node.zIndex ?? 0),
    };
  });
  store.setNodes(recalculateCanvasSectionItemCounts(nextNodes));
}

export function addCanvasSection(
  addNode: (type: CanvasNodeKind, position: { x: number; y: number }, data?: Record<string, unknown>) => string,
  position: { x: number; y: number },
  size: { width: number; height: number },
  data: Record<string, unknown>,
) {
  const sectionId = addNode('section', position, data);
  const store = useCanvasStore.getState();
  store.setNodes(store.nodes.map((node) => (
    node.id === sectionId
      ? {
          ...node,
          style: {
            ...node.style,
            width: size.width,
            height: size.height,
          },
          zIndex: 0,
        }
      : node
  )));
  return sectionId;
}

export function upsertEpisodeCanvasNode(nodes: any[], node: any): any[] {
  const index = nodes.findIndex((item) => item.id === node.id);
  if (index < 0) return [...nodes, node];
  return nodes.map((item, itemIndex) => (
    itemIndex === index
      ? (() => {
          const existingOutputImage = publicImageUrl(item.data?.outputImage) || publicImageUrl(item.data?.clipSyncUrl);
          const existingOutputVideo = item.data?.outputVideo || item.data?.outputVideoAssetId;
          const preserveCompletedStatus = item.data?.status === 'completed' && Boolean(existingOutputImage || existingOutputVideo);
          const preserveCompletedVideoStatus = item.data?.videoStatus === 'completed' && Boolean(existingOutputVideo);
          return {
          ...item,
          ...node,
          data: {
            ...(item.data ?? {}),
            ...(node.data ?? {}),
            status: preserveCompletedStatus ? item.data.status : node.data?.status,
            videoStatus: preserveCompletedVideoStatus ? item.data.videoStatus : node.data?.videoStatus,
            outputImage: item.data?.outputImage || node.data?.outputImage,
            outputImageAssetId: item.data?.outputImageAssetId || node.data?.outputImageAssetId,
            outputVideo: item.data?.outputVideo || node.data?.outputVideo,
            outputVideoAssetId: item.data?.outputVideoAssetId || node.data?.outputVideoAssetId,
          },
        };
      })()
      : item
  ));
}

export function upsertEpisodeCanvasEdge(edges: any[], edge: any): any[] {
  if (edges.some((item) => item.id === edge.id || (item.source === edge.source && item.target === edge.target))) return edges;
  return [...edges, edge];
}

export function removeEpisodeCanvasChildren(nodes: any[], edges: any[], sectionId: string): { nodes: any[]; edges: any[]; removedIds: Set<string> } {
  const removeIds = collectCanvasSectionDescendantIds(nodes, sectionId);
  if (removeIds.size === 0) return { nodes, edges, removedIds: removeIds };
  return {
    nodes: nodes.filter((node) => !removeIds.has(node.id)),
    edges: edges.filter((edge) => !removeIds.has(edge.source) && !removeIds.has(edge.target)),
    removedIds: removeIds,
  };
}

export function buildEpisodeClipVideoPrompt(clip: Clip, clipScenes: BreakdownScene[], aspectRatio?: string) {
  if (clipScenes.length === 0 && clip.seedancePrompt && !isClipVideoPromptStaleForStoryboard(clip)) return clip.seedancePrompt;
  const storyboardPrompt = buildLocalClipVideoPromptFromStoryboard(clip, clipScenes, aspectRatio);
  if (clipScenes.length === 0 && storyboardPrompt) return storyboardPrompt;
  return buildLocalClipVideoPrompt(clip, clipScenes, aspectRatio) || clip.seedancePrompt || '';
}

export function isClipVideoPromptStaleForStoryboard(clip: Clip) {
  const storyboardPanelLabels = extractStoryboardPromptPanelTexts(clip.storyboardPrompt).map((panel) => panel.label);
  if (storyboardPanelLabels.length <= 0) return false;
  const videoPBeats = new Set(Array.from(String(clip.seedancePrompt || '').matchAll(/\bP(\d{1,2})\s*:/g)).map((match) => Number(match[1])));
  return storyboardPanelLabels.some((label) => !videoPBeats.has(Number(label.replace(/^P/, ''))));
}

export function buildLocalClipVideoPromptFromStoryboard(clip: Clip, clipScenes: BreakdownScene[], aspectRatio?: string) {
  const panels = extractStoryboardPromptPanelTexts(clip.storyboardPrompt);
  if (!panels.length) return '';
  const duration = Math.round(getClipEstimatedDuration(clip, clipScenes) * 10) / 10;
  return [
    `Generate one continuous ${duration}s cinematic video, ${normalizeCanvasBoardAspectRatio(aspectRatio)}.`,
    'Style: polished 3D American animated dark-comedy comic look, saturated colors, clean 3D render, exaggerated acting, fast pacing.',
    `Scene: ${clip.setting || 'current scene'}.`,
    `Characters: ${compactList(clip.characters, 'characters from this Clip', 12)}; use connected character reference images for identity.`,
    'Use the connected storyboard image as the main visual reference. Follow these storyboard panels in exact order and animate them as natural motion, not comic panels:',
    panels.map((panel) => `${panel.label}: ${compactPromptText(panel.text, 260)}`).join('\n'),
    'Do not skip, merge, or reorder the P beats. Do not add subtitles, speech bubbles, UI, panel borders, panel numbers, watermarks, or explanatory text.',
  ].filter(Boolean).join('\n');
}

export function extractStoryboardPromptPanelTexts(value: unknown): Array<{ label: string; text: string }> {
  const prompt = normalizePromptTextForParsing(value);
  if (!prompt) return [];
  const panelMarker = String.raw`(?:Panel|panel|Storyboard\s*panel|P|p|分镜|镜头|格|画面|Shot|shot)`;
  const panelPattern = new RegExp(
    String.raw`(?:^|\n)[ \t]*(?:[-*]\s*)?${panelMarker}\s*#?\s*(\d{1,2})\s*(?:[:：.\-]|[)\]]|\s+-\s+)\s*([\s\S]*?)(?=(?:^|\n)[ \t]*(?:[-*]\s*)?${panelMarker}\s*#?\s*\d{1,2}\s*(?:[:：.\-]|[)\]]|\s+-\s+)|(?:^|\n)[ \t]*(?:Make panels|Panel planning rules|Technical labels|Avoid|Negative prompt|Board style|Reference image map|Dialogue lock)\b|$)`,
    'gi',
  );
  return Array.from(prompt.matchAll(panelPattern))
    .map((match) => ({
      order: Number(match[1]),
      text: cleanStoryboardPromptPanelText(match[2] ?? ''),
    }))
    .filter((item) => Number.isFinite(item.order) && item.order > 0 && item.text)
    .sort((a, b) => a.order - b.order)
    .slice(0, MAX_CLIP_STORYBOARD_PANEL_COUNT)
    .map((item) => ({ label: `P${item.order}`, text: item.text }));
}

export function cleanStoryboardPromptPanelText(value: string) {
  return value
    .replace(/\b(?:shot size|angle|camera angle|camera movement|move|lens|focal length|action|key prop|dialogue)\s*[:=]/gi, '')
    .replace(/\b(?:image area|technical label strip|label strip)\b/gi, '')
    .replace(/\s*[|/]\s*/g, '; ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildLocalClipVideoPrompt(clip: Clip, clipScenes: BreakdownScene[], aspectRatio?: string) {
  const duration = Math.round(getClipEstimatedDuration(clip, clipScenes) * 10) / 10;
  const allocatedDialogues = allocateCanvasClipDialogues(clipScenes);
  const initialStateAndPositions = summarizeCanvasInitialCharacterStateAndPositions(clip, clipScenes);
  const beats = clipScenes.map((scene, index) => {
    const dialogue = compactPromptText(allocatedDialogues[index] || '', 180);
    const action = stripCanvasShotStyleBoilerplate(compactPromptText(scene.action || scene.description || scene.visualPrompt || fallbackCanvasBeatAction(scene, dialogue), 220));
    return `S${index + 1}: ${[
      `Shot: ${sceneCameraPlan(scene, index)}`,
      dialogue ? `Exact dialogue: ${dialogue}` : '',
      action,
    ].filter(Boolean).join('; ')}`;
  });
  return [
    `Clip video prompt for ${clip.title}.`,
    `Duration target: ${duration}s, ${normalizeCanvasBoardAspectRatio(aspectRatio)} cinematic 3D animated dark comedy style.`,
    `Characters: ${compactList(clip.characters, 'characters from this Clip', 12)}.`,
    `Setting: ${clip.setting || 'current scene'}.`,
    initialStateAndPositions ? `Initial character state and positions: ${initialStateAndPositions}` : '',
    'Global shot rules: maintain one continuous scene geography, readable screen direction, visible-subject framing, and clear foreground/midground/background separation without repeating these rules in every beat.',
    'Each S beat should contain only concrete shot design, specific blocking, visible action, exact dialogue when present, and carried-forward state only when it affects the shot.',
    compactPromptText(clip.plotGoal, 260),
    beats.length ? beats.join('\n') : compactPromptText(clip.startState || clip.endState || '', 320),
  ].filter(Boolean).join('\n');
}

function summarizeCanvasInitialCharacterStateAndPositions(clip: Clip, clipScenes: BreakdownScene[]) {
  const output: string[] = [];
  const seen = new Set<string>();
  const fallbackText = compactPromptText([clip.startState, clip.endState].filter(Boolean).join('; '), 360);
  for (const scene of clipScenes.slice(0, 3)) {
    const names = uniqueClipNames([...(scene.characters ?? []), dialogueSpeakerName(scene.dialogue || '')]).slice(0, 4);
    if (names.length === 0) continue;
    const evidence = cleanCanvasInitialStateEvidence([
      scene.composition,
      scene.references,
      scene.visualPrompt,
      scene.action,
      scene.description,
      scene.title,
    ].filter(Boolean).join('; '));
    for (const name of names) {
      const key = normalizeCompareText(name);
      if (!key || seen.has(key)) continue;
      const phrase = summarizeCanvasInitialStateForCharacter(name, evidence, fallbackText);
      if (!phrase) continue;
      output.push(phrase);
      seen.add(key);
      if (output.length >= 5) break;
    }
    if (output.length >= 5) break;
  }
  if (output.length === 0 && fallbackText) return compactPromptText(fallbackText, 360);
  return compactPromptText(output.join('; '), 520);
}

function summarizeCanvasInitialStateForCharacter(character: string, evidence: string, fallbackText: string) {
  const clauses = reduceCanvasInitialStateClauses(uniqueClipNames([
    ...canvasInitialStateClausesForCharacter(character, fallbackText),
    ...canvasInitialStateClausesForCharacter(character, evidence),
  ]).sort((a, b) => canvasInitialStateClausePriority(b) - canvasInitialStateClausePriority(a)));
  if (clauses.length === 0) return '';
  return `${character} ${uniqueClipNames(clauses).slice(0, 3).join(', ')}`;
}

function canvasInitialStateClausesForCharacter(character: string, value: string) {
  const source = cleanCanvasInitialStateEvidence(value);
  if (!source) return [];
  const name = escapeRegExp(character);
  const clauses: string[] = [];
  const carriedBedState = canvasLivingVineBedStateForCharacter(source, character);
  if (carriedBedState) clauses.push(carriedBedState);
  const localSource = canvasInitialStateLocalTextForCharacter(source, character);
  const patterns = [
    String.raw`\b${name}\b[^.;。!?]{0,90}\b(screen[- ]?(?:left|right|center)|center[- ]?(?:left|right)|foreground|midground|background|left side|right side|front row|rear|elevated|below|above|at the head|head of (?:the )?bed|bed head)\b[^.;。!?]{0,70}`,
    String.raw`\b${name}\b[^.;。!?]{0,90}\b(?:facing|faces|looks toward|turned toward|toward|面向|看向)\b[^.;。!?]{0,70}`,
    String.raw`\b${name}\b[^.;。!?]{0,100}\b(?:holding|holds|held|clutching|clutches|carrying|carries|with|手持|拿着|抱着)\b[^.;。!?]{0,70}`,
    String.raw`\b${name}\b[^.;。!?]{0,110}\b(?:bound|tied|restrained|wearing|wears|splattered|stained|injured|lowered|raised|嵌在|长在|被绑|受限|穿着|戴着|污渍|溅到)\b[^.;。!?]{0,80}`,
  ];
  for (const pattern of patterns) {
    const match = localSource.match(new RegExp(pattern, 'i'));
    if (match) clauses.push(cleanCanvasInitialStateClause(match[0].replace(new RegExp(String.raw`^\b${name}\b\s*`, 'i'), '')));
  }
  const compactSentenceWithName = localSource.match(new RegExp(String.raw`\b${name}\b[^.;。!?]{0,140}`, 'i'));
  if (clauses.length === 0 && compactSentenceWithName) {
    const fallbackClause = cleanCanvasInitialStateClause(compactSentenceWithName[0].replace(new RegExp(String.raw`^\b${name}\b\s*`, 'i'), ''));
    if (isUsefulCanvasInitialStateClause(fallbackClause)) clauses.push(fallbackClause);
  }
  return clauses.filter(Boolean);
}

function canvasInitialStateClausePriority(value: string) {
  const text = normalizeCompareText(value);
  let score = 0;
  if (/living vine hospital bed|vine bed|ritual bed|hospital bed|altar|bed/.test(text)) score += 5;
  if (/bound|restrained|strapped|tied|root restraint|vine restraint|藤蔓|根须|被绑|束缚/.test(text)) score += 4;
  if (/screen|center|left|right|foreground|background|at the head|head of/.test(text)) score += 2;
  if (/facing|toward|looks toward|面向|看向/.test(text)) score += 1;
  return score;
}

function reduceCanvasInitialStateClauses(values: string[]) {
  const cleaned = uniqueClipNames(values.map(cleanCanvasInitialStateClause).filter(Boolean))
    .filter((item) => !/^Start\s*[:：]/i.test(item))
    .filter((item) => !/^Ends?\s+with\b/i.test(item))
    .filter((item) => !/^['’]s\b/i.test(item))
    .filter((item) => !/^(?:Location|Characters|Continuity references|Character personal prop continuity|Rule)\s*[:：]/i.test(item))
    .filter((item) => !/^\s*,\s*$/.test(item));
  const bestLivingBedState = cleaned.find((item) => /Living Vine Hospital Bed.*wrist connected to needle\/tubing/i.test(item))
    ?? cleaned.find((item) => /lying on the Living Vine Hospital Bed, restrained by living vines\/root restraints/i.test(item))
    ?? cleaned.find((item) => /Living Vine Hospital Bed.*restrained by living vines\/root restraints/i.test(item));
  return cleaned.filter((item) => {
    if (bestLivingBedState && /\bhands bound with rope\b|\bbound with rope\b|\bmovement restricted\b/i.test(item)) return false;
    if (
      bestLivingBedState &&
      item !== bestLivingBedState &&
      /Living Vine Hospital Bed.*restrained by living vines\/root restraints/i.test(item)
    ) return false;
    return true;
  });
}

function canvasLivingVineBedStateForCharacter(value: string, character: string) {
  const source = compactPromptText(value || '');
  if (!source) return '';
  const name = escapeRegExp(character);
  if (!new RegExp(String.raw`\b${name}\b`, 'i').test(source)) return '';
  const hasLivingBed = /\b(?:Living Vine Hospital Bed|vine hospital bed|living vine bed|vine bed|ritual bed|hospital bed|altar)\b|藤蔓病床|藤蔓床|仪式病床|仪式床/.test(source);
  const local = canvasInitialStateLocalTextForCharacter(source, character);
  const hasVineRestraint = /\b(?:living vines?|vine restraints?|root restraints?|restrained by vines?|bound by vines?|tendrils?|fungal neck threads?|bound|restrained|strapped|tied)\b|藤蔓|根须|触须|菌丝|被绑|束缚/.test(local);
  const characterOnBed = /\b(?:lies?|lying|bound|restrained|strapped|twists?|glares?|strains?)\b/i.test(local) ||
    /\bon\s+(?:the\s+)?(?:Living Vine Hospital Bed|vine hospital bed|living vine bed|vine bed|ritual bed|hospital bed|altar)\b/i.test(local);
  if (!hasLivingBed || !hasVineRestraint || !characterOnBed) return '';
  if (/\b(?:wrist|needle|tube|tubing|injection)\b/i.test(local)) {
    return 'on the Living Vine Hospital Bed, still restrained by living vines/root restraints, wrist connected to needle/tubing';
  }
  if (/\b(?:lies?|lying|twists?|tilts?|glares?|strains?)\b/i.test(local)) {
    return 'lying on the Living Vine Hospital Bed, restrained by living vines/root restraints';
  }
  return 'on the Living Vine Hospital Bed, restrained by living vines/root restraints';
}

function canvasInitialStateLocalTextForCharacter(value: string, character: string) {
  const name = escapeRegExp(character);
  return canvasInitialStateEvidenceClauses(value)
    .map((item) => {
      const match = item.match(new RegExp(String.raw`\b${name}\b[\s\S]*`, 'i'));
      const local = match?.[0]?.trim() ?? '';
      return local.split(/(?:[;,]|[.!?])\s+(?=(?:[A-Z][A-Za-z'’.-]+\b|Location|Characters|Start|End|Continuity references|Rule)\b)/)[0]?.trim() ?? '';
    })
    .filter(Boolean)
    .join('; ');
}

function cleanCanvasInitialStateEvidence(value: string) {
  const structured = canvasInitialStateEvidenceClauses(value).join('; ');
  return compactPromptText(structured)
    .replace(/\bShot:\s*/gi, '')
    .replace(/\bState:\s*/gi, '')
    .replace(/\bPerformance:\s*[^;。!?]+[;。!?]?\s*/gi, '')
    .replace(/\bExact dialogue:\s*[^;。!?]+[;。!?]?\s*/gi, '')
    .replace(/\b(?:medium shot|close-up|wide shot|eye-level|over-shoulder|static hold|slow push-in|controlled camera move|handheld tracking|24mm|35mm|50mm|85mm)\b;?\s*/gi, '')
    .replace(/\s*;\s*;\s*/g, '; ')
    .replace(/^;\s*|\s*;$/g, '')
    .trim();
}

function canvasInitialStateEvidenceClauses(value: string) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/Character personal prop continuity\s*[:：][\s\S]*?(?=\b(?:Rule|Start|End|Location|Characters|Continuity references)\s*[:：]|$)/gi, '\n')
    .replace(/\s*\|\s*/g, '\n')
    .replace(/\b(Location|Characters|Start|End|Continuity references|Character personal prop continuity|Rule)\s*[:：]/gi, '\n$1: ')
    .split(/\n+|;\s*/)
    .map((line) => line.trim().replace(/^[-*]\s*/, ''))
    .filter(Boolean)
    .map((line) => {
      if (/^(?:Location|Characters|Character personal prop continuity|Rule)\s*[:：]/i.test(line)) return '';
      if (/^Continuity references\s*[:：]\s*/i.test(line)) return line.replace(/^Continuity references\s*[:：]\s*/i, '').trim();
      return line
        .replace(/^Start\s*[:：]\s*(?:Starts?\s+with\s*)?/i, '')
        .replace(/^End\s*[:：]\s*(?:Ends?\s+with\s*)?/i, '')
        .replace(/^Continuity\s*[:：]\s*/i, '')
        .replace(/^Starts?\s+with\s+/i, '')
        .replace(/^Ends?\s+with\s+/i, '')
        .trim();
    })
    .filter((line) => line && !/^Keep screen direction, character side, important props\b/i.test(line))
    .filter((line) => line && !/^these props belong to the listed characters\b/i.test(line));
}

function cleanCanvasInitialStateClause(value: string) {
  return compactPromptText(value || '')
    .replace(/\b(?:blocking|composition)\s*[:：]\s*/gi, '')
    .replace(/\b(?:Location|Characters|Continuity references)\s*[:：][^;。!?]*[;。!?]?\s*/gi, '')
    .replace(/\bStart\s*[:：]\s*(?:Starts?\s+with\s*)?/gi, '')
    .replace(/\bEnd\s*[:：]\s*(?:Ends?\s+with\s*)?/gi, '')
    .replace(/^(?:is|are|stands?|remains?|still|with)\s+/i, '')
    .replace(/^[,;:：\s]+/g, '')
    .replace(/\s*;\s*$/g, '')
    .trim();
}

function isUsefulCanvasInitialStateClause(value: string) {
  return /\b(?:screen[- ]?(?:left|right|center)|center[- ]?(?:left|right)?|foreground|midground|background|left side|right side|front row|rear|elevated|below|above|at the head|head of (?:the )?bed|bed head|facing|faces|looks toward|turned toward|toward|holding|holds|held|clutching|clutches|carrying|carries|with|bound|tied|restrained|wearing|wears|splattered|stained|injured|lowered|raised|lies?|lying|on the|upon|bed|altar)\b|面向|看向|手持|拿着|抱着|嵌在|长在|被绑|受限|穿着|戴着|污渍|溅到/.test(value);
}

function sceneCameraPlan(scene: BreakdownScene, index: number) {
  const text = normalizeCompareText([scene.title, scene.description, scene.action, scene.visualPrompt].join(' '));
  const actionLike = /(run|attack|fire|shoot|dodge|explode|slam|grab|fight|chase|冲|打|射|爆|躲)/.test(text);
  const closeLike = /(close|face|eyes|reaction|whisper|smirk|stare|特写|表情)/.test(text);
  const wideLike = /(enter|open|lab|room|space|crowd|screen|world|establish|全景|空间|进入)/.test(text);
  const shotSize = String(scene.shotSize || (closeLike ? 'close-up' : wideLike ? 'wide shot' : 'medium shot')).trim();
  const angle = String(scene.cameraAngle || (actionLike && index % 3 === 1 ? 'low angle' : index % 4 === 2 ? 'over-shoulder' : 'eye-level')).trim();
  const movement = String(scene.cameraMove || (actionLike ? 'handheld tracking' : wideLike ? 'slow push-in' : 'static hold')).trim();
  const composition = cleanCanvasShotBlocking(String(scene.composition || scene.references || scene.visualPrompt || '')).trim();
  const lens = String(scene.lens || (shotSize.toLowerCase().includes('wide') ? '24mm' : shotSize.toLowerCase().includes('close') ? '85mm' : '50mm')).trim();
  return [
    shotSize,
    angle,
    movement,
    lens,
    composition ? `blocking: ${composition}` : '',
  ].join('; ');
}

function cleanCanvasShotBlocking(value: string) {
  return stripCanvasShotStyleBoilerplate(compactPromptText(value || '', 180))
    .replace(/\bSet in [^;。.!?]+[;。.!?]?\s*/gi, '')
    .replace(/\bUse the current scene layout[;。.!?]?\s*/gi, '')
    .replace(/\bframe only the visible subject\(s\) for this shot[;。.!?]?\s*/gi, '')
    .replace(/\bkeep screen direction readable[;。.!?]?\s*/gi, '')
    .replace(/\bseparate foreground, midground, and background(?: for continuity)?[;。.!?]?\s*/gi, '')
    .replace(/\bclear character blocking[;。.!?]?\s*/gi, '')
    .replace(/\bcurrent scene layout[;。.!?]?\s*/gi, '')
    .replace(/\b[A-Z][A-Za-z'’.-]+(?:\s+and\s+[A-Z][A-Za-z'’.-]+)?\s+in the same established scene position[;。.!?]?\s*/gi, '')
    .replace(/\bin the same established scene position[;。.!?]?\s*/gi, '')
    .replace(/\bShow the listener's reaction, speaker's expression, and body language as the line lands\.?/gi, '')
    .replace(/\bHold the same scene geography and shift to a natural reaction or angle change\.?/gi, '')
    .replace(/\bSame setting and character blocking,?\s*natural reaction or angle change\.?/gi, '')
    .replace(/\breaction\/cutaway detail, same scene geography, same character positions\.?/gi, '')
    .replace(/\bSame dialogue turn continues over this silent reaction\/cutaway shot\.?/gi, '')
    .replace(/\s*;\s*;\s*/g, '; ')
    .replace(/^;\s*|\s*;$/g, '')
    .trim();
}

function stripCanvasShotStyleBoilerplate(value: string) {
  return compactPromptText(value || '', 220)
    .replace(/\b(?:masterpiece|best quality|highly detailed|cinematic lighting|consistent character design|polished render|saturated colors|clean 3D render)\b,?\s*/gi, '')
    .replace(/\b(?:saturated\s+)?3D\s+(?:American\s+)?(?:animated\s+)?(?:dark[- ]comedy\s+)?comic style\b,?\s*/gi, '')
    .replace(/\b(?:3D style|American comic style|dark humor|dark-comedy comic look)\b,?\s*/gi, '')
    .replace(/\b[A-Z][A-Za-z'’.-]+(?:\s+and\s+[A-Z][A-Za-z'’.-]+)?\s+in the same established scene position[;。.!?]?\s*/gi, '')
    .replace(/\bin the same established scene position[;。.!?]?\s*/gi, '')
    .replace(/^(?:[,;]\s*)+/g, '')
    .replace(/\s*;\s*;\s*/g, '; ')
    .trim();
}

function allocateCanvasClipDialogues(clipScenes: BreakdownScene[]) {
  const output = clipScenes.map(() => '');
  let pending: { index: number; speaker: string; text: string } | null = null;
  const flush = () => {
    if (!pending) return;
    output[pending.index] = [output[pending.index], `${pending.speaker ? `${pending.speaker}: ` : ''}${pending.text}`].filter(Boolean).join(' ').trim();
    pending = null;
  };

  clipScenes.forEach((scene, index) => {
    const dialogue = String(scene.dialogue || '').replace(/\s+/g, ' ').trim();
    if (!dialogue) return;
    const speaker = dialogueSpeakerName(dialogue) || (Array.isArray(scene.characters) && scene.characters.length === 1 ? String(scene.characters[0] || '') : '');
    const text = dialogue.replace(/^([A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,2}|[一-龥·]{1,12})\s*[:：]\s*/, '').trim();
    if (
      pending &&
      !/[.!?。！？…]["'”’」』)]*$/.test(pending.text) &&
      (!speaker || !pending.speaker || normalizeCompareText(speaker) === normalizeCompareText(pending.speaker))
    ) {
      pending.text = `${pending.text} ${text}`.trim();
      if (/[.!?。！？…]["'”’」』)]*$/.test(pending.text)) flush();
      return;
    }
    flush();
    pending = { index, speaker, text };
    if (/[.!?。！？…]["'”’」』)]*$/.test(text)) flush();
  });
  flush();
  return output;
}

function dialogueSpeakerName(value: string) {
  return value.trim().match(/^([A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,2}|[一-龥·]{1,12})\s*[:：]\s*/)?.[1]?.trim() || '';
}

function fallbackCanvasBeatAction(scene: BreakdownScene, dialogue: string) {
  const speaker = dialogueSpeakerName(dialogue || String(scene.dialogue || ''));
  if (speaker) return `${speaker} speaks in ${scene.setting || 'the scene'} with clear expression and readable body language.`;
  const cast = Array.isArray(scene.characters) ? scene.characters.filter(Boolean).slice(0, 3) : [];
  if (cast.length > 0) return `${cast.join(' and ')} react in ${scene.setting || 'the scene'} with clear story intent.`;
  return 'Continue the current story beat with visible character action.';
}

export function buildCanvasClipPositioningBoardPrompt(input: {
  projectName?: string;
  clip: Clip;
  shots: BreakdownScene[];
  referenceLabels: string[];
  visibleCharacterNames: string[];
  sceneLockName?: string;
  aspectRatio?: string;
  mode?: ClipPositioningBoardMode;
}) {
  if (input.mode === 'storyboard') return buildCanvasClipStoryboardBoardPrompt(input);
  const aspectRatio = normalizeCanvasBoardAspectRatio(input.aspectRatio);
  const anchor = selectCanvasPositioningAnchorShot(input.shots, input.visibleCharacterNames);
  const anchorAction = canvasPositioningSentence(anchor?.action || anchor?.description || anchor?.visualPrompt || input.clip.title || 'a readable representative moment');
  const anchorRefs = canvasPositioningSentence(anchor?.references || '');
  const speaker = dialogueSpeakerName(String(anchor?.dialogue || ''));
  const cues = compactCanvasPositioningCues(input.shots, input.visibleCharacterNames);
  const embeddedSubjectRule = canvasPositioningEmbeddedSubjectRule(input.shots, input.visibleCharacterNames);
  return [
    `Create ONE static keyframe positioning-board image for ${input.clip.title || input.clip.id || 'this clip'}.`,
    `Image type: a single ${aspectRatio} still frame used as a spatial layout reference, not a storyboard, not a video prompt, not a multi-shot sequence.`,
    `Project: ${input.projectName || 'current project'}. Style: saturated 3D American animated dark-comedy, cinematic but readable previsualization.`,
    `Scene to lock: ${input.sceneLockName || input.clip.setting || 'current scene'}. Use the connected scene reference as the spatial authority.`,
    input.referenceLabels.length ? `Connected references to preserve exactly: ${input.referenceLabels.join(', ')}.` : 'Use connected references to preserve identity and scene consistency.',
    `Visible characters for this still frame only: ${input.visibleCharacterNames.length ? input.visibleCharacterNames.join(', ') : 'only characters visible in this clip event'}.`,
    `Representative frame to depict: ${anchorAction}.`,
    anchorRefs ? `Important spatial/prop cue: ${anchorRefs}.` : '',
    embeddedSubjectRule,
    speaker ? `If ${speaker} is speaking in this chosen frame, show mouth shape, expression, and gesture only; do not draw dialogue text.` : '',
    input.clip.startState ? `Continuity entering this clip: ${canvasPositioningSentence(input.clip.startState)}.` : '',
    input.clip.endState ? `Continuity target after this clip: ${canvasPositioningSentence(input.clip.endState)}.` : '',
    cues.length ? `Additional layout cues for this one still frame:\n- ${cues.join('\n- ')}` : '',
    'Clearly show approximate screen-left/screen-right/center positions, facing directions, body posture, facial emotion, held items, worn items, restraints, and key props for visible subjects.',
    'Keep the background as one coherent space with readable floor depth and fixed landmarks; show enough environment to locate characters in the scene.',
    'Do not render every beat. Collapse the clip context into one representative frozen frame. No motion trails, no panels, no subtitles, no labels, no UI, no watermarks, no random text.',
    'Do not redesign characters, scene architecture, props, clothing, helmets, held items, or visible restraints. Keep visible states consistent with connected references and continuity notes.',
  ].filter(Boolean).join('\n');
}

export function buildCanvasClipStoryboardBoardPrompt(input: {
  projectName?: string;
  clip: Clip;
  shots: BreakdownScene[];
  referenceLabels: string[];
  visibleCharacterNames: string[];
  sceneLockName?: string;
  aspectRatio?: string;
}) {
  const aspectRatio = normalizeCanvasBoardAspectRatio(input.aspectRatio);
  const isPortrait = canvasBoardAspectRatioIsPortrait(aspectRatio);
  const shots = input.shots.length > 0 ? input.shots : [{
    id: 'S1',
    title: input.clip.title || 'Clip beat',
    description: input.clip.summary || input.clip.title || 'representative clip action',
    action: input.clip.summary || input.clip.title || 'representative clip action',
    setting: input.clip.setting,
    characters: input.clip.characters,
  } as BreakdownScene];
  const panelCount = Math.max(1, Math.min(12, shots.length));
  const grid = isPortrait ? portraitCanvasStoryboardGrid(panelCount) : storyboardGridForPanelCount(panelCount);
  const panelLines = shots.slice(0, panelCount).map((shot, index) => {
    const label = shot.id || `S${index + 1}`;
    const camera = [
      shot.shotSize ? `shot size ${shot.shotSize}` : '',
      shot.cameraAngle ? `angle ${shot.cameraAngle}` : '',
      shot.cameraMove ? `camera movement ${shot.cameraMove}` : '',
      shot.composition ? `composition ${shot.composition}` : '',
      shot.lens ? `lens ${shot.lens}` : '',
    ].filter(Boolean).join('; ');
    const action = canvasPositioningSentence([shot.action, shot.description, shot.visualPrompt].filter(Boolean).join(' '));
    const dialogue = canvasPositioningSentence(shot.dialogue || '');
    const references = canvasPositioningSentence(shot.references || '');
    const visible = Array.isArray(shot.characters) && shot.characters.length ? `Visible: ${shot.characters.join(', ')}.` : '';
    return [
      `Panel ${index + 1} (${label}):`,
      camera ? `camera: ${camera}.` : '',
      visible,
      action ? `visible action/blocking: ${action}.` : '',
      dialogue ? `dialogue moment to act, without drawing subtitles/text: ${dialogue}.` : '',
      references ? `spatial/prop cue: ${references}.` : '',
    ].filter(Boolean).join(' ');
  });
  const embeddedSubjectRule = canvasPositioningEmbeddedSubjectRule(input.shots, input.visibleCharacterNames);
  return [
    `Create a ${grid} comic storyboard board for ${input.clip.title || input.clip.id || 'this clip'}, matching the clip video prompt shots S1, S2, S3... in exact order.`,
    `Image type: one ${aspectRatio} storyboard sheet, multiple panels in a clean grid. Each panel is a still frame for one shot, not a single positioning still and not a video.`,
    isPortrait
      ? `Grid rule: use a uniform square grid (${grid}) with thin black gutters so that every panel cell is itself a ${aspectRatio} vertical frame, the same aspect ratio as the final video. Compose each panel as a standalone vertical video frame, never as a wide or square crop. If the shots do not fill the square grid, leave the unused trailing cells as solid black empty cells with no drawing and no label.`
      : '',
    'Panel numbering is mandatory: draw a small readable label in the upper-left corner of each panel, exactly S1, S2, S3... matching the shot order. No other text, captions, speech bubbles, subtitles, UI, watermark, or random labels.',
    `Project: ${input.projectName || 'current project'}. Style: saturated 3D American animated dark-comedy storyboard/previsualization, cinematic but readable.`,
    `Scene continuity lock: ${input.sceneLockName || input.clip.setting || 'current scene'}. Keep the same scene geography across all panels unless the shot explicitly changes location.`,
    input.referenceLabels.length ? `Connected references to preserve exactly: ${input.referenceLabels.join(', ')}.` : 'Use connected references to preserve identity and scene consistency.',
    `Visible clip characters: ${input.visibleCharacterNames.length ? input.visibleCharacterNames.join(', ') : 'only characters visible in this clip event'}.`,
    input.clip.startState ? `Continuity entering this clip: ${canvasPositioningSentence(input.clip.startState)}.` : '',
    input.clip.endState ? `Continuity target after this clip: ${canvasPositioningSentence(input.clip.endState)}.` : '',
    embeddedSubjectRule,
    'For every panel, preserve character identity, costume, held items, worn items, restraints, prop state, screen direction, and emotional performance. Use connected scene and asset references as visual authority.',
    'Each panel should show the shot-specific camera plan through composition: shot size, angle, camera movement feeling, foreground/midground/background, and readable blocking. Do not repeat generic rules as visible text.',
    `Storyboard panels:\n${panelLines.join('\n')}`,
    'Do not redesign characters, scene architecture, props, clothing, helmets, held items, or visible restraints. Keep all visible states consistent with connected references and continuity notes.',
  ].filter(Boolean).join('\n');
}

function storyboardGridForPanelCount(count: number) {
  if (count <= 1) return '1-panel';
  if (count <= 2) return '1x2';
  if (count <= 4) return '2x2';
  if (count <= 6) return '2x3';
  if (count <= 9) return '3x3';
  return '3x4';
}

export function normalizeCanvasBoardAspectRatio(value?: string) {
  return /^\d+:\d+$/.test(String(value || '').trim()) ? String(value).trim() : '16:9';
}

export function canvasBoardAspectRatioIsPortrait(aspectRatio: string) {
  const [w, h] = aspectRatio.split(':').map(Number);
  return Number.isFinite(w) && Number.isFinite(h) && h > w;
}

// 竖屏故事板使用正方形宫格：整图 9:16 时每个 NxN 格子本身也是 9:16。
function portraitCanvasStoryboardGrid(count: number) {
  if (count <= 1) return '1x1';
  if (count <= 4) return '2x2';
  if (count <= 9) return '3x3';
  return '4x4';
}

function canvasPositioningEmbeddedSubjectRule(shots: BreakdownScene[], names: string[]) {
  const text = [names.join(', '), ...shots.flatMap((shot) => [shot.action, shot.description, shot.references, shot.visualPrompt])].join('\n');
  if (!/(embedded|fused|protruding|grown into|growing out of|rooted in|vine wall|vine barricade|living wall|嵌入|嵌在|融合|长在|从.*长出|藤蔓墙|活墙)/i.test(text)) return '';
  const embeddedNames = names.filter((name) => canvasPositioningNameIsEmbeddedSubject(name, text));
  const subject = embeddedNames.length ? embeddedNames.join(', ') : 'any fused or embedded character';
  return `Embedded-character spatial rule: ${subject} must be organically embedded in and growing from the vine wall itself, with plant fibers/vines/root tissue integrated into the body and wall. Do not show them tied, strapped, chained, pinned, taped, or merely bound onto the wall surface.`;
}

function canvasPositioningNameIsEmbeddedSubject(name: string, text: string) {
  const escaped = escapeRegExp(name);
  const embeddedBeforeName = new RegExp(`\\b(?:embedded|fused|protruding|rooted|partly embedded|partially embedded|grown into|growing out of)\\b(?:\\s+\\w+){0,5}\\s+${escaped}\\b`, 'i');
  const nameBeforeEmbedded = new RegExp(`\\b${escaped}\\b\\s+(?:is|are|appears|appearing|remains|stays|protrudes|protruding|embedded|fused|rooted|grown|growing)\\b[^.。!?\\n]{0,80}\\b(?:embedded|fused|protruding|rooted|grown into|growing out of|in vines|into the vine wall|from the vine wall)\\b`, 'i');
  const directFusedState = new RegExp(`\\b${escaped}\\b\\s+(?:is\\s+|are\\s+|appears\\s+|appearing\\s+|remains\\s+|stays\\s+)?(?:embedded|fused|rooted|protruding|grown into|growing out of)\\b`, 'i');
  return embeddedBeforeName.test(text) || nameBeforeEmbedded.test(text) || directFusedState.test(text);
}

function selectCanvasPositioningAnchorShot(shots: BreakdownScene[], names: string[]): BreakdownScene | undefined {
  return shots
    .map((shot, index) => ({ shot, score: canvasPositioningShotScore(shot, names, index, shots.length) }))
    .sort((a, b) => b.score - a.score)[0]?.shot;
}

function canvasPositioningShotScore(shot: BreakdownScene, names: string[], index: number, total: number): number {
  const text = [shot.action, shot.description, shot.visualPrompt, shot.references, shot.dialogue].filter(Boolean).join(' ');
  let score = 0;
  for (const name of names) if (name && text.toLowerCase().includes(name.toLowerCase())) score += 20;
  if (/\b(left|right|center|foreground|midground|background|screen|facing|holds?|wears?|bound|restrained|corner|speaker|table)\b/i.test(text)) score += 30;
  if (shot.dialogue) score += 8;
  score += total > 1 ? (1 - Math.abs(index / Math.max(1, total - 1) - 0.45)) * 10 : 10;
  return score;
}

function compactCanvasPositioningCues(shots: BreakdownScene[], names: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const shot of shots) {
    const cue = canvasPositioningSentence([shot.action, shot.references].filter(Boolean).join(' '));
    if (!cue) continue;
    const hasName = names.some((name) => name && cue.toLowerCase().includes(name.toLowerCase()));
    const hasSpatial = /\b(left|right|center|foreground|midground|background|screen|facing|holds?|wears?|bound|restrained|corner|speaker|table)\b/i.test(cue);
    if (!hasName && !hasSpatial) continue;
    const compact = cue.length > 180 ? `${cue.slice(0, 177).trim()}...` : cue;
    const key = compact.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(compact);
    if (output.length >= 5) break;
  }
  return output;
}

function canvasPositioningSentence(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\bShow the listener's reaction, speaker's expression, and body language as the line lands\.?/gi, '')
    .replace(/\bHold the same scene geography and shift to a natural reaction or angle change\.?/gi, '')
    .replace(/\bSame setting and character blocking, natural reaction or angle change\.?/gi, '')
    .replace(/\bSame setting and character blocking,?\s*natural reaction or angle change\.?/gi, '')
    .replace(/\breaction\/cutaway detail, same scene geography, same character positions\.?/gi, '')
    .replace(/\bSame dialogue turn continues over this silent reaction\/cutaway shot\.?/gi, '')
    .replace(/\bReaction beat\.?/gi, '')
    .replace(/[。.!?;,，；：:]+$/g, '')
    .trim();
}

export function syncEpisodeClipBoardsToCanvas(options: EpisodeCanvasSyncOptions): EpisodeCanvasSyncResult {
  const store = useCanvasStore.getState();
  const episodeKey = stableCanvasIdPart(options.episodeId || options.episode, 'episode');
  const clips = options.clips.filter((clip) => clip.id);
  const useMultiReferenceStrategy = isSeedanceMultiReferenceStrategy(options.generationStrategy);
  const projectAspectRatio = normalizeCanvasBoardAspectRatio(options.aspectRatio);
  const nextClips = clips.map((clip) => ({ ...clip }));
  let nextNodes: any[] = store.nodes;
  let nextEdges: any[] = store.edges;
  let storyboardCount = 0;
  let videoCount = 0;
  const blockedStoryboardUrls = options.blockedStoryboardUrls ?? new Set<string>();
  const removedIds = new Set<string>();

  nextClips.forEach((clip, index) => {
    const clipScenes = getClipScenes(clip, options.scenes);
    const clipKey = stableCanvasIdPart(clip.id || clip.title, `clip-${index + 1}`);
    const sectionId = `episode-sync-${episodeKey}-${clipKey}`;
    const storyNodeId = `episode-sync-storyboard-${episodeKey}-${clipKey}`;
    const videoNodeId = `episode-sync-video-node-${episodeKey}-${clipKey}`;
    const positioningSectionId = `clip-position-board-${options.episodeId}-${clipKey}`;
    const positioningNodeId = `clip-position-board-gen-${options.episodeId}-${clipKey}`;
    const oldChildren = collectCanvasSectionDescendantIds(nextNodes, sectionId);
    const oldBySignature = new Map<string, any>();
    for (const childId of oldChildren) {
      const child = nextNodes.find((node) => node.id === childId);
      if (!child) continue;
      if (child.data?.clipSyncRole) oldBySignature.set(String(child.data.clipSyncRole), child);
      if (child.data?.clipSyncAssetId) oldBySignature.set(`asset:${child.data.clipSyncAssetId}`, child);
      if (child.data?.clipSyncUrl) oldBySignature.set(`url:${child.data.clipSyncUrl}`, child);
    }
    const videoSectionId = `episode-sync-video-${episodeKey}-${clipKey}`;
    const oldVideoChildren = collectCanvasSectionDescendantIds(nextNodes, videoSectionId);
    for (const childId of oldVideoChildren) {
      const child = nextNodes.find((node) => node.id === childId);
      if (!child) continue;
      if (child.data?.clipSyncRole) oldBySignature.set(String(child.data.clipSyncRole), child);
      if (child.data?.clipSyncAssetId) oldBySignature.set(`asset:${child.data.clipSyncAssetId}`, child);
      if (child.data?.clipSyncUrl) oldBySignature.set(`url:${child.data.clipSyncUrl}`, child);
    }
    const oldPositioningData = nextNodes.find((node) => node.id === positioningNodeId || (
      node.type === 'generation' &&
      node.data?.positioningBoardFlow === true &&
      node.data?.clipId === clip.id &&
      (!node.data?.sourceEpisodeId || node.data.sourceEpisodeId === options.episodeId)
    ))?.data ?? {};
    const oldPositioningOutputImages = Array.isArray(oldPositioningData.outputImages) ? oldPositioningData.outputImages : [];
    const oldPositioningChildIds = collectCanvasSectionDescendantIds(nextNodes, positioningSectionId);
    const cleanedPositioning = removeEpisodeCanvasChildren(nextNodes, nextEdges, positioningSectionId);
    nextNodes = cleanedPositioning.nodes.filter((node) => node.id !== positioningSectionId);
    const positioningRemoveIds = new Set([...cleanedPositioning.removedIds, positioningSectionId]);
    nextEdges = cleanedPositioning.edges.filter((edge) => !positioningRemoveIds.has(edge.source) && !positioningRemoveIds.has(edge.target));
    oldPositioningChildIds.forEach((id) => {
      if (id !== positioningNodeId) removedIds.add(id);
    });
    const cleaned = removeEpisodeCanvasChildren(nextNodes, nextEdges, sectionId);
    nextNodes = cleaned.nodes;
    nextEdges = cleaned.edges;
    cleaned.removedIds.forEach((id) => removedIds.add(id));
    const cleanedVideo = removeEpisodeCanvasChildren(nextNodes, nextEdges, videoSectionId);
    nextNodes = cleanedVideo.nodes;
    nextEdges = cleanedVideo.edges;
    cleanedVideo.removedIds.forEach((id) => removedIds.add(id));

    const previousClip = index > 0 ? nextClips[index - 1] : undefined;
    const previousClipKey = previousClip ? stableCanvasIdPart(previousClip.id || previousClip.title, `clip-${index}`) : '';
    const previousStoryNodeId = previousClip ? `episode-sync-storyboard-${episodeKey}-${previousClipKey}` : '';
    const exactStoryboardRef = useMultiReferenceStrategy ? undefined : findExactClipStoryboardReference(options.storyboardAssetRefs ?? [], clip, blockedStoryboardUrls);
    const finalizedStoryboard = useMultiReferenceStrategy ? null : buildFinalClipStoryboardPromptForCanvas({
      clip,
      clips: nextClips,
      scenes: options.scenes,
      assets: options.assets,
      nodes: nextNodes,
      storyboardAssetRefs: options.storyboardAssetRefs,
      blockedStoryboardUrls,
    });
    if (finalizedStoryboard) {
      clip.storyboardPrompt = finalizedStoryboard.prompt;
      clip.seedancePrompt = clip.seedancePrompt && !isClipVideoPromptStaleForStoryboard(clip) ? clip.seedancePrompt : '';
    }
    nextClips[index] = clip;
    const previousStoryboardRef = finalizedStoryboard?.previousStoryboardRef ?? null;
    const storyboardReferences = finalizedStoryboard?.references ?? [];
    const storyboardPromptWithReferenceMap = finalizedStoryboard?.prompt ?? '';
    const videoPrompt = buildEpisodeClipVideoPrompt(clip, clipScenes, projectAspectRatio);
    const positioningBoardImageUrl = publicImageUrl(oldPositioningData.outputImage) || oldPositioningOutputImages.map((item: unknown) => publicImageUrl(item)).find(Boolean) || '';
    const positioningBoardReference: ClipImageReference | null = useMultiReferenceStrategy && positioningBoardImageUrl
      ? {
          kind: 'positioning-board',
          name: oldPositioningData.title || 'Clip positioning board',
          label: '定位板参考: Clip spatial layout',
          url: positioningBoardImageUrl,
          assetId: oldPositioningData.outputImageAssetId || '',
          nodeId: positioningNodeId,
          targetClipId: clip.id,
        }
      : null;
    const positioningAuthorityLine = 'Use the connected positioning board as the spatial layout authority for this clip: preserve character screen positions, facing directions, visible states, and scene geography from that single frame.';
    const promptWithPositioningAuthority = positioningBoardReference && !normalizeCompareText(videoPrompt).includes('connected positioning board as the spatial layout authority')
      ? [
          positioningAuthorityLine,
          videoPrompt,
        ].join('\n')
      : videoPrompt;
    const assetReferenceLimit = useMultiReferenceStrategy
      ? Math.max(0, MAX_VIDEO_REFERENCE_IMAGES - (positioningBoardReference ? 1 : 0))
      : MAX_VIDEO_REFERENCE_IMAGES;
    const videoAssetReferences = collectClipAssetReferences(clip, clipScenes, options.assets, assetReferenceLimit, promptWithPositioningAuthority, {
      includeProps: useMultiReferenceStrategy,
      includeScenes: useMultiReferenceStrategy,
      allScenes: options.scenes,
      includeStoryboardPrompt: false,
      includeMissing: useMultiReferenceStrategy,
    });
    const storyboardSlotNodeId = `episode-sync-video-storyboard-slot-${episodeKey}-${clipKey}`;
    const videoReferencesWithCurrentStoryboard: ClipImageReference[] = [
      ...(positioningBoardReference ? [positioningBoardReference] : []),
      ...videoAssetReferences,
    ].slice(0, Math.max(0, useMultiReferenceStrategy ? MAX_VIDEO_REFERENCE_IMAGES : MAX_VIDEO_REFERENCE_IMAGES - 1));
    const storyboardGrid = canvasReferenceGridMetrics(storyboardReferences.length);
    const videoNewReferenceCount = videoReferencesWithCurrentStoryboard.length + (useMultiReferenceStrategy ? 0 : 1);
    const videoGrid = canvasReferenceGridMetrics(videoNewReferenceCount);
    const storyboardAreaWidth = storyboardReferences.length ? storyboardGrid.width + CANVAS_TARGET_SECTION_GAP : 0;
    const videoAreaWidth = videoNewReferenceCount ? videoGrid.width + CANVAS_TARGET_SECTION_GAP : 0;
    const storyboardWidth = CANVAS_SECTION_PADDING_X * 2 + storyboardAreaWidth + 380;
    const videoWidth = CANVAS_SECTION_PADDING_X * 2 + videoAreaWidth + 540;
    const storyboardHeight = CANVAS_SECTION_HEADER_HEIGHT + Math.max(storyboardGrid.height, CANVAS_GENERATION_NODE_HEIGHT) + CANVAS_SECTION_PADDING_BOTTOM;
    const videoHeight = CANVAS_SECTION_HEADER_HEIGHT + Math.max(videoGrid.height, CANVAS_VIDEO_NODE_HEIGHT) + CANVAS_SECTION_PADDING_BOTTOM;
    const sectionPosition = {
      x: EPISODE_CANVAS_SYNC_START_X,
      y: EPISODE_CANVAS_SYNC_START_Y + index * EPISODE_CANVAS_SYNC_ROW_STRIDE,
    };
    const videoSectionPosition = {
      x: useMultiReferenceStrategy ? sectionPosition.x : sectionPosition.x + storyboardWidth + EPISODE_CANVAS_SYNC_COLUMN_GAP,
      y: sectionPosition.y,
    };
    const positioningSectionPosition = {
      x: videoSectionPosition.x - POSITIONING_BOARD_SECTION_WIDTH - EPISODE_CANVAS_SYNC_COLUMN_GAP,
      y: videoSectionPosition.y,
    };
    const storyboardBase = {
      x: sectionPosition.x + CANVAS_SECTION_PADDING_X,
      y: sectionPosition.y + CANVAS_SECTION_HEADER_HEIGHT,
    };
    const storyboardNodePosition = {
      x: storyboardBase.x + storyboardAreaWidth,
      y: storyboardBase.y,
    };
    const videoBase = {
      x: videoSectionPosition.x + CANVAS_SECTION_PADDING_X,
      y: videoSectionPosition.y + CANVAS_SECTION_HEADER_HEIGHT,
    };
    const videoNodePosition = {
      x: videoBase.x + videoAreaWidth,
      y: videoBase.y,
    };
    const oldStoryboardData = oldBySignature.get('storyboard')?.data ?? {};
    const oldStoryboardSlotData = oldBySignature.get('storyboard-slot')?.data ?? {};
    const preserveOldStoryboardOutput = canPreserveExistingClipStoryboardOutput(oldStoryboardData, clip, options.episodeId, options.episode);
    const recoveredStoryboardUrl = exactStoryboardRef?.url || (preserveOldStoryboardOutput ? publicImageUrl(oldStoryboardData.outputImage) : '');
    const recoveredStoryboardAssetId = exactStoryboardRef?.assetId || (preserveOldStoryboardOutput ? oldStoryboardData.outputImageAssetId : '') || '';
    const recoveredStoryboardSlotUrl = recoveredStoryboardUrl;
    const recoveredStoryboardSlotAssetId = recoveredStoryboardAssetId;
    const storyReferenceCount = storyboardReferences.length + (previousStoryboardRef?.nodeId && !previousStoryboardRef.url ? 1 : 0);
    const persistedVideoReferenceUrls = [
      useMultiReferenceStrategy ? '' : recoveredStoryboardSlotUrl,
      ...videoReferencesWithCurrentStoryboard.map((reference) => publicImageUrl(reference.url)),
    ].filter(Boolean).slice(0, MAX_VIDEO_REFERENCE_IMAGES);

    if (useMultiReferenceStrategy) {
      const positioningReferences = collectClipPositioningBoardReferences(clip, clipScenes, options.assets, 12, {
        includeMissing: true,
      });
      const positioningRows = Math.ceil(positioningReferences.length / POSITIONING_BOARD_REFERENCE_COLUMNS);
      const positioningSectionHeight = Math.max(
        360,
        CANVAS_SECTION_HEADER_HEIGHT +
          Math.max(
            CANVAS_GENERATION_NODE_HEIGHT,
            positioningRows * POSITIONING_BOARD_REFERENCE_NODE_HEIGHT + Math.max(0, positioningRows - 1) * POSITIONING_BOARD_REFERENCE_NODE_GAP_Y,
          ) +
          CANVAS_SECTION_PADDING_BOTTOM,
      );
      const positioningReferenceLabels = positioningReferences.map((reference) => reference.name || reference.label).filter(Boolean);
      const positioningSceneLockName = positioningReferences.find((reference) => reference.kind === 'scenes')?.name;
      const visibleCharacterNames = positioningReferences
        .filter((reference) => reference.kind === 'characters')
        .map((reference) => reference.name)
        .filter(Boolean);
      const boardMode: ClipPositioningBoardMode = 'storyboard';
      const positioningPrompt = buildCanvasClipPositioningBoardPrompt({
        projectName: '',
        clip,
        shots: clipScenes,
        referenceLabels: positioningReferenceLabels,
        visibleCharacterNames,
        sceneLockName: positioningSceneLockName,
        mode: 'positioning',
        aspectRatio: projectAspectRatio,
      });
      const storyboardPrompt = buildCanvasClipPositioningBoardPrompt({
        projectName: '',
        clip,
        shots: clipScenes,
        referenceLabels: positioningReferenceLabels,
        visibleCharacterNames,
        sceneLockName: positioningSceneLockName,
        mode: 'storyboard',
        aspectRatio: projectAspectRatio,
      });
      const activeBoardPrompt = boardMode === 'storyboard' ? storyboardPrompt : positioningPrompt;
      const positioningOutputImage = publicImageUrl(oldPositioningData.outputImage);
      const hasPositioningOutput = Boolean(positioningOutputImage || oldPositioningOutputImages.some((item: unknown) => publicImageUrl(item)));
      nextNodes = upsertEpisodeCanvasNode(nextNodes, {
        id: positioningSectionId,
        type: 'section',
        position: positioningSectionPosition,
        style: { width: POSITIONING_BOARD_SECTION_WIDTH, height: positioningSectionHeight },
        zIndex: 0,
        data: {
          title: `${clip.title || `Clip ${index + 1}`} · 故事板/定位板图片流程`,
          description: '默认为本 Clip 生成对应视频镜头的宫格故事板；可在节点内切换为单帧空间定位板。',
          tone: 'emerald',
          itemCount: positioningReferences.length + 1,
          clipId: clip.id,
          sourceEpisode: options.episode,
          sourceEpisodeId: options.episodeId,
          sectionKind: 'clip-positioning-board',
          positioningBoardFlow: true,
          positioningBoardMode: boardMode,
          episodeCanvasSync: true,
          clipOrder: index + 1,
        },
      });
      nextNodes = upsertEpisodeCanvasNode(nextNodes, {
        id: positioningNodeId,
        type: 'generation',
        parentId: positioningSectionId,
        extent: 'parent',
        expandParent: false,
        position: { x: POSITIONING_BOARD_GENERATION_NODE_X, y: CANVAS_SECTION_HEADER_HEIGHT },
        style: { width: POSITIONING_BOARD_GENERATION_NODE_WIDTH },
        zIndex: 1,
        data: {
          mode: 'standalone',
          title: `${clip.title || clip.id} 故事板`,
          description: `生成本 Clip 对应视频镜头的宫格故事板，已接入 ${positioningReferences.length} 张参考图。`,
          prompt: activeBoardPrompt,
          finalPrompt: activeBoardPrompt,
          positioningPrompt,
          storyboardPrompt,
          manualFinalPrompt: true,
          status: hasPositioningOutput ? 'completed' : oldPositioningData.status || 'waiting',
          error: hasPositioningOutput ? oldPositioningData.error || '' : '',
          outputImage: oldPositioningData.outputImage || '',
          outputImageAssetId: oldPositioningData.outputImageAssetId || '',
          outputImages: oldPositioningOutputImages,
          generationStartedAt: oldPositioningData.generationStartedAt || '',
          size: projectAspectRatio,
          resolution: options.imageResolution || '2k',
          quality: 'high',
          format: 'png',
          modelId: options.imageModelId || undefined,
          projectPromptContext: options.projectPromptContext,
          clipId: clip.id,
          clipTitle: clip.title,
          clipNodeKind: 'positioning-board',
          sourceEpisode: options.episode,
          sourceEpisodeId: options.episodeId,
          positioningBoardFlow: true,
          positioningBoardMode: boardMode,
          lightweightGeneration: true,
          episodeCanvasSync: true,
        },
      });
      positioningReferences.forEach((reference, refIndex) => {
        const refNodeId = `clip-position-board-ref-${options.episodeId}-${clipKey}-${stableCanvasIdPart(reference.kind, 'asset')}-${stableCanvasIdPart(reference.assetId || reference.name || refIndex, `ref-${refIndex}`)}`;
        const column = refIndex % POSITIONING_BOARD_REFERENCE_COLUMNS;
        const row = Math.floor(refIndex / POSITIONING_BOARD_REFERENCE_COLUMNS);
        nextNodes = upsertEpisodeCanvasNode(nextNodes, {
          id: refNodeId,
          type: 'imageInput',
          parentId: positioningSectionId,
          extent: 'parent',
          expandParent: false,
          position: {
            x: CANVAS_SECTION_PADDING_X + column * (POSITIONING_BOARD_REFERENCE_NODE_WIDTH + POSITIONING_BOARD_REFERENCE_NODE_GAP_X),
            y: CANVAS_SECTION_HEADER_HEIGHT + row * (POSITIONING_BOARD_REFERENCE_NODE_HEIGHT + POSITIONING_BOARD_REFERENCE_NODE_GAP_Y),
          },
          style: { width: POSITIONING_BOARD_REFERENCE_NODE_WIDTH },
          zIndex: 1,
          data: {
            label: `${reference.kind === 'scenes' ? '场景' : reference.kind === 'props' ? '道具' : '角色'} · ${reference.name || reference.label}`,
            imageUrl: publicImageUrl(reference.url),
            imageAspectRatio: reference.kind === 'scenes' ? 1.78 : 1.45,
            fileName: `${reference.name || reference.kind}.png`,
            uploadStatus: publicImageUrl(reference.url) ? 'linked' : 'missing',
            sourcePrompt: `${reference.label}，用于 ${clip.title || 'Clip'} 定位板空间参考`,
            uploadError: publicImageUrl(reference.url) ? '' : '该资产还没有参考图，请上传或生成后再生成定位板。',
            imageLoadError: false,
            assetKind: reference.kind,
            assetName: reference.name,
            assetId: reference.assetId || '',
            sourceClipId: clip.id,
            targetClipId: clip.id,
            sourceEpisode: options.episode,
            sourceEpisodeId: options.episodeId,
            positioningBoardFlow: true,
            lightweightReference: true,
            episodeCanvasSync: true,
            clipSyncRole: `positioning-ref:${reference.kind}:${reference.assetId || normalizeCompareText(reference.name)}`,
            clipSyncAssetId: reference.assetId || '',
            clipSyncUrl: publicImageUrl(reference.url),
          },
        });
        nextEdges = upsertEpisodeCanvasEdge(nextEdges, {
          id: canvasAutoEdgeId('clip-position-board-ref', refNodeId, positioningNodeId),
          source: refNodeId,
          sourceHandle: null,
          target: positioningNodeId,
          targetHandle: null,
          type: 'smoothstep',
        });
      });
      nextEdges = upsertEpisodeCanvasEdge(nextEdges, {
        id: canvasAutoEdgeId('clip-position-board-video', positioningNodeId, videoNodeId),
        source: positioningNodeId,
        sourceHandle: null,
        target: videoNodeId,
        targetHandle: null,
        type: 'smoothstep',
      });
    }

    if (!useMultiReferenceStrategy) {
      nextNodes = upsertEpisodeCanvasNode(nextNodes, {
      id: sectionId,
      type: 'section',
      position: sectionPosition,
      style: { width: storyboardWidth, height: storyboardHeight },
      zIndex: 0,
      data: {
        title: `${clip.title || `Clip ${index + 1}`} · 图片分镜故事板`,
        description: '当前集自动同步的故事板生图任务，等待手动点击生成。',
        tone: 'amber',
        itemCount: storyboardReferences.length + 1,
        clipId: clip.id,
        sourceEpisode: options.episode,
        sourceEpisodeId: options.episodeId,
        sectionKind: 'clip-storyboard-assets',
        episodeCanvasSync: true,
        clipOrder: index + 1,
      },
    });
      nextNodes = upsertEpisodeCanvasNode(nextNodes, {
      id: storyNodeId,
      type: 'generation',
      parentId: sectionId,
      extent: 'parent',
      expandParent: false,
      position: canvasSectionRelativePosition(storyboardNodePosition, sectionPosition),
      style: { width: 360 },
      zIndex: 1,
      data: {
        ...(oldBySignature.get('storyboard')?.data ?? {}),
        mode: 'standalone',
        title: `${clip.title || 'Clip'} 故事板`,
        description: storyReferenceCount
          ? `Clip 级导演故事板生图节点，已接入 ${storyReferenceCount} 张参考图${previousStoryboardRef ? '，含上一个故事板' : ''}`
          : 'Clip 级导演故事板生图节点，当前没有匹配到可用资产参考图',
        prompt: storyboardPromptWithReferenceMap,
        finalPrompt: storyboardPromptWithReferenceMap,
        manualFinalPrompt: true,
        status: recoveredStoryboardUrl ? 'completed' : 'waiting',
        outputImage: recoveredStoryboardUrl || '',
        outputImageAssetId: recoveredStoryboardAssetId,
        submittedPrompt: exactStoryboardRef?.prompt || oldStoryboardData.submittedPrompt || '',
        error: recoveredStoryboardUrl ? '已关联本 Clip 的故事板生成记录。' : '',
        generationStartedAt: '',
        size: projectAspectRatio,
        resolution: options.imageResolution || '2k',
        quality: 'high',
        format: 'png',
        modelId: options.imageModelId || undefined,
        projectPromptContext: options.projectPromptContext,
        clipId: clip.id,
        clipTitle: clip.title,
        clipNodeKind: 'storyboard',
        storyboardForClip: true,
        previousStoryboardAssetId: previousStoryboardRef?.assetId || previousStoryboardRef?.nodeId || previousStoryNodeId || '',
        sourceEpisode: options.episode,
        sourceEpisodeId: options.episodeId,
        episodeCanvasSync: true,
        clipSyncRole: 'storyboard',
        clipSyncUrl: recoveredStoryboardUrl || '',
      },
    });
      storyboardCount += 1;
      const hasPreviousStoryboardReferenceNode = storyboardReferences.some((reference) => reference.kind === 'storyboard' && publicImageUrl(reference.url));
      const previousStoryboardSourceNodeId = previousStoryboardRef?.nodeId || previousStoryNodeId;
      if (!hasPreviousStoryboardReferenceNode && previousStoryboardSourceNodeId && nextNodes.some((node) => node.id === previousStoryboardSourceNodeId)) {
        nextEdges = upsertEpisodeCanvasEdge(nextEdges, {
          id: canvasAutoEdgeId('episode-storyboard-prev', previousStoryboardSourceNodeId, storyNodeId),
          source: previousStoryboardSourceNodeId,
          sourceHandle: null,
          target: storyNodeId,
          targetHandle: null,
        });
      }

      storyboardReferences.forEach((reference, refIndex) => {
      const url = publicImageUrl(reference.url);
      if (!url) return;
      const signature = reference.kind === 'storyboard'
        ? `previous:${reference.sourceClipId || reference.assetId || url}`
        : `asset:${reference.assetId || `${reference.kind}:${normalizeCompareText(reference.name)}`}`;
      const nodeId = `episode-sync-story-ref-${episodeKey}-${clipKey}-${stableCanvasIdPart(signature, `ref-${refIndex}`)}`;
      const referencePosition = canvasReferenceGridPosition(storyboardBase, refIndex);
      nextNodes = upsertEpisodeCanvasNode(nextNodes, {
        id: nodeId,
        type: 'imageInput',
        parentId: sectionId,
        extent: 'parent',
        expandParent: false,
        position: canvasSectionRelativePosition(referencePosition, sectionPosition),
        style: { width: reference.kind === 'storyboard' ? 340 : 260, height: preferredImageInputNodeHeight({ imageAspectRatio: reference.kind === 'storyboard' ? 1.78 : 1.45, fileName: `${reference.name}.png` }) },
        zIndex: 1,
        data: {
          label: reference.label,
          imageUrl: url,
          imageAspectRatio: reference.kind === 'storyboard' ? 1.78 : 1.45,
          fileName: `${reference.name}.png`,
          uploadStatus: 'linked',
          sourcePrompt: reference.kind === 'storyboard'
            ? `上一个故事板，用于延续 ${clip.title || 'Clip'} 的场景和角色位置`
            : `${reference.label}，用于 ${clip.title || 'Clip'} 故事板连续性参考`,
          uploadError: '',
          imageLoadError: false,
          ...(reference.kind === 'storyboard'
            ? {
                clipNodeKind: 'storyboard-reference',
                storyboardForClip: false,
                sourceClipId: reference.sourceClipId || '',
                sourceClipTitle: reference.sourceClipTitle || '',
                targetClipId: reference.targetClipId || clip.id,
              }
            : { assetKind: reference.kind, assetName: reference.name }),
          assetId: reference.assetId || '',
          sourceEpisode: options.episode,
          sourceEpisodeId: options.episodeId,
          episodeCanvasSync: true,
          clipSyncRole: signature,
          clipSyncAssetId: reference.assetId || '',
          clipSyncUrl: url,
        },
      });
      nextEdges = upsertEpisodeCanvasEdge(nextEdges, {
        id: canvasAutoEdgeId('episode-storyboard-ref', nodeId, storyNodeId),
        source: nodeId,
        sourceHandle: null,
        target: storyNodeId,
        targetHandle: null,
      });
      });
    }

    nextNodes = upsertEpisodeCanvasNode(nextNodes, {
      id: videoSectionId,
      type: 'section',
      position: videoSectionPosition,
      style: { width: videoWidth, height: videoHeight },
      zIndex: 0,
      data: {
        title: `${clip.title || `Clip ${index + 1}`} · 视频板`,
        description: useMultiReferenceStrategy
          ? 'Seedance 多参视频任务，资产占位会先接入视频节点，缺图后续上传或生成即可。'
          : '当前集自动同步的视频生成任务，等待手动点击生成。',
        tone: 'sky',
        itemCount: videoNewReferenceCount + 1,
        clipId: clip.id,
        sourceEpisode: options.episode,
        sourceEpisodeId: options.episodeId,
        sectionKind: 'clip-video-assets',
        episodeCanvasSync: true,
        clipOrder: index + 1,
      },
    });
    nextNodes = upsertEpisodeCanvasNode(nextNodes, {
      id: videoNodeId,
      type: 'video',
      parentId: videoSectionId,
      extent: 'parent',
      expandParent: false,
      position: canvasSectionRelativePosition(videoNodePosition, videoSectionPosition),
      style: { width: 520 },
      zIndex: 1,
      data: {
        ...(oldBySignature.get('video')?.data ?? {}),
        kind: 'video',
        workflowKind: 'video',
        title: `${clip.title || 'Clip'} 视频任务`,
        description: useMultiReferenceStrategy
          ? `Seedance 多参视频提示词已就绪，已接入 ${videoReferencesWithCurrentStoryboard.length} 个资产参考节点`
          : `Seedance 视频提示词已就绪，已强制接入对应故事板坑位和 ${videoReferencesWithCurrentStoryboard.length} 张资产参考`,
        scope: '分镜视频',
        statusLabel: '待生成视频',
        prompt: promptWithPositioningAuthority,
        seedancePrompt: promptWithPositioningAuthority,
        videoPrompt: promptWithPositioningAuthority,
        videoStatus: oldBySignature.get('video')?.data?.videoStatus === 'completed' ? 'completed' : 'waiting',
        status: oldBySignature.get('video')?.data?.status === 'completed' ? 'completed' : 'waiting',
        clipId: clip.id,
        duration: getClipEstimatedDuration(clip, clipScenes),
        durationSeconds: normalizeVideoDuration(getClipEstimatedDuration(clip, clipScenes)),
        resolution: oldBySignature.get('video')?.data?.resolution || '720p',
        includeAudio: oldBySignature.get('video')?.data?.includeAudio ?? true,
        ratio: oldBySignature.get('video')?.data?.ratio || 'adaptive',
        count: oldBySignature.get('video')?.data?.count || 1,
        videoParametersCollapsed: true,
        referenceCount: videoNewReferenceCount,
        generationStrategy: useMultiReferenceStrategy ? SEEDANCE_MULTI_REF_STRATEGY : options.generationStrategy || '',
        storyboardImageUrl: useMultiReferenceStrategy ? '' : recoveredStoryboardSlotUrl || '',
        referenceImageUrls: persistedVideoReferenceUrls,
        videoError: '',
        sourceEpisode: options.episode,
        sourceEpisodeId: options.episodeId,
        episodeCanvasSync: true,
        clipSyncRole: 'video',
      },
    });
    videoCount += 1;

    if (!useMultiReferenceStrategy) {
      const storyboardSlotPosition = canvasReferenceGridPosition(videoBase, 0);
      nextNodes = upsertEpisodeCanvasNode(nextNodes, {
        id: storyboardSlotNodeId,
        type: 'imageInput',
        parentId: videoSectionId,
        extent: 'parent',
        expandParent: false,
        position: canvasSectionRelativePosition(storyboardSlotPosition, videoSectionPosition),
        style: { width: 340, height: preferredImageInputNodeHeight({ imageAspectRatio: 1.78, fileName: `${clip.title || 'Clip'}-storyboard.png` }) },
        zIndex: 1,
        data: {
          ...storyboardSlotImageData(clip, recoveredStoryboardSlotUrl, recoveredStoryboardSlotAssetId, exactStoryboardRef?.prompt),
          sourceEpisode: options.episode,
          sourceEpisodeId: options.episodeId,
          episodeCanvasSync: true,
        },
      });
      nextEdges = upsertEpisodeCanvasEdge(nextEdges, {
        id: canvasAutoEdgeId('episode-video-storyboard-slot-in', storyNodeId, storyboardSlotNodeId),
        source: storyNodeId,
        sourceHandle: null,
        target: storyboardSlotNodeId,
        targetHandle: null,
      });
      nextEdges = upsertEpisodeCanvasEdge(nextEdges, {
        id: canvasAutoEdgeId('episode-video-ref', storyboardSlotNodeId, videoNodeId),
        source: storyboardSlotNodeId,
        sourceHandle: null,
        target: videoNodeId,
        targetHandle: null,
      });
      nextEdges = upsertEpisodeCanvasEdge(nextEdges, {
        id: canvasAutoEdgeId('episode-video-ref', storyNodeId, videoNodeId),
        source: storyNodeId,
        sourceHandle: null,
        target: videoNodeId,
        targetHandle: null,
      });
    }

    let createdVideoReferenceIndex = useMultiReferenceStrategy ? 0 : 1;
    videoReferencesWithCurrentStoryboard.forEach((reference, refIndex) => {
      const url = publicImageUrl(reference.url);
      const isStoryboardReference = reference.kind === 'storyboard';
      const isPositioningBoardReference = reference.kind === 'positioning-board';
      const signature = isStoryboardReference
        ? `storyboard:${reference.assetId || url}`
        : isPositioningBoardReference
          ? `positioning-board:${reference.assetId || reference.nodeId || url}`
        : `asset:${reference.assetId || `${reference.kind}:${normalizeCompareText(reference.name)}`}`;
      const nodeId = `episode-sync-video-ref-${episodeKey}-${clipKey}-${stableCanvasIdPart(signature, `ref-${refIndex}`)}`;
      const referencePosition = canvasReferenceGridPosition(videoBase, createdVideoReferenceIndex);
      createdVideoReferenceIndex += 1;
      nextNodes = upsertEpisodeCanvasNode(nextNodes, {
        id: nodeId,
        type: 'imageInput',
        parentId: videoSectionId,
        extent: 'parent',
        expandParent: false,
        position: canvasSectionRelativePosition(referencePosition, videoSectionPosition),
        style: { width: (isStoryboardReference || isPositioningBoardReference) ? 340 : 260, height: preferredImageInputNodeHeight({ imageAspectRatio: (isStoryboardReference || isPositioningBoardReference) ? 1.78 : 1.45, fileName: `${reference.name}.png` }) },
        zIndex: 1,
        data: {
          label: reference.label,
          imageUrl: url,
          imageAspectRatio: (isStoryboardReference || isPositioningBoardReference) ? 1.78 : 1.45,
          fileName: `${reference.name}.png`,
          uploadStatus: url ? 'linked' : 'missing',
          sourcePrompt: isPositioningBoardReference
            ? 'Positioning board: use as spatial layout authority for this clip video.'
            : isStoryboardReference
            ? `${reference.label}，用于 ${clip.title || 'Clip'} 视频首帧/连续性参考`
            : `${reference.label}，用于 ${clip.title || 'Clip'} 视频连续性参考`,
          uploadError: url ? '' : '该资产还没有参考图，请上传或生成后再生成视频。',
          imageLoadError: false,
          ...(isPositioningBoardReference
            ? {
                clipId: clip.id,
                clipNodeKind: 'positioning-board-reference',
                positioningBoardForClip: true,
                spatialAuthority: true,
                targetClipId: clip.id,
                sourceNodeId: reference.nodeId || '',
                assetKind: 'positioning-board',
                assetName: reference.name,
              }
            : isStoryboardReference
              ? { clipId: clip.id, clipNodeKind: 'storyboard', storyboardForClip: true }
              : { assetKind: reference.kind, assetName: reference.name }),
          assetId: reference.assetId || '',
          sourceEpisode: options.episode,
          sourceEpisodeId: options.episodeId,
          episodeCanvasSync: true,
          clipSyncRole: signature,
          clipSyncAssetId: reference.assetId || '',
          clipSyncUrl: url,
        },
      });
      nextEdges = upsertEpisodeCanvasEdge(nextEdges, {
        id: canvasAutoEdgeId('episode-video-ref', nodeId, videoNodeId),
        source: nodeId,
        sourceHandle: null,
        target: videoNodeId,
        targetHandle: null,
      });
    });
  });

  const positioningLayout = applyPositioningBoardLayout(nextNodes, nextEdges);
  positioningLayout.removedIds.forEach((id) => removedIds.add(id));
  nextNodes = recalculateCanvasSectionItemCounts(positioningLayout.nodes);
  nextEdges = positioningLayout.edges;
  return { nodes: nextNodes, edges: nextEdges, storyboardCount, videoCount, removedIds, clips: nextClips };
}

/**
 * Single source of truth (frontend) for positioning-board / storyboard section layout.
 * Mirrors the backend `applyPositioningBoardLayout`: de-duplicates reference image nodes
 * and lays the kept references on a grid sized to their real 340px footprint, with the
 * generation node to the right and the section right-aligned a fixed gutter left of its
 * video board, so sections never overlap each other or the video boards.
 */
const POSITIONING_BOARD_LAYOUT = {
  paddingX: 12,
  header: 42,
  paddingBottom: 8,
  refWidth: 340,
  refRowHeight: 300,
  refGapX: 16,
  refGapY: 10,
  rowsTarget: 3,
  minColumns: 3,
  maxColumns: 6,
  genWidth: 420,
  genHeight: 560,
  targetGap: 24,
  sectionGap: 36,
};

export function applyPositioningBoardLayout(
  nodes: any[],
  edges: any[],
): { nodes: any[]; edges: any[]; removedIds: string[] } {
  const L = POSITIONING_BOARD_LAYOUT;
  const sections = nodes.filter((node) => node?.type === 'section' && node?.data?.positioningBoardFlow === true);
  if (!sections.length) return { nodes, edges, removedIds: [] };

  const num = (value: unknown, fallback = 0): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const norm = (value: unknown): string => String(value ?? '').trim().toLowerCase();
  const kindOrder = (kind: string): number => (kind === 'characters' ? 0 : kind === 'scenes' ? 1 : kind === 'props' ? 2 : 3);
  const hasImage = (node: any): boolean => Boolean(norm(node?.data?.imageUrl)) || norm(node?.data?.uploadStatus) === 'linked';

  const removed = new Set<string>();
  const updates = new Map<string, any>();
  const patch = (node: any): any => {
    let clone = updates.get(node.id);
    if (!clone) {
      clone = { ...node, position: { ...(node.position || {}) }, style: { ...(node.style || {}) }, data: { ...(node.data || {}) } };
      updates.set(node.id, clone);
    }
    return clone;
  };

  const videoSectionFor = (section: any): any => {
    const clipId = String(section?.data?.clipId || '');
    if (!clipId) return null;
    const episodeId = String(section?.data?.sourceEpisodeId || '');
    return nodes.find((node) => node?.type === 'section' && node?.data?.sectionKind === 'clip-video-assets' && String(node?.data?.clipId || '') === clipId && (!episodeId || String(node?.data?.sourceEpisodeId || '') === episodeId))
      ?? nodes.find((node) => node?.type === 'section' && node?.data?.sectionKind === 'clip-video-assets' && String(node?.data?.clipId || '') === clipId)
      ?? null;
  };

  for (const section of sections) {
    const children = nodes.filter((node) => node?.parentId === section.id);
    const refs = children.filter((node) => node?.type === 'imageInput');
    const generations = children.filter((node) => node?.type === 'generation');

    const byKey = new Map<string, any>();
    const kept: any[] = [];
    for (const ref of refs) {
      const key = `${norm(ref?.data?.assetKind)}|${norm(ref?.data?.assetId) || norm(ref?.data?.assetName ?? ref?.data?.label)}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, ref);
        kept.push(ref);
      } else if (!hasImage(existing) && hasImage(ref)) {
        const index = kept.indexOf(existing);
        if (index >= 0) kept[index] = ref;
        byKey.set(key, ref);
        removed.add(existing.id);
      } else {
        removed.add(ref.id);
      }
    }

    const orderedRefs = kept
      .filter((node) => !removed.has(node.id))
      .sort((a, b) => {
        const ka = kindOrder(norm(a?.data?.assetKind));
        const kb = kindOrder(norm(b?.data?.assetKind));
        if (ka !== kb) return ka - kb;
        return norm(a?.data?.assetName).localeCompare(norm(b?.data?.assetName));
      });

    const count = orderedRefs.length;
    const columns = Math.min(L.maxColumns, Math.max(L.minColumns, Math.ceil(count / L.rowsTarget) || L.minColumns));
    orderedRefs.forEach((ref, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const clone = patch(ref);
      clone.position = { x: L.paddingX + col * (L.refWidth + L.refGapX), y: L.header + row * (L.refRowHeight + L.refGapY) };
      clone.style = { ...(clone.style || {}), width: L.refWidth };
      delete clone.style.height;
      delete clone.width;
      delete clone.height;
      delete clone.measured;
      clone.extent = 'parent';
      clone.expandParent = false;
      clone.zIndex = 1;
    });

    const rows = Math.max(1, Math.ceil(count / columns));
    const refsRight = count > 0 ? L.paddingX + columns * L.refWidth + Math.max(0, columns - 1) * L.refGapX : L.paddingX;
    const refsBottom = count > 0 ? L.header + rows * L.refRowHeight + Math.max(0, rows - 1) * L.refGapY : L.header;

    const genX = refsRight + L.targetGap;
    generations.forEach((gen, index) => {
      const clone = patch(gen);
      clone.position = { x: genX, y: L.header + index * (L.genHeight + L.refGapY) };
      clone.style = { ...(clone.style || {}), width: L.genWidth };
      clone.extent = 'parent';
      clone.expandParent = false;
      clone.zIndex = 1;
    });
    const genBottom = generations.length ? L.header + generations.length * L.genHeight + Math.max(0, generations.length - 1) * L.refGapY : L.header;
    const genRight = generations.length ? genX + L.genWidth : refsRight;

    const sectionWidth = Math.max(genRight, refsRight) + L.paddingX;
    const sectionHeight = Math.max(360, Math.max(refsBottom, genBottom) + L.paddingBottom);

    const video = videoSectionFor(section);
    const nextX = video ? num(video.position?.x) - sectionWidth - L.sectionGap : num(section.position?.x);
    const nextY = video ? num(video.position?.y, num(section.position?.y)) : num(section.position?.y);
    const sectionClone = patch(section);
    sectionClone.position = { x: nextX, y: nextY };
    sectionClone.style = { ...(sectionClone.style || {}), width: sectionWidth, height: sectionHeight };
    sectionClone.data = { ...(sectionClone.data || {}), itemCount: count + generations.length };
  }

  if (updates.size === 0 && removed.size === 0) return { nodes, edges, removedIds: [] };
  const nextNodes = nodes.filter((node) => !removed.has(node.id)).map((node) => updates.get(node.id) ?? node);
  const nextEdges = edges.filter((edge) => !removed.has(String(edge.source)) && !removed.has(String(edge.target)));
  return { nodes: nextNodes, edges: nextEdges, removedIds: [...removed] };
}

export function clipCanvasSectionTitle(clip: Clip, suffix: string) {
  return `${clip.title || 'Clip'} · ${suffix}`;
}

export type CanvasNodeProps = {
  id: string;
  data: any;
  selected?: boolean;
  width?: number;
  height?: number;
};

export type ConnectionStartSnapshot = {
  nodeId: string;
  handleId: string | null;
  handleType: 'source' | 'target';
};

export type ConnectionCreateMenu = ConnectionStartSnapshot & {
  x: number;
  y: number;
  flowX: number;
  flowY: number;
};

export type ConnectionCreateOption = {
  key: string;
  type: CanvasNodeKind;
  label: string;
  desc: string;
  icon: React.ElementType;
  tone: string;
  data?: Record<string, unknown>;
};

export const CONNECTION_CREATE_MENU_WIDTH = 300;
export const CONNECTION_CREATE_MENU_HEIGHT = 390;
export const CONNECTION_CREATE_MENU_MARGIN = 12;

export function clientPointFromConnectionEvent(event: MouseEvent | TouchEvent): { x: number; y: number } | null {
  if ('changedTouches' in event && event.changedTouches.length > 0) {
    return { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY };
  }
  if ('clientX' in event) {
    return { x: event.clientX, y: event.clientY };
  }
  return null;
}

export function clampConnectionMenuPoint(point: { x: number; y: number }): { x: number; y: number } {
  if (typeof window === 'undefined') return point;
  return {
    x: Math.max(
      CONNECTION_CREATE_MENU_MARGIN,
      Math.min(point.x, window.innerWidth - CONNECTION_CREATE_MENU_WIDTH - CONNECTION_CREATE_MENU_MARGIN),
    ),
    y: Math.max(
      CONNECTION_CREATE_MENU_MARGIN,
      Math.min(point.y, window.innerHeight - CONNECTION_CREATE_MENU_HEIGHT - CONNECTION_CREATE_MENU_MARGIN),
    ),
  };
}

export function CanvasNodeResizer({
  selected,
  minWidth,
  minHeight,
}: {
  selected?: boolean;
  minWidth: number;
  minHeight: number;
}) {
  return (
    <NodeResizer
      isVisible={Boolean(selected)}
      minWidth={minWidth}
      minHeight={minHeight}
      color="#F5A623"
      lineStyle={{ borderWidth: 1 }}
      handleStyle={{
        width: 10,
        height: 10,
        borderRadius: 3,
        border: '1px solid #F7C24E',
        background: '#09090b',
      }}
    />
  );
}

export function CanvasHandle({
  type,
  position,
  tone = 'default',
  style,
}: {
  type: 'target' | 'source';
  position: Position;
  tone?: 'default' | 'sky' | 'primary' | 'emerald';
  style?: React.CSSProperties;
}) {
  const borderClass =
    tone === 'sky' ? '!border-[#F5A623] hover:!bg-[#F5A623]' : tone === 'primary' ? 'border-primary hover:!bg-primary' : tone === 'emerald' ? 'border-emerald-500 hover:!bg-emerald-500' : 'border-zinc-500 hover:!bg-zinc-500';
  return (
    <Handle
      type={type}
      position={position}
      className={cn(
        "!h-5 !w-5 rounded-full border-2 !bg-zinc-900 shadow-[0_0_0_5px_rgba(9,9,11,0.72)] transition-colors",
        borderClass,
        position === Position.Left ? "!left-[-10px]" : "!right-[-10px]",
      )}
      style={style}
    />
  );
}

export async function uploadCanvasReferenceFile(projectId: string, file: File): Promise<string> {
  const key = safeCanvasUploadKey(projectId, file.name);
  const local = await apiClient.uploadLocalFile({
    key,
    file,
    contentType: file.type || 'image/png',
  });
  return local.publicUrl;
}

export function isImageDropFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name);
}

export function getImageFileAspectRatio(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : null);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    image.src = objectUrl;
  });
}

export const CANVAS_IMAGE_DRAG_TYPE = 'application/x-loohii-image-url';
export const CANVAS_IMAGE_DRAG_TOKEN_TYPE = 'application/x-loohii-image-token';
export const CANVAS_IMAGE_DRAG_PAYLOAD_TYPE = 'application/x-loohii-image-payload';

export const videoResolutionOptions = ['720p'];
export const videoDurationOptions = Array.from({ length: 12 }, (_, index) => index + 4);
export const videoRatioOptions: Array<{ value: string; label: string }> = [
  { value: 'adaptive', label: '自适应' },
  { value: '16:9', label: '16:9' },
  { value: '4:3', label: '4:3' },
  { value: '1:1', label: '1:1' },
  { value: '3:4', label: '3:4' },
  { value: '9:16', label: '9:16' },
  { value: '21:9', label: '21:9' },
];

export type CanvasImageDragPayload = {
  url: string;
  label?: string;
  fileName?: string;
  nodeType?: 'imageInput' | 'generation';
  assetKind?: WorkflowAssetKind;
  assetName?: string;
  assetId?: string;
  generationId?: string;
  prompt?: string;
  revisedPrompt?: string;
  source?: string;
  size?: string;
  resolution?: string;
  quality?: string;
  modelLabel?: string;
};

export const canvasImageDragRegistry = new Map<string, CanvasImageDragPayload>();

export function isReusableImageSource(value: string): boolean {
  return Boolean(normalizeReusableImageSource(value));
}

export function dataTransferHasImage(dataTransfer: DataTransfer): boolean {
  const files = Array.from(dataTransfer.files ?? []);
  if (files.some(isImageDropFile)) return true;
  const types = Array.from(dataTransfer.types ?? []);
  return types.includes('Files') || types.includes(CANVAS_IMAGE_DRAG_TOKEN_TYPE) || types.includes(CANVAS_IMAGE_DRAG_PAYLOAD_TYPE) || types.includes(CANVAS_IMAGE_DRAG_TYPE) || types.includes('text/uri-list') || types.includes('text/plain') || types.includes('text/html');
}

export function normalizeCanvasImageDragPayload(value: Partial<CanvasImageDragPayload> & { url?: string }): CanvasImageDragPayload | null {
  const url = normalizeReusableImageSource(value.url ?? '');
  if (!url) return null;
  return {
    ...value,
    url,
    assetKind: normalizeWorkflowAssetKind(value.assetKind) ?? undefined,
  };
}

export function extractDroppedImagePayload(dataTransfer: DataTransfer): CanvasImageDragPayload | null {
  const internalToken = dataTransfer.getData(CANVAS_IMAGE_DRAG_TOKEN_TYPE).trim();
  const tokenPayload = internalToken ? canvasImageDragRegistry.get(internalToken) : undefined;
  const reusableTokenPayload = tokenPayload ? normalizeCanvasImageDragPayload(tokenPayload) : null;
  if (reusableTokenPayload) {
    canvasImageDragRegistry.delete(internalToken);
    return reusableTokenPayload;
  }

  const payloadText = dataTransfer.getData(CANVAS_IMAGE_DRAG_PAYLOAD_TYPE);
  if (payloadText) {
    try {
      const payload = normalizeCanvasImageDragPayload(JSON.parse(payloadText));
      if (payload) return payload;
    } catch {
      // Ignore malformed drag payloads and fall back to URL-only extraction.
    }
  }

  const internalUrl = normalizeReusableImageSource(dataTransfer.getData(CANVAS_IMAGE_DRAG_TYPE));
  if (internalUrl) return { url: internalUrl };

  const candidates = [
    dataTransfer.getData('text/uri-list'),
    dataTransfer.getData('text/plain'),
  ]
    .flatMap((value) => value.split(/\r?\n/))
    .map((value) => value.trim())
    .filter(Boolean);

  const html = dataTransfer.getData('text/html');
  const htmlSrc = html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
  if (htmlSrc) candidates.unshift(htmlSrc.trim());

  for (const candidate of candidates) {
    const reusable = normalizeReusableImageSource(candidate);
    if (reusable) return { url: reusable };
  }
  return null;
}

export function extractDroppedImageUrl(dataTransfer: DataTransfer): string {
  return extractDroppedImagePayload(dataTransfer)?.url ?? '';
}

export function imageLabelFromUrl(url: string): string {
  if (/^data:image\//i.test(url)) return '本地上传图';
  if (/^blob:/i.test(url)) return '临时图片';
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.split('/').filter(Boolean).pop();
    return name ? decodeURIComponent(name).slice(0, 80) : '图片输入';
  } catch {
    return '图片输入';
  }
}

export function setImageDragData(dataTransfer: DataTransfer, imageUrl: string, payload: Partial<CanvasImageDragPayload> = {}) {
  const reusableImageUrl = normalizeReusableImageSource(imageUrl) || imageUrl.trim();
  const publicUrl = publicImageUrl(reusableImageUrl);
  const dragPayload = normalizeCanvasImageDragPayload({ ...payload, url: reusableImageUrl }) ?? { ...payload, url: reusableImageUrl };
  dataTransfer.effectAllowed = 'copy';
  const token = `image-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  canvasImageDragRegistry.set(token, dragPayload);
  dataTransfer.setData(CANVAS_IMAGE_DRAG_TOKEN_TYPE, token);
  dataTransfer.setData(CANVAS_IMAGE_DRAG_PAYLOAD_TYPE, JSON.stringify(dragPayload));
  if (publicUrl) {
    dataTransfer.setData(CANVAS_IMAGE_DRAG_TYPE, publicUrl);
    dataTransfer.setData('text/uri-list', publicUrl);
    dataTransfer.setData('text/plain', publicUrl);
  } else {
    dataTransfer.setData('text/plain', imageLabelFromUrl(reusableImageUrl));
  }
}

export type CanvasProjectPromptContext = {
  title?: string;
  description?: string;
  globalPrompt?: string;
  negativePrompt?: string;
  characterIdentityRules?: string;
  setupSettings?: Record<string, unknown>;
};

export function compactProjectPromptContext(project: any): CanvasProjectPromptContext {
  const setupSettings = project?.setupSettings && typeof project.setupSettings === 'object' ? project.setupSettings as Record<string, unknown> : undefined;
  return {
    title: typeof project?.title === 'string' ? project.title : '',
    description: typeof project?.description === 'string' ? project.description : '',
    globalPrompt: typeof project?.globalPrompt === 'string' ? project.globalPrompt : '',
    negativePrompt: typeof project?.negativePrompt === 'string' ? project.negativePrompt : '',
    characterIdentityRules:
      typeof setupSettings?.characterIdentityRules === 'string'
        ? setupSettings.characterIdentityRules
        : firstPromptLine(typeof project?.globalPrompt === 'string' ? project.globalPrompt : '', 'Character identity rules:'),
    setupSettings,
  };
}

export function firstPromptLine(value: string, label: string): string {
  const line = value.split('\n').find((item) => item.trim().startsWith(label));
  return line?.slice(label.length).trim() || '';
}

export function projectRequiresFruitCharacters(context: CanvasProjectPromptContext, data?: any): boolean {
  const fruitIdentity = String(data?.fruitIdentity || '').trim();
  if (fruitIdentity) return true;
  const text = [
    context.characterIdentityRules,
    context.globalPrompt,
    typeof context.setupSettings?.globalPrompt === 'string' ? context.setupSettings.globalPrompt : '',
  ].filter(Boolean).join('\n').toLowerCase();
  const mentionsFruit = /(fruit|水果|banana|apple|orange|lemon|grape|strawberry|pineapple|peach|pear|mango|kiwi|watermelon|香蕉|苹果|橙|柠檬|葡萄|草莓|菠萝|水蜜桃|桃|梨|芒果|猕猴桃|西瓜)/i.test(text);
  const universal = /(all|every|each|characters must|must have|所有|全部|每个|全员|必须|拟人化水果)/i.test(text);
  return mentionsFruit && universal;
}

export function concreteFruitIdentityFromText(value: string): string {
  const text = value.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/(chloe|peach|水蜜桃|桃)/i, 'peach'],
    [/(leo|lemon|柠檬)/i, 'lemon'],
    [/(bob|orange|soldier|gas mask|橙|橙子|士兵|防毒面具)/i, 'orange'],
    [/(tiffany|beauty|glam|ceo|boss|美妆|老板|反派)/i, 'dragon fruit'],
    [/(eugene|timid|scared|nervous|害怕|胆小|紧张)/i, 'pear'],
    [/(scientist|lab|实验|科学)/i, 'kiwi'],
    [/(guard|security|保安|守卫)/i, 'pineapple'],
    [/(strawberry|草莓)/i, 'strawberry'],
    [/(banana|香蕉)/i, 'banana'],
    [/(watermelon|西瓜)/i, 'watermelon'],
    [/(mango|芒果)/i, 'mango'],
    [/(apple|苹果)/i, 'apple'],
    [/(grape|葡萄)/i, 'grape cluster'],
    [/(pear|梨)/i, 'pear'],
    [/(pineapple|菠萝)/i, 'pineapple'],
    [/(kiwi|猕猴桃)/i, 'kiwi'],
  ];
  return rules.find(([pattern]) => pattern.test(text))?.[1] || '';
}

export function isGroupAssetText(value: string): boolean {
  return /(zombies?|undead|corpse|crowd|group|mob|victims?|background|extras?|群像|背景|群众|人群|一群|丧尸|僵尸|亡灵|受害者)/i.test(value);
}

export function isMixedRandomFruitIdentity(value: string): boolean {
  return /mixed random fruit crowd/i.test(value);
}

export function fallbackFruitIdentity(name: string): string {
  const choices = ['apple', 'orange', 'lemon', 'pear', 'peach', 'grape cluster', 'pineapple', 'mango', 'kiwi', 'strawberry', 'watermelon'];
  const seed = Array.from(name || 'character').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return choices[seed % choices.length];
}

export function effectiveFruitIdentityForAsset(data: any, mustUseFruitIdentity: boolean): string {
  const explicit = String(data?.fruitIdentity || '').trim();
  if (explicit) return explicit;
  if (!mustUseFruitIdentity) return '';
  const text = [
    data?.name,
    data?.assetName,
    data?.role,
    data?.description,
    data?.visualPrompt,
    data?.traits,
    data?.lockedVisualIdentity,
  ].filter(Boolean).join('\n');
  if (isGroupAssetText(text)) return 'mixed random fruit crowd';
  return concreteFruitIdentityFromText(text) || fallbackFruitIdentity(String(data?.name || data?.assetName || 'character'));
}

export function promptHasConcreteFruit(value: string, expectedFruitIdentity = ''): boolean {
  const text = value.toLowerCase();
  if (expectedFruitIdentity && text.includes(expectedFruitIdentity.toLowerCase())) return true;
  return /(banana|apple|orange|lemon|grape|strawberry|pineapple|peach|pear|mango|kiwi|watermelon|dragon fruit|橙子|橙|柠檬|葡萄|草莓|菠萝|水蜜桃|桃|梨|芒果|猕猴桃|西瓜|火龙果|香蕉|苹果)/i.test(text);
}

export function hasProjectPromptContext(context: CanvasProjectPromptContext): boolean {
  return Boolean(
    context.title ||
    context.description ||
    context.globalPrompt ||
    context.characterIdentityRules ||
    context.negativePrompt ||
    context.setupSettings,
  );
}

export function finalPromptSatisfiesProjectIdentity(value: string, context: CanvasProjectPromptContext, data?: any): boolean {
  if (hasLegacyCanvasAssetPromptScaffold(value)) return false;
  if (!projectRequiresFruitCharacters(context, data)) return true;
  const fruitIdentity = effectiveFruitIdentityForAsset(data, true);
  return promptHasConcreteFruit(value, fruitIdentity);
}

export function hasLegacyCanvasAssetPromptScaffold(value: unknown): boolean {
  const text = typeof value === 'string' ? value : '';
  return /Project authority:|Scene visual authority:|Character identity rules:|Project global settings authority:|Script rules:|Scene visual style:|Style notes:|Negative constraints:/i.test(text);
}

export function stripLegacyCanvasAssetPromptScaffold(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  if (!hasLegacyCanvasAssetPromptScaffold(text)) return stripRedundantCanvasAssetPromptLines(text);
  return '';
}

export function stripRedundantCanvasAssetPromptLines(value: string): string {
  return value
    .split('\n')
    .filter((line) => !/^(Style details|Style notes|Scene visual authority|Project title|Scene visual style|Negative constraints)\s*:/i.test(line.trim()))
    .filter((line) => !/Keep the project visual style consistent with the scene visual authority above/i.test(line.trim()))
    .join('\n')
    .trim();
}

export function imageStylePromptFromProjectContext(projectContext: CanvasProjectPromptContext): string {
  return sceneStylePromptFromProjectContext(projectContext)
    .split('\n')
    .map((line) => line.replace(/^(base style|global prompt|visual style|style|look|render|lighting|cinematic|quality)\s*:\s*/i, '').trim())
    .filter(Boolean)
    .join('; ');
}

export function imageStyleLinesFromProjectContext(projectContext: CanvasProjectPromptContext): string[] {
  const visualStyle = imageStylePromptFromProjectContext(projectContext);
  return [
    visualStyle ? `Style: ${visualStyle}` : '',
    projectContext.negativePrompt ? `Negative prompt: ${projectContext.negativePrompt}` : '',
    '',
  ].filter(Boolean);
}

export function buildCanvasCharacterFinalPrompt(data: any, referenceImageCount: number, projectContext: CanvasProjectPromptContext = {}): string {
  const name = String(data?.name || 'character').trim();
  const shortPrompt = firstCleanAssetPromptSeed(data?.visualPrompt, data?.traits, data?.description);
  const customGenerationPrompt = cleanAssetPromptSeed(data?.customGenerationPrompt);
  const characterVariant = data?.variant === 'with-props' ? 'with-props' : 'clean';
  const hasManualBoundProps = Array.isArray(data?.boundPropNames);
  const manualBoundProps = hasManualBoundProps ? mergeBoundPropNames(data.boundPropNames.map(String)) : [];
  const signaturePropText = hasManualBoundProps ? manualBoundProps.join(', ') : String(data?.signatureProps || '');
  const carriedProps = hasManualBoundProps
    ? manualBoundProps.slice(0, 4)
    : mergeBoundPropNames(extractSignaturePropNames([
        data?.signatureProps,
        data?.primaryLook,
        data?.habitualActions,
        data?.description,
        data?.visualPrompt,
        data?.traits,
      ].filter(Boolean).join(', ')).concat(
        typeof data?.signatureProps === 'string'
          ? data.signatureProps.split(/[,;/|]+/).map((item: string) => item.trim()).filter(Boolean)
          : [],
      )).slice(0, 4);
  const carriedPropText = carriedProps.length ? carriedProps.join(', ') : '';
  const mustUseFruitIdentity = projectRequiresFruitCharacters(projectContext, data);
  const fruitIdentity = effectiveFruitIdentityForAsset(data, mustUseFruitIdentity);
  const mixedFruitGroup = isMixedRandomFruitIdentity(fruitIdentity);
  return [
    ...imageStyleLinesFromProjectContext(projectContext),
    `Asset kind: characters`,
    `Asset name: ${name}`,
    characterVariant === 'with-props' ? 'Character image variant: with signature carried props.' : 'Character image variant: clean base reference, no loose carried props.',
    data?.role ? `Asset role: ${data.role}` : '',
    fruitIdentity ? mixedFruitGroup ? 'Fruit species policy: mixed random fruit crowd. Choose a varied mix such as apple, orange, lemon, pear, grape, peach, banana, melon, kiwi, or strawberry individuals; do not make all members the same fruit.' : `Fruit species to draw and label clearly: ${fruitIdentity}` : '',
    mustUseFruitIdentity && fruitIdentity
      ? mixedFruitGroup
        ? 'Visual identity: every member must read as anthropomorphic fruit, with varied fruit species and clear fruit anatomy/material cues.'
        : `Visual identity: unmistakable anthropomorphic ${fruitIdentity}; not a normal human, animal, generic zombie, or non-fruit monster. Make the ${fruitIdentity} identity readable in the head/body silhouette, surface texture, and color palette.`
      : '',
    data?.description ? `Asset description: ${data.description}` : '',
    signaturePropText ? `Character signature carried props / gear: ${signaturePropText}` : '',
    carriedPropText ? `Personal prop continuity to include in character sheet: ${carriedPropText}` : '',
    shortPrompt ? `User/asset prompt to preserve: ${shortPrompt}` : '',
    customGenerationPrompt ? `User custom generation instruction for this run: ${customGenerationPrompt}` : '',
    referenceImageCount > 0
      ? `Reference images supplied to the image model: ${referenceImageCount}. Use them as visual continuity references and do not contradict them.`
      : '',
    '',
    'Create a clean character production reference sheet, like a professional animation character bible page.',
    'Mandatory layout: one single wide clean sheet.',
    characterVariant === 'with-props'
      ? 'Upper main section should occupy most of the image and show the character body clearly. Keep the face and silhouette unobstructed, but include the character\'s signature carried prop when one is known.'
      : 'Upper main section should occupy most of the image and must show the character body only, with no loose story props or held objects.',
    'Upper-left: large face close-up / head bust for the primary look, natural neutral expression, unobstructed face. Add a small clean printed info block for character name and personality.',
    characterVariant === 'with-props'
      ? 'Upper-right: three full-body turnaround views of the same primary look: front view, side view, and back or three-quarter rear view. At least one full-body view should show the character naturally holding or carrying their signature prop when listed. Add a simple inferred height ruler / height marker beside the turnaround views.'
      : 'Upper-right: three full-body turnaround views of the same primary look: front view, side view, and back or three-quarter rear view. Use natural neutral expressions and unobstructed full-body silhouettes. Add a simple inferred height ruler / height marker beside the turnaround views.',
    characterVariant === 'with-props'
      ? carriedPropText ? `Draw these personal props with the character for video continuity: ${carriedPropText}. Keep owner + prop together and make scale/handling readable.` : 'If no signature carried prop is known, do not invent a loose handheld prop.'
      : 'Do not draw pillows, handheld weapons, bags, furniture, food, tools, or other standalone props in the clean base reference. Prop-bearing variants can be generated separately.',
    'Wearable identity gear is allowed when attached to the body or worn by the character, such as a mask, helmet, armor, uniform, glasses, or backpack.',
    characterVariant === 'with-props'
      ? 'Lower reference strip: add compact supplemental panels for useful facial expressions, habitual body gestures, important story-state variants, and one action pose with the signature prop if it exists.'
      : 'Lower reference strip: add compact supplemental panels for useful facial expressions, habitual body gestures, and important story-state variants. These panels should still keep the character unobstructed and should not introduce standalone props.',
    'If the character commonly wears a mask, helmet, armor, or other long-term gear, use that dominant story state in the upper main section. Put the no-mask / gear-off variant in the lower reference strip for scenes that require it.',
    characterVariant === 'with-props'
      ? 'If no alternate state is known, use the lower strip for expression poses, hand gestures, posture habits, prop-holding pose when relevant, and key silhouette details.'
      : 'If no alternate state is known, use the lower strip for expression poses, hand gestures without props, posture habits, and key silhouette details.',
    'Keep the exact same character identity, outfit, material, proportions, colors, and silhouette across all views.',
    fruitIdentity ? mixedFruitGroup ? 'The group must be visibly fruit-based without becoming one repetitive species: show clear fruit anatomy/material cues on different individuals and include a compact clean printed label "Fruit species: mixed random fruit crowd".' : `The fruit species must be visually obvious without guessing: show clear ${fruitIdentity} anatomy/material cues, and include a compact clean printed label "Fruit species: ${fruitIdentity}" on the character sheet.` : '',
    'Use a pure clean neutral blank background, evenly lit studio reference lighting, no environment, no decorative scene. Do not let text or info boxes cover the character drawings.',
    characterVariant === 'with-props'
      ? 'Single image only. Clean printed text is allowed only for compact character sheet labels: name, personality, height, expressions, actions, variants, wearable outfit/gear, personal prop, and color palette. No UI chrome, no watermark, no random captions, no messy handwritten annotations.'
      : 'Single image only. Clean printed text is allowed only for compact character sheet labels: name, personality, height, expressions, actions, variants, wearable outfit/gear, and color palette. No UI chrome, no watermark, no random captions, no messy handwritten annotations. Do not include standalone props in this clean base reference.',
    'Make it useful as a reusable AI video/image reference asset.',
  ].filter(Boolean).join('\n');
}

export function buildCanvasAssetProjectAuthority(projectContext: CanvasProjectPromptContext): string[] {
  return hasProjectPromptContext(projectContext) ? imageStyleLinesFromProjectContext(projectContext) : [];
}

export function sceneStylePromptFromProjectContext(projectContext: CanvasProjectPromptContext): string {
  const raw = String(projectContext.globalPrompt || '');
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const allowed = lines.filter((line) => (
    /^(base style|global prompt|visual style|style|look|render|lighting|cinematic|quality)\s*:/i.test(line) ||
    /masterpiece|best quality|highly detailed|cinematic lighting|cartoon|3d|render|lighting/i.test(line)
  ));
  const blockedPattern = /character identity rules|script rules|core rules|核心规则|所有主要角色|叙述中|肢体|社会与职业|黑色幽默应围绕|人物与气质|叙事与世界观|镜头与节奏|边界与禁用元素|default generation strategy|project tone|director guidance/i;
  return allowed.filter((line) => !blockedPattern.test(line)).join('\n');
}

export function buildCanvasSceneProjectAuthority(projectContext: CanvasProjectPromptContext): string[] {
  return hasProjectPromptContext(projectContext) ? imageStyleLinesFromProjectContext(projectContext) : [];
}

export function buildCanvasSceneFinalPrompt(data: any, referenceImageCount: number, projectContext: CanvasProjectPromptContext = {}): string {
  const name = String(data?.assetName || data?.name || data?.title || 'scene').trim();
  const description = String(data?.description || '').trim();
  const shortPrompt = firstCleanAssetPromptSeed(data?.visualPrompt, data?.prompt);
  const layoutInstruction = sceneImageModeInstruction(data?.sceneImageMode);
  return [
    ...buildCanvasSceneProjectAuthority(projectContext),
    'Asset kind: scenes',
    `Asset name: ${name}`,
    data?.timeOfDay ? `Time of day / lighting context: ${data.timeOfDay}` : '',
    data?.sceneVisualLock ? `Scene visual continuity lock: ${data.sceneVisualLock}` : '',
    data?.sceneZone ? `Scene zone / sub-area: ${data.sceneZone}` : '',
    Array.isArray(data?.sceneAnchors) && data.sceneAnchors.length > 0 ? `Fixed local anchors: ${data.sceneAnchors.join(', ')}` : '',
    description ? `Asset description: ${description}` : '',
    shortPrompt ? `User/asset prompt to preserve: ${shortPrompt}` : '',
    referenceImageCount > 0
      ? `Reference images supplied to the image model: ${referenceImageCount}. Use them as visual continuity references and do not contradict them.`
      : '',
    '',
    'Create a clean empty scene/location production reference image for an AI animation project.',
    'This is an environment plate only: no characters, no people, no creatures, no visible actors, no dialogue, no performance beat.',
    data?.sceneVisualLock ? 'Inherit the scene visual continuity lock exactly. A local zone or anchor must remain inside the same canonical visual world.' : '',
    'The image must be useful as a reusable environment reference, not a random cinematic still.',
    'Prioritize readable geography, staging zones, entrance/exit points, major props fixed in the space, material language, lighting direction, atmosphere, and scale cues.',
    'Keep the visual style consistent across all scene assets.',
    'Show the full usable location clearly with a stable camera angle and enough depth to understand blocking zones.',
    'Do not add characters. Do not turn this into a poster or title card.',
    layoutInstruction || 'Single image only. No captions, no UI, no watermark, no decorative text, no random labels unless explicitly required by the asset facts.',
    'Make it useful as a reusable AI video/image reference asset.',
  ].filter(Boolean).join('\n');
}

export function buildCanvasPropFinalPrompt(data: any, referenceImageCount: number, projectContext: CanvasProjectPromptContext = {}): string {
  const name = String(data?.assetName || data?.name || data?.title || 'prop').trim();
  const description = String(data?.description || '').trim();
  const shortPrompt = firstCleanAssetPromptSeed(data?.visualPrompt, data?.prompt);
  return [
    ...buildCanvasAssetProjectAuthority(projectContext),
    'Asset kind: props',
    `Asset name: ${name}`,
    data?.function ? `Prop function: ${data.function}` : '',
    description ? `Asset description: ${description}` : '',
    shortPrompt ? `User/asset prompt to preserve: ${shortPrompt}` : '',
    referenceImageCount > 0
      ? `Reference images supplied to the image model: ${referenceImageCount}. Use them as visual continuity references and do not contradict them.`
      : '',
    '',
    'Create a clean prop production reference image for an AI animation project.',
    'Prioritize shape, silhouette, material, texture, scale, how it is held or used, and any moving/functional parts.',
    'Show the prop clearly on a clean neutral background with studio reference lighting.',
    'If useful, include compact alternate angles or small detail callouts, but keep the sheet clean and readable.',
    'Do not add unrelated characters, scenes, UI, watermark, random captions, or decorative title text.',
    'Single image only. Make it useful as a reusable AI video/image reference asset.',
  ].filter(Boolean).join('\n');
}

export function buildCanvasAssetFinalPrompt(kind: WorkflowAssetKind, data: any, referenceImageCount: number, projectContext: CanvasProjectPromptContext = {}): string {
  if (kind === 'characters') return buildCanvasCharacterFinalPrompt(data, referenceImageCount, projectContext);
  if (kind === 'scenes') return buildCanvasSceneFinalPrompt(data, referenceImageCount, projectContext);
  return buildCanvasPropFinalPrompt(data, referenceImageCount, projectContext);
}

export function looksLikeCanvasAssetFinalPrompt(value: unknown): boolean {
  const text = typeof value === 'string' ? value : '';
  return (
    text.includes('Project authority:') ||
    text.includes('Scene visual authority:') ||
    text.includes('Scene visual style:') ||
    text.includes('User final prompt:') ||
    text.includes('Asset kind: characters') ||
    text.includes('Asset kind: scenes') ||
    text.includes('Asset kind: props') ||
    text.includes('Create a clean character production reference sheet') ||
    text.includes('Create a clean scene/location production reference image') ||
    text.includes('Create a clean prop production reference image')
  );
}

export function cleanAssetPromptSeed(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || looksLikeCanvasAssetFinalPrompt(text)) return '';
  return text;
}

export function firstCleanAssetPromptSeed(...values: unknown[]): string {
  for (const value of values) {
    const text = cleanAssetPromptSeed(value);
    if (text) return text;
  }
  return '';
}

export function isRawAssetPrompt(data: any, value: unknown): boolean {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || looksLikeCanvasAssetFinalPrompt(text)) return false;
  return [
    data?.prompt,
    data?.visualPrompt,
    data?.description,
    data?.lockedVisualIdentity,
    data?.generatedImagePrompt,
  ]
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .some((candidate) => normalizeCompareText(candidate) === normalizeCompareText(text));
}

export function hasManualCanvasGenerationPrompt(data: any): boolean {
  return data?.manualFinalPrompt === true || Object.prototype.hasOwnProperty.call(data ?? {}, 'finalPrompt');
}

export function looksLikeCanvasCharacterFinalPrompt(value: unknown): boolean {
  const text = typeof value === 'string' ? value : '';
  return (
    text.includes('Asset kind: characters') ||
    text.includes('Create a clean character production reference sheet') ||
    text.includes('Mandatory layout: one single wide clean sheet')
  );
}

export function isRawCharacterAssetPrompt(data: any, value: unknown): boolean {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || looksLikeCanvasCharacterFinalPrompt(text)) return false;
  return [
    data?.visualPrompt,
    data?.lockedVisualIdentity,
    data?.traits,
    data?.description,
    data?.generatedImagePrompt,
  ]
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .some((item) => item === text);
}

export const workflowStages: Array<{
  key: WorkflowStageKey;
  num: string;
  title: string;
  desc: string;
}> = [
  { key: 'source', num: '01', title: '小说/剧本导入', desc: '导入原文并识别集/章' },
  { key: 'assets', num: '02', title: '场景角色道具', desc: '提取角色、场景、道具资产' },
  { key: 'storyboard', num: '03', title: '分镜脚本', desc: '拆成镜头、对白、动作和时长' },
  { key: 'video', num: '04', title: '分镜视频', desc: '生成镜头视频和参考图' },
  { key: 'voice', num: '05', title: '配音对口型', desc: '台词配音、字幕和口型' },
  { key: 'preview', num: '06', title: '视频预览', desc: '预览、缺失检查、快速拼接' },
  { key: 'edit', num: '07', title: '后期剪辑', desc: '进入剪辑时间线和导出' },
];

export const assetGroups = [
  { key: 'characters' as const, title: '角色资产', desc: '角色图、事实卡、表演约束', icon: Boxes },
  { key: 'scenes' as const, title: '场景资产', desc: '空间图、氛围、时间点', icon: ImageIcon },
  { key: 'props' as const, title: '道具资产', desc: '关键物件、交互用途', icon: Package },
];

export const batchCharacterAudioTargets = [
  { index: 1, name: 'Bob', aliases: ['bob'] },
  { index: 2, name: 'Chloe', aliases: ['chloe', 'chole'] },
  { index: 3, name: 'Leo', aliases: ['leo'] },
  { index: 4, name: 'Tiffany', aliases: ['tiffany'] },
  { index: 5, name: 'Eugene', aliases: ['eugene'] },
];

export const assetImageAspectRatioOptions = [
  { value: '16:9', label: '16:9 横版' },
  { value: '1:1', label: '1:1 方图' },
  { value: '9:16', label: '9:16 竖版' },
  { value: '4:3', label: '4:3' },
];

export const assetImageResolutionOptions = [
  { value: '1k', label: '1K' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' },
];

export const assetLibraryCategories: Array<{ key: AssetLibraryCategory; label: string; icon: typeof Boxes }> = [
  { key: 'characters', label: '角色', icon: Users },
  { key: 'scenes', label: '场景', icon: ImageIcon },
  { key: 'props', label: '道具', icon: Package },
  { key: 'directorBoards', label: '导演板', icon: Clapperboard },
];

export function isProjectNotFoundError(error: unknown): boolean {
  return error instanceof Error && /project not found/i.test(error.message);
}

export function createDraftScenes(sourceText: string): BreakdownScene[] {
  const lines = sourceText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const headingIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^(第?\s*\d+\s*[章节集幕场]|chapter\s+\d+|scene\s+\d+|act\s+\d+)/i.test(line));

  const chunks =
    headingIndexes.length > 0
      ? headingIndexes.map((item, index) => {
          const next = headingIndexes[index + 1]?.index ?? lines.length;
          return lines.slice(item.index, next).join(' ');
        })
      : sourceText
          .split(/\n\s*\n|(?<=[。！？!?])\s+/)
          .map((item) => item.trim())
          .filter((item) => item.length > 12);

  return chunks.slice(0, 8).map((chunk, index) => {
    const cleaned = chunk.replace(/\s+/g, ' ');
    const titleSeed = cleaned.slice(0, 22);
    return {
      id: `draft-${index + 1}`,
      title: `${String(index + 1).padStart(2, '0')} ${titleSeed || '剧情段落'}`,
      description: cleaned.slice(0, 180),
      references: index === 0 ? '待提取角色、场景、道具' : '承接上一段角色状态和空间关系',
      status: index < 2 ? 'ready' : 'draft',
    };
  });
}

export function countEnglishDialogueWords(text?: string) {
  return (String(text ?? '').match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?/g) ?? []).length;
}

export function getDialoguePacing(scene: BreakdownScene) {
  const words = countEnglishDialogueWords(scene.dialogue);
  const duration = Math.max(0, Number(scene.durationSeconds ?? 0));
  const wordsPerSecond = duration > 0 ? words / duration : 0;
  const recommendedSeconds = words > 0 ? Math.ceil(words / 3.2) : 0;
  return {
    words,
    duration,
    wordsPerSecond,
    recommendedSeconds,
    tooDense: wordsPerSecond > 3.6,
  };
}

export function formatClipDuration(clip: Clip) {
  const estimated = Number.isFinite(Number(clip.estimatedDuration)) ? `${clip.estimatedDuration}s` : '未估算';
  const target = Number.isFinite(Number(clip.targetDuration)) ? `${clip.targetDuration}s` : null;
  const max = Number.isFinite(Number(clip.maxDuration)) ? `${clip.maxDuration}s` : null;
  return [estimated, target ? `目标 ${target}` : null, max ? `上限 ${max}` : null].filter(Boolean).join(' / ');
}

export function formatClipDialogue(clip: Clip) {
  const words = Number.isFinite(Number(clip.dialogueWordCount)) ? `${clip.dialogueWordCount} 词` : '0 词';
  if (clip.dialogueDensity === undefined || clip.dialogueDensity === null || clip.dialogueDensity === '') return words;
  const density =
    typeof clip.dialogueDensity === 'number'
      ? `${clip.dialogueDensity.toFixed(1)} w/s`
      : String(clip.dialogueDensity);
  return `${words} / ${density}`;
}

export function getClipRiskItems(clip: Clip) {
  const preflight = clip.preflight;
  if (!preflight) return [];
  if (typeof preflight === 'string') return preflight.trim() ? [preflight.trim()] : [];

  const items: string[] = [];
  for (const key of ['risks', 'riskTips', 'warnings', 'issues']) {
    const value = preflight[key];
    if (Array.isArray(value)) {
      items.push(...value.map(String).filter(Boolean));
    } else if (typeof value === 'string' && value.trim()) {
      items.push(value.trim());
    }
  }
  return Array.from(new Set(items));
}

export function getClipPreflightStatus(clip: Clip) {
  const preflight = clip.preflight;
  if (!preflight) return '未检查';
  if (typeof preflight === 'string') return preflight.trim() || '未检查';

  const status = preflight.status ?? preflight.state ?? preflight.result;
  if (status !== undefined && status !== null && String(status).trim()) return String(status);

  const ok = preflight.ok ?? preflight.passed;
  const pass = preflight.pass;
  if (typeof ok === 'boolean') return ok ? '通过' : '需检查';
  if (typeof pass === 'boolean') return pass ? '通过' : '需检查';
  if (typeof pass === 'string' && pass.trim()) return pass;

  return getClipRiskItems(clip).length ? '需检查' : '未检查';
}

export function isClipPreflightRisky(clip: Clip) {
  const status = getClipPreflightStatus(clip).toLowerCase();
  return getClipRiskItems(clip).length > 0 || /fail|warn|risk|需|失败|警告|风险/.test(status);
}

export function compactList(items: string[] | undefined, fallback = '未指定', max = 3) {
  if (!items?.length) return fallback;
  const visible = items.slice(0, max).join(', ');
  return items.length > max ? `${visible} +${items.length - max}` : visible;
}

export function uniqueClipNames(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    const key = normalizeCompareText(normalized);
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

export function getClipScenes(clip: Clip, scenes: BreakdownScene[]) {
  const shotIds = new Set((clip.shotIds ?? []).map(String));
  if (shotIds.size === 0) return [];
  return scenes.filter((scene) => shotIds.has(scene.id));
}

export function clipSceneSettings(clip: Clip, clipScenes: BreakdownScene[]): string[] {
  return uniqueClipNames([clip.setting, ...clipScenes.map((scene) => scene.setting)].filter((item): item is string => Boolean(item?.trim())));
}

export function assetLooksLikeContinuityTeamMember(item: WorkflowAssetItem): boolean {
  const role = normalizeCompareText(String(item.role || ''));
  if (/background|crowd|extra|zombie|victim|antagonist|villain|enemy|boss|ceo/.test(role)) return false;
  const text = normalizeCompareText([
    item.name,
    item.role,
    item.description,
    item.visualPrompt,
    item.referencePolicy,
  ].map((value) => String(value || '')).join(' '));
  if (/(background|crowd|zombie|victim|antagonist|villain|enemy|boss|ceo|mutant villain)/.test(text)) return false;
  return /(protagonist|team leader|teammate|team member|squad|ally|supporting)/.test(text);
}

export function inferContinuityCharactersForClip(clip: Clip, clipScenes: BreakdownScene[], allScenes: BreakdownScene[], assets?: WorkflowAssets) {
  const explicitNames = uniqueClipNames([
    ...(clip.characters ?? []),
    ...clipScenes.flatMap((scene) => scene.characters ?? []),
  ]);
  const settings = clipSceneSettings(clip, clipScenes);
  const settingKeys = new Set(settings.map(normalizeCompareText).filter(Boolean));
  const sameSettingScenes = settingKeys.size
    ? allScenes.filter((scene) => settingKeys.has(normalizeCompareText(scene.setting || '')))
    : clipScenes;
  const sameSettingNames = uniqueClipNames(sameSettingScenes.flatMap((scene) => scene.characters ?? []));
  const availableAssetNames = assets ? new Set(assetArray(assets, 'characters').map((item) => normalizeCompareText(workflowAssetName(item))).filter(Boolean)) : null;
  const teamHints = normalizeCompareText([
    clip.title,
    clip.plotGoal,
    clip.startState,
    clip.endState,
    clip.layoutMemory,
    clip.storyboardNotes,
    ...clipScenes.flatMap((scene) => [scene.title, scene.description, scene.action, scene.references, scene.visualPrompt, scene.directorBoardPrompt]),
  ].join('\n'));
  const likelyTeamScene = /\bteam\b|teammate|group|guests|主角团|小队/.test(teamHints) || explicitNames.length >= 2;
  const protagonistNames = assets
    ? assetArray(assets, 'characters')
        .filter(assetLooksLikeContinuityTeamMember)
        .map(workflowAssetName)
    : [];
  const inferredNames = likelyTeamScene ? uniqueClipNames([...sameSettingNames, ...protagonistNames]) : sameSettingNames;
  return uniqueClipNames([...explicitNames, ...inferredNames])
    .filter((name) => !availableAssetNames || availableAssetNames.has(normalizeCompareText(name)))
    .slice(0, 12);
}

export function clipCurrentCharacterNamesForAssetReferences(clip: Clip, clipScenes: BreakdownScene[], assets?: WorkflowAssets) {
  const names = uniqueClipNames([
    ...(clip.characters ?? []),
    ...clipScenes.flatMap((scene) => scene.characters ?? []),
  ]);
  const availableAssetNames = assets ? new Set(assetArray(assets, 'characters').map((item) => normalizeCompareText(workflowAssetName(item))).filter(Boolean)) : null;
  return names
    .filter((name) => !availableAssetNames || availableAssetNames.has(normalizeCompareText(name)))
    .slice(0, 12);
}

export type ClipAssetReference = {
  kind: WorkflowAssetKind;
  name: string;
  label: string;
  url?: string;
  assetId?: string;
};

export type ClipImageReference = {
  kind: WorkflowAssetKind | 'storyboard' | 'positioning-board';
  name: string;
  label: string;
  url?: string;
  assetId?: string;
  nodeId?: string;
  sourceClipId?: string;
  sourceClipTitle?: string;
  targetClipId?: string;
};

export type ClipStoryboardImageReference = {
  clipId?: string;
  clipTitle?: string;
  title: string;
  url: string;
  assetId?: string;
  prompt?: string;
  nodeId?: string;
  sourceEpisode?: string;
  sourceEpisodeId?: string;
};

export type PreviousStoryboardReference = ClipStoryboardImageReference & {
  sourceClip?: Clip;
};

export type EpisodeCanvasSyncResult = {
  nodes: any[];
  edges: any[];
  storyboardCount: number;
  videoCount: number;
  removedIds: Set<string>;
  clips: Clip[];
};

export type EpisodeCanvasSyncOptions = {
  episodeId: string;
  episode: string;
  clips: Clip[];
  scenes: BreakdownScene[];
  assets: WorkflowAssets;
  generationStrategy?: string;
  storyboardAssetRefs?: ClipStoryboardImageReference[];
  blockedStoryboardUrls?: Set<string>;
  projectPromptContext?: string;
  imageModelId?: string;
  imageResolution?: string;
  aspectRatio?: string;
};

export type EpisodeCanvasSyncRequest = {
  episodeId?: string;
  clips?: Clip[];
  scenes?: BreakdownScene[];
  assets?: WorkflowAssets;
  episode?: string;
  refreshRecords?: boolean;
};

export type WorkflowBreakdownRecoveryOptions = {
  stage: 'assets' | 'storyboard';
  startedAtMs: number;
  assetsFallback: WorkflowAssets;
};

export type CanvasReferenceImage = {
  url: string;
  label: string;
  kind: 'storyboard' | 'character' | 'scene' | 'prop' | 'image';
  name?: string;
  sourceClipId?: string;
  targetClipId?: string;
};

export type FinalClipStoryboardPromptOptions = {
  clip: Clip;
  clips: Clip[];
  scenes: BreakdownScene[];
  assets: WorkflowAssets;
  nodes: Array<{ id: string; type?: string; data?: any }>;
  storyboardAssetRefs?: ClipStoryboardImageReference[];
  blockedStoryboardUrls?: Set<string>;
  basePrompt?: string;
};

export type FinalClipStoryboardPromptResult = {
  prompt: string;
  references: ClipImageReference[];
  previousStoryboardRef: PreviousStoryboardReference | null;
};

export type FinalizeClipStoryboardPrompt = (
  clip: Clip,
  basePrompt: string,
  clipsOverride?: Clip[],
  assetsOverride?: WorkflowAssets,
  scenesOverride?: BreakdownScene[],
) => FinalClipStoryboardPromptResult;

export function buildFinalClipStoryboardPromptForCanvas(options: FinalClipStoryboardPromptOptions): FinalClipStoryboardPromptResult {
  const clipScenes = getClipScenes(options.clip, options.scenes);
  const blockedStoryboardUrls = options.blockedStoryboardUrls ?? new Set<string>();
  const basePrompt = options.basePrompt || options.clip.storyboardPrompt || buildClipDirectorBoardPrompt(options.clip, clipScenes, 'ai', options.scenes, options.assets);
  const savedPanelCount = Number(options.clip.storyboardPanelCount);
  const panelChoice: ClipPanelCountChoice = CLIP_STORYBOARD_PANEL_CHOICES.includes(savedPanelCount as typeof CLIP_STORYBOARD_PANEL_CHOICES[number])
    ? savedPanelCount as ClipPanelCountChoice
    : 'ai';
  const cleanedBasePrompt = finalizeClipStoryboardImagePrompt(stripReferenceImageMapPrompt(basePrompt), typeof panelChoice === 'number' ? panelChoice : savedPanelCount || undefined);
  const promptWithUsablePanels = extractStoryboardPromptPanelTexts(cleanedBasePrompt).length > 0
    ? cleanedBasePrompt
    : buildClipDirectorBoardPrompt(options.clip, clipScenes, panelChoice, options.scenes, options.assets);
  const continuityPrompt = enforceClipStoryboardContinuityPrompt(
    finalizeClipStoryboardImagePrompt(promptWithUsablePanels, typeof panelChoice === 'number' ? panelChoice : savedPanelCount || undefined),
    options.clip,
    clipScenes,
    options.scenes,
    options.assets,
  );
  const previousStoryboardRef = findPreviousClipStoryboardReference(
    options.clip,
    options.clips,
    options.nodes,
    options.storyboardAssetRefs ?? [],
    blockedStoryboardUrls,
  );
  const promptWithContinuity = replacePreviousStoryboardContinuityPrompt(continuityPrompt, previousStoryboardRef);
  const storyboardReferenceLimit = previousStoryboardRef?.url || previousStoryboardRef?.nodeId ? 8 : 9;
  const assetReferences = collectClipAssetReferences(options.clip, clipScenes, options.assets, storyboardReferenceLimit, promptWithContinuity, {
    includeProps: false,
    includeScenes: false,
    allScenes: options.scenes,
  });
  const references: ClipImageReference[] = [
    ...(previousStoryboardRef?.url ? [{
      kind: 'storyboard' as const,
      name: previousStoryboardRef.title || `${previousStoryboardRef.sourceClip?.title || '上一个 Clip'} 故事板`,
      label: `上一个故事板: ${previousStoryboardRef.sourceClip?.title || previousStoryboardRef.clipTitle || previousStoryboardRef.title || '上一段'}`,
      url: previousStoryboardRef.url,
      assetId: previousStoryboardRef.assetId,
      nodeId: previousStoryboardRef.nodeId,
      sourceClipId: previousStoryboardRef.sourceClip?.id || previousStoryboardRef.clipId,
      sourceClipTitle: previousStoryboardRef.sourceClip?.title || previousStoryboardRef.clipTitle,
      targetClipId: options.clip.id,
    }] : []),
    ...assetReferences,
  ];

  return {
    prompt: appendReferenceImageMapPrompt(
      promptWithContinuity,
      references.map(clipImageReferenceAsCanvasReference),
    ),
    references,
    previousStoryboardRef,
  };
}

export function workflowAssetImageUrl(item: WorkflowAssetItem) {
  return normalizeReusableImageSource(item.referenceImageUrl || item.generatedImageUrl || '');
}

export function workflowAssetImageAssetId(item: WorkflowAssetItem) {
  const referenceUrl = workflowAssetImageUrl(item);
  const referenceImageUrl = normalizeReusableImageSource(item.referenceImageUrl || '');
  const generatedUrl = normalizeReusableImageSource(item.generatedImageUrl || '');
  const referenceAssetId = String(item.referenceImageAssetId || '');
  const generatedAssetId = String(item.generatedImageAssetId || '');
  if (generatedAssetId && referenceUrl.includes(generatedAssetId)) return generatedAssetId;
  if (referenceAssetId && referenceUrl.includes(referenceAssetId)) return referenceAssetId;
  if (referenceUrl && generatedUrl && referenceUrl === generatedUrl && generatedAssetId) return generatedAssetId;
  if (referenceUrl && generatedUrl && referenceUrl !== generatedUrl) {
    if (referenceUrl === referenceImageUrl && referenceAssetId) return referenceAssetId;
    if (referenceUrl === generatedUrl && generatedAssetId) return generatedAssetId;
  }
  return referenceAssetId || generatedAssetId || '';
}

export function workflowAssetStableId(item: WorkflowAssetItem) {
  return String(item.id || workflowAssetImageAssetId(item) || workflowAssetName(item) || '').trim();
}

export function findWorkflowAssetByName(items: WorkflowAssetItem[], name: string) {
  const target = normalizeCompareText(name);
  if (!target) return undefined;
  return items.find((item) => workflowAssetNamesMatch(item, name))
    ?? items.find((item) => {
      const assetName = normalizeCompareText(workflowAssetName(item));
      return Boolean(assetName && (assetName.includes(target) || target.includes(assetName)));
    });
}

function propCanonicalSignature(value: string): string {
  const text = normalizeCompareText(value).replace(/[-_]+/g, ' ');
  if (!text) return '';
  const hasPanWord = /\b(pan|skillet)\b/.test(text);
  const isIronPan = hasPanWord && (
    /\bcast\s+iron\b/.test(text) ||
    /\biron\s+(?:frying\s+)?pan\b/.test(text) ||
    /\biron\s+skillet\b/.test(text) ||
    /^skillet$/.test(text)
  );
  return isIronPan ? 'prop:iron-pan' : '';
}

function workflowAssetNameKeys(value: WorkflowAssetItem | string): string[] {
  const aliases = typeof value === 'string'
    ? [value]
    : [
        workflowAssetName(value),
        value.title || '',
        ...((Array.isArray(value.aliases) ? value.aliases : []) as string[]),
      ];
  const keys = new Set<string>();
  aliases.forEach((alias) => {
    const key = normalizeCompareText(String(alias || ''));
    if (!key) return;
    keys.add(key);
    const signature = propCanonicalSignature(key);
    if (signature) keys.add(signature);
  });
  return Array.from(keys);
}

function workflowAssetNamesMatch(asset: WorkflowAssetItem, name: string) {
  const targetKeys = new Set(workflowAssetNameKeys(name));
  return workflowAssetNameKeys(asset).some((key) => targetKeys.has(key));
}

export function primarySceneNamesForClip(clip: Clip, clipScenes: BreakdownScene[], extraSearchText = '') {
  const text = normalizeCompareText([
    clip.title,
    clip.setting,
    clip.plotGoal,
    clip.startState,
    clip.endState,
    ...clipScenes.flatMap((scene) => [
      scene.title,
      scene.setting,
      scene.description,
      scene.action,
      scene.visualPrompt,
      scene.references,
    ]),
  ].filter(Boolean).join('\n'));
  const names: string[] = [];
  const push = (name: string) => {
    if (!names.some((item) => normalizeCompareText(item) === normalizeCompareText(name))) names.push(name);
  };
  const settingText = normalizeCompareText([
    clip.setting,
    ...clipScenes.map((scene) => scene.setting),
  ].filter(Boolean).join('\n'));

  if (/underground loading dock|地下装卸|地下卸货/.test(text)) push('Underground Loading Dock');
  if (/frozen meat section|冷冻肉|冻肉区/.test(text)) push('Frozen Meat Section');
  if (/gutted produce section ritual hall|gutted produce hall/.test(settingText || text)) {
    push('Thanksgiving Harvest Ritual Stage');
  }
  if (
    /thanksgiving harvest ritual stage|harvest ritual stage|ritual stage|pumpkin podium|fungus curtain|living wall|vine barricade|front row quarantine seats|coronation|pre-harvest ritual|感恩节丰收仪式舞台|丰收仪式舞台|仪式舞台|南瓜讲台|真菌幕布|活墙|藤蔓墙|藤蔓路障|前排隔离座|加冕|预收获仪式/.test(text)
  ) {
    push('Thanksgiving Harvest Ritual Stage');
  }
  if (/labor purification route|劳动净化路线|净化路线/.test(text)) push('Labor Purification Route');
  if (/labor purification zone|劳动净化区|净化区/.test(text)) push('Labor Purification Zone');
  if (/sanctuary superstore center|superstore meditation circle|meditation circle|trial circle|圣所超市|超市中心|冥想圈|审判圈/.test(settingText || text)) {
    push('Superstore Meditation Circle');
  } else if (/shipping pallet altar|pallet altar|托盘祭坛|货盘祭坛/.test(settingText)) {
    push('Shipping Pallet Altar');
  }

  return names;
}

export function characterNameLooksPhysicallyPresent(searchableText: string, characterName: string): boolean {
  const name = normalizeCompareText(characterName);
  if (!name || !searchableText.includes(name)) return false;
  const escaped = escapeRegExp(name);
  const decorativeMention = new RegExp(`\\b${escaped}\\s+(poster|posters|portrait|portraits|photo|photos|image|images|billboard|billboards|logo|logos|sign|signs)\\b`);
  if (decorativeMention.test(searchableText)) return false;
  return true;
}

export function pushClipAssetReference(
  refs: ClipAssetReference[],
  seen: Set<string>,
  kind: WorkflowAssetKind,
  item: WorkflowAssetItem | undefined,
  labelPrefix: string,
  options: { includeMissing?: boolean } = {},
): boolean {
  if (!item) return false;
  const name = workflowAssetName(item);
  const url = workflowAssetImageUrl(item);
  if (!name || (!url && !options.includeMissing)) return false;
  const assetId = workflowAssetImageAssetId(item);
  const key = `${kind}:${workflowAssetStableId(item) || normalizeCompareText(name)}:${url || 'missing'}`;
  if (seen.has(key)) return false;
  seen.add(key);
  refs.push({
    kind,
    name,
    label: `${labelPrefix}: ${name}`,
    url,
    assetId,
  });
  return true;
}

export function propAliasCandidates(name: string, description = ''): string[] {
  const base = normalizeCompareText(name);
  const aliases = new Set<string>([base]);
  if (base.includes('shotgun')) aliases.add('shotgun');
  const ironPanSignature = propCanonicalSignature(base);
  if (base.includes('magic pan') || base.includes('iron pan') || base.includes('frying pan') || base.includes('skillet') || ironPanSignature === 'prop:iron-pan') {
    aliases.add('magic pan');
    aliases.add('iron magic pan');
    aliases.add('iron pan');
    aliases.add('cast iron pan');
    aliases.add('cast iron frying pan');
    aliases.add('frying pan');
    aliases.add('skillet');
  }
  if (base.includes('heavy gun')) aliases.add('heavy gun');
  if (base.includes('pillow')) aliases.add('pillow');
  void description;
  return Array.from(aliases).filter(Boolean);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function propTextHasExplicitOwner(propText: string, characterName: string): boolean {
  const escapedName = escapeRegExp(normalizeCompareText(characterName));
  if (!escapedName) return false;
  return new RegExp(`\\b${escapedName}\\s*'s\\b|\\bused\\s+by\\s+${escapedName}\\b|\\bcarried\\s+by\\s+${escapedName}\\b|\\bheld\\s+by\\s+${escapedName}\\b|\\bowned\\s+by\\s+${escapedName}\\b`).test(propText);
}

export function extractSignaturePropNames(value: string): string[] {
  return value
    .split(/[,;/|]+/)
    .map((item) => item.trim())
    .filter((item) => {
      const normalized = normalizeCompareText(item);
      if (!normalized) return false;
      return /(gun|shotgun|pan|skillet|pillow|needle|chair|button|weapon|tool|prop)/i.test(normalized);
    })
    .slice(0, 4);
}

export function mergeBoundPropNames(values: string[]): string[] {
  const output: string[] = [];
  for (const value of values) {
    const normalized = normalizeCompareText(value);
    if (!normalized) continue;
    const covered = output.some((existing) => {
      const existingKey = normalizeCompareText(existing);
      return existingKey === normalized || existingKey.includes(normalized) || normalized.includes(existingKey);
    });
    if (!covered) output.push(value.trim());
  }
  return output;
}

export function inferredPropNamesFromCharacter(character: WorkflowAssetItem): string[] {
  return mergeBoundPropNames([
    ...extractSignaturePropNames(character.signatureProps || ''),
    ...(character.signatureProps || '')
      .split(/[,;/|]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  ]);
}

export function hasManualBoundPropNames(character: WorkflowAssetItem): boolean {
  return Array.isArray(character.boundPropNames);
}

export function manualBoundPropNamesFromCharacter(character: WorkflowAssetItem): string[] {
  return mergeBoundPropNames((character.boundPropNames ?? []).map(String));
}

export function selectedPropNamesFromCharacter(character: WorkflowAssetItem): string[] {
  return hasManualBoundPropNames(character)
    ? manualBoundPropNamesFromCharacter(character)
    : inferredPropNamesFromCharacter(character);
}

export function formatBoundSignatureProps(character: WorkflowAssetItem, propName: string): string {
  return mergeBoundPropNames([...inferredPropNamesFromCharacter(character), propName]).join(', ');
}

export function nextManualBoundPropNames(character: WorkflowAssetItem, propName: string, shouldBind: boolean): string[] {
  const current = selectedPropNamesFromCharacter(character);
  const target = normalizeCompareText(propName);
  if (!target) return current;
  const withoutTarget = current.filter((item) => {
    const key = normalizeCompareText(item);
    return Boolean(key && key !== target && !key.includes(target) && !target.includes(key));
  });
  if (shouldBind) return mergeBoundPropNames([...withoutTarget, propName]);
  return withoutTarget;
}

export function removeInferredBoundPropName(character: WorkflowAssetItem, propName: string): string {
  const target = normalizeCompareText(propName);
  return inferredPropNamesFromCharacter(character)
    .filter((item) => normalizeCompareText(item) !== target)
    .join(', ');
}

export function propHasUsableImage(prop: WorkflowAssetItem): boolean {
  return Boolean(workflowAssetImageUrl(prop) || publicImageUrl(prop.referenceImageUrl) || publicImageUrl(prop.generatedImageUrl));
}

export function propIsCarryableReference(prop: WorkflowAssetItem): boolean {
  const text = normalizeCompareText([
    prop.name,
    prop.description,
    prop.function,
    prop.visualPrompt,
  ].map((item) => String(item || '')).join(' '));
  if (!text) return false;
  if (/(shirt|t-?shirt|clothes?|clothing|outfit|uniform|pants|shorts|dress|skirt|boots?|shoes?|hat|helmet|armor|vest|jacket|coat|gloves?|socks?|衬衫|衣服|服装|制服|裤|短裤|鞋|靴|帽|头盔|护甲|背心|外套)/i.test(text)) {
    return false;
  }
  return true;
}

export function propIsBoundToCharacter(character: WorkflowAssetItem, prop: WorkflowAssetItem): boolean {
  const propName = workflowAssetName(prop);
  if (!propName) return false;
  const propKey = normalizeCompareText(propName);
  return selectedPropNamesFromCharacter(character).some((signatureProp) => {
    const signatureKey = normalizeCompareText(signatureProp);
    return Boolean(signatureKey && signatureKey === propKey);
  });
}

export function assetHistoryImageIsWithProps(image: WorkflowAssetImageHistoryItem): boolean {
  return assetHistoryImageIsWithPropsCore(image);
}

export function reusableAssetHistoryImages(kind: WorkflowAssetKind, images: WorkflowAssetImageHistoryItem[]) {
  return reusableAssetHistoryImagesCore(kind, images, normalizeReusableImageSource);
}

export function orderedReusableAssetHistoryImages(kind: WorkflowAssetKind, images: WorkflowAssetImageHistoryItem[]) {
  return orderedReusableAssetHistoryImagesCore(kind, images, normalizeReusableImageSource);
}

export async function chooseReachableAssetHistoryImage(kind: WorkflowAssetKind, images: WorkflowAssetImageHistoryItem[]) {
  const ordered = orderedReusableAssetHistoryImages(kind, images);
  const seen = new Set<string>();
  for (const image of ordered) {
    if (seen.has(image.id)) continue;
    seen.add(image.id);
    if (await browserImageLooksReachable(image.url)) return image;
  }
  return null;
}

export function generationRecordWorkflowAssetBusyKey(record: GenerationRecord): string | null {
  if (record.status.toUpperCase() !== 'RUNNING') return null;
  const startedAt = Date.parse(record.startedAt || record.createdAt || '');
  if (!Number.isFinite(startedAt) || Date.now() - startedAt > 15 * 60 * 1000) return null;
  const input = record.input && typeof record.input === 'object' && !Array.isArray(record.input)
    ? record.input as Record<string, unknown>
    : {};
  if (input.kind !== 'workflow-asset-image') return null;
  const kind = normalizeWorkflowAssetKind(input.assetKind);
  const assetName = typeof input.assetName === 'string' ? input.assetName.trim() : '';
  return kind && assetName ? workflowAssetBusyKey(kind, assetName) : null;
}

export function characterOwnsProp(character: WorkflowAssetItem, prop: WorkflowAssetItem): boolean {
  const characterName = workflowAssetName(character);
  const propName = workflowAssetName(prop);
  if (!characterName || !propName) return false;
  if (hasManualBoundPropNames(character)) {
    const propKey = normalizeCompareText(propName);
    return manualBoundPropNamesFromCharacter(character).some((signatureProp) => normalizeCompareText(signatureProp) === propKey);
  }
  const searchable = [
    character.signatureProps,
    character.description,
    character.visualPrompt,
    character.lockedVisualIdentity,
    character.referencePolicy,
  ].map((item) => normalizeCompareText(String(item || ''))).filter(Boolean).join(' | ');
  const propText = normalizeCompareText([
    prop.name,
    prop.title,
    prop.description,
    prop.function,
    prop.visualPrompt,
  ].map((item) => String(item || '')).join(' '));
  if (propTextHasExplicitOwner(propText, characterName)) return true;
  const matchedByAlias = propAliasCandidates(propName, prop.description || '').some((alias) => alias && searchable.includes(alias));
  if (matchedByAlias) return true;
  const signatureProps = selectedPropNamesFromCharacter(character);
  return signatureProps.some((signatureProp) => {
    const signatureKey = normalizeCompareText(signatureProp);
    const propKey = normalizeCompareText(propName);
    return hasManualBoundPropNames(character)
      ? Boolean(signatureKey && propKey && signatureKey === propKey)
      : Boolean(signatureKey && propKey && (signatureKey.includes(propKey) || propKey.includes(signatureKey)));
  });
}

export function findCharacterPropReferences(character: WorkflowAssetItem, assets: WorkflowAssets, options: { includeMissing?: boolean } = {}): ClipAssetReference[] {
  const refs: ClipAssetReference[] = [];
  const seen = new Set<string>();
  for (const prop of assetArray(assets, 'props')) {
    if (characterOwnsProp(character, prop) && (options.includeMissing || propHasUsableImage(prop)) && propIsCarryableReference(prop)) {
      pushClipAssetReference(refs, seen, 'props', prop, `绑定道具: ${workflowAssetName(character)}`, options);
    }
  }
  return refs;
}

function positioningBoardPropIsExplicitlyVisible(propName: string, prop: WorkflowAssetItem, clipScenes: BreakdownScene[]) {
  const aliases = propAliasCandidates(propName, prop.description || '')
    .map((alias) => normalizeCompareText(alias))
    .filter((alias) => alias.length >= 3);
  if (aliases.length === 0) return false;
  const visibleText = normalizeCompareText(clipScenes.flatMap((scene) => [
    scene.action,
    scene.description,
    scene.references,
    scene.visualPrompt,
    scene.directorBoardPrompt,
  ]).filter(Boolean).join('\n'));
  if (!visibleText) return false;
  const mention = aliases.some((alias) => visibleText.includes(alias));
  if (!mention) return false;
  const propKey = normalizeCompareText(propName);
  if (propKey && !visibleText.includes(propKey) && propKey.split(/\s+/).length > 1) {
    const genericAliasOnly = aliases.some((alias) => visibleText.includes(alias) && alias.split(/\s+/).length === 1);
    if (genericAliasOnly) {
      return /(holds?|holding|held|carries|carrying|clutches|clutching|aims?|aiming|points?|pointing|pressed|visible|in frame|foreground|midground|background|hand|grip|against|at his|at her|at their|拿|握|抱|举|指|对准|可见|入画|手中|身边|抵住)/i.test(visibleText);
    }
  }
  return true;
}

function uniqueReferenceNames(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const name = String(value || '').trim();
    const key = normalizeCompareText(name);
    if (!name || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

function clipPositioningBoardCharacterNamesForReferences(clip: Clip, clipScenes: BreakdownScene[]): string[] {
  const explicit = clipScenes.flatMap((scene) => {
    const raw = Array.isArray(scene.characters) ? scene.characters : [];
    return raw.map(String).filter((name) => characterIsExplicitlyVisibleInSceneForReferences(name, scene));
  });
  const continuity = [
    ...(Array.isArray(clip.characters) ? clip.characters.map(String) : []),
    ...clipScenes.flatMap((scene) => Array.isArray(scene.characters) ? scene.characters.map(String) : []),
  ].filter((name) => characterIsAllowedAsPositioningBoardContinuityReference(name, clip, clipScenes));
  return uniqueReferenceNames([...explicit, ...continuity]);
}

function characterIsAllowedAsPositioningBoardContinuityReference(name: string, clip: Clip, clipScenes: BreakdownScene[]): boolean {
  const key = normalizeCompareText(name);
  if (!key) return false;
  const searchableText = normalizeCompareText([
    clip.title,
    clip.plotGoal,
    clip.startState,
    clip.endState,
    clip.layoutMemory,
    ...clipScenes.flatMap((scene) => [
      scene.title,
      scene.description,
      scene.action,
      scene.visualPrompt,
      scene.references,
      scene.composition,
    ]),
  ].filter(Boolean).join('\n'));
  if (!searchableText.includes(key)) return false;
  return !characterMentionIsNonVisualOnlyForReferences(searchableText, key);
}

function characterIsExplicitlyVisibleInSceneForReferences(name: string, scene: BreakdownScene): boolean {
  const key = normalizeCompareText(name);
  if (!key) return false;
  const visualText = normalizeCompareText([
    scene.title,
    scene.description,
    scene.action,
    scene.visualPrompt,
    scene.references,
    scene.composition,
  ].join('\n'));
  if (!visualText.includes(key)) return false;
  return !characterMentionIsNonVisualOnlyForReferences(visualText, key);
}

function characterMentionIsNonVisualOnlyForReferences(searchableText: string, normalizedName: string): boolean {
  const escaped = escapeRegExp(normalizedName);
  const nonVisualPatterns = [
    new RegExp(`\\b${escaped}\\b[^.。!?\\n]{0,80}\\b(?:memory echo only|voice only|audio only|off[- ]?screen voice|voiceover|voice-over|narration only|heard only)\\b`),
    new RegExp(`\\b(?:memory echo only|voice only|audio only|off[- ]?screen voice|voiceover|voice-over|narration only|heard only)\\b[^.。!?\\n]{0,80}\\b${escaped}\\b`),
    new RegExp(`\\b${escaped}\\b[^.。!?\\n]{0,80}\\b(?:回声|声音|旁白|画外音|只闻其声|不出镜|记忆闪回|记忆回声)\\b`),
    new RegExp(`\\b(?:回声|声音|旁白|画外音|只闻其声|不出镜|记忆闪回|记忆回声)\\b[^.。!?\\n]{0,80}\\b${escaped}\\b`),
  ];
  if (!nonVisualPatterns.some((pattern) => pattern.test(searchableText))) return false;
  const visualOverridePatterns = [
    new RegExp(`\\b${escaped}\\b[^.。!?\\n]{0,80}\\b(?:appears physically|visible|on screen|in frame|enters|stands|holds|faces|walks|runs|grabs|points|looks)\\b`),
    new RegExp(`\\b${escaped}\\b[^.。!?\\n]{0,80}\\b(?:可见|出镜|入画|站在|拿着|面对|走进|跑向|抓住|指向|看向)\\b`),
  ];
  return !visualOverridePatterns.some((pattern) => pattern.test(searchableText));
}

export function collectClipPositioningBoardReferences(
  clip: Clip,
  clipScenes: BreakdownScene[],
  assets: WorkflowAssets,
  limit = 12,
  options: { includeMissing?: boolean } = {},
) {
  const refs: ClipAssetReference[] = [];
  const seen = new Set<string>();
  const includeMissing = options.includeMissing ?? false;
  const characters = assetArray(assets, 'characters');
  const scenes = assetArray(assets, 'scenes');
  const props = assetArray(assets, 'props');

  const visibleCharacterNames = clipPositioningBoardCharacterNamesForReferences(clip, clipScenes);
  for (const name of visibleCharacterNames) {
    if (refs.length >= limit) break;
    pushClipAssetReference(refs, seen, 'characters', findWorkflowAssetByName(characters, name), '角色参考', { includeMissing });
  }

  const primarySceneNames = primarySceneNamesForClip(clip, clipScenes);
  for (const name of primarySceneNames) {
    if (refs.length >= limit) break;
    pushClipAssetReference(refs, seen, 'scenes', findWorkflowAssetByName(scenes, name), '场景参考', { includeMissing });
  }
  if (primarySceneNames.length === 0) {
    const settingNames = [clip.setting, ...clipScenes.map((scene) => scene.setting)].filter((item): item is string => Boolean(item?.trim()));
    for (const name of settingNames) {
      if (refs.length >= limit) break;
      pushClipAssetReference(refs, seen, 'scenes', findWorkflowAssetByName(scenes, name), '场景参考', { includeMissing });
    }
  }

  for (const prop of props) {
    if (refs.length >= limit) break;
    const propName = workflowAssetName(prop);
    if (!propName) continue;
    if (positioningBoardPropIsExplicitlyVisible(propName, prop, clipScenes)) {
      pushClipAssetReference(refs, seen, 'props', prop, '当前可见道具', { includeMissing });
    }
  }

  return refs.slice(0, limit);
}

export function collectClipAssetReferences(
  clip: Clip,
  clipScenes: BreakdownScene[],
  assets: WorkflowAssets,
  limit = 12,
  extraSearchText = '',
  options: { includeProps?: boolean; includeScenes?: boolean; allScenes?: BreakdownScene[]; includeStoryboardPrompt?: boolean; includeMissing?: boolean } = {},
) {
  const refs: ClipAssetReference[] = [];
  const seen = new Set<string>();
  const includeProps = options.includeProps ?? true;
  const includeScenes = options.includeScenes ?? true;
  const includeMissing = options.includeMissing ?? false;
  const characters = assetArray(assets, 'characters');
  const scenes = assetArray(assets, 'scenes');
  const props = assetArray(assets, 'props');
  const explicitClipText = [
    ...clipScenes.flatMap((scene) => [scene.title, scene.description, scene.action, scene.references, scene.visualPrompt, scene.directorBoardPrompt, scene.composition]),
  ].join('\n');
  const propSearchText = [
    clip.title,
    clip.setting,
    clip.plotGoal,
    clip.startState,
    clip.endState,
    clip.layoutMemory,
    clip.storyboardNotes,
    extraSearchText,
    explicitClipText,
  ].join('\n');
  const characterSearchNormalized = normalizeCompareText(explicitClipText);
  const propSearchNormalized = normalizeCompareText(propSearchText);
  const characterNames = clipCurrentCharacterNamesForAssetReferences(clip, clipScenes, assets);
  const referencedCharacters: WorkflowAssetItem[] = [];
  const explicitCharacterKeys = new Set(characterNames.map((name) => normalizeCompareText(name)).filter(Boolean));

  for (const name of characterNames) {
    const character = findWorkflowAssetByName(characters, name);
    if (pushClipAssetReference(refs, seen, 'characters', character, '角色参考', { includeMissing }) && character) {
      referencedCharacters.push(character);
    }
  }

  for (const character of characters) {
    const characterName = workflowAssetName(character);
    if (!characterName) continue;
    const characterKey = normalizeCompareText(characterName);
    if (!explicitCharacterKeys.has(characterKey) && characterNameLooksPhysicallyPresent(characterSearchNormalized, characterName)) {
      if (pushClipAssetReference(refs, seen, 'characters', character, '角色引用参考', { includeMissing })) {
        referencedCharacters.push(character);
      }
    }
  }

  if (includeScenes) {
    const primarySceneNames = primarySceneNamesForClip(clip, clipScenes, extraSearchText);
    for (const name of primarySceneNames) {
      pushClipAssetReference(refs, seen, 'scenes', findWorkflowAssetByName(scenes, name), '场景参考', { includeMissing });
    }

    if (primarySceneNames.length === 0) {
      const settingNames = [clip.setting, ...clipScenes.map((scene) => scene.setting)].filter((item): item is string => Boolean(item?.trim()));
      for (const name of settingNames) {
        pushClipAssetReference(refs, seen, 'scenes', findWorkflowAssetByName(scenes, name), '场景参考', { includeMissing });
      }
    }

    if (primarySceneNames.length === 0) {
      for (const scene of scenes) {
        const sceneName = workflowAssetName(scene);
        if (!sceneName) continue;
        if (propSearchNormalized.includes(normalizeCompareText(sceneName))) {
          pushClipAssetReference(refs, seen, 'scenes', scene, '场景引用参考', { includeMissing });
        }
      }
    }
  }

  if (includeProps) {
    for (const character of referencedCharacters) {
      for (const propReference of findCharacterPropReferences(character, assets, { includeMissing })) {
        pushClipAssetReference(refs, seen, propReference.kind, findWorkflowAssetByName(props, propReference.name), propReference.label, { includeMissing });
      }
    }

    for (const prop of props) {
      const propName = workflowAssetName(prop);
      if (!propName) continue;
      const mentioned = propAliasCandidates(propName, prop.description || '').some((alias) => alias && propSearchNormalized.includes(alias));
      if (mentioned) {
        pushClipAssetReference(refs, seen, 'props', prop, '道具参考', { includeMissing });
      }
    }
  }

  return refs.slice(0, limit);
}

export function isClipStoryboardNodeForClip(node: { type?: string; data?: any }, clip: Clip): boolean {
  const data = node.data ?? {};
  if (node.type !== 'generation' && node.type !== 'imageInput') return false;
  const searchable = String([data.title, data.label, data.description, data.sourcePrompt, data.prompt, data.finalPrompt, data.submittedPrompt].filter(Boolean).join('\n'));
  if (looksLikeCharacterReferenceSheet(searchable)) return false;
  if (data.clipId && data.clipId === clip.id) {
    return data.clipNodeKind === 'storyboard' || data.storyboardForClip === true || /故事板|storyboard/i.test(String(data.title || data.description || ''));
  }
  if (data.clipId && data.clipId !== clip.id) return false;
  const clipTitle = normalizeCompareText(clip.title || '');
  const title = normalizeCompareText(String(data.title || ''));
  return Boolean(clipTitle && title.includes(clipTitle) && /故事板|storyboard/i.test(String(data.title || data.description || '')));
}

export function findClipStoryboardNode(nodes: Array<{ id: string; type?: string; data?: any }>, clip: Clip) {
  const candidates = nodes.filter((node) => isClipStoryboardNodeForClip(node, clip));
  return candidates.find((node) => node.type === 'generation') ?? candidates[0];
}

export function normalizedClipNodeTitle(value: unknown): string {
  return normalizeCompareText(String(value || ''))
    .replace(/\s*(视频任务|故事板|storyboard|video task|clip-level director board|director board)\s*$/i, '')
    .trim();
}

export function clipTitleTokens(clip: Clip): string[] {
  const title = normalizeCompareText(clip.title || '');
  const tokens = new Set<string>();
  if (clip.id) tokens.add(normalizeCompareText(clip.id));
  const clipNumber = title.match(/\bclip\s*0*(\d+)\b/i)?.[1];
  if (clipNumber) {
    tokens.add(`clip ${clipNumber.padStart(2, '0')}`);
    tokens.add(`clip-${clipNumber.padStart(3, '0')}`);
  }
  for (const part of title.split(/[·:()/-]+/)) {
    const token = normalizeCompareText(part);
    if (token.length >= 4 && !/^clip\s*\d+$/i.test(token) && !/^\d+$/.test(token)) tokens.add(token);
  }
  return Array.from(tokens).filter(Boolean);
}

export function significantStoryboardTokens(value: unknown, limit = 40): string[] {
  const stopWords = new Set([
    'clip', 'shot', 'scene', 'storyboard', 'director', 'board', 'image', 'panel', 'panels',
    'style', 'visual', 'prompt', 'generate', 'continuous', 'cinematic', 'camera', 'label',
    'wide', 'medium', 'close', 'level', 'slow', 'push', 'with', 'from', 'that', 'this',
    'into', 'over', 'under', 'the', 'and', 'for',
  ]);
  const normalized = normalizeCompareText(String(value || '')).replace(/[^a-z0-9\u4e00-\u9fff']+/gi, ' ');
  const tokens = new Set<string>();
  for (const token of normalized.split(/\s+/)) {
    if (token.length < 4 || /^\d+$/.test(token) || stopWords.has(token)) continue;
    tokens.add(token);
    if (tokens.size >= limit) break;
  }
  return Array.from(tokens);
}

export function textMatchesClip(text: string, clip: Clip): boolean {
  const normalized = normalizeCompareText(text);
  if (!normalized) return false;
  return clipTitleTokens(clip).some((token) => token.length >= 4 && normalized.includes(token));
}

export function recordHasExplicitClipAnchor(text: string, clip: Clip): boolean {
  const normalized = normalizeCompareText(text);
  if (!normalized) return false;
  if (clip.id && normalized.includes(normalizeCompareText(clip.id))) return true;
  const title = normalizeCompareText(clip.title || '');
  if (title && normalized.includes(title)) return true;
  const clipNumber = title.match(/\bclip\s*0*(\d+)\b/i)?.[1];
  if (!clipNumber) return false;
  const padded2 = clipNumber.padStart(2, '0');
  const padded3 = clipNumber.padStart(3, '0');
  return new RegExp(`\\bclip\\s*0*${Number(clipNumber)}\\b|\\bclip[-_\\s]?${padded2}\\b|\\bclip[-_\\s]?${padded3}\\b`, "i").test(normalized);
}

export function stripPreviousStoryboardReferenceText(value: unknown): string {
  return String(value || '')
    .replace(/Use the linked previous storyboard image[\s\S]*?as the continuity reference for scene layout[\s\S]*?(?:resetting the scene\.|character positions\.?)\s*/gi, ' ')
    .replace(/(^|\n)\s*上一个故事板[:：][^\n。.]*(?:[。.])?\s*(?=\n|$)/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

export function looksLikeCharacterReferenceSheet(text: string): boolean {
  return /(character\s+(reference|model|turnaround|sheet)|model\s+sheet|reference\s+sheet|turnaround|orthographic|front\s+view|side\s+view|back\s+view|expression\s+sheet|pose\s+sheet|角色设定|角色三视图|表情表|设定图|转面图|正面|侧面|背面)/i.test(text);
}

export function scoreClipStoryboardMatch(text: string, clip: Clip): number {
  const normalized = normalizeCompareText(text);
  if (!normalized) return 0;

  let score = textMatchesClip(text, clip) ? 80 : 0;
  const setting = normalizeCompareText(clip.setting || '');
  if (setting) {
    if (normalized.includes(setting)) {
      score += 70;
    } else {
      const settingHits = significantStoryboardTokens(setting, 8).filter((token) => normalized.includes(token)).length;
      score += settingHits * 14;
    }
  }

  const characterNames = Array.from(new Set((clip.characters ?? []).map((name) => normalizeCompareText(name)).filter(Boolean)));
  const characterHits = characterNames.filter((name) => normalized.includes(name)).length;
  score += characterHits * 12;
  if (characterHits >= Math.min(2, characterNames.length)) score += 18;
  if (characterNames.length > 0 && characterHits === characterNames.length) score += 12;

  const titleTokenHits = significantStoryboardTokens(clip.title, 10).filter((token) => normalized.includes(token)).length;
  score += titleTokenHits * 8;

  for (const shotId of clip.shotIds ?? []) {
    if (shotId && normalized.includes(normalizeCompareText(shotId))) score += 18;
  }

  const promptStart = normalizeCompareText(String(clip.storyboardPrompt || '')).slice(0, 160);
  if (promptStart.length >= 80 && normalized.includes(promptStart)) score += 90;

  const clipContext = [
    clip.plotGoal,
    clip.startState,
    clip.endState,
    clip.layoutMemory,
    clip.storyboardPrompt,
    clip.seedancePrompt,
  ].filter(Boolean).join(' ');
  const contextHits = significantStoryboardTokens(clipContext, 28).filter((token) => normalized.includes(token)).length;
  score += Math.min(42, contextHits * 3);

  return score;
}

export function bestStoryboardClipMatch(text: string, clips: Clip[]): Clip | undefined {
  let best: { clip: Clip; score: number } | null = null;
  for (const clip of clips) {
    const score = scoreClipStoryboardMatch(text, clip);
    if (!best || score > best.score) best = { clip, score };
  }
  return best && best.score >= 55 ? best.clip : undefined;
}

export function storyboardReferenceMatchesClip(ref: ClipStoryboardImageReference, clip: Clip): boolean {
  if (ref.clipId && ref.clipId === clip.id) return true;
  if (ref.clipId && ref.clipId !== clip.id) return false;
  return scoreClipStoryboardMatch([ref.prompt, ref.clipTitle, ref.title].filter(Boolean).join('\n'), clip) >= 55;
}

export function findExactClipStoryboardReference(
  refs: ClipStoryboardImageReference[],
  clip: Clip,
  blockedStoryboardUrls: Set<string> = new Set(),
): ClipStoryboardImageReference | null {
  return refs.find((ref) => Boolean(ref.url && ref.clipId === clip.id && !blockedStoryboardUrls.has(ref.url))) ?? null;
}

export function canPreserveExistingClipStoryboardOutput(data: any, clip: Clip, episodeId: string, episodeTitle: string): boolean {
  const url = publicImageUrl(data?.outputImage);
  if (!url) return false;
  const nodeEpisodeId = canvasNodeEpisodeId(data);
  if (nodeEpisodeId && normalizeCompareText(nodeEpisodeId) !== normalizeCompareText(episodeId)) return false;
  const sourceEpisode = typeof data?.sourceEpisode === 'string' ? data.sourceEpisode : '';
  if (sourceEpisode && normalizeCompareText(sourceEpisode) !== normalizeCompareText(episodeTitle) && normalizeCompareText(sourceEpisode) !== normalizeCompareText(episodeId)) {
    return false;
  }
  const submittedPrompt = String(data?.submittedPrompt || '');
  if (!submittedPrompt) return false;
  return scoreClipStoryboardMatch(stripPreviousStoryboardReferenceText(submittedPrompt), clip) >= 120;
}

export function looksLikeStoryboardPrompt(text: string): boolean {
  if (looksLikeCharacterReferenceSheet(text)) return false;
  return /(storyboard|director board|production board|clip-level director|故事板|导演板|分镜)/i.test(text);
}

export function generationRecordImageUrl(record: GenerationRecord): { url: string; assetId?: string; title?: string } | null {
  const asset = record.assets.find((item) => item.url && String(item.type || '').toUpperCase() === 'IMAGE') ?? record.assets.find((item) => item.url);
  const url = publicImageUrl(asset?.url);
  if (!url) return null;
  return { url, assetId: asset?.id, title: asset?.title };
}

export function generationRecordImageUrls(record: GenerationRecord): Array<{ url: string; assetId?: string; title?: string }> {
  return record.assets
    .filter((item) => item.url && (!item.type || String(item.type).toUpperCase() === 'IMAGE'))
    .map((asset) => {
      const url = publicImageUrl(asset.url);
      return url ? { url, assetId: asset.id, title: asset.title } : null;
    })
    .filter((item): item is { url: string; assetId?: string; title?: string } => Boolean(item));
}

export function generationRecordVideoUrl(record: GenerationRecord): { url: string; assetId?: string; title?: string } | null {
  const asset = record.assets.find((item) => item.url && String(item.type || '').toUpperCase() === 'VIDEO') ?? null;
  const url = typeof asset?.url === 'string' ? asset.url : '';
  if (!url) return null;
  return { url, assetId: asset?.id, title: asset?.title };
}

export function canvasOutputImageVariantsFromResult(result: WorkflowAssetImageGenerationResponse): Array<{ url: string; assetId?: string; title?: string; revisedPrompt?: string }> {
  const assets = Array.isArray(result.assets) ? result.assets : [];
  const images = Array.isArray(result.images) && result.images.length > 0
    ? result.images
    : result.image?.url ? [result.image] : [];
  return images
    .map((image, index) => {
      const url = publicImageUrl(image?.url);
      if (!url) return null;
      const asset = assets[index];
      return {
        url,
        assetId: readObjectString(asset, 'id'),
        title: readObjectString(asset, 'title'),
        revisedPrompt: image?.revisedPrompt,
      };
    })
    .filter((item): item is { url: string; assetId?: string; title?: string; revisedPrompt?: string } => Boolean(item));
}

export function canvasOutputImageVariantsEqual(
  left: unknown,
  right: Array<{ url: string; assetId?: string; title?: string; revisedPrompt?: string }>,
): boolean {
  if (!Array.isArray(left)) return right.length === 0;
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const current = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const expected = right[index];
    return (
      publicImageUrl(current.url) === expected.url &&
      readObjectString(current, 'assetId') === (expected.assetId || '') &&
      readObjectString(current, 'title') === (expected.title || '')
    );
  });
}

export function generationRecordTime(record: GenerationRecord): number {
  const value = record.completedAt || record.updatedAt || record.createdAt || record.startedAt || record.queuedAt || '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function generationRecordStartedAt(record: GenerationRecord): string {
  return record.startedAt || record.createdAt || record.queuedAt || '';
}

export function isRecentGenerationRecord(record: GenerationRecord): boolean {
  const time = generationRecordTime(record);
  return time > 0 && Date.now() - time <= CANVAS_GENERATION_STALE_MS;
}

export function generationRecordPromptKey(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function clipPromptBatchStorageKey(kind: ClipPromptBatchKind, projectId: string | undefined, episodeId?: string): string {
  return `loohii-clip-prompt-batch:${kind}:${projectId || 'local'}:${episodeId || 'default'}`;
}

export function readPersistedClipPromptBatch(kind: ClipPromptBatchKind, projectId: string | undefined, episodeId?: string): PersistedClipPromptBatch | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(clipPromptBatchStorageKey(kind, projectId, episodeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedClipPromptBatch>;
    if (parsed.version !== 1 || parsed.kind !== kind || parsed.projectId !== (projectId || 'local')) return null;
    if (!Array.isArray(parsed.clipIds) || parsed.clipIds.length === 0) return null;
    const updatedAt = Date.parse(String(parsed.updatedAt || parsed.createdAt || ''));
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > CLIP_PROMPT_BATCH_MAX_AGE_MS) {
      window.localStorage.removeItem(clipPromptBatchStorageKey(kind, projectId, episodeId));
      return null;
    }
    return {
      version: 1,
      kind,
      projectId: projectId || 'local',
      episodeId,
      clipIds: parsed.clipIds.map(String).filter(Boolean),
      completedClipIds: Array.isArray(parsed.completedClipIds) ? parsed.completedClipIds.map(String).filter(Boolean) : [],
      failedClipIds: Array.isArray(parsed.failedClipIds) ? parsed.failedClipIds.map(String).filter(Boolean) : [],
      currentClipId: typeof parsed.currentClipId === 'string' ? parsed.currentClipId : undefined,
      panelChoices: parsed.panelChoices as Record<string, ClipPanelCountChoice> | undefined,
      aiModelId: typeof parsed.aiModelId === 'string' ? parsed.aiModelId : undefined,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writePersistedClipPromptBatch(batch: PersistedClipPromptBatch): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      clipPromptBatchStorageKey(batch.kind, batch.projectId, batch.episodeId),
      JSON.stringify({ ...batch, updatedAt: new Date().toISOString() }),
    );
  } catch {
    // Ignore storage failures; the active request still continues in memory.
  }
}

export function clearPersistedClipPromptBatch(kind: ClipPromptBatchKind, projectId: string | undefined, episodeId?: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(clipPromptBatchStorageKey(kind, projectId, episodeId));
  } catch {
    // Ignore storage failures.
  }
}

export function shouldResumePersistedClipPromptBatch(batch: PersistedClipPromptBatch, currentAiModelId: string, clipIds: string[]): boolean {
  const savedModelId = batch.aiModelId || '';
  const activeModelId = currentAiModelId || '';
  if (savedModelId !== activeModelId) return false;
  if ((batch.failedClipIds?.length ?? 0) > 0) return false;
  const availableClipIds = new Set(clipIds);
  const completedClipIds = new Set(batch.completedClipIds);
  return batch.clipIds.some((clipId) => availableClipIds.has(clipId) && !completedClipIds.has(clipId));
}

export function shouldIgnoreStoppedCanvasGenerationRecord(
  nodeData: Record<string, unknown> | undefined,
  record: GenerationRecord,
  prompt: string,
): boolean {
  const stoppedAt = Date.parse(String(nodeData?.generationStoppedAt || ''));
  if (!Number.isFinite(stoppedAt)) return false;
  const recordStartedAt = Date.parse(generationRecordStartedAt(record));
  if (Number.isFinite(recordStartedAt) && recordStartedAt > stoppedAt + 3000) return false;
  if (!Number.isFinite(recordStartedAt)) {
    const recordTime = generationRecordTime(record);
    if (recordTime > stoppedAt + 3000) return false;
  }
  const stoppedPrompt = generationRecordPromptKey(nodeData?.stoppedSubmittedPrompt);
  const recordPrompt = generationRecordPromptKey(record.prompt);
  if (stoppedPrompt) return recordPrompt === stoppedPrompt;
  return recordPrompt === generationRecordPromptKey(prompt);
}

export function shouldAllowMissingBackendTaskRecovery(node: { id?: string; data?: any }, record: GenerationRecord, prompt: string): boolean {
  const error = String(node.data?.error || '');
  if (!/没有找到对应的后端生成任务/.test(error)) return false;
  const nodeId = String(node.id || '').trim();
  if (!nodeId || generationRecordNodeId(record) !== nodeId) return false;
  return generationRecordPromptKey(record.prompt) === generationRecordPromptKey(prompt);
}

export function generationRecordObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function generationRecordInputKind(record: GenerationRecord): string {
  const input = generationRecordObject(record.input);
  return typeof input.kind === 'string' ? input.kind : '';
}

export function generationRecordMetadataObjects(record: GenerationRecord): Record<string, unknown>[] {
  const input = generationRecordObject(record.input);
  const inputMetadata = generationRecordObject(input.metadata);
  const assetMetadata = record.assets
    .map((asset) => generationRecordObject(asset.metadata))
    .filter((metadata) => Object.keys(metadata).length > 0);
  return [
    ...(Object.keys(inputMetadata).length > 0 ? [inputMetadata] : []),
    ...assetMetadata,
  ];
}

export function generationRecordRequestId(record: GenerationRecord): string {
  const input = generationRecordObject(record.input);
  const inputMetadata = generationRecordObject(input.metadata);
  const inputRequestId = readObjectString(inputMetadata, 'requestId');
  if (inputRequestId) return inputRequestId;
  for (const metadata of generationRecordMetadataObjects(record)) {
    const requestId = readObjectString(metadata, 'requestId');
    if (requestId) return requestId;
  }
  return '';
}

export function generationRecordSourceEpisode(record: GenerationRecord): string {
  for (const metadata of generationRecordMetadataObjects(record)) {
    const sourceEpisode = readObjectString(metadata, 'sourceEpisode');
    if (sourceEpisode) return sourceEpisode;
  }
  return '';
}

export function generationRecordSourceEpisodeId(record: GenerationRecord): string {
  for (const metadata of generationRecordMetadataObjects(record)) {
    const sourceEpisodeId = readObjectString(metadata, 'sourceEpisodeId');
    if (sourceEpisodeId) return sourceEpisodeId;
    const sourceEpisode = readObjectString(metadata, 'sourceEpisode');
    if (sourceEpisode && isWorkflowEpisodeId(sourceEpisode)) return sourceEpisode;
  }
  return '';
}

export function generationRecordBelongsToEpisode(record: GenerationRecord, episodeId: string, episodeTitle = ''): boolean {
  const expectedEpisodeId = episodeId.trim();
  const recordEpisodeId = generationRecordSourceEpisodeId(record);
  if (expectedEpisodeId && recordEpisodeId) {
    return normalizeCompareText(recordEpisodeId) === normalizeCompareText(expectedEpisodeId);
  }

  const recordEpisodeTitle = generationRecordSourceEpisode(record);
  if (recordEpisodeTitle) {
    if (expectedEpisodeId && normalizeCompareText(recordEpisodeTitle) === normalizeCompareText(expectedEpisodeId)) return true;
    return Boolean(episodeTitle) && normalizeCompareText(recordEpisodeTitle) === normalizeCompareText(episodeTitle);
  }

  // Older generations had no episode metadata. Keep them only for the legacy first episode.
  return normalizeCompareText(expectedEpisodeId || 'episode-001') === 'episode-001';
}

export type CanvasGenerationRecoveryKeys = {
  generationIds: Set<string>;
  requestIds: Set<string>;
  nodeIds: Set<string>;
  promptKeys: Set<string>;
};

export function canvasActiveGenerationRecoveryKeys(nodes: Array<{ id?: string; type?: string; data?: any }>): CanvasGenerationRecoveryKeys {
  const generationIds = new Set<string>();
  const requestIds = new Set<string>();
  const nodeIds = new Set<string>();
  const promptKeys = new Set<string>();
  for (const node of nodes) {
    if (node.type !== 'generation') continue;
    const status = String(node.data?.status || '').trim();
    if (status && status !== 'generating' && status !== 'failed' && status !== 'waiting') continue;
    const generationId = String(node.data?.generationId || '').trim();
    if (generationId) generationIds.add(generationId);
    const requestId = String(node.data?.generationRequestId || '').trim();
    if (requestId) requestIds.add(requestId);
    const nodeId = String(node.id || node.data?.nodeId || '').trim();
    if (nodeId) nodeIds.add(nodeId);
    for (const prompt of [node.data?.submittedPrompt, node.data?.finalPrompt, node.data?.prompt]) {
      const promptKey = generationRecordPromptKey(prompt);
      if (promptKey) promptKeys.add(promptKey);
    }
  }
  return { generationIds, requestIds, nodeIds, promptKeys };
}

export function generationRecordNodeId(record: GenerationRecord): string {
  for (const metadata of generationRecordMetadataObjects(record)) {
    const nodeId = readObjectString(metadata, 'nodeId');
    if (nodeId) return nodeId;
  }
  return '';
}

export function generationRecordMatchesActiveCanvasGeneration(record: GenerationRecord, keys: CanvasGenerationRecoveryKeys): boolean {
  if (generationRecordInputKind(record) !== 'canvas-image-generation') return false;
  if (keys.generationIds.has(record.id)) return true;
  const requestId = generationRecordRequestId(record);
  if (requestId && keys.requestIds.has(requestId)) return true;
  const nodeId = generationRecordNodeId(record);
  if (nodeId && keys.nodeIds.has(nodeId)) return true;
  const promptKey = generationRecordPromptKey(record.prompt);
  return Boolean(promptKey && keys.promptKeys.has(promptKey));
}

export function readMetadataBoolean(metadata: Record<string, unknown>, key: string): boolean | undefined {
  const value = metadata[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return undefined;
}

export function metadataLooksLikeClipStoryboard(metadata: Record<string, unknown>): boolean {
  const storyboardForClip = readMetadataBoolean(metadata, 'storyboardForClip');
  if (storyboardForClip === false) return false;
  const clipNodeKind = readObjectString(metadata, 'clipNodeKind');
  if (clipNodeKind && clipNodeKind !== 'storyboard') return false;
  if (clipNodeKind === 'storyboard' || storyboardForClip === true) return true;
  const text = [readObjectString(metadata, 'title'), readObjectString(metadata, 'clipTitle')].join(' ');
  return /故事板|storyboard/i.test(text);
}

export function workflowEpisodeLibraryTitle(episode: WorkflowEpisodeSummary): string {
  return episode.title || episode.selectedEpisode || episode.id || '未命名集';
}

export function assetLibraryEpisodeMatches(episodeId: string, episodeFilter: AssetLibraryEpisodeFilter): boolean {
  return episodeFilter === 'all' || episodeId === episodeFilter;
}

export function assetLibraryAssetDescription(item: WorkflowAssetItem): string {
  return [
    item.lockedVisualIdentity,
    item.description,
    item.visualPrompt,
    item.role,
    item.timeOfDay,
    item.function,
  ].find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

export function collectEpisodeAssetLibraryItems(
  bundles: EpisodeWorkflowAssetBundle[],
  category: WorkflowAssetKind,
  episodeFilter: AssetLibraryEpisodeFilter,
): AssetLibraryItem[] {
  return bundles
    .filter((bundle) => assetLibraryEpisodeMatches(bundle.episode.id, episodeFilter))
    .flatMap((bundle) => {
      const episodeTitle = workflowEpisodeLibraryTitle(bundle.episode);
      return assetArray(bundle.workflow?.assets ?? defaultWorkflowAssets(), category)
        .map((asset, index) => {
          const name = workflowAssetName(asset) || `${workflowAssetKindLabel(category)} ${index + 1}`;
          const imageUrl = workflowAssetImageUrl(asset);
          return {
            id: `${bundle.episode.id}:${category}:${stableCanvasIdPart(asset.id || name, `asset-${index}`)}:${index}`,
            kind: category,
            episodeId: bundle.episode.id,
            episodeTitle,
            name,
            description: assetLibraryAssetDescription(asset),
            imageUrl,
            imageAssetId: workflowAssetImageAssetId(asset),
            asset: { ...asset, name, title: asset.title || name },
          };
        });
    });
}

export function generationRecordStoryboardMetadataTitle(record: GenerationRecord): string {
  for (const metadata of generationRecordMetadataObjects(record)) {
    const title = readObjectString(metadata, 'clipTitle') || readObjectString(metadata, 'title');
    if (title) return title;
  }
  return '';
}

export function generationRecordLooksLikeDirectorBoard(record: GenerationRecord, imageTitle = ''): boolean {
  if (looksLikeStoryboardPrompt(record.prompt)) return true;
  if (generationRecordMetadataObjects(record).some(metadataLooksLikeClipStoryboard)) return true;
  return /(storyboard|director board|production board|clip-level director|故事板|导演板|分镜)/i.test(imageTitle);
}

export function collectDirectorBoardLibraryItems(
  records: GenerationRecord[],
  episodes: WorkflowEpisodeSummary[],
  episodeFilter: AssetLibraryEpisodeFilter,
): DirectorBoardLibraryItem[] {
  const usableEpisodes = episodes.length ? episodes : defaultEpisodeList().episodes;
  const episodeIndex = new Map(usableEpisodes.map((episode, index) => [episode.id, index]));
  return records
    .map((record) => {
      if (record.status && record.status !== 'SUCCEEDED') return null;
      const image = generationRecordImageUrl(record);
      if (!image?.url || !generationRecordLooksLikeDirectorBoard(record, image.title || '')) return null;
      const episode = usableEpisodes.find((item) => generationRecordBelongsToEpisode(record, item.id, workflowEpisodeLibraryTitle(item))) ?? usableEpisodes[0];
      if (!episode || !assetLibraryEpisodeMatches(episode.id, episodeFilter)) return null;
      const title = generationRecordStoryboardMetadataTitle(record) || image.title || '导演板';
      const createdAt = record.completedAt || record.createdAt || record.updatedAt || record.startedAt || '';
      return {
        id: record.id,
        episodeId: episode.id,
        episodeTitle: workflowEpisodeLibraryTitle(episode),
        name: title,
        description: createdAt ? new Date(createdAt).toLocaleString() : '生成记录',
        imageUrl: image.url,
        imageAssetId: image.assetId || '',
        prompt: record.prompt || '',
        generationId: record.id,
        createdAt,
      };
    })
    .filter((item): item is DirectorBoardLibraryItem => Boolean(item))
    .sort((a, b) => {
      const episodeDelta = (episodeIndex.get(a.episodeId) ?? 999) - (episodeIndex.get(b.episodeId) ?? 999);
      if (episodeDelta !== 0) return episodeDelta;
      return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);
    });
}

export function generationRecordExplicitStoryboardClip(record: GenerationRecord, clips: Clip[]): Clip | undefined {
  for (const metadata of generationRecordMetadataObjects(record)) {
    if (!metadataLooksLikeClipStoryboard(metadata)) continue;
    const clipId = readObjectString(metadata, 'clipId');
    if (clipId) {
      const byId = clips.find((clip) => clip.id === clipId);
      if (byId) return byId;
    }
    const clipTitle = normalizedClipNodeTitle(readObjectString(metadata, 'clipTitle') || readObjectString(metadata, 'title'));
    if (clipTitle) {
      const byTitle = clips.find((clip) => {
        const candidate = normalizedClipNodeTitle(clip.title);
        return candidate && (candidate === clipTitle || candidate.includes(clipTitle) || clipTitle.includes(candidate));
      });
      if (byTitle) return byTitle;
    }
  }
  return undefined;
}

export function stripPreviousStoryboardContinuityText(value: unknown): string {
  return stripPreviousStoryboardReferenceText(value)
    .replace(/Previous Clip end state to continue from:[\s\S]*?(?=(?:Reference image map:|Create one|Create a|Required continuity characters:|Character reference lock:|Dialogue lock:|Panel\s+\d+:|$))/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function storyboardRecordOwnershipText(record: GenerationRecord, image: { title?: string }): string {
  const metadataText = generationRecordMetadataObjects(record)
    .map((metadata) => [
      readObjectString(metadata, 'clipId'),
      readObjectString(metadata, 'clipTitle'),
      readObjectString(metadata, 'clipNodeKind'),
      readObjectString(metadata, 'title'),
    ].filter(Boolean).join(' '))
    .filter(Boolean)
    .join('\n');
  return [
    stripPreviousStoryboardContinuityText(record.prompt),
    metadataText,
    JSON.stringify(record.parameters ?? {}),
    image.title,
  ].filter(Boolean).join('\n');
}

export function generationRecordReferenceImageCount(record: GenerationRecord): number {
  const input = generationRecordObject(record.input);
  const inputRefs = Array.isArray(input.referenceImageUrls) ? input.referenceImageUrls : [];
  if (inputRefs.length > 0) return inputRefs.length;
  const parameters = generationRecordObject(record.parameters);
  const imageUrls = Array.isArray(parameters.image_urls) ? parameters.image_urls : [];
  return imageUrls.length;
}

export function generationRecordResolution(record: GenerationRecord): string {
  const parameters = generationRecordObject(record.parameters);
  if (typeof parameters.resolution === 'string') return parameters.resolution;
  const input = generationRecordObject(record.input);
  const inputParameters = generationRecordObject(input.parameters);
  return typeof inputParameters.resolution === 'string' ? inputParameters.resolution : '';
}

export function findLatestCanvasImageGenerationRecord(
  records: GenerationRecord[],
  prompt: string,
  options: { notBefore?: string | number; requestId?: string; generationId?: string } = {},
): GenerationRecord | null {
  const generationId = String(options.generationId || '').trim();
  if (generationId) {
    const byId = records.find((record) => record.id === generationId && generationRecordInputKind(record) === 'canvas-image-generation');
    if (byId) return byId;
  }
  const promptKey = generationRecordPromptKey(prompt);
  if (!promptKey) return null;
  const requestId = String(options.requestId || '').trim();
  const notBefore = typeof options.notBefore === 'number' ? options.notBefore : Date.parse(String(options.notBefore || ''));
  const hasNotBefore = Number.isFinite(notBefore);
  return [...records]
    .sort((a, b) => generationRecordTime(b) - generationRecordTime(a))
    .find((record) => (
      generationRecordInputKind(record) === 'canvas-image-generation' &&
      generationRecordPromptKey(record.prompt) === promptKey &&
      (!requestId || generationRecordRequestId(record) === requestId) &&
      (!hasNotBefore || generationRecordTime(record) >= notBefore - 3000)
    )) ?? null;
}

export function findLatestCanvasImageGenerationRecordForNode(
  records: GenerationRecord[],
  node: { data?: any },
  prompt: string,
  options: { notBefore?: string | number; requestId?: string; generationId?: string } = {},
): GenerationRecord | null {
  const byPrompt = findLatestCanvasImageGenerationRecord(records, prompt, options);
  if (byPrompt) return byPrompt;

  const requestId = String(options.requestId || '').trim();
  const clipId = typeof node.data?.clipId === 'string' ? node.data.clipId : '';
  const clipNodeKind = typeof node.data?.clipNodeKind === 'string' ? node.data.clipNodeKind : '';
  if (!clipId || !clipNodeKind) return null;

  const notBefore = typeof options.notBefore === 'number' ? options.notBefore : Date.parse(String(options.notBefore || ''));
  const hasNotBefore = Number.isFinite(notBefore);
  return [...records]
    .sort((a, b) => generationRecordTime(b) - generationRecordTime(a))
    .find((record) => {
      if (generationRecordInputKind(record) !== 'canvas-image-generation') return false;
      if (requestId && generationRecordRequestId(record) !== requestId) return false;
      if (hasNotBefore && generationRecordTime(record) < notBefore - 3000) return false;
      return generationRecordMetadataObjects(record).some((metadata) => (
        readObjectString(metadata, 'clipId') === clipId &&
        readObjectString(metadata, 'clipNodeKind') === clipNodeKind
      ));
    }) ?? null;
}

export function findLatestCanvasVideoGenerationRecordForNode(
  records: GenerationRecord[],
  node: { id?: string; data?: any },
  prompt: string,
  options: { notBefore?: string | number; generationId?: string } = {},
): GenerationRecord | null {
  const generationId = String(options.generationId || '').trim();
  if (generationId) {
    const byId = records.find((record) => record.id === generationId && generationRecordInputKind(record) === 'canvas-video-generation');
    if (byId) return byId;
  }
  const promptKey = generationRecordPromptKey(prompt);
  const notBefore = typeof options.notBefore === 'number' ? options.notBefore : Date.parse(String(options.notBefore || ''));
  const hasNotBefore = Number.isFinite(notBefore);
  const nodeId = String(node.id || node.data?.nodeId || '').trim();
  const clipId = typeof node.data?.clipId === 'string' ? node.data.clipId : '';
  return [...records]
    .sort((a, b) => generationRecordTime(b) - generationRecordTime(a))
    .find((record) => {
      if (generationRecordInputKind(record) !== 'canvas-video-generation') return false;
      if (hasNotBefore && generationRecordTime(record) < notBefore - 3000) return false;
      const recordNodeId = generationRecordNodeId(record);
      if (nodeId && recordNodeId && nodeId === recordNodeId) return true;
      if (clipId && generationRecordMetadataObjects(record).some((metadata) => readObjectString(metadata, 'clipId') === clipId)) return true;
      return Boolean(promptKey && generationRecordPromptKey(record.prompt) === promptKey);
    }) ?? null;
}

export function recoverCanvasImageFromGenerationRecords(
  records: GenerationRecord[],
  prompt: string,
  options: { notBefore?: string | number; requestId?: string; generationId?: string } = {},
): WorkflowAssetImageGenerationResponse | null {
  const match = findLatestCanvasImageGenerationRecord(records, prompt, options);
  if (!match || match.status !== 'SUCCEEDED') return null;
  const image = generationRecordImageUrl(match);
  if (!image) return null;
  const variants = generationRecordImageUrls(match);
  const images = variants.map((item) => ({ url: item.url }));
  const assets = variants.map((item) => ({ id: item.assetId, title: item.title, url: item.url }));
  return {
    generation: match,
    asset: image.assetId ? { id: image.assetId, title: image.title, url: image.url } : undefined,
    assets,
    prompt: match.prompt,
    image: { url: image.url },
    images,
  };
}

export function storyboardReferencesFromGenerationRecords(
  records: GenerationRecord[],
  clips: Clip[],
  options: { episodeId?: string; episode?: string } = {},
): ClipStoryboardImageReference[] {
  const refs: ClipStoryboardImageReference[] = [];
  const seen = new Set<string>();
  const seenMatchedClips = new Set<string>();
  const orderedRecords = [...records].sort((a, b) => generationRecordTime(b) - generationRecordTime(a));
  for (const record of orderedRecords) {
    if (options.episodeId && !generationRecordBelongsToEpisode(record, options.episodeId, options.episode)) continue;
    if (record.status !== 'SUCCEEDED') continue;
    if (generationRecordInputKind(record) !== 'canvas-image-generation') continue;
    const image = generationRecordImageUrl(record);
    if (!image) continue;
    const searchable = storyboardRecordOwnershipText(record, image);
    if (!looksLikeStoryboardPrompt(searchable)) continue;
    const explicitClip = generationRecordExplicitStoryboardClip(record, clips);
    const searchableWithoutPreviousRef = stripPreviousStoryboardReferenceText(record.prompt);
    const matchedClip = explicitClip ?? bestStoryboardClipMatch(searchableWithoutPreviousRef, clips);
    if (!matchedClip) continue;
    if (!explicitClip && !recordHasExplicitClipAnchor(searchableWithoutPreviousRef, matchedClip)) continue;
    if (matchedClip && seenMatchedClips.has(matchedClip.id)) continue;
    const key = `${matchedClip?.id || 'unmatched'}:${image.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (matchedClip) seenMatchedClips.add(matchedClip.id);
    refs.push({
      clipId: matchedClip?.id,
      clipTitle: matchedClip?.title,
      title: matchedClip ? `${matchedClip.title} 故事板` : image.title || '已生成故事板',
      url: image.url,
      assetId: image.assetId,
      prompt: record.prompt,
      sourceEpisode: generationRecordSourceEpisode(record),
      sourceEpisodeId: generationRecordSourceEpisodeId(record),
    });
  }
  return refs;
}

export function nonStoryboardImageUrlsFromGenerationRecords(records: GenerationRecord[]): Set<string> {
  const urls = new Set<string>();
  for (const record of records) {
    if (record.status !== 'SUCCEEDED') continue;
    const image = generationRecordImageUrl(record);
    if (!image?.url) continue;
    if (generationRecordMetadataObjects(record).some(metadataLooksLikeClipStoryboard)) continue;
    const searchable = [
      record.prompt,
      JSON.stringify(record.input ?? {}),
      JSON.stringify(record.parameters ?? {}),
      JSON.stringify(record.assets.map((asset) => asset.metadata ?? {})),
      image.title,
    ].join('\n');
    if (generationRecordInputKind(record) !== 'canvas-image-generation' || !looksLikeStoryboardPrompt(searchable)) {
      urls.add(image.url);
    }
  }
  return urls;
}

export function isStoryboardAssetReferenceForVideo(ref: ClipStoryboardImageReference, video: { data?: any }): boolean {
  const videoData = video.data ?? {};
  if (ref.clipId && videoData.clipId) return ref.clipId === videoData.clipId;
  const videoTitle = normalizedClipNodeTitle(videoData.title);
  const refTitle = normalizedClipNodeTitle(ref.clipTitle || ref.title);
  if (refTitle && videoTitle && refTitle.length > 6 && videoTitle.length > 6 && (refTitle.includes(videoTitle) || videoTitle.includes(refTitle))) return true;
  return Boolean(ref.prompt && videoTitle && scoreClipStoryboardMatch(ref.prompt, { id: String(videoData.clipId || ''), title: String(videoData.title || '') } as Clip) >= 55);
}

export function isStoryboardReferenceNodeForVideo(source: { type?: string; data?: any }, video: { data?: any }): boolean {
  const sourceData = source.data ?? {};
  const videoData = video.data ?? {};
  if (source.type !== 'generation' && source.type !== 'imageInput') return false;
  if (sourceData.clipNodeKind === 'storyboard-reference') return false;
  const sourceText = String([sourceData.title, sourceData.label, sourceData.description, sourceData.sourcePrompt].filter(Boolean).join(' '));
  const looksStoryboard = sourceData.clipNodeKind === 'storyboard' || sourceData.storyboardForClip === true || /故事板|storyboard/i.test(sourceText);
  if (!looksStoryboard) return false;
  if (sourceData.clipId && videoData.clipId) return sourceData.clipId === videoData.clipId;
  const sourceTitle = normalizedClipNodeTitle(sourceData.title || sourceData.label);
  const videoTitle = normalizedClipNodeTitle(videoData.title);
  return Boolean(sourceTitle && videoTitle && sourceTitle.length > 6 && videoTitle.length > 6 && (sourceTitle.includes(videoTitle) || videoTitle.includes(sourceTitle)));
}

export function isStoryboardSlotNodeForVideo(source: { type?: string; data?: any; parentId?: string }, video: { data?: any; parentId?: string }): boolean {
  const sourceData = source.data ?? {};
  const videoData = video.data ?? {};
  if (source.type !== 'imageInput') return false;
  if (sourceData.storyboardSlotForClip !== true && sourceData.clipSyncRole !== 'storyboard-slot') return false;
  const sourceClipId = typeof sourceData.clipId === 'string' ? sourceData.clipId : '';
  const sourceTargetClipId = typeof sourceData.targetClipId === 'string' ? sourceData.targetClipId : '';
  const videoClipId = typeof videoData.clipId === 'string' ? videoData.clipId : '';
  if (sourceClipId && videoClipId && sourceClipId !== videoClipId) return false;
  if (sourceTargetClipId && videoClipId && sourceTargetClipId !== videoClipId) return false;
  return true;
}

export function isAutoVideoStoryboardReferenceNode(node: { id?: string; type?: string; data?: any }): boolean {
  return typeof node.id === 'string' &&
    node.id.startsWith('storyboard-ref-') &&
    node.type === 'imageInput' &&
    node.data?.clipNodeKind === 'storyboard' &&
    node.data?.storyboardForClip === true;
}

export function isBlockedStoryboardSource(source: { type?: string; data?: any }, blockedStoryboardUrls: Set<string>): boolean {
  const url = canvasNodeReferenceUrl(source);
  return Boolean(url && blockedStoryboardUrls.has(url));
}

export function canvasNodeReferenceUrl(node: { type?: string; data?: any }): string {
  if (node.type === 'imageInput') return publicImageUrl(node.data?.imageUrl);
  if (node.type === 'character') return publicImageUrl(node.data?.avatar);
  if (node.type === 'generation') return publicImageUrl(node.data?.outputImage);
  return '';
}

export function canvasVideoPromptText(data: any): string {
  return String(data?.videoPrompt || data?.prompt || data?.seedancePrompt || '').trim();
}

export function canvasNodePromptText(node: { type?: string; data?: any } | undefined): string {
  const data = node?.data ?? {};
  if (node?.type === 'video') return canvasVideoPromptText(data);
  if (node?.type === 'generation') return String(data.finalPrompt || data.prompt || data.submittedPrompt || data.visualPrompt || '').trim();
  if (node?.type === 'character') return String(data.finalPrompt || data.visualPrompt || data.prompt || data.traits || '').trim();
  if (node?.type === 'imageInput') return String(data.sourcePrompt || data.prompt || data.label || '').trim();
  if (node?.type === 'scene') return String(data.visualPrompt || data.directorBoardPrompt || data.description || '').trim();
  if (node?.type === 'translation') return String(data.translatedPrompt || data.sourcePrompt || '').trim();
  if (node?.type === 'promptOptimizer') return String(data.optimizedPrompt || data.sourcePrompt || '').trim();
  if (node?.type === 'promptInspector') return String(data.answer || data.sourcePrompt || '').trim();
  if (node?.type === 'agent') return String(data.request || data.lastRequest || '').trim();
  return String(data.finalPrompt || data.videoPrompt || data.prompt || data.seedancePrompt || data.sourcePrompt || data.description || '').trim();
}

export function canvasNodePromptLabel(node: { type?: string; data?: any } | undefined): string {
  const data = node?.data ?? {};
  if (node?.type === 'video') return String(data.title || '视频节点');
  if (node?.type === 'generation') return String(data.title || data.assetName || '图片生成节点');
  if (node?.type === 'character') return String(data.name || '角色节点');
  if (node?.type === 'imageInput') return String(data.label || '图片输入节点');
  if (node?.type === 'scene') return String(data.title || '分镜节点');
  if (node?.type === 'translation') return String(data.title || '翻译节点');
  if (node?.type === 'promptOptimizer') return String(data.title || '提示词优化节点');
  if (node?.type === 'promptInspector') return String(data.title || '提示词检查节点');
  if (node?.type === 'agent') return String(data.title || '智能体节点');
  return String(data.title || data.label || '上游节点');
}

export function translatedPromptPatchForNode(node: { type?: string; data?: any } | undefined, prompt: string): Record<string, unknown> {
  if (!node) return {};
  if (node.type === 'video') return { prompt, seedancePrompt: prompt, videoPrompt: prompt };
  if (node.type === 'generation') return { prompt, finalPrompt: prompt, manualFinalPrompt: true };
  if (node.type === 'character') return { finalPrompt: prompt };
  if (node.type === 'scene') return { visualPrompt: prompt, description: prompt };
  if (node.type === 'imageInput') return { sourcePrompt: prompt };
  if (node.type === 'translation') return { sourcePrompt: prompt };
  if (node.type === 'promptOptimizer') return { sourcePrompt: prompt };
  if (node.type === 'agent') return { request: prompt };
  return { prompt };
}

export function videoReferenceSourcePriority(source: { type?: string; data?: any }, video: { data?: any }): number {
  if (isStoryboardSlotNodeForVideo(source, video)) return 0;
  if (isStoryboardReferenceNodeForVideo(source, video)) return 5;
  const kind = normalizeWorkflowAssetKind(source.data?.assetKind);
  if (source.type === 'character' || kind === 'characters') return 1;
  if (kind === 'scenes') return 2;
  if (kind === 'props') return 99;
  if (source.type === 'generation') return 3;
  return 4;
}

export function videoReferenceLabel(source: { type?: string; data?: any }, video: { data?: any }): string {
  if (isStoryboardReferenceNodeForVideo(source, video)) return String(source.data?.title || source.data?.label || '已生成故事板');
  if (source.type === 'imageInput') return String(source.data?.label || '参考图');
  if (source.type === 'character') return String(source.data?.name || '角色');
  if (source.type === 'generation') return String(source.data?.title || '生成图');
  return '参考图';
}

export function computeVideoNodeReferencePatch(
  videoNode: { id: string; data?: any },
  nodes: Array<{ id: string; type?: string; data?: any }>,
  edges: Edge[],
): { storyboardImageUrl: string; referenceImageUrls: string[] } {
  const useMultiReferenceStrategy = isSeedanceMultiReferenceStrategy(videoNode.data?.generationStrategy);
  const incomingSources = edges
    .filter((edge) => edge.target === videoNode.id)
    .map((edge) => nodes.find((node) => node.id === edge.source))
    .filter((node): node is { id: string; type?: string; data?: any } => Boolean(node));
  const addUrl = (urls: string[], url: unknown) => {
    const normalized = publicImageUrl(url);
    if (!normalized || urls.includes(normalized) || urls.length >= MAX_VIDEO_REFERENCE_IMAGES) return;
    urls.push(normalized);
  };
  const storyboardUrls: string[] = [];
  for (const source of incomingSources
    .filter((item) => isStoryboardSlotNodeForVideo(item, videoNode) || isStoryboardReferenceNodeForVideo(item, videoNode))
    .sort((a, b) => videoReferenceSourcePriority(a, videoNode) - videoReferenceSourcePriority(b, videoNode))) {
    addUrl(storyboardUrls, canvasNodeReferenceUrl(source));
  }
  const referenceImageUrls = storyboardUrls.slice(0, 1);
  for (const source of incomingSources
    .filter((item) => !isStoryboardSlotNodeForVideo(item, videoNode) && !isStoryboardReferenceNodeForVideo(item, videoNode))
    .filter((item) => {
      const assetKind = normalizeWorkflowAssetKind(item.data?.assetKind);
      if (assetKind === 'audio') return false;
      return useMultiReferenceStrategy || (assetKind !== 'scenes' && assetKind !== 'props');
    })
    .sort((a, b) => videoReferenceSourcePriority(a, videoNode) - videoReferenceSourcePriority(b, videoNode))) {
    addUrl(referenceImageUrls, canvasNodeReferenceUrl(source));
  }
  return {
    storyboardImageUrl: storyboardUrls[0] || '',
    referenceImageUrls,
  };
}

export function generationReferenceSourcePriority(source: { type?: string; data?: any } | undefined): number {
  if (!source) return 9;
  if (source.type === 'imageInput' && source.data?.clipNodeKind === 'storyboard-reference') return 0;
  if (source.type === 'generation' && (source.data?.clipNodeKind === 'storyboard' || source.data?.storyboardForClip === true)) return 1;
  const kind = normalizeWorkflowAssetKind(source.data?.assetKind);
  if (source.type === 'character' || kind === 'characters') return 2;
  if (kind === 'scenes') return 3;
  if (kind === 'props') return 8;
  return 4;
}

export function canvasReferenceImageKind(source: { type?: string; data?: any } | undefined): CanvasReferenceImage['kind'] {
  if (source?.type === 'imageInput' && source.data?.clipNodeKind === 'storyboard-reference') return 'storyboard';
  if (source?.type === 'generation' && (source.data?.clipNodeKind === 'storyboard' || source.data?.storyboardForClip === true)) return 'storyboard';
  const assetKind = normalizeWorkflowAssetKind(source?.data?.assetKind);
  if (source?.type === 'character' || assetKind === 'characters') return 'character';
  if (assetKind === 'scenes') return 'scene';
  if (assetKind === 'props') return 'prop';
  return 'image';
}

export function shouldSkipCanvasGenerationReference(source: { id?: string; type?: string; data?: any } | undefined, target: { id?: string; data?: any } | undefined): boolean {
  if (!source || !target) return false;
  const targetClipId = normalizeClipId(String(target.data?.clipId || target.data?.sourceClipId || target.data?.targetClipId || target.id || ''));
  if (!targetClipId) return false;
  const sourceRole = String(source.data?.clipSyncRole || source.data?.clipNodeKind || '');
  const isStoryboardSlot = source.type === 'imageInput' && (source.data?.storyboardSlotForClip === true || sourceRole === 'storyboard-slot');
  if (!isStoryboardSlot) return false;
  const sourceClipId = normalizeClipId(String(source.data?.clipId || source.data?.sourceClipId || source.data?.targetClipId || ''));
  return Boolean(sourceClipId && sourceClipId === targetClipId);
}

export function canvasReferenceDedupKey(ref: Pick<CanvasReferenceImage, 'url' | 'kind'>) {
  return `${ref.kind}:${publicImageUrl(ref.url) || ref.url}`;
}

export function canvasReferenceImageBadgeLabel(ref: CanvasReferenceImage, index: number): string {
  if (ref.kind === 'storyboard') return '上';
  return String(index + 1);
}

export function cleanReferenceLabelName(value: unknown) {
  return String(value || '')
    .replace(/^(角色参考|角色引用参考|场景参考|场景引用参考|道具参考|绑定道具(?::\s*[^:]+)?|上一个故事板|已生成故事板|参考图)\s*[:：]\s*/i, '')
    .replace(/\.(?:png|jpe?g|webp|gif)$/i, '')
    .trim();
}

export function canvasReferenceDisplayName(ref: Pick<CanvasReferenceImage, 'name' | 'label' | 'kind'>) {
  return cleanReferenceLabelName(ref.name) || cleanReferenceLabelName(ref.label) || (
    ref.kind === 'character'
      ? 'unnamed character'
      : ref.kind === 'storyboard'
        ? 'storyboard'
        : 'reference'
  );
}

export function formatReferenceMapLine(index: number, ref: Pick<CanvasReferenceImage, 'name' | 'label' | 'kind'>) {
  const referenceNumber = index + 1;
  const displayName = canvasReferenceDisplayName(ref);
  if (ref.kind === 'storyboard') {
    return `#${referenceNumber}: previous storyboard (${displayName}); use for scene layout and character positions.`;
  }
  if (ref.kind === 'character') {
    return `#${referenceNumber}: Character ${displayName}; identity source for ${displayName}.`;
  }
  if (ref.kind === 'scene') {
    return `#${referenceNumber}: Scene ${displayName}; environment/layout source.`;
  }
  if (ref.kind === 'prop') {
    return `#${referenceNumber}: Prop ${displayName}; use only when needed.`;
  }
  return `#${referenceNumber}: ${displayName}.`;
}

export function buildReferenceImageMapPrompt(referenceImages: Array<Pick<CanvasReferenceImage, 'name' | 'label' | 'kind'>>) {
  if (!referenceImages.length) return '';
  const characterBindings = referenceImages
    .map((ref, index) => ref.kind === 'character' ? `${canvasReferenceDisplayName(ref)}=Reference image #${index + 1}` : '')
    .filter(Boolean);
  return [
    'Reference image map:',
    ...referenceImages.map((ref, index) => formatReferenceMapLine(index, ref)),
    characterBindings.length ? `Character bindings: ${characterBindings.join('; ')}.` : '',
  ].filter(Boolean).join('\n');
}

export function stripReferenceImageMapPrompt(prompt: unknown) {
  return String(prompt || '')
    .replace(/(?:^|\n|^)Reference image map:\s+[\s\S]*?(?=(?:\n\n|\n)?(?:Storyboard layout|Comic panels in reading order|Create|Required|Use the linked previous storyboard image|Clip title|This storyboard|Each panel|First infer|Setting|Characters present|Plot goal|Start state|End state|Shots to cover|Panel\s+\d+)\b|$)/i, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function appendReferenceImageMapPrompt(prompt: unknown, referenceImages: Array<Pick<CanvasReferenceImage, 'name' | 'label' | 'kind'>>) {
  const mapPrompt = buildReferenceImageMapPrompt(referenceImages);
  const cleanedPrompt = stripReferenceImageMapPrompt(prompt);
  return [mapPrompt, cleanedPrompt].filter(Boolean).join('\n\n');
}

export function clipImageReferenceAsCanvasReference(ref: ClipImageReference): Pick<CanvasReferenceImage, 'name' | 'label' | 'kind'> {
  const assetKind = normalizeWorkflowAssetKind(ref.kind);
  return {
    name: ref.name,
    label: ref.label,
    kind: ref.kind === 'storyboard'
      ? 'storyboard'
      : assetKind === 'characters'
        ? 'character'
        : assetKind === 'scenes'
          ? 'scene'
          : assetKind === 'props'
            ? 'prop'
            : 'image',
  };
}

export function videoReferenceAutoEdgeId(sourceId: string, targetId: string): string {
  return `video-ref-${sourceId}-${targetId}`.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

export function canvasAutoEdgeId(prefix: string, sourceId: string, targetId: string): string {
  return `${prefix}-${sourceId}-${targetId}`.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

export function uniqueCanvasNodeId(base: string, nodes: Array<{ id: string }>): string {
  const normalizedBase = (base || 'node').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 140) || 'node';
  const existing = new Set(nodes.map((node) => node.id));
  if (!existing.has(normalizedBase)) return normalizedBase;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${normalizedBase}-${index}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${normalizedBase}-${Date.now().toString(36)}`;
}

export function replacePreviousStoryboardContinuityPrompt(prompt: unknown, previous: PreviousStoryboardReference | null): string {
  const panelCount = detectStoryboardPanelCount(String(prompt || '')) || undefined;
  const cleaned = finalizeClipStoryboardImagePrompt(stripPreviousStoryboardContinuityText(prompt), panelCount)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return appendPreviousStoryboardContinuityPrompt(cleaned, previous);
}

export function normalizeVideoReferenceGraph(
  nodes: Array<{ id: string; type?: string; data?: any; parentId?: string; position?: { x?: number; y?: number }; style?: Record<string, unknown> }>,
  edges: Edge[],
  storyboardAssetRefs: ClipStoryboardImageReference[] = [],
  blockedStoryboardUrls: Set<string> = new Set(),
): { nodes: typeof nodes; edges: Edge[] } {
  let nextNodes = nodes;
  let nextEdges = edges;
  let changed = false;
  const patchNode = (nodeId: string, patch: Partial<(typeof nodes)[number]>) => {
    const index = nextNodes.findIndex((node) => node.id === nodeId);
    if (index < 0) return;
    const current = nextNodes[index];
    const dataPatch = patch.data;
    const stylePatch = patch.style;
    const topLevelChanged = Object.entries(patch)
      .filter(([key]) => key !== 'data' && key !== 'style')
      .some(([key, value]) => (current as Record<string, unknown>)[key] !== value);
    const dataChanged = dataPatch && Object.entries(dataPatch).some(([key, value]) => current.data?.[key] !== value);
    const styleChanged = stylePatch && Object.entries(stylePatch).some(([key, value]) => current.style?.[key] !== value);
    if (!topLevelChanged && !dataChanged && !styleChanged) return;
    nextNodes = nextNodes.map((node, itemIndex) => itemIndex === index
      ? {
          ...node,
          ...patch,
          data: dataPatch ? { ...(node.data ?? {}), ...dataPatch } : node.data,
          style: stylePatch ? { ...(node.style ?? {}), ...stylePatch } : node.style,
        }
      : node);
    changed = true;
  };

  const videoNodes = nextNodes.filter(isVideoCanvasNode);
  for (const videoNode of videoNodes) {
    const isWorkflowClipVideo = Boolean(videoNode.data?.clipId || videoNode.data?.episodeCanvasSync);
    const storyboardSources = nextNodes.filter((node) => (
      node.id !== videoNode.id &&
      !isAutoVideoStoryboardReferenceNode(node) &&
      isStoryboardReferenceNodeForVideo(node, videoNode) &&
      !isBlockedStoryboardSource(node, blockedStoryboardUrls)
    ));
    const storyboardSlotNodes = nextNodes.filter((node) => node.id !== videoNode.id && isStoryboardSlotNodeForVideo(node, videoNode));
    for (const source of storyboardSources.filter((node) => !isStoryboardSlotNodeForVideo(node, videoNode))) {
      const sourceUrl = canvasNodeReferenceUrl(source);
      if (!sourceUrl) continue;
      const matchingSlot = storyboardSlotNodes.find((node) => canvasNodeReferenceUrl(node) === sourceUrl) ??
        storyboardSlotNodes.find((node) => {
          const slotAssetId = String(node.data?.assetId || node.data?.clipSyncAssetId || '');
          const sourceAssetId = String(source.data?.outputImageAssetId || source.data?.assetId || '');
          return Boolean(slotAssetId && sourceAssetId && slotAssetId === sourceAssetId);
        }) ??
        storyboardSlotNodes.find((node) => !canvasNodeReferenceUrl(node)) ??
        storyboardSlotNodes[0];
      if (!matchingSlot) continue;
      const sourceAssetId = String(source.data?.outputImageAssetId || source.data?.assetId || matchingSlot.data?.assetId || '');
      const slotData = {
        label: '对应故事板',
        imageUrl: sourceUrl,
        imageAspectRatio: 1.78,
        fileName: `${source.data?.title || videoNode.data?.title || 'Clip'}-storyboard.png`,
        uploadStatus: 'linked',
        sourcePrompt: source.data?.submittedPrompt || source.data?.finalPrompt || source.data?.prompt || matchingSlot.data?.sourcePrompt || '',
        uploadError: '',
        imageLoadError: false,
        clipId: source.data?.clipId || videoNode.data?.clipId || matchingSlot.data?.clipId || '',
        clipNodeKind: 'storyboard',
        storyboardForClip: true,
        storyboardSlotForClip: true,
        sourceClipId: source.data?.clipId || matchingSlot.data?.sourceClipId || '',
        sourceClipTitle: source.data?.clipTitle || source.data?.title || matchingSlot.data?.sourceClipTitle || '',
        targetClipId: source.data?.clipId || videoNode.data?.clipId || matchingSlot.data?.targetClipId || '',
        assetId: sourceAssetId,
        clipSyncRole: matchingSlot.data?.clipSyncRole || 'storyboard-slot',
        clipSyncAssetId: sourceAssetId || matchingSlot.data?.clipSyncAssetId || '',
        clipSyncUrl: sourceUrl,
      };
      patchNode(matchingSlot.id, {
        data: slotData,
        style: {
          width: preferredImageInputNodeWidth(slotData),
          height: preferredImageInputNodeHeight(slotData),
        },
      });
      if (!hasCanvasConnection(nextEdges, source.id, matchingSlot.id)) {
        nextEdges = [
          ...nextEdges,
          {
            id: videoReferenceAutoEdgeId(source.id, matchingSlot.id),
            source: source.id,
            target: matchingSlot.id,
            sourceHandle: null,
            targetHandle: null,
          },
        ];
        changed = true;
      }
      if (!hasCanvasConnection(nextEdges, matchingSlot.id, videoNode.id)) {
        nextEdges = [
          ...nextEdges,
          {
            id: videoReferenceAutoEdgeId(matchingSlot.id, videoNode.id),
            source: matchingSlot.id,
            target: videoNode.id,
            sourceHandle: null,
            targetHandle: null,
          },
        ];
        changed = true;
      }
    }

    const existingStoryboardUrls = new Set(nextEdges
      .filter((edge) => edge.target === videoNode.id)
      .map((edge) => nextNodes.find((node) => node.id === edge.source))
      .filter((node): node is { id: string; type?: string; data?: any } => Boolean(node))
      .filter((node) => isStoryboardReferenceNodeForVideo(node, videoNode))
      .map(canvasNodeReferenceUrl)
      .filter(Boolean));
    const matchingStoryboardAssets = storyboardAssetRefs.filter((ref) => isStoryboardAssetReferenceForVideo(ref, videoNode) && !blockedStoryboardUrls.has(ref.url));
    for (const [index, ref] of matchingStoryboardAssets.entries()) {
      const matchingSlot = storyboardSlotNodes.find((node) => canvasNodeReferenceUrl(node) === ref.url) ??
        storyboardSlotNodes.find((node) => {
          const nodeAssetId = String(node.data?.assetId || node.data?.clipSyncAssetId || '');
          return Boolean(ref.assetId && nodeAssetId === ref.assetId);
        }) ??
        storyboardSlotNodes.find((node) => !canvasNodeReferenceUrl(node)) ??
        storyboardSlotNodes[index] ??
        storyboardSlotNodes[0];
      if (matchingSlot) {
        const slotData = {
          label: '对应故事板',
          imageUrl: ref.url,
          imageAspectRatio: 1.78,
          fileName: `${ref.title || videoNode.data?.title || 'Clip'}-storyboard.png`,
          uploadStatus: 'linked',
          sourcePrompt: ref.prompt || matchingSlot.data?.sourcePrompt || '',
          uploadError: '',
          imageLoadError: false,
          clipId: ref.clipId || videoNode.data?.clipId || matchingSlot.data?.clipId || '',
          clipNodeKind: 'storyboard',
          storyboardForClip: true,
          storyboardSlotForClip: true,
          sourceClipId: ref.clipId || matchingSlot.data?.sourceClipId || '',
          sourceClipTitle: ref.clipTitle || matchingSlot.data?.sourceClipTitle || '',
          targetClipId: ref.clipId || videoNode.data?.clipId || matchingSlot.data?.targetClipId || '',
          assetId: ref.assetId || matchingSlot.data?.assetId || '',
          clipSyncRole: matchingSlot.data?.clipSyncRole || 'storyboard-slot',
          clipSyncAssetId: ref.assetId || matchingSlot.data?.clipSyncAssetId || '',
          clipSyncUrl: ref.url,
        };
        patchNode(matchingSlot.id, {
          data: slotData,
          style: {
            width: preferredImageInputNodeWidth(slotData),
            height: preferredImageInputNodeHeight(slotData),
          },
        });
        if (!hasCanvasConnection(nextEdges, matchingSlot.id, videoNode.id)) {
          nextEdges = [
            ...nextEdges,
            {
              id: videoReferenceAutoEdgeId(matchingSlot.id, videoNode.id),
              source: matchingSlot.id,
              target: videoNode.id,
              sourceHandle: null,
              targetHandle: null,
            },
          ];
          changed = true;
        }
        existingStoryboardUrls.add(ref.url);
        continue;
      }

      if (existingStoryboardUrls.has(ref.url)) continue;
    }

    const directStoryboardEdgeIds = new Set(nextEdges
      .filter((edge) => edge.target === videoNode.id)
      .filter((edge) => {
        const source = nextNodes.find((node) => node.id === edge.source);
        return Boolean(source && isStoryboardReferenceNodeForVideo(source, videoNode) && !isStoryboardSlotNodeForVideo(source, videoNode));
      })
      .map((edge) => edge.id));
    if (directStoryboardEdgeIds.size > 0 && storyboardSlotNodes.length > 0) {
      nextEdges = nextEdges.filter((edge) => !directStoryboardEdgeIds.has(edge.id));
      changed = true;
    }

    const connectedStableStoryboardUrls = new Set(nextEdges
      .filter((edge) => edge.target === videoNode.id)
      .map((edge) => nextNodes.find((node) => node.id === edge.source))
      .filter((node): node is { id: string; type?: string; data?: any } => Boolean(node))
      .filter((node) => isStoryboardSlotNodeForVideo(node, videoNode))
      .map(canvasNodeReferenceUrl)
      .filter(Boolean));
    const obsoleteAutoStoryboardNodeIds = new Set(nextNodes
      .filter((node) => isAutoVideoStoryboardReferenceNode(node) && isStoryboardReferenceNodeForVideo(node, videoNode))
      .filter((node) => {
        const url = canvasNodeReferenceUrl(node);
        return Boolean(url && connectedStableStoryboardUrls.has(url));
      })
      .map((node) => node.id));
    if (obsoleteAutoStoryboardNodeIds.size > 0) {
      nextNodes = nextNodes.filter((node) => !obsoleteAutoStoryboardNodeIds.has(node.id));
      nextEdges = nextEdges.filter((edge) => !obsoleteAutoStoryboardNodeIds.has(String(edge.source)) && !obsoleteAutoStoryboardNodeIds.has(String(edge.target)));
      changed = true;
    }

    const incoming = nextEdges
      .filter((edge) => edge.target === videoNode.id)
      .map((edge, index) => ({ edge, index, source: nextNodes.find((node) => node.id === edge.source) }))
      .filter((item) => item.source && (canvasNodeReferenceUrl(item.source) || isStoryboardReferenceNodeForVideo(item.source, videoNode)));

    const protectedStoryboardSlotEdgeIds = new Set(incoming
      .filter((item) => Boolean(item.source && isStoryboardSlotNodeForVideo(item.source, videoNode)))
      .map((item) => item.edge.id));
    const propIncomingIds = new Set(incoming
      .filter((item) => {
        if (protectedStoryboardSlotEdgeIds.has(item.edge.id)) return false;
        const assetKind = normalizeWorkflowAssetKind(item.source?.data?.assetKind);
        return assetKind === 'props' || (isWorkflowClipVideo && assetKind === 'scenes') || (item.source && isStoryboardReferenceNodeForVideo(item.source, videoNode) && isBlockedStoryboardSource(item.source, blockedStoryboardUrls));
      })
      .map((item) => item.edge.id));
    if (propIncomingIds.size > 0) {
      nextEdges = nextEdges.filter((edge) => !propIncomingIds.has(edge.id));
      changed = true;
    }

    const nonPropIncoming = incoming.filter((item) => !propIncomingIds.has(item.edge.id));
    const keepEdgeIds = new Set(nonPropIncoming
      .sort((a, b) => {
        const priorityDelta = videoReferenceSourcePriority(a.source ?? {}, videoNode) - videoReferenceSourcePriority(b.source ?? {}, videoNode);
        return priorityDelta || a.index - b.index;
      })
      .slice(0, MAX_VIDEO_REFERENCE_IMAGES)
      .map((item) => item.edge.id));
    const removableIncomingIds = new Set(nonPropIncoming.map((item) => item.edge.id));
    const prunedEdges = nextEdges.filter((edge) => edge.target !== videoNode.id || !removableIncomingIds.has(edge.id) || keepEdgeIds.has(edge.id));
    if (prunedEdges.length !== nextEdges.length) {
      nextEdges = prunedEdges;
      changed = true;
    }
    const referencePatch = computeVideoNodeReferencePatch(videoNode, nextNodes, nextEdges);
    const currentReferenceUrls = Array.isArray(videoNode.data?.referenceImageUrls) ? videoNode.data.referenceImageUrls.map(String) : [];
    if (
      videoNode.data?.storyboardImageUrl !== referencePatch.storyboardImageUrl ||
      !canvasIdListsEqual(currentReferenceUrls, referencePatch.referenceImageUrls)
    ) {
      patchNode(videoNode.id, { data: referencePatch });
    }
  }
  return changed ? { nodes: nextNodes, edges: nextEdges } : { nodes, edges };
}

export function isClipStoryboardAssetSection(node: { type?: string; data?: any }): boolean {
  return node.type === 'section' && node.data?.sectionKind === 'clip-storyboard-assets' && typeof node.data?.clipId === 'string';
}

export function isStoryboardReferenceInputNode(node: { type?: string; data?: any }): boolean {
  return node.type === 'imageInput' && node.data?.clipNodeKind === 'storyboard-reference';
}

export function preferredStoryboardReferenceNode(
  nodes: Array<{ id: string; type?: string; data?: any }>,
  previousRef: PreviousStoryboardReference | null,
  clip: Clip,
  previousUrl: string,
) {
  const previousUrlKey = imageReferenceUrlKey(previousUrl);
  const sourceClipId = previousRef?.sourceClip?.id || previousRef?.clipId || '';
  const candidates = nodes.filter((node) => {
    if (!isStoryboardReferenceInputNode(node)) return false;
    if (imageReferenceUrlKey(canvasNodeReferenceUrl(node)) !== previousUrlKey) return false;
    const targetClipId = typeof node.data?.targetClipId === 'string' ? node.data.targetClipId : '';
    const nodeSourceClipId = typeof node.data?.sourceClipId === 'string' ? node.data.sourceClipId : '';
    if (targetClipId && targetClipId !== clip.id) return false;
    if (sourceClipId && nodeSourceClipId && nodeSourceClipId !== sourceClipId) return false;
    return true;
  });
  if (!candidates.length) return null;
  return [...candidates].sort((left, right) => storyboardReferenceNodePriority(left.id) - storyboardReferenceNodePriority(right.id))[0] ?? null;
}

export function storyboardReferenceNodePriority(id: string): number {
  if (id.startsWith('episode-sync-story-ref-')) return 0;
  if (id.startsWith('storyboard-prev-')) return 1;
  return 2;
}

export function normalizeClipStoryboardReferenceSections(
  clips: Clip[],
  nodes: Array<{ id: string; type?: string; data?: any; parentId?: string; position?: { x?: number; y?: number }; style?: Record<string, unknown>; zIndex?: number; extent?: unknown; expandParent?: boolean }>,
  edges: Edge[],
  storyboardAssetRefs: ClipStoryboardImageReference[] = [],
  blockedStoryboardUrls: Set<string> = new Set(),
): { nodes: typeof nodes; edges: Edge[] } {
  if (clips.length === 0 || nodes.length === 0) return { nodes, edges };

  let nextNodes = nodes;
  let nextEdges = edges;
  let changed = false;

  const patchNode = (nodeId: string, patch: Partial<(typeof nodes)[number]>) => {
    const index = nextNodes.findIndex((node) => node.id === nodeId);
    if (index < 0) return;
    const current = nextNodes[index];
    const nextNode = {
      ...current,
      ...patch,
      data: patch.data ? { ...(current.data ?? {}), ...(patch.data ?? {}) } : current.data,
      style: patch.style ? { ...(current.style ?? {}), ...(patch.style ?? {}) } : current.style,
    };
    const dataChanged = patch.data && Object.entries(patch.data).some(([key, value]) => current.data?.[key] !== value);
    const styleChanged = patch.style && Object.entries(patch.style).some(([key, value]) => current.style?.[key] !== value);
    const nodeChanged = current.parentId !== nextNode.parentId ||
      current.extent !== nextNode.extent ||
      current.expandParent !== nextNode.expandParent ||
      current.zIndex !== nextNode.zIndex ||
      current.position?.x !== nextNode.position?.x ||
      current.position?.y !== nextNode.position?.y ||
      dataChanged ||
      styleChanged;
    if (!nodeChanged) return;
    nextNodes = nextNodes.map((node, itemIndex) => (itemIndex === index ? nextNode : node));
    changed = true;
  };

  const addEdgeIfMissing = (prefix: string, source: string, target: string) => {
    if (!source || !target || hasCanvasConnection(nextEdges, source, target)) return;
    nextEdges = [
      ...nextEdges,
      {
        id: canvasAutoEdgeId(prefix, source, target),
        source,
        target,
        sourceHandle: null,
        targetHandle: null,
      },
    ];
    changed = true;
  };

  for (const section of nextNodes.filter(isClipStoryboardAssetSection)) {
    const clip = clips.find((item) => item.id === section.data?.clipId);
    if (!clip) continue;
    const childNodes = nextNodes.filter((node) => node.parentId === section.id);
    const generationNode = childNodes.find((node) => node.type === 'generation' && isClipStoryboardNodeForClip(node, clip));
    if (!generationNode) continue;

    const previousRef = findPreviousClipStoryboardReference(clip, clips, nextNodes, storyboardAssetRefs, blockedStoryboardUrls);
    const previousSourceNode = previousRef?.nodeId ? nextNodes.find((node) => node.id === previousRef.nodeId) : null;
    const previousUrl = publicImageUrl(previousRef?.url);
    const previousSourceId = previousSourceNode?.id || previousRef?.nodeId || '';
    const storyboardReferenceNodes = childNodes.filter(isStoryboardReferenceInputNode);
    const preferredPreviousReferenceNode = previousUrl
      ? preferredStoryboardReferenceNode(storyboardReferenceNodes, previousRef, clip, previousUrl)
      : null;
    const matchingPreviousReferenceNode = preferredPreviousReferenceNode ?? (previousUrl
      ? storyboardReferenceNodes.find((node) => (
          node.data?.targetClipId === clip.id &&
          (!previousRef?.sourceClip?.id || node.data?.sourceClipId === previousRef.sourceClip.id)
        )) ??
        storyboardReferenceNodes.find((node) => canvasNodeReferenceUrl(node) === previousUrl) ??
        storyboardReferenceNodes[0]
      : null);

    if (previousUrl && matchingPreviousReferenceNode) {
      const sourceClip = previousRef?.sourceClip;
      const nextData = {
        label: `上一个故事板: ${sourceClip?.title || previousRef?.clipTitle || previousRef?.title || '上一段'}`,
        imageUrl: previousUrl,
        imageAspectRatio: 1.78,
        fileName: `${previousRef?.title || sourceClip?.title || 'previous-storyboard'}.png`,
        uploadStatus: 'linked',
        sourcePrompt: `上一个故事板，用于延续 ${clip.title || 'Clip'} 的场景和角色位置`,
        uploadError: '',
        imageLoadError: false,
        clipNodeKind: 'storyboard-reference',
        storyboardForClip: false,
        sourceClipId: sourceClip?.id || previousRef?.clipId || '',
        sourceClipTitle: sourceClip?.title || previousRef?.clipTitle || '',
        targetClipId: clip.id,
        assetId: previousRef?.assetId || '',
        clipSyncAssetId: previousRef?.assetId || '',
        clipSyncUrl: previousUrl,
        assetKind: undefined,
        assetName: undefined,
      };
      patchNode(matchingPreviousReferenceNode.id, {
        parentId: section.id,
        extent: 'parent',
        expandParent: false,
        zIndex: 1,
        data: nextData,
        style: {
          width: preferredImageInputNodeWidth(nextData),
          height: preferredImageInputNodeHeight(nextData),
        },
      });
      addEdgeIfMissing('storyboard-prev-ref', matchingPreviousReferenceNode.id, generationNode.id);
    } else if (previousUrl) {
      const sourceClip = previousRef?.sourceClip;
      const nextData = {
        label: `上一个故事板: ${sourceClip?.title || previousRef?.clipTitle || previousRef?.title || '上一段'}`,
        imageUrl: previousUrl,
        imageAspectRatio: 1.78,
        fileName: `${previousRef?.title || sourceClip?.title || 'previous-storyboard'}.png`,
        uploadStatus: 'linked',
        sourcePrompt: `上一个故事板，用于延续 ${clip.title || 'Clip'} 的场景和角色位置`,
        uploadError: '',
        imageLoadError: false,
        clipNodeKind: 'storyboard-reference',
        storyboardForClip: false,
        sourceClipId: sourceClip?.id || previousRef?.clipId || '',
        sourceClipTitle: sourceClip?.title || previousRef?.clipTitle || '',
        targetClipId: clip.id,
        assetId: previousRef?.assetId || '',
        clipSyncAssetId: previousRef?.assetId || '',
        clipSyncUrl: previousUrl,
        assetKind: undefined,
        assetName: undefined,
      };
      const basePosition = generationNode.position ?? section.position ?? { x: 0, y: 0 };
      const nextNode = {
        id: uniqueCanvasNodeId(
          `storyboard-prev-${generationNode.id}-${previousRef?.assetId || sourceClip?.id || previousRef?.clipId || 'ref'}`,
          nextNodes,
        ),
        type: 'imageInput',
        parentId: section.id,
        extent: 'parent',
        expandParent: false,
        position: {
          x: Math.max(0, Number(basePosition.x ?? 0) - CANVAS_REFERENCE_NODE_WIDTH - CANVAS_TARGET_SECTION_GAP),
          y: Number(basePosition.y ?? CANVAS_SECTION_HEADER_HEIGHT),
        },
        style: {
          width: preferredImageInputNodeWidth(nextData),
          height: preferredImageInputNodeHeight(nextData),
        },
        zIndex: 1,
        data: nextData,
      };
      nextNodes = [...nextNodes, nextNode];
      changed = true;
      addEdgeIfMissing('storyboard-prev-ref', nextNode.id, generationNode.id);
    } else if (previousSourceId) {
      addEdgeIfMissing('storyboard-prev-live', previousSourceId, generationNode.id);
    }

    const staleStoryboardReferenceNodeIds = new Set(storyboardReferenceNodes
      .filter((node) => node.id !== matchingPreviousReferenceNode?.id)
      .filter((node) => {
        const nodeTargetClipId = typeof node.data?.targetClipId === 'string' ? node.data.targetClipId : '';
        if (nodeTargetClipId && nodeTargetClipId !== clip.id) return false;
        const nodeUrl = canvasNodeReferenceUrl(node);
        if (!previousUrl) return Boolean(previousRef && nodeUrl);
        return Boolean(nodeUrl && imageReferenceUrlKey(nodeUrl) === imageReferenceUrlKey(previousUrl));
      })
      .map((node) => node.id));
    if (staleStoryboardReferenceNodeIds.size > 0) {
      nextNodes = nextNodes.filter((node) => !staleStoryboardReferenceNodeIds.has(node.id));
      const prunedEdges = nextEdges.filter((edge) => !staleStoryboardReferenceNodeIds.has(edge.source) && !staleStoryboardReferenceNodeIds.has(edge.target));
      if (prunedEdges.length !== nextEdges.length) {
        nextEdges = prunedEdges;
      }
      changed = true;
    }

    if (previousRef && generationNode.data?.status !== 'generating') {
      const nextPrompt = replacePreviousStoryboardContinuityPrompt(
        generationNode.data?.finalPrompt || generationNode.data?.prompt || '',
        previousRef,
      );
      const nextPreviousStoryboardAssetId = previousRef.assetId || previousRef.nodeId || '';
      if (
        nextPrompt &&
        (
          generationNode.data?.prompt !== nextPrompt ||
          generationNode.data?.finalPrompt !== nextPrompt ||
          generationNode.data?.previousStoryboardAssetId !== nextPreviousStoryboardAssetId
        )
      ) {
        patchNode(generationNode.id, {
          data: {
            prompt: nextPrompt,
            finalPrompt: nextPrompt,
            manualFinalPrompt: true,
            previousStoryboardAssetId: nextPreviousStoryboardAssetId,
          },
        });
      }
    }

    const storyboardIncomingEdges = nextEdges
      .filter((edge) => edge.target === generationNode.id)
      .map((edge, index) => ({ edge, index, source: nextNodes.find((node) => node.id === edge.source) }))
      .filter((item) => item.source && canvasReferenceImageKind(item.source) === 'storyboard');
    if (storyboardIncomingEdges.length > 1) {
      const keepByUrl = new Map<string, string>();
      const sortedStoryboardEdges = [...storyboardIncomingEdges].sort((a, b) => {
        const aPreferred = isStoryboardReferenceInputNode(a.source ?? {}) ? 0 : 1;
        const bPreferred = isStoryboardReferenceInputNode(b.source ?? {}) ? 0 : 1;
        return aPreferred - bPreferred || a.index - b.index;
      });
      for (const item of sortedStoryboardEdges) {
        const urlKey = imageReferenceUrlKey(canvasNodeReferenceUrl(item.source ?? {}));
        if (!urlKey || keepByUrl.has(urlKey)) continue;
        keepByUrl.set(urlKey, item.edge.id);
      }
      const keepEdgeIds = new Set(keepByUrl.values());
      const storyboardEdgeIds = new Set(storyboardIncomingEdges.map((item) => item.edge.id));
      const dedupedEdges = nextEdges.filter((edge) => !storyboardEdgeIds.has(edge.id) || keepEdgeIds.has(edge.id));
      if (dedupedEdges.length !== nextEdges.length) {
        nextEdges = dedupedEdges;
        changed = true;
      }
    }
  }

  return changed ? { nodes: recalculateCanvasSectionItemCounts(nextNodes), edges: nextEdges } : { nodes, edges };
}

export function collectClipStoryboardReferences(clip: Clip, nodes: Array<{ id: string; type?: string; data?: any }>): ClipImageReference[] {
  const refs: ClipImageReference[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    if (isStoryboardReferenceInputNode(node)) continue;
    if (!isClipStoryboardNodeForClip(node, clip)) continue;
    const url = canvasNodeReferenceUrl(node);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    refs.push({
      kind: 'storyboard',
      name: String(node.data?.title || `${clip.title || 'Clip'} 故事板`),
      label: '已生成故事板',
      url,
      assetId: typeof node.data?.outputImageAssetId === 'string' ? node.data.outputImageAssetId : typeof node.data?.assetId === 'string' ? node.data.assetId : '',
      nodeId: node.id,
    });
  }
  return refs;
}

export function collectClipStoryboardImageReferences(
  clip: Clip,
  nodes: Array<{ id: string; type?: string; data?: any }>,
  storyboardAssetRefs: ClipStoryboardImageReference[] = [],
  blockedStoryboardUrls: Set<string> = new Set(),
): ClipStoryboardImageReference[] {
  const refs: ClipStoryboardImageReference[] = [];
  const seen = new Set<string>();
  for (const ref of collectClipStoryboardReferences(clip, nodes)) {
    if (!ref.url || seen.has(ref.url)) continue;
    if (blockedStoryboardUrls.has(ref.url)) continue;
    seen.add(ref.url);
    refs.push({
      clipId: clip.id,
      clipTitle: clip.title,
      title: ref.name || `${clip.title || 'Clip'} 故事板`,
      url: ref.url,
      assetId: ref.assetId,
      nodeId: ref.nodeId,
    });
  }
  for (const ref of storyboardAssetRefs) {
    if (!storyboardReferenceMatchesClip(ref, clip) || seen.has(ref.url)) continue;
    seen.add(ref.url);
    refs.push(ref);
  }
  return refs.slice(0, 6);
}

export function findPreviousClipStoryboardReference(
  clip: Clip,
  clips: Clip[],
  nodes: Array<{ id: string; type?: string; data?: any }>,
  storyboardAssetRefs: ClipStoryboardImageReference[] = [],
  blockedStoryboardUrls: Set<string> = new Set(),
): PreviousStoryboardReference | null {
  const clipIndex = clips.findIndex((item) => item.id === clip.id);
  if (clipIndex <= 0) return null;
  const previousClip = clips[clipIndex - 1];
  const refs = collectClipStoryboardImageReferences(previousClip, nodes, storyboardAssetRefs, blockedStoryboardUrls);
  const ref = refs.find((item) => item.url && item.clipId === previousClip.id);
  if (ref) return { ...ref, sourceClip: previousClip };
  const previousNode = findClipStoryboardNode(nodes, previousClip);
  if (!previousNode) return null;
  return {
    clipId: previousClip.id,
    clipTitle: previousClip.title,
    title: String(previousNode.data?.title || `${previousClip.title || '上一个 Clip'} 故事板`),
    url: canvasNodeReferenceUrl(previousNode),
    assetId: String(previousNode.data?.outputImageAssetId || previousNode.data?.assetId || ''),
    nodeId: previousNode.id,
    sourceClip: previousClip,
  };
}

export function appendPreviousStoryboardContinuityPrompt(prompt: string, previous: PreviousStoryboardReference | null): string {
  if (!previous?.url && !previous?.nodeId) return prompt;
  const previousLabel = previous.sourceClip?.title || previous.clipTitle || previous.title || 'previous Clip';
  const sourceClip = previous.sourceClip;
  const previousEndState = compactPromptText(sourceClip?.endState, 240);
  const line = [
    `Use the linked previous storyboard image (${previousLabel}) as the continuity reference for scene layout, character positions, and the previous Clip end state; continue the next storyboard from that ending instead of resetting the scene.`,
    previousEndState ? `Previous Clip end state to continue from: ${previousEndState}` : '',
  ].filter(Boolean).join(' ');
  if (normalizeCompareText(prompt).includes(normalizeCompareText(line))) return prompt;
  return [line, prompt].filter(Boolean).join('\n\n');
}

export function collectClipVideoReferences(
  clip: Clip,
  clipScenes: BreakdownScene[],
  assets: WorkflowAssets,
  nodes: Array<{ id: string; type?: string; data?: any }>,
  storyboardAssetRefs: ClipStoryboardImageReference[] = [],
  blockedStoryboardUrls: Set<string> = new Set(),
  extraSearchText = '',
  options: { includeStoryboard?: boolean; includeProps?: boolean; includeScenes?: boolean; includeMissing?: boolean } = {},
): ClipImageReference[] {
  const includeStoryboard = options.includeStoryboard ?? true;
  const storyboardRefs = includeStoryboard ? [
    ...collectClipStoryboardImageReferences(clip, nodes, storyboardAssetRefs, blockedStoryboardUrls).map((ref): ClipImageReference => ({
      kind: 'storyboard',
      name: ref.title,
      label: '已生成故事板',
      url: ref.url,
      assetId: ref.assetId,
      nodeId: ref.nodeId,
    })),
    ...storyboardAssetRefs
      .filter((ref) => storyboardReferenceMatchesClip(ref, clip) && !blockedStoryboardUrls.has(ref.url))
      .map((ref): ClipImageReference => ({
        kind: 'storyboard',
        name: ref.title,
        label: '已生成故事板',
        url: ref.url,
        assetId: ref.assetId,
    })),
  ] : [];
  const primarySceneRefs = options.includeScenes
    ? primarySceneNamesForClip(clip, clipScenes, extraSearchText)
        .map((name) => {
          const item = findWorkflowAssetByName(assetArray(assets, 'scenes'), name);
          const url = item ? workflowAssetImageUrl(item) : '';
          if (!item || (!url && !options.includeMissing)) return null;
          return {
            kind: 'scenes' as const,
            name: workflowAssetName(item),
            label: `场景参考: ${workflowAssetName(item)}`,
            url,
            assetId: workflowAssetImageAssetId(item),
          };
        })
        .filter((item): item is ClipAssetReference => Boolean(item))
        .slice(0, 1)
    : [];
  const assetRefs = collectClipAssetReferences(clip, clipScenes, assets, 100, extraSearchText, {
    includeProps: options.includeProps ?? false,
    includeScenes: options.includeScenes ?? false,
    includeStoryboardPrompt: false,
    includeMissing: options.includeMissing ?? false,
  });
  const ordered = [
    ...storyboardRefs,
    ...primarySceneRefs,
    ...assetRefs.filter((reference) => options.includeProps || options.includeScenes ? true : reference.kind === 'characters'),
  ];
  const refs: ClipImageReference[] = [];
  const seen = new Set<string>();
  for (const reference of ordered) {
    const key = reference.url || `${reference.kind}:${reference.assetId || normalizeCompareText(reference.name)}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    refs.push(reference);
    if (refs.length >= MAX_VIDEO_REFERENCE_IMAGES) break;
  }
  return refs;
}

export type CharacterAudioReference = {
  name: string;
  url?: string;
  assetId?: string;
  fileName?: string;
  source: 'workflow-asset' | 'canvas-node';
};

export function workflowAssetAudioUrl(item: WorkflowAssetItem): string {
  return publicAudioUrl(item.referenceAudioUrl);
}

export function extractDialogueCharacterNamesFromScenes(clipScenes: BreakdownScene[], availableNames: string[]): string[] {
  const names = availableNames.filter(Boolean);
  const found: string[] = [];
  const seen = new Set<string>();
  for (const scene of clipScenes) {
    const dialogue = compactPromptText(scene.dialogue);
    if (!dialogue || /^(none|no dialogue|silent|无|无台词)$/i.test(dialogue)) continue;
    let matchedExplicitSpeaker = false;
    const sceneCharacters = Array.isArray(scene.characters) ? scene.characters.filter(Boolean) : [];
    for (const rawName of sceneCharacters) {
      const name = names.find((candidate) => normalizeCompareText(candidate) === normalizeCompareText(rawName));
      if (name && dialogueNamesCharacter(dialogue, name)) matchedExplicitSpeaker = pushUniqueDialogueName(found, seen, name) || matchedExplicitSpeaker;
    }
    for (const name of names) {
      if (dialogueNamesCharacter(dialogue, name)) matchedExplicitSpeaker = pushUniqueDialogueName(found, seen, name) || matchedExplicitSpeaker;
    }
    if (!matchedExplicitSpeaker) {
      const matchedSceneCharacters = uniqueClipNames(sceneCharacters
        .map((rawName) => names.find((candidate) => normalizeCompareText(candidate) === normalizeCompareText(rawName)) || '')
        .filter(Boolean));
      if (matchedSceneCharacters.length === 1) pushUniqueDialogueName(found, seen, matchedSceneCharacters[0]);
    }
  }
  return found;
}

export function pushUniqueDialogueName(found: string[], seen: Set<string>, name: string): boolean {
  const key = normalizeCompareText(name);
  if (!key || seen.has(key)) return false;
  seen.add(key);
  found.push(name);
  return true;
}

export function dialogueNamesCharacter(dialogue: string, name: string): boolean {
  const escaped = escapeRegExp(name);
  return (
    new RegExp(`(?:^|[\\n;。.!?])\\s*${escaped}\\s*[:：]`, 'i').test(dialogue) ||
    new RegExp(`\\b${escaped}\\b\\s*(?:says|said|asks|asked|replies|responds|whispers|shouts|mutters|delivers|speaks)\\b`, 'i').test(dialogue)
  );
}

export function extractDialogueCharacterNamesFromPrompt(prompt: string, availableNames: string[]): string[] {
  const text = normalizePromptTextForParsing(prompt);
  if (!text) return [];
  const names = availableNames.filter(Boolean);
  const found: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const hasDialogue = promptNamesSpeakingCharacter(text, name);
    if (hasDialogue && !seen.has(normalizeCompareText(name))) {
      seen.add(normalizeCompareText(name));
      found.push(name);
    }
  }
  return found;
}

export function promptNamesSpeakingCharacter(text: string, name: string): boolean {
  const escaped = escapeRegExp(name);
  return (
    new RegExp(`(?:^|[\\n;。.!?])\\s*${escaped}\\s*[:：]["'“”‘’\\s]`, 'i').test(text) ||
    new RegExp(`\\b${escaped}\\b\\s*(?:says|said|asks|asked|replies|responds|whispers|shouts|mutters|speaks)\\b`, 'i').test(text) ||
    new RegExp(`\\b${escaped}\\b\\s*(?:delivers|gives)\\s+(?:the\\s+)?(?:spoken\\s+)?(?:dialogue|line)\\b`, 'i').test(text)
  );
}

export function extractDialogueCharacterNames(
  prompt: string,
  clipScenes: BreakdownScene[],
  characters: WorkflowAssetItem[],
  explicitNames: unknown,
): string[] {
  const availableNames = uniqueClipNames([
    ...characters.map(workflowAssetName),
    ...(Array.isArray(explicitNames) ? explicitNames.map(String) : []),
  ]);
  if (availableNames.length === 0) return [];
  const fromScenes = extractDialogueCharacterNamesFromScenes(clipScenes, availableNames);
  const fromPrompt = extractDialogueCharacterNamesFromPrompt(prompt, availableNames);
  return uniqueClipNames([...fromScenes, ...fromPrompt]).filter((name) => availableNames.some((candidate) => normalizeCompareText(candidate) === normalizeCompareText(name)));
}

export function collectCharacterAudioReferencesFromWorkflow(
  names: string[],
  assets: WorkflowAssets,
): CharacterAudioReference[] {
  const characters = assetArray(assets, 'characters');
  const refs: CharacterAudioReference[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const character = findWorkflowAssetByName(characters, name);
    if (!character) continue;
    const url = workflowAssetAudioUrl(character);
    const key = normalizeCompareText(name);
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({
      name,
      url,
      assetId: character.referenceAudioAssetId,
      fileName: character.voiceReferenceFileName,
      source: 'workflow-asset',
    });
  }
  return refs;
}

export function canvasNodeAudioReferenceUrl(node: { type?: string; data?: any } | undefined): string {
  if (!node) return '';
  const data = node.data ?? {};
  if (node.type === 'audio' || data.workflowKind === 'audio' || data.kind === 'audio' || data.assetKind === 'audio') {
    return publicAudioUrl(data.audioUrl || data.referenceAudioUrl || data.url);
  }
  return publicAudioUrl(data.referenceAudioUrl || data.audioUrl);
}

export function collectVideoNodeAudioReferences(
  videoNodeId: string,
  prompt: string,
  data: any,
  nodes: Array<{ id: string; type?: string; data?: any }>,
  edges: Array<{ source?: string; target?: string }>,
  workflowAssets: WorkflowAssets,
  clipScenes: BreakdownScene[],
): CharacterAudioReference[] {
  const characterAssets = assetArray(workflowAssets, 'characters');
  const dialogueNames = extractDialogueCharacterNames(prompt, clipScenes, characterAssets, data.dialogueCharacterNames || data.characters);
  const refs = collectCharacterAudioReferencesFromWorkflow(dialogueNames, workflowAssets);
  const refByName = new Map(refs.map((ref) => [normalizeCompareText(ref.name), ref]));
  for (const edge of edges.filter((edge) => edge.target === videoNodeId)) {
    const source = nodes.find((node) => node.id === edge.source);
    if (!source) continue;
    const audioUrl = canvasNodeAudioReferenceUrl(source);
    if (!audioUrl) continue;
    const sourceName = String(source.data?.assetName || source.data?.characterName || source.data?.name || source.data?.title || '').trim();
    const matchedName = dialogueNames.find((name) => normalizeCompareText(name) === normalizeCompareText(sourceName)) || sourceName;
    if (!matchedName) continue;
    const key = normalizeCompareText(matchedName);
    const existing = refByName.get(key);
    if (existing?.url) continue;
    const nextRef: CharacterAudioReference = {
      name: matchedName,
      url: audioUrl,
      assetId: String(source.data?.referenceAudioAssetId || source.data?.assetId || ''),
      fileName: String(source.data?.fileName || source.data?.voiceReferenceFileName || ''),
      source: 'canvas-node',
    };
    refByName.set(key, nextRef);
  }
  return Array.from(refByName.values());
}

export function characterAudioReferenceMetadata(refs: CharacterAudioReference[]) {
  const dialogueCharacterNames = refs.map((ref) => ref.name);
  const referenceAudioUrls = refs.map((ref) => ref.url).filter(Boolean) as string[];
  return {
    dialogueCharacterNames,
    characterAudioReferences: refs,
    referenceAudioUrls,
    referenceAudioCount: referenceAudioUrls.length,
  };
}

export function characterAudioReferencesFromNodeData(data: any): CharacterAudioReference[] {
  const rawRefs = Array.isArray(data?.characterAudioReferences) ? data.characterAudioReferences : [];
  const refs = rawRefs
    .filter((item: any) => item && typeof item === 'object')
    .map((item: any): CharacterAudioReference => ({
      name: String(item.name || item.characterName || '').trim(),
      url: publicAudioUrl(item.url || item.referenceAudioUrl),
      assetId: String(item.assetId || item.referenceAudioAssetId || ''),
      fileName: String(item.fileName || item.voiceReferenceFileName || ''),
      source: item.source === 'canvas-node' ? 'canvas-node' : 'workflow-asset',
    }))
    .filter((item) => item.name);
  const storedUrls = Array.isArray(data?.referenceAudioUrls) ? data.referenceAudioUrls.map(publicAudioUrl).filter(Boolean) : [];
  const namedKeys = new Set(refs.map((ref) => normalizeCompareText(ref.name)));
  const seenUrls = new Set(refs.map((ref) => publicAudioUrl(ref.url)).filter(Boolean));
  for (const [index, url] of storedUrls.entries()) {
    if (!url || seenUrls.has(url)) continue;
    const key = `audio-${index + 1}`;
    if (namedKeys.has(key)) continue;
    refs.push({ name: `音频参考 ${index + 1}`, url, source: 'workflow-asset' });
    seenUrls.add(url);
  }
  return refs;
}

export function mergeVideoAudioReferencesWithIncoming(
  baseRefs: CharacterAudioReference[],
  videoNodeId: string,
  nodes: Array<{ id: string; type?: string; data?: any }>,
  edges: Array<{ source?: string; target?: string }>,
): CharacterAudioReference[] {
  const refs = new Map<string, CharacterAudioReference>();
  const urlToKey = new Map<string, string>();
  for (const ref of baseRefs) {
    const key = normalizeCompareText(ref.name);
    if (!key) continue;
    refs.set(key, ref);
    const url = publicAudioUrl(ref.url);
    if (url) urlToKey.set(url, key);
  }
  for (const edge of edges.filter((edge) => edge.target === videoNodeId)) {
    const source = nodes.find((node) => node.id === edge.source);
    const audioUrl = canvasNodeAudioReferenceUrl(source);
    if (!source || !audioUrl) continue;
    const name = String(source.data?.assetName || source.data?.characterName || source.data?.name || source.data?.title || '').trim() || '音频参考';
    const existingKeyForUrl = urlToKey.get(audioUrl);
    const key = existingKeyForUrl || normalizeCompareText(name);
    const existing = refs.get(key);
    refs.set(key, {
      name: existingKeyForUrl && existing?.name ? existing.name : name,
      url: audioUrl,
      assetId: String(source.data?.referenceAudioAssetId || source.data?.assetId || existing?.assetId || ''),
      fileName: String(source.data?.fileName || source.data?.voiceReferenceFileName || existing?.fileName || ''),
      source: 'canvas-node',
    });
    urlToKey.set(audioUrl, key);
  }
  return Array.from(refs.values());
}

export function compactPromptText(value: unknown, _max = Number.POSITIVE_INFINITY) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizePromptTextForParsing(value: unknown) {
  return String(value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

export function prepareCanvasPromptForImageModel(value: unknown) {
  const prompt = String(value ?? '').trim();
  if (!prompt) return prompt;
  if (!/(storyboard|director board|production board|分镜|故事板|导演板|technical label strip|Technical labels under each panel)/i.test(prompt)) {
    return prompt;
  }
  return finalizeClipStoryboardImagePrompt(prompt, detectStoryboardPanelCount(prompt));
}

export function isClipStoryboardImagePrompt(prompt: string) {
  return /clip-level director storyboard image|director storyboard image with \d+ clear panels|Panel\s*1\s*:/i.test(prompt);
}

export function canvasPromptTooLongError(kind: 'image' | 'video', length: number) {
  const label = kind === 'video' ? '视频提示词' : '生图提示词';
  return `${label}超过接口上限 ${CANVAS_PROMPT_API_MAX_CHARS} 字符（当前 ${length}）。已拒绝提交，未压缩提示词。请手动拆分或删减后再生成。`;
}

export function isCanvasPromptWithinApiLimit(value: string) {
  return value.length <= CANVAS_PROMPT_API_MAX_CHARS;
}

export function dreaminaWebVideoPromptTooLongError(length: number) {
  return `Dreamina Web 视频提示词超过 4000 字符（当前 ${length}）。Dreamina 页面会禁用生成按钮，已拒绝提交，未压缩提示词。请手动删减或重新推理更短的视频提示词后再生成。`;
}

export function isDreaminaWebVideoPromptWithinLimit(value: string) {
  return value.length <= DREAMINA_WEB_VIDEO_PROMPT_MAX_CHARS;
}

export function getClipEstimatedDuration(clip: Clip, clipScenes: BreakdownScene[]) {
  const estimated = Number(clip.estimatedDuration);
  if (Number.isFinite(estimated) && estimated > 0) return estimated;
  const sceneTotal = clipScenes.reduce((sum, scene) => sum + Math.max(0, Number(scene.durationSeconds ?? 0)), 0);
  return sceneTotal > 0 ? sceneTotal : 10;
}

export function suggestClipStoryboardPanelCount(clip: Clip, clipScenes: BreakdownScene[]) {
  const duration = getClipEstimatedDuration(clip, clipScenes);
  const shotCount = Math.max(clipScenes.length, clip.shotIds?.length ?? 0);
  const dialogueWords = clip.dialogueWordCount ?? clipScenes.reduce((sum, scene) => sum + countEnglishDialogueWords(scene.dialogue), 0);
  const dialoguePressure = dialogueWords > 32 ? 1 : 0;

  if (duration < 6) return Math.max(MIN_CLIP_STORYBOARD_PANEL_COUNT, Math.min(6, shotCount + 2));
  if (duration <= 8) return Math.max(6, Math.min(8, shotCount + 3 + dialoguePressure));
  if (duration <= 12) return Math.max(8, Math.min(10, shotCount + 4 + dialoguePressure));
  return Math.max(10, Math.min(MAX_CLIP_STORYBOARD_PANEL_COUNT, shotCount + 5 + dialoguePressure));
}

export function formatClipShotPromptLine(scene: BreakdownScene, index: number) {
  const duration = Number.isFinite(Number(scene.durationSeconds)) ? `${scene.durationSeconds}s` : 'duration unspecified';
  const action = compactPromptText(scene.action || scene.description, 220);
  const dialogue = compactPromptText(scene.dialogue, 180);
  const visual = compactPromptText(scene.visualPrompt, 180);
  return [
    `Story beat ${String(index + 1).padStart(2, '0')} (${duration}): ${compactPromptText(scene.title, 90)}`,
    action ? `show ${action}` : '',
    dialogue ? `speech bubble when visible: ${dialogue}` : 'no speech bubble',
    visual ? `visual cue: ${visual}` : '',
  ]
    .filter(Boolean)
    .join('; ');
}

export function buildClipStoryboardPanelLines(clip: Clip, clipScenes: BreakdownScene[], panelCount: number) {
  const count = Math.max(
    MIN_CLIP_STORYBOARD_PANEL_COUNT,
    Math.min(MAX_CLIP_STORYBOARD_PANEL_COUNT, Math.round(panelCount || suggestClipStoryboardPanelCount(clip, clipScenes))),
  );
  if (clipScenes.length === 0) {
    return Array.from({ length: count }, (_, index) => {
      const edge = index === 0 ? clip.startState : index === count - 1 ? clip.endState : clip.plotGoal;
      const action = compactPromptText(edge, 260) || compactPromptText(clip.plotGoal, 260) || 'Show the required Clip story beat clearly';
      const focusCharacter = clip.characters[index % Math.max(1, clip.characters.length)] || 'current Clip subject';
      return `Panel ${index + 1}: visible cast: ${focusCharacter}; compose as medium close-up or close-up; show ${action}; no speech bubble; small corner label P${index + 1}; do not repeat the same character inside this panel.`;
    }).join('\n');
  }
  const firstPanelBySceneIndex = new Map<number, number>();
  for (let index = 0; index < count; index += 1) {
    const sceneIndex = Math.min(clipScenes.length - 1, Math.floor((index * clipScenes.length) / count));
    if (!firstPanelBySceneIndex.has(sceneIndex)) firstPanelBySceneIndex.set(sceneIndex, index);
  }
  const usedDialogueKeys = new Set<string>();
  return Array.from({ length: count }, (_, index) => {
    const sceneIndex = Math.min(clipScenes.length - 1, Math.floor((index * clipScenes.length) / count));
    const scene = clipScenes[sceneIndex];
    const action = compactPromptText(scene.action || scene.description || scene.visualPrompt, 260);
    const dialogue = compactPromptText(scene.dialogue, 220);
    const dialogueKey = normalizeStoryboardDialogueKey(dialogue);
    const shouldShowDialogue = Boolean(dialogue && dialogueKey && firstPanelBySceneIndex.get(sceneIndex) === index && !usedDialogueKeys.has(dialogueKey));
    if (shouldShowDialogue) usedDialogueKeys.add(dialogueKey);
    const visibleCast = limitStoryboardVisibleCast(storyboardVisibleCastForScene(scene, clip), scene, index).join(', ') || 'current panel subjects only';
    const framing = storyboardPanelFramingForScene(scene, index);
    const label = [
      `visible cast: ${visibleCast}`,
      `compose as ${framing}`,
      action ? `show ${action}` : '',
      shouldShowDialogue ? `speech bubble: ${dialogue}` : 'no speech bubble',
      'do not repeat the same character inside this panel',
      `small corner label P${index + 1}`,
    ].filter(Boolean).join(' | ');
    return `Panel ${index + 1}: ${label || 'Continue the Clip action with readable continuity'}.`;
  }).join('\n');
}

export function storyboardVisibleCastForScene(scene: BreakdownScene, clip: Clip): string[] {
  const text = normalizeCompareText([
    scene.title,
    scene.description,
    scene.action,
    scene.dialogue,
    scene.references,
    scene.visualPrompt,
  ].join(' '));
  const candidates = uniqueStrings([...(scene.characters ?? []), ...(clip.characters ?? [])]).slice(0, 12);
  const direct = candidates.filter((name) => {
    const key = normalizeCompareText(name);
    return key && text.includes(key);
  });
  if (direct.length > 0) return direct;
  return uniqueStrings(scene.characters ?? []).slice(0, 6);
}

export function storyboardPanelFramingForScene(scene: BreakdownScene, index: number): string {
  const text = normalizeCompareText([scene.title, scene.description, scene.action, scene.visualPrompt].join(' '));
  const hasDetailNeed = /\b(close|close-up|closeup|reaction|insert|detail|face|eyes|hand|prop|weapon)\b|特写|近景|反应|表情|眼神|手部|道具|武器|细节/.test(text);
  const hasWideNeed = /\b(wide|establishing|overhead|full room|group|team|everyone|all characters)\b|远景|全景|俯视|空间|全体|众人|主角团|所有角色/.test(text);
  if (hasDetailNeed || index % 3 === 1) return 'close-up / reaction close-up / detail insert';
  if (hasWideNeed) return 'brief medium group orientation only if needed, cropped toward the current action';
  if (index % 3 === 2) return 'medium close-up / over-the-shoulder';
  return 'medium close-up or tight medium shot';
}

export function limitStoryboardVisibleCast(names: string[], scene: BreakdownScene, index: number): string[] {
  const unique = uniqueStrings(names).filter(Boolean);
  if (unique.length <= 2) return unique;
  const text = normalizeCompareText([scene.title, scene.description, scene.action, scene.dialogue, scene.references, scene.visualPrompt].join(' '));
  const needsGroup = /\b(group|team|everyone|all characters|crowd|surround|fight|battle|block|intercept|together)\b|全体|众人|主角团|团队|包围|战斗|拦截|一起/.test(text);
  if (needsGroup) return unique.slice(0, 3);
  return unique.slice(index % unique.length, index % unique.length + 2).concat(unique.slice(0, Math.max(0, (index % unique.length + 2) - unique.length))).slice(0, 2);
}

export function clipStoryboardBoardLayoutStrategy(panelCount?: number) {
  const panelText = panelCount ? `${panelCount} sequential panels` : 'the selected number of sequential panels';
  return [
    `Storyboard layout: one 16:9 compact multi-panel comic page using ${panelText} in left-to-right, top-to-bottom reading order.`,
    'Use a full-page comic grid with thin black gutters and vertical-video-friendly frames: most panels should be tighter and taller-feeling rather than very wide.',
    'Favor medium close-ups, close-ups, reaction close-ups, over-shoulders, hand/prop inserts, and expression inserts; use wide/group panels sparingly for orientation only.',
    'Each panel should contain only the characters needed for that panel beat; do not duplicate the same character multiple times inside one panel.',
    'Place a small readable panel number label such as P1, P2, P3 in a corner of each panel.',
    'Show spoken dialogue as clean white comic speech bubbles inside the relevant panels.',
    'Place each exact dialogue line in one speech bubble on the most relevant panel only; continuation and reaction panels for that same beat use no speech bubble unless they contain a different exact dialogue line.',
    'Visible text stays to panel labels and speech bubbles.',
  ].join(' ');
}

export function buildClipDirectorBoardPrompt(clip: Clip, clipScenes: BreakdownScene[], panelChoice: ClipPanelCountChoice, allScenes: BreakdownScene[] = clipScenes, assets?: WorkflowAssets) {
  const duration = Math.round(getClipEstimatedDuration(clip, clipScenes) * 10) / 10;
  const suggestedPanelCount = suggestClipStoryboardPanelCount(clip, clipScenes);
  const targetPanelCount = panelChoice === 'ai' ? suggestedPanelCount : panelChoice;
  const continuityCharacters = inferContinuityCharactersForClip(clip, clipScenes, allScenes, assets);
  const panelInstruction =
    panelChoice === 'ai'
      ? `First infer the best panel count for this Clip from the story, dialogue density, action complexity, and readability. Use 5-12 panels. Prefer building each storyboard around a full 15-second Clip when the dialogue can be spoken within 15 seconds at fast American animation pacing. Prefer 8-10 panels for 10-12 second Clips and 10-12 panels for 13-15 second Clips. Do not fill panels mechanically; key story beats, exact dialogue, and readable continuity are more important than maximizing panel count. System estimate: ${suggestedPanelCount} panels.`
      : `Use exactly ${panelChoice} clear panels.`;
  const shotLines = clipScenes.length
    ? clipScenes.map(formatClipShotPromptLine).join('\n')
    : 'No matched shots were found. Build the board from the Clip goal, start state, end state, and project continuity.';

  return finalizeClipStoryboardImagePrompt([
    'Create one 16:9 multi-panel 3D American comic storyboard image.',
    'This storyboard represents the whole Clip, not one isolated shot.',
    clipStoryboardBoardLayoutStrategy(targetPanelCount),
    'Visual style: polished 3D American animated dark-comedy comic storyboard, saturated colors, clean 3D render, exaggerated acting, cinematic rim light, fast comic-panel pacing.',
    panelInstruction,
    `Clip title: ${clip.title}`,
    `Clip duration target: ${duration}s, never longer than 15s.`,
    `Setting: ${clip.setting || 'use the current project setting'}`,
    `Characters present: ${compactList(continuityCharacters.length ? continuityCharacters : clip.characters, 'characters from this Clip', 12)}`,
    'If these characters have linked character images, use those images as the complete visual authority, including any carried props already visible in the character image. Do not request separate prop reference images.',
    `Plot goal: ${compactPromptText(clip.plotGoal, 260) || 'show the required story beat clearly'}`,
    `Start state: ${compactPromptText(clip.startState, 220) || 'use the first shot state'}`,
    `End state: ${compactPromptText(clip.endState, 220) || 'use the last shot state'}`,
    clip.emotionArc ? `Emotion arc: ${compactPromptText(clip.emotionArc, 180)}` : '',
    clip.layoutMemory ? `Spatial continuity:\n${compactPromptText(clip.layoutMemory, 520)}` : '',
    'Story beats to show across the comic panels:',
    shotLines,
    'Comic panels in reading order:',
    buildClipStoryboardPanelLines(clip, clipScenes, targetPanelCount),
    'Panel planning rules: distribute the Clip action across the panels; do not create one board per single shot; keep screen direction, character positions, props, entrances, exits, and start/end states continuous.',
    'Panel framing strategy: most panels should be medium close-ups, close-ups, reaction close-ups, over-shoulders, hand/prop inserts, and expression inserts. Use wide/group panels only when the exact beat needs orientation or multi-character blocking.',
    'Panel cast rule: every Panel line has visible cast and framing guidance. Follow that line over the broader continuity character list. Do not draw the same named character more than once inside a single panel.',
    'Visible board text: small panel number labels and speech-bubble dialogue only.',
    'Character rules: reference images define exact appearance. Use only short identity labels in text; do not invent clothing, hair, fruit type, or props that conflict with references.',
    'Board style: polished 3D American animated dark-comedy comic storyboard for AI video generation, readable spatial blocking, fast comic-panel pacing.',
    'Language rule: keep dialogue and any visible board text in the original language used by the shots.',
    'Avoid: decorative explanation paragraphs, UI chrome, watermarks, random non-dialogue text, inconsistent character identity, and isolated single-shot treatment.',
  ]
    .filter(Boolean)
    .join('\n'), targetPanelCount);
}

export function ensureClipStoryboardBoardLayoutPrompt(prompt: string, panelCount?: number) {
  const trimmed = stripLegacyClipStoryboardImageLayoutPrompt(String(prompt || '').trim());
  if (!trimmed) return trimmed;
  if (hasCompleteClipStoryboardBoardLayoutPrompt(trimmed)) return trimmed;
  return normalizeStoryboardPromptSpacing([clipStoryboardBoardLayoutStrategy(panelCount ?? detectStoryboardPanelCount(trimmed)), trimmed].filter(Boolean).join('\n\n'));
}

export function finalizeClipStoryboardImagePrompt(prompt: string, panelCount?: number) {
  const text = ensureClipStoryboardBoardLayoutPrompt(stripComicStoryboardLayoutPrompt(prompt), panelCount);
  if (!text) return text;
  return normalizeStoryboardPromptSpacing(
    dedupeStoryboardPanelSpeechBubbles(text
      .replace(/^\s*Shots to cover across the panels\s*:/gim, 'Story beats to show across the comic panels:')
      .replace(/^\s*Panel beats to render in order\s*:/gim, 'Comic panels in reading order:')
      .replace(/^\s*Shot\s+(\d{1,2})(?:\s*\([^)]*\))?\s*\|\s*/gim, 'Story beat $1: ')
      .replace(/\btitle\s*=\s*/gi, 'title: ')
      .replace(/\bcamera\s*=\s*[^|\n.]+(?:\s*\|\s*)?/gi, '')
      .replace(/\baction\s*=\s*/gi, 'show ')
      .replace(/\bexact dialogue\s*=\s*/gi, 'speech bubble: ')
      .replace(/\bdialogue\s*=\s*/gi, 'speech bubble when visible: ')
      .replace(/\bkey prop\s*=\s*/gi, 'carried object: ')
      .replace(/\bvisual cue\s*=\s*/gi, 'visual cue: ')
      .replace(/\btechnical label strip includes[^.\n]*[.\n]?/gi, '')
      .replace(/\bTechnical labels under each panel:[^\n.]*[.\n]?/gi, '')
      .replace(/\bshot size,?\s*angle,?\s*movement,?\s*lens\b/gi, '')
      .replace(/\bcompact printed production labels\b/gi, 'clean comic panel labels and speech bubbles')
      .replace(/\bcompact production labels\b/gi, 'clean comic panel labels')
      .replace(/\s*\|\s*/g, '; ')
      .replace(/;[ \t]*;/g, ';')),
  );
}

export function stripComicStoryboardLayoutPrompt(prompt: unknown) {
  return String(prompt || '')
    .replace(/Storyboard layout:\s*one 16:9 (?:compact\s*)?multi-panel comic page[\s\S]*?(?:Visible text stays to panel labels and speech bubbles\.|Use only panel numbers and intentional speech bubbles as visible text; camera, lens, movement, and shot metadata belong to the video prompt, not the image\.)\s*/gi, '')
    .replace(/Storyboard layout:\s*one 16:9 multi-panel comic page[\s\S]*?Place a small readable panel number label such as P1, P2, P3 in a corner of\s*(?=(?:Required continuity characters|Use linked|Create|Comic panels in reading order|Panel\s+\d+:|Character reference|Dialogue lock|$))/gi, '')
    .replace(/\b(?:each|the selected number of large sequential panels in left-to-right, top-to-bottom reading order\. Use a full-page comic grid with thin black gutters and large cinematic 3D American comic frames\. Place a small readable panel number label such as P1, P2, P3 in a corner of each)\s+panel\. Show spoken dialogue as clean white comic speech bubbles inside the relevant panels\. Visible text stays to panel labels and speech bubbles\./gi, ' ');
}

export function hasCompleteClipStoryboardBoardLayoutPrompt(prompt: string) {
  return /Storyboard layout:\s*one 16:9 compact multi-panel comic page/i.test(prompt) &&
    /vertical-video-friendly frames/i.test(prompt) &&
    /Show spoken dialogue as clean white comic speech bubbles/i.test(prompt);
}

export function stripLegacyClipStoryboardImageLayoutPrompt(prompt: string) {
  const original = String(prompt || '');
  const hadLegacyLayout = /clip-level director board|technical label strip|Technical labels under each panel|compact printed production labels|compact production labels|subtitles over artwork|Storyboard layout:\s*one 16:9 board with two zones|Upper continuity zone|Lower storyboard zone|\bcamera\s*=|\bexact dialogue\s*=|\bkey prop\s*=/i.test(original);
  const replaced = original
    .replace(/\bCreate one 16:9 clip-level director board image\b/gi, 'Create one 16:9 multi-panel 3D American comic storyboard image')
    .replace(/Layout:\s*clean storyboard strip\/grid with clear sequential panels for the Clip action\./gi, '')
    .replace(/Storyboard layout:\s*one 16:9 board with two zones\.[\s\S]*?compact readable labels below panels only\./gi, ' ')
    .replace(/Each storyboard panel must have an image area (?:above|plus)[^.]*technical label strip below it\./gi, ' ')
    .replace(/Each panel must include an image area and a compact technical label strip below it\./gi, ' ')
    .replace(/Technical labels under each panel:[^\n.]*[.\n]?/gi, 'Visible board text: small panel number labels like P1/P2 and intentional speech-bubble dialogue only. ')
    .replace(/;\s*technical label strip includes[^.\n]*\./gi, '.')
    .replace(/\bcompact printed production labels\b/gi, 'clean comic panel labels and speech bubbles')
    .replace(/\bcompact production labels\b/gi, 'clean comic panel labels')
    .replace(/,\s*speech bubbles,\s*subtitles over artwork/gi, '');
  if (!hadLegacyLayout) return normalizeStoryboardPromptSpacing(cleanStrayReferenceMapText(replaced));
  const panelCleanedText = cleanLegacyStoryboardText(cleanLegacyStoryboardPanelFieldText(cleanLegacyStoryboardShotFieldText(cleanStrayReferenceMapText(replaced))));
  return [
    clipStoryboardBoardLayoutStrategy(detectStoryboardPanelCount(panelCleanedText)),
    panelCleanedText,
    'Visible board text rule: only small P1/P2/P3 panel labels and clean comic speech-bubble dialogue appear as text.',
  ].filter(Boolean).join('\n\n');
}

export function cleanStrayReferenceMapText(prompt: string) {
  return prompt
    .replace(/\b(?:each|the selected number of large sequential panels in left-to-right, top-to-bottom reading order\. Use a full-page comic grid with thin black gutters and large cinematic 3D American comic frames\. Place a small readable panel number label such as P1, P2, P3 in a corner of each)\s+panel\. Show spoken dialogue as clean white comic speech bubbles inside the relevant panels\. Visible text stays to panel labels and speech bubbles\./gi, ' ')
    .replace(/\s+Reference image map:\s+#\d+:[\s\S]*?(?=(?:\s+Required continuity characters:|\s+Use the linked previous storyboard image|\s+Create one|\s+Storyboard layout:|\s+Comic panels in reading order:|\s+Panel\s+\d+:|$))/gi, ' ')
    .replace(/^Reference image map:\s+[\s\S]*?(?=(?:\n\n|\n)?(?:Storyboard layout|Comic panels in reading order|Create|Required|Use the linked previous storyboard image|Clip title|This storyboard|Each panel|First infer|Setting|Characters present|Plot goal|Start state|End state|Shots to cover|Panel\s+\d+)\b|$)/i, '');
}

export function cleanLegacyStoryboardText(prompt: string): string {
  return prompt
    .replace(/Shots to cover across the panels:/gi, 'Story beats to show across the comic panels:')
    .replace(/Panel beats to render in order:/gi, 'Comic panels in reading order:')
    .replace(/Panel planning rules:\s*distribute the Clip action across the panels;\s*/gi, 'Panel continuity: distribute the Clip story across the panels; ')
    .replace(/Language rule:\s*keep dialogue and any visible board text in the original language used by the shots\./gi, 'Speech bubbles use the original story language.')
    .replace(/Character personal prop continuity:/gi, 'Character carried-object continuity:')
    .replace(/\baction beats\b/gi, 'story beats')
    .replace(/\bdialogue only\b/gi, 'speech bubbles only')
    .replace(/\brandom non-dialogue text\b/gi, 'random extra text')
    .replace(/\brandom text\b/gi, 'random extra text')
    .replace(/[ \t]*(Story beats to show across the comic panels:)[ \t]*/gi, '\n$1\n')
    .replace(/[ \t]*(Comic panels in reading order:)[ \t]*/gi, '\n$1\n')
    .replace(/[ \t]*(Panel continuity:)/gi, '\n$1')
    .replace(/[ \t]*(Visible board text:)/gi, '\n$1')
    .replace(/[ \t]*(Character rules:)/gi, '\n$1')
    .replace(/[ \t]*(Board style:)/gi, '\n$1')
    .replace(/[ \t]*(Speech bubbles use the original story language\.)/gi, '\n$1')
    .replace(/[ \t]*(Avoid:)/gi, '\n$1');
}

export function cleanLegacyStoryboardPanelFieldText(prompt: string): string {
  const usedDialogueKeys = new Set<string>();
  return prompt.replace(
    /\bPanel\s+(\d{1,2})\s*[:：]\s*([\s\S]*?)(?=\bPanel\s+\d{1,2}\s*[:：]|\bPanel planning rules\b|\bVisible board text\b|\bCharacter rules\b|\bBoard style\b|\bLanguage rule\b|\bAvoid\b|$)/gi,
    (match, panelNumber: string, body: string) => {
      if (!/\b(?:camera|action|exact dialogue|dialogue|key prop|panel label|visible cast|framing)\s*=/i.test(body)) return match;
      const action = extractLegacyStoryboardField(body, 'action');
      const dialogue = extractLegacyStoryboardField(body, 'exact dialogue') || extractLegacyStoryboardField(body, 'dialogue');
      const dialogueKey = normalizeStoryboardDialogueKey(dialogue);
      const shouldShowDialogue = Boolean(dialogue && dialogueKey && !usedDialogueKeys.has(dialogueKey));
      if (shouldShowDialogue) usedDialogueKeys.add(dialogueKey);
      const visual = [action ? `show ${action}` : '', shouldShowDialogue ? `speech bubble: ${dialogue}` : 'no speech bubble', `small corner label P${Number(panelNumber)}`]
        .filter(Boolean)
        .join('; ');
      return `\nPanel ${Number(panelNumber)}: ${visual}. `;
    },
  );
}

export function cleanLegacyStoryboardShotFieldText(prompt: string): string {
  return prompt.replace(
    /\bShot\s+(\d{1,2})\s*(?:\([^)]*\))?\s*\|\s*([\s\S]*?)(?=\bShot\s+\d{1,2}\s*(?:\([^)]*\))?\s*\||\bPanel beats to render in order\s*:|\bComic panels in reading order\s*:|\bPanel\s+\d{1,2}\s*[:：]|$)/gi,
    (match, shotNumber: string, body: string) => {
      if (!/\b(?:title|camera|action|dialogue|exact dialogue|key prop|visual cue)\s*=/i.test(body)) return match;
      const title = extractLegacyStoryboardField(body, 'title');
      const action = extractLegacyStoryboardField(body, 'action');
      const dialogue = extractLegacyStoryboardField(body, 'dialogue') || extractLegacyStoryboardField(body, 'exact dialogue');
      const visualCue = extractLegacyStoryboardField(body, 'visual cue');
      const visual = [
        title ? `Story beat ${Number(shotNumber)} (${title})` : `Story beat ${Number(shotNumber)}`,
        action ? `show ${action}` : '',
        visualCue ? `visual cue: ${visualCue}` : '',
        dialogue ? `speech bubble when visible: ${dialogue}` : 'no speech bubble',
      ].filter(Boolean).join('; ');
      return `\n${visual}. `;
    },
  );
}

export function extractLegacyStoryboardField(body: string, field: string): string {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`${escaped}\\s*=\\s*([\\s\\S]*?)(?=\\s*\\|\\s*(?:title|camera|action|exact dialogue|dialogue|key prop|visual cue|panel label|visible cast|framing)\\s*=|;\\s*technical label|$)`, 'i'));
  return compactPromptText(match?.[1] || '', 420);
}

export function dedupeStoryboardPanelSpeechBubbles(prompt: string): string {
  const panelsHeaderMatch = prompt.match(/\bComic panels in reading order\s*:/i);
  if (!panelsHeaderMatch || typeof panelsHeaderMatch.index !== 'number') return prompt;
  const beforePanels = prompt.slice(0, panelsHeaderMatch.index + panelsHeaderMatch[0].length);
  const panelsAndAfter = prompt.slice(panelsHeaderMatch.index + panelsHeaderMatch[0].length);
  const usedDialogueKeys = new Set<string>();
  const cleanedPanels = panelsAndAfter.replace(
    /\bPanel\s+(\d{1,2})\s*[:：]\s*([\s\S]*?)(?=\bPanel\s+\d{1,2}\s*[:：]|\bPanel planning rules\b|\bPanel continuity\b|\bVisible board text\b|\bCharacter rules\b|\bBoard style\b|\bLanguage rule\b|\bSpeech bubbles\b|\bAvoid\b|$)/gi,
    (match, panelNumber: string, body: string) => {
      const nextBody = body.replace(/\bspeech bubble(?:\s+when\s+visible)?\s*:\s*([^|;\n]+)/gi, (_bubbleMatch, dialogue: string) => {
        const cleanDialogue = compactPromptText(dialogue, 420);
        const dialogueKey = normalizeStoryboardDialogueKey(cleanDialogue);
        if (!dialogueKey) return 'no speech bubble';
        if (usedDialogueKeys.has(dialogueKey)) return 'no speech bubble';
        usedDialogueKeys.add(dialogueKey);
        return `speech bubble: ${cleanDialogue}`;
      });
      return `Panel ${Number(panelNumber)}: ${nextBody}`;
    },
  );
  return `${beforePanels}${cleanedPanels}`;
}

export function normalizeStoryboardDialogueKey(dialogue: string): string {
  return compactPromptText(dialogue)
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeStoryboardPromptSpacing(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function detectStoryboardPanelCount(prompt: string): number | undefined {
  const exact = prompt.match(/\bUse exactly\s+(\d{1,2})\s+(?:clear\s+)?panels?\b/i);
  const comic = prompt.match(/\bwith\s+(\d{1,2})\s+large\s+panels?\b/i);
  const labels = Array.from(prompt.matchAll(/\bPanel\s+(\d{1,2})\s*[:：]/gi)).map((match) => Number(match[1]));
  const count = Number(exact?.[1] || comic?.[1] || Math.max(0, ...labels));
  if (!Number.isFinite(count) || count <= 0) return undefined;
  return Math.max(MIN_CLIP_STORYBOARD_PANEL_COUNT, Math.min(MAX_CLIP_STORYBOARD_PANEL_COUNT, Math.round(count)));
}

export function enforceClipStoryboardContinuityPrompt(
  prompt: string,
  clip: Clip,
  clipScenes: BreakdownScene[],
  allScenes: BreakdownScene[],
  assets?: WorkflowAssets,
) {
  const continuityCharacters = inferContinuityCharactersForClip(clip, clipScenes, allScenes, assets);
  if (continuityCharacters.length === 0) return prompt;
  const promptKey = normalizeCompareText(prompt);
  const missing = continuityCharacters.filter((name) => !promptKey.includes(normalizeCompareText(name)));
  if (missing.length === 0 && /required continuity characters/i.test(prompt)) return prompt;
  const header = [
    `Required continuity characters: ${continuityCharacters.join(', ')}.`,
    "This is continuity context, not a requirement to draw every listed character in every panel. Use each panel's visible cast and framing note to decide who is actually on screen.",
    'Use linked character images as the complete visual authority. Do not add separate prop reference images; carried props already visible in character images stay with their characters.',
  ].join(' ');
  return [header, prompt].filter(Boolean).join('\n\n');
}


export type WorkflowCenterOverlayProps = {
  generationStrategy?: string;
  storyboardEnabled?: boolean;
  firstFrameUnavailable?: boolean;
  activeStage: WorkflowStageKey;
  setActiveStage: (stage: WorkflowStageKey) => void;
  sourceText: string;
  setSourceText: (value: string) => void;
  sourceName: string;
  setSourceName: (value: string) => void;
  selectedEpisode: string;
  setSelectedEpisode: (value: string) => void;
  episodeList: WorkflowEpisodeListResponse;
  activeEpisodeId: string;
  activeEpisodeSummary?: WorkflowEpisodeSummary;
  episodeSwitching: boolean;
  episodeCreating: boolean;
  onSelectEpisode: (episodeId: string) => void;
  onCreateNextEpisode: () => void;
  onSaveSource: () => void | Promise<void>;
  scenes: BreakdownScene[];
  clips: Clip[];
  assets: WorkflowAssets;
  stageStatuses: Record<string, string>;
  workflowLoading: boolean;
  workflowSaving: boolean;
  workflowRunning: boolean;
  workflowError: string | null;
  workflowProgressText?: string;
  workflowModels: ModelConfig[];
  workflowAiModelId: string;
  setWorkflowAiModelId: (value: string) => void;
  finalizeClipStoryboardPrompt: FinalizeClipStoryboardPrompt;
  workflowModelsLoading: boolean;
  workflowModelError: string | null;
  runBreakdown: () => void;
  rerunStoryboard: () => void;
  inferBoardsAndVideoToCanvas: () => InferBoardsAndVideoResult | Promise<InferBoardsAndVideoResult>;
  onSyncEpisodeBoardsToCanvas: (override?: EpisodeCanvasSyncRequest) => void | Promise<void>;
  onFullPipelineInfer?: () => void | Promise<void>;
  fullPipelineRunning?: boolean;
  onClose: () => void;
  onUploadClick: () => void;
  onAddWorkflowNode: (nodeType: CanvasNodeKind, title: string, description: string) => void;
  onAddSceneNode: (scene: BreakdownScene, index: number) => void;
  onAddClipStoryboardNode: (clip: Clip, prompt: string) => void | Promise<void>;
  onAddClipStoryboardImageReferenceNode: (clip: Clip, reference: ClipStoryboardImageReference) => void;
  onAddClipVideoNode: (clip: Clip, prompt: string) => void | Promise<void>;
  onAddClipVideoNodes: (clips: Clip[]) => void | Promise<void>;
  onAddClipPositioningBoardNode: (clip: Clip) => void | Promise<void>;
  onAddClipPositioningBoardNodes: (clips: Clip[], options?: { mode?: ClipPositioningBoardMode }) => void | Promise<void>;
  onUpdateClipStoryboard: (clipId: string, patch: { prompt?: string; panelCount?: number; notes?: string }) => void;
  onUpdateScene: (scene: BreakdownScene) => void;
  onDeleteScene: (sceneId: string) => void;
  onAcceptClip: (clipId: string) => void;
  onOptimizeClip: (clipId: string) => void;
  onGenerateClipSeedancePrompt: (clipId: string, options?: { skipCanvasSync?: boolean }) => ClipVideoPromptInferenceResult | Promise<ClipVideoPromptInferenceResult>;
  onUploadAssetReference: (kind: WorkflowAssetKind, item: WorkflowAssetItem) => void;
  onUploadAudioReference: (item: WorkflowAssetItem) => void;
  onClearAudioReference: (item: WorkflowAssetItem) => void | Promise<void>;
  onBatchUploadCharacterAudioReferences: () => void;
  onOpenProjectGlobalSettings: () => void;
  onOpenCharacterPropPicker: (item: WorkflowAssetItem) => void;
  onGenerateAssetImage: (kind: WorkflowAssetKind, item: WorkflowAssetItem, options?: GenerateAssetImageOptions) => void;
  onOpenAssetHistory: (kind: WorkflowAssetKind, item: WorkflowAssetItem, variantFilter?: 'all' | 'with-props') => void;
  onLoadAssetHistoryImages: (kind?: AssetHistoryLoadKind) => void | Promise<void>;
  onPreviewAssetImage: (preview: AssetImagePreview) => void;
  onAddAssetToCanvas: (kind: WorkflowAssetKind, item: WorkflowAssetItem) => void;
  onClearAssetCurrentImage: (kind: WorkflowAssetKind, item: WorkflowAssetItem) => void | Promise<void>;
  onRemoveAsset: (kind: WorkflowAssetKind, item: WorkflowAssetItem) => void;
  onUpdateAssetPrompt: (kind: WorkflowAssetKind, item: WorkflowAssetItem, prompt: string) => void | Promise<void>;
  buildAssetFinalPrompt: (kind: WorkflowAssetKind, item: WorkflowAssetItem) => string;
  isAssetUploadBusy: (kind: WorkflowAssetKind, item: WorkflowAssetItem) => boolean;
  isAssetGenerationBusy: (kind: WorkflowAssetKind, item: WorkflowAssetItem) => boolean;
  optimizingClipId: string | null;
  generatingSeedanceClipId: string | null;
  inferBoardsAndVideoRunning: boolean;
};

export type StageWorkPanelProps = {
  generationStrategy?: string;
  storyboardEnabled?: boolean;
  firstFrameUnavailable?: boolean;
  activeStage: Exclude<WorkflowStageKey, 'source'>;
  sourceReady: boolean;
  activeEpisodeId: string;
  scenes: BreakdownScene[];
  clips: Clip[];
  assets: WorkflowAssets;
  selectedEpisode: string;
  workflowModels: ModelConfig[];
  workflowAiModelId: string;
  setWorkflowAiModelId: (value: string) => void;
  finalizeClipStoryboardPrompt: FinalizeClipStoryboardPrompt;
  workflowModelsLoading: boolean;
  workflowModelError: string | null;
  workflowProgressText?: string;
  runBreakdown: () => void;
  rerunStoryboard: () => void;
  inferBoardsAndVideoToCanvas: () => InferBoardsAndVideoResult | Promise<InferBoardsAndVideoResult>;
  onSyncEpisodeBoardsToCanvas: (override?: EpisodeCanvasSyncRequest) => void | Promise<void>;
  onFullPipelineInfer?: () => void | Promise<void>;
  fullPipelineRunning?: boolean;
  setActiveStage: (stage: WorkflowStageKey) => void;
  onAddWorkflowNode: (nodeType: CanvasNodeKind, title: string, description: string) => void;
  onAddSceneNode: (scene: BreakdownScene, index: number) => void;
  onAddClipStoryboardNode: (clip: Clip, prompt: string) => void | Promise<void>;
  onAddClipStoryboardImageReferenceNode: (clip: Clip, reference: ClipStoryboardImageReference) => void;
  onAddClipVideoNode: (clip: Clip, prompt: string) => void | Promise<void>;
  onAddClipVideoNodes: (clips: Clip[]) => void | Promise<void>;
  onAddClipPositioningBoardNode: (clip: Clip) => void | Promise<void>;
  onAddClipPositioningBoardNodes: (clips: Clip[], options?: { mode?: ClipPositioningBoardMode }) => void | Promise<void>;
  onUpdateClipStoryboard: (clipId: string, patch: { prompt?: string; panelCount?: number; notes?: string }) => void;
  onDeleteScene: (sceneId: string) => void;
  onEditScene: (sceneId: string) => void;
  onAcceptClip: (clipId: string) => void;
  onOptimizeClip: (clipId: string) => void;
  onGenerateClipSeedancePrompt: (clipId: string, options?: { skipCanvasSync?: boolean }) => ClipVideoPromptInferenceResult | Promise<ClipVideoPromptInferenceResult>;
  onUploadAssetReference: (kind: WorkflowAssetKind, item: WorkflowAssetItem) => void;
  onUploadAudioReference: (item: WorkflowAssetItem) => void;
  onClearAudioReference: (item: WorkflowAssetItem) => void | Promise<void>;
  onBatchUploadCharacterAudioReferences: () => void;
  onOpenProjectGlobalSettings: () => void;
  onOpenCharacterPropPicker: (item: WorkflowAssetItem) => void;
  onGenerateAssetImage: (kind: WorkflowAssetKind, item: WorkflowAssetItem, options?: GenerateAssetImageOptions) => void;
  onOpenAssetHistory: (kind: WorkflowAssetKind, item: WorkflowAssetItem, variantFilter?: 'all' | 'with-props') => void;
  onLoadAssetHistoryImages: (kind?: AssetHistoryLoadKind) => void | Promise<void>;
  onPreviewAssetImage: (preview: AssetImagePreview) => void;
  onAddAssetToCanvas: (kind: WorkflowAssetKind, item: WorkflowAssetItem) => void;
  onClearAssetCurrentImage: (kind: WorkflowAssetKind, item: WorkflowAssetItem) => void | Promise<void>;
  onRemoveAsset: (kind: WorkflowAssetKind, item: WorkflowAssetItem) => void;
  onUpdateAssetPrompt: (kind: WorkflowAssetKind, item: WorkflowAssetItem, prompt: string) => void | Promise<void>;
  buildAssetFinalPrompt: (kind: WorkflowAssetKind, item: WorkflowAssetItem) => string;
  isAssetUploadBusy: (kind: WorkflowAssetKind, item: WorkflowAssetItem) => boolean;
  isAssetGenerationBusy: (kind: WorkflowAssetKind, item: WorkflowAssetItem) => boolean;
  optimizingClipId: string | null;
  generatingSeedanceClipId: string | null;
  inferBoardsAndVideoRunning: boolean;
  workflowBusy: boolean;
  storyboardImageRefs: ClipStoryboardImageReference[];
};
