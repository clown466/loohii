import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  Handle,
  Position,
  NodeResizer,
  useReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  applyEdgeChanges,
  SelectionMode,
  useOnSelectionChange,
  NodeChange,
  EdgeChange,
  type Connection,
  type Edge,
  type OnConnectEnd,
  type OnConnectStart,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Boxes,
  ArrowRight,
  ChevronDown,
  CheckCircle2,
  Clapperboard,
  ClipboardCheck,
  Copy,
  Download,
  Film,
  FileText,
  Image as ImageIcon,
  ImagePlay,
  Languages,
  Layers3,
  ListChecks,
  Mic,
  MonitorPlay,
  Package,
  PackageOpen,
  PanelLeft,
  Pencil,
  Plus,
  RotateCcw,
  RotateCw,
  Save,
  Sparkles,
  SlidersHorizontal,
  Trash2,
  UploadCloud,
  Users,
  Wand2,
  X,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { cn } from '../utils/cn';
import { CanvasNodeKind, detachNodesFromRemovedParents, useCanvasStore } from '../stores/useCanvasStore';
import { AGENT_ACTIONS_APPLIED_EVENT } from '../stores/useAgentStore';
import { useProjectStore } from '../stores/useProjectStore';
import {
  apiClient,
  type ModelConfig,
  type GenerationRecord,
  type ProjectCharacterRecord,
  type ProjectSceneRecord,
  type WorkflowAssetImageHistoryItem,
  type WorkflowClip,
  type WorkflowEpisodeListResponse,
  type WorkflowEpisodeSummary,
  type WorkflowState,
  type CanvasVideoGenerationInput,
  type CanvasVideoGenerationResponse,
} from '../lib/apiClient';
import { nodeTypes } from '../features/canvas/nodes';

const workflowSteps = [
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

type WorkflowStageKey = 'source' | 'assets' | 'storyboard' | 'video' | 'voice' | 'preview' | 'edit';
type BreakdownScene = {
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

type Clip = WorkflowClip;
export type WorkflowAssets = NonNullable<WorkflowState['assets']>;
type ClipPanelCountChoice = 'ai' | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
type ClipStoryboardPlan = { panelCount?: number; notes?: string };
type ClipPromptBatchKind = 'storyboard' | 'video-prompt';
type ClipStoryboardInferenceResult = { ok: boolean; clip?: Clip };
type ClipVideoPromptInferenceResult = {
  ok: boolean;
  clips?: Clip[];
  scenes?: BreakdownScene[];
  assets?: WorkflowAssets;
  episode?: string;
};
type InferBoardsAndVideoResult = {
  ok: boolean;
  completed: number;
  failed: number;
};
type PersistedClipPromptBatch = {
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
type AssetLibraryCategory = WorkflowAssetKind | 'directorBoards';
type AssetLibraryEpisodeFilter = 'all' | string;
type AssetHistoryLoadKind = WorkflowAssetKind | 'all';
export const MAX_VIDEO_REFERENCE_IMAGES = 9;
const CANVAS_SECTION_PADDING_X = 12;
const CANVAS_SECTION_HEADER_HEIGHT = 42;
const CANVAS_SECTION_PADDING_BOTTOM = 12;
const CANVAS_REFERENCE_NODE_WIDTH = 340;
const CANVAS_REFERENCE_NODE_HEIGHT = 248;
const CANVAS_REFERENCE_NODE_GAP_X = 12;
const CANVAS_REFERENCE_NODE_GAP_Y = 10;
const CANVAS_REFERENCE_ROWS_PER_COLUMN = 4;
const CANVAS_TARGET_SECTION_GAP = 18;
const CANVAS_GENERATION_NODE_HEIGHT = 560;
const CANVAS_VIDEO_NODE_HEIGHT = 620;
export const CANVAS_VIDEO_POLL_INTERVAL_MS = 15 * 1000;
export const CANVAS_VIDEO_POLL_TIMEOUT_MS = 30 * 60 * 1000;
const CANVAS_SINGLE_ASSET_NODE_HEIGHT = 560;
const EPISODE_CANVAS_SYNC_START_X = 120;
const EPISODE_CANVAS_SYNC_START_Y = 120;
const EPISODE_CANVAS_SYNC_COLUMN_GAP = 36;
const EPISODE_CANVAS_SYNC_ROW_GAP = 28;
const EPISODE_CANVAS_SYNC_ROW_STRIDE =
  CANVAS_SECTION_HEADER_HEIGHT +
  Math.max(
    CANVAS_REFERENCE_ROWS_PER_COLUMN * CANVAS_REFERENCE_NODE_HEIGHT + Math.max(0, CANVAS_REFERENCE_ROWS_PER_COLUMN - 1) * CANVAS_REFERENCE_NODE_GAP_Y,
    CANVAS_GENERATION_NODE_HEIGHT,
    CANVAS_VIDEO_NODE_HEIGHT,
  ) +
  CANVAS_SECTION_PADDING_BOTTOM +
  EPISODE_CANVAS_SYNC_ROW_GAP;
const CLIP_PROMPT_BATCH_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export type WorkflowAssetItem = {
  id?: string;
  name?: string;
  title?: string;
  role?: string;
  description?: string;
  visualPrompt?: string;
  timeOfDay?: string;
  function?: string;
  fruitIdentity?: string;
  signatureProps?: string;
  boundPropNames?: string[];
  lockedVisualIdentity?: string;
  referencePolicy?: string;
  referenceImageUrl?: string;
  referenceImageAssetId?: string;
  referenceAnalysisStatus?: string;
  generatedImageUrl?: string;
  generatedImageAssetId?: string;
  generatedImagePrompt?: string;
  referenceAudioUrl?: string;
  referenceAudioAssetId?: string;
  voiceReferenceStatus?: string;
  voiceReferenceFileName?: string;
  voiceReferenceMimeType?: string;
};

type AssetHistoryTarget = {
  kind: WorkflowAssetKind;
  asset: WorkflowAssetItem;
};

export type AssetImagePreview = {
  url: string;
  title: string;
  subtitle?: string;
};

type EpisodeWorkflowAssetBundle = {
  episode: WorkflowEpisodeSummary;
  workflow: WorkflowState | null;
};

type AssetLibraryItem = {
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

type DirectorBoardLibraryItem = {
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

type ProjectGlobalSettingsDraft = {
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

const PROJECT_GLOBAL_STYLE_OPTIONS = ['动漫风', '3D美漫黑色幽默', '美漫风格', '3D 渲染', '写实电影', '自定义'] as const;
export const CANVAS_IMAGE_RATIO_OPTIONS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '2:1', '1:2', '21:9', '9:21', '3:1', '1:3'] as const;
const PROJECT_GLOBAL_RATIO_OPTIONS = CANVAS_IMAGE_RATIO_OPTIONS;
const PROJECT_GLOBAL_GENERATION_STRATEGIES = [
  { id: 'standard', title: '普通' },
  { id: 'first-frame', title: '首帧衔接' },
  { id: 'seedance-multi-ref', title: 'Seedance 多参' },
  { id: 'chapter-board', title: '章节导演板' },
] as const;
const PROJECT_SCRIPT_RULE_TEMPLATES = [
  { id: 'continuity', title: '人物与气质一致性', hint: '角色外观、性格、携带物、表演状态不得随镜头漂移。' },
  { id: 'world', title: '叙事与世界观', hint: '明确故事背景、时代、地点、科技或现实规则。' },
  { id: 'camera', title: '镜头与节奏', hint: '短剧节奏明确，镜头切换快，动作和对白要能落到画面。' },
  { id: 'safety', title: '边界与禁用元素', hint: '避免水印、乱码文字、低质量和破坏风格的元素。' },
] as const;
const PROJECT_DEFAULT_GLOBAL_PROMPT = 'masterpiece, best quality, highly detailed, cinematic lighting, consistent character design';
const PROJECT_DEFAULT_NEGATIVE_PROMPT = 'No text, no watermarks, low quality, bad anatomy';
const PROJECT_DEFAULT_COVER = 'https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?q=80&w=800&auto=format&fit=crop';
const SEEDANCE_MULTI_REF_STRATEGY = 'seedance-multi-ref';

function projectDefaultScriptRules(): Record<string, string> {
  return Object.fromEntries(PROJECT_SCRIPT_RULE_TEMPLATES.map((item) => [item.id, item.hint]));
}

function projectFirstLineAfterLabel(value: string | undefined, label: string): string | undefined {
  if (!value) return undefined;
  const line = value.split('\n').find((item) => item.trim().startsWith(label));
  return line?.slice(label.length).trim() || undefined;
}

function projectGenerationStrategyFromPrompt(value: string | undefined): string | undefined {
  const stored = projectFirstLineAfterLabel(value, 'Default generation strategy:');
  if (!stored) return undefined;
  return PROJECT_GLOBAL_GENERATION_STRATEGIES.find((item) => item.id === stored || item.title === stored)?.id;
}

function isSeedanceMultiReferenceStrategy(value: unknown): boolean {
  const normalized = String(value || '').trim();
  return normalized === SEEDANCE_MULTI_REF_STRATEGY || normalized === 'Seedance 多参';
}

function projectGenerationStrategy(project?: { setupSettings?: Record<string, unknown>; globalPrompt?: string } | null): string {
  const setupSettings = project?.setupSettings && typeof project.setupSettings === 'object' ? project.setupSettings : {};
  return stringSettingValue(setupSettings.generationStrategy) || projectGenerationStrategyFromPrompt(project?.globalPrompt) || 'chapter-board';
}

function projectScriptRulesFromPrompt(value: string | undefined): Record<string, string> {
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

function stringSettingValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function createProjectGlobalSettingsDraft(project?: ReturnType<typeof useProjectStore.getState>['projects'][number]): ProjectGlobalSettingsDraft {
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
    generationStrategy: stringSettingValue(setupSettings.generationStrategy) || projectGenerationStrategyFromPrompt(globalPrompt) || 'chapter-board',
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

function buildProjectGlobalPromptFromDraft(draft: ProjectGlobalSettingsDraft): string {
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
export const CANVAS_GENERATION_RECORDS_REFRESH_EVENT = 'loohii:generation-records-refresh';
export const CANVAS_GENERATION_STALE_MS = 15 * 60 * 1000;
const CANVAS_GENERATION_SUBMIT_CONFIRM_MS = 30 * 1000;
export const CANVAS_TRANSLATION_STALE_MS = 2 * 60 * 1000;
export const CANVAS_PROMPT_API_MAX_CHARS = 20000;
export const DREAMINA_WEB_VIDEO_PROMPT_MAX_CHARS = 4000;
const MIN_CLIP_STORYBOARD_PANEL_COUNT = 5;
const MAX_CLIP_STORYBOARD_PANEL_COUNT = 12;
const CLIP_STORYBOARD_PANEL_CHOICES = [5, 6, 7, 8, 9, 10, 11, 12] as const;

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

type GenerateAssetImageOptions = {
  useCurrentReference?: boolean;
  referenceImageUrl?: string;
  extraReferenceImageUrls?: string[];
  variant?: 'clean' | 'with-props';
  customPrompt?: string;
  preservePromptExact?: boolean;
};

export function defaultWorkflowAssets(): WorkflowAssets {
  return { characters: [], scenes: [], props: [] };
}

function workflowHasRunningStage(stageStatuses?: Record<string, string>): boolean {
  return Object.values(stageStatuses ?? {}).includes('running');
}

function workflowHasCompleteBoardAndVideoPrompts(workflow: WorkflowState | null | undefined): boolean {
  const workflowClips = workflow?.clips ?? [];
  return workflowClips.length > 0 && workflowClips.every((clip) => (
    Boolean(clip.storyboardPrompt?.trim()) && Boolean(clip.seedancePrompt?.trim())
  ));
}

function workflowHasCompleteBoardAndVideoPromptsForClipIds(
  workflow: WorkflowState | null | undefined,
  clipIds: string[],
): boolean {
  const expectedClipIds = clipIds.filter(Boolean);
  if (expectedClipIds.length === 0) return workflowHasCompleteBoardAndVideoPrompts(workflow);
  const clipById = new Map((workflow?.clips ?? []).map((clip) => [clip.id, clip]));
  return expectedClipIds.every((clipId) => {
    const clip = clipById.get(clipId);
    return Boolean(clip?.storyboardPrompt?.trim()) && Boolean(clip?.seedancePrompt?.trim());
  });
}

function workflowLastVideoRunFinishedBatch(workflow: WorkflowState, clipIds: string[], startedAtMs: number): boolean {
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

function workflowRemoteBatchFinished(
  workflow: WorkflowState | null | undefined,
  clipIds: string[],
  startedAtMs: number,
  completedClipIds: Set<string>,
): workflow is WorkflowState {
  if (!workflow || workflowHasRunningStage(workflow.stageStatuses)) return false;
  const expectedClipIds = clipIds.filter(Boolean);
  if (!workflowHasCompleteBoardAndVideoPromptsForClipIds(workflow, expectedClipIds)) return false;
  if (expectedClipIds.length > 0 && completedClipIds.size >= expectedClipIds.length) return true;
  return workflowLastVideoRunFinishedBatch(workflow, expectedClipIds, startedAtMs);
}

function workflowRunCompletedAfter(workflow: WorkflowState | null | undefined, startedAtMs: number): boolean {
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

function workflowRunStartedAfter(workflow: WorkflowState | null | undefined, startedAtMs: number): boolean {
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

function workflowHasBreakdownResult(workflow: WorkflowState | null | undefined): workflow is WorkflowState {
  if (!workflow || workflowHasRunningStage(workflow.stageStatuses)) return false;
  return (workflow.clips?.length ?? 0) > 0 || workflow.breakdownScenes.length > 0;
}

function shouldRecoverWorkflowAfterRequestError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /网络请求没有连到后端|Failed to fetch|fetch failed|networkerror|load failed|长请求被浏览器或网关中断/i.test(message);
}

function defaultEpisodeList(): WorkflowEpisodeListResponse {
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

function workflowEpisodeCanvasSceneId(episodeId: string) {
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

function nextEpisodeTitle(episodes: WorkflowEpisodeSummary[]): string {
  const numbers = episodes
    .map((episode) => `${episode.title} ${episode.selectedEpisode} ${episode.id}`.match(/(?:第\s*)?(\d{1,4})\s*(?:集|话|章|回)|episode[-_\s]*(\d{1,4})|ep[-_\s]*(\d{1,4})/i))
    .map((match) => match ? Number(match[1] || match[2] || match[3]) : Number.NaN)
    .filter(Number.isFinite);
  const next = numbers.length ? Math.max(...numbers) + 1 : episodes.length + 1;
  return `第 ${next} 集`;
}

function applyWorkflowSnapshot(
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

function mergeAssetItems(primary: WorkflowAssetItem[], fallback: WorkflowAssetItem[]): WorkflowAssetItem[] {
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

function projectCharacterToWorkflowAsset(character: ProjectCharacterRecord): WorkflowAssetItem {
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

function projectSceneToWorkflowAsset(scene: ProjectSceneRecord): WorkflowAssetItem | null {
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

function stableCanvasIdPart(value: unknown, fallback = 'item'): string {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || fallback;
}

function workflowAssetBusyKey(kind: WorkflowAssetKind, assetName: string): string {
  return `${kind}:${normalizeCompareText(assetName)}`;
}

function assetImageSourceLabel(source?: string): string {
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

function safeAudioUploadKey(projectId: string, fileName: string): string {
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

function browserImageLooksReachable(value: unknown, timeoutMs = 7000): Promise<boolean> {
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

function isPublicImageUrl(value: unknown): value is string {
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

function preferredImageInputNodeWidth(data: any): number {
  const ratio = positiveNumber(data?.imageAspectRatio) ?? 1;
  return ratio > 1.15 ? 340 : 260;
}

function preferredImageInputNodeHeight(data: any): number {
  const ratio = Math.min(Math.max(positiveNumber(data?.imageAspectRatio) ?? 1, 0.45), 3.4);
  const width = preferredImageInputNodeWidth(data);
  return Math.round(34 + 16 + width / ratio + (data?.fileName ? 16 : 0));
}

function isVideoCanvasNode(node: { type?: string; data?: any }): boolean {
  return node.type === 'video' || node.data?.workflowKind === 'video' || Boolean(node.data?.seedancePrompt || node.data?.videoPrompt);
}

function hasCanvasConnection(edges: Array<{ source?: string; target?: string }>, source: string, target: string): boolean {
  return edges.some((edge) => edge.source === source && edge.target === target);
}

function imageReferenceUrlKey(value: unknown) {
  return publicImageUrl(value).trim();
}

function nodeStyleWidth(style: unknown): number {
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
    header: 'border-zinc-700/70 bg-zinc-800/30',
    icon: 'text-zinc-300',
    badge: 'border-zinc-700 bg-zinc-900/70 text-zinc-300',
  };
}

function canvasSectionRelativePosition(position: { x: number; y: number }, sectionPosition: { x: number; y: number }) {
  return {
    x: position.x - sectionPosition.x,
    y: position.y - sectionPosition.y,
  };
}

function numericCanvasSize(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function canvasNodeAbsolutePosition(
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

function canvasNodeVisualSize(node: { type?: string; width?: number | null; height?: number | null; measured?: { width?: number; height?: number }; style?: Record<string, unknown> }) {
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

function canvasNodesBoundingBox(
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

function normalizeReactFlowCanvasNodes<T extends { id: string; type?: string; parentId?: string; position?: { x?: number; y?: number }; width?: number | null; height?: number | null; measured?: { width?: number; height?: number }; style?: Record<string, unknown>; expandParent?: boolean }>(nodes: T[]): T[] {
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

function recalculateCanvasSectionItemCounts<T extends { id: string; type?: string; parentId?: string; data?: any }>(nodes: T[]): T[] {
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

function stableCanvasValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function canvasNodeChangeSignature(node: any): string {
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

function canvasEdgeChangeSignature(edge: any): string {
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

function canvasNodeListsEqual(a: any[], b: any[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (canvasNodeChangeSignature(a[index]) !== canvasNodeChangeSignature(b[index])) return false;
  }
  return true;
}

function canvasEdgeListsEqual(a: any[], b: any[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (canvasEdgeChangeSignature(a[index]) !== canvasEdgeChangeSignature(b[index])) return false;
  }
  return true;
}

function canvasIdListsEqual(a: string[], b: string[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function uniqueCanvasNodesById<T extends { id?: string }>(nodes: T[]): T[] {
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

function canvasGraphChangeSignature(nodes: any[], edges: any[]) {
  return [
    nodes.map(canvasNodeChangeSignature).join('\n'),
    edges.map(canvasEdgeChangeSignature).join('\n'),
  ].join('\n---edges---\n');
}

function canvasStyleValuesEqual(a: unknown, b: unknown) {
  return stableCanvasValue(a) === stableCanvasValue(b);
}

function isTransientCanvasNodeChange(change: NodeChange) {
  if (change.type === 'select') return true;
  if (change.type === 'dimensions') return !change.setAttributes;
  if (change.type === 'position') return Boolean(change.dragging);
  return false;
}

function isMeasurementCanvasNodeChange(change: NodeChange) {
  return change.type === 'dimensions' && !change.setAttributes && change.resizing !== false;
}

function isAutoCanvasLayoutChange(change: NodeChange) {
  return change.type === 'dimensions' && Boolean(change.setAttributes) && change.resizing !== true;
}

function isAutoCanvasLayoutPositionChange(change: NodeChange) {
  return change.type === 'position' && change.dragging !== true;
}

function isAutoCanvasLayoutChangeBatch(changes: NodeChange[]) {
  const actionableChanges = changes.filter((change) => !isMeasurementCanvasNodeChange(change));
  return actionableChanges.some(isAutoCanvasLayoutChange) &&
    actionableChanges.every((change) => (
      isAutoCanvasLayoutChange(change) ||
      isAutoCanvasLayoutPositionChange(change) ||
      change.type === 'select'
    ));
}

function isInteractiveCanvasResizeChange(change: NodeChange) {
  return change.type === 'dimensions' && change.resizing === true;
}

function collectCanvasSectionDescendantIds(nodes: Array<{ id: string; parentId?: string }>, sectionId: string): Set<string> {
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

function canvasReferenceGridMetrics(count: number) {
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

function canvasReferenceGridPosition(basePosition: { x: number; y: number }, index: number) {
  const column = Math.floor(index / CANVAS_REFERENCE_ROWS_PER_COLUMN);
  const row = index % CANVAS_REFERENCE_ROWS_PER_COLUMN;
  return {
    x: basePosition.x + column * (CANVAS_REFERENCE_NODE_WIDTH + CANVAS_REFERENCE_NODE_GAP_X),
    y: basePosition.y + row * (CANVAS_REFERENCE_NODE_HEIGHT + CANVAS_REFERENCE_NODE_GAP_Y),
  };
}

function storyboardSlotImageData(clip: Clip, url: string, assetId?: string, prompt?: string) {
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

function attachNodesToCanvasSection(sectionId: string, childPositions: Map<string, { x: number; y: number }>) {
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

function addCanvasSection(
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

function upsertEpisodeCanvasNode(nodes: any[], node: any): any[] {
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

function upsertEpisodeCanvasEdge(edges: any[], edge: any): any[] {
  if (edges.some((item) => item.id === edge.id || (item.source === edge.source && item.target === edge.target))) return edges;
  return [...edges, edge];
}

function removeEpisodeCanvasChildren(nodes: any[], edges: any[], sectionId: string): { nodes: any[]; edges: any[]; removedIds: Set<string> } {
  const removeIds = collectCanvasSectionDescendantIds(nodes, sectionId);
  if (removeIds.size === 0) return { nodes, edges, removedIds: removeIds };
  return {
    nodes: nodes.filter((node) => !removeIds.has(node.id)),
    edges: edges.filter((edge) => !removeIds.has(edge.source) && !removeIds.has(edge.target)),
    removedIds: removeIds,
  };
}

function buildEpisodeClipVideoPrompt(clip: Clip, clipScenes: BreakdownScene[]) {
  if (clip.seedancePrompt && !isClipVideoPromptStaleForStoryboard(clip)) return clip.seedancePrompt;
  const storyboardPrompt = buildLocalClipVideoPromptFromStoryboard(clip, clipScenes);
  if (storyboardPrompt) return storyboardPrompt;
  return clip.seedancePrompt || buildLocalClipVideoPrompt(clip, clipScenes);
}

function isClipVideoPromptStaleForStoryboard(clip: Clip) {
  const storyboardPanelLabels = extractStoryboardPromptPanelTexts(clip.storyboardPrompt).map((panel) => panel.label);
  if (storyboardPanelLabels.length <= 0) return false;
  const videoPBeats = new Set(Array.from(String(clip.seedancePrompt || '').matchAll(/\bP(\d{1,2})\s*:/g)).map((match) => Number(match[1])));
  return storyboardPanelLabels.some((label) => !videoPBeats.has(Number(label.replace(/^P/, ''))));
}

function buildLocalClipVideoPromptFromStoryboard(clip: Clip, clipScenes: BreakdownScene[]) {
  const panels = extractStoryboardPromptPanelTexts(clip.storyboardPrompt);
  if (!panels.length) return '';
  const duration = Math.round(getClipEstimatedDuration(clip, clipScenes) * 10) / 10;
  return [
    `Generate one continuous ${duration}s cinematic video, 16:9.`,
    'Style: polished 3D American animated dark-comedy comic look, saturated colors, clean 3D render, exaggerated acting, fast pacing.',
    `Scene: ${clip.setting || 'current scene'}.`,
    `Characters: ${compactList(clip.characters, 'characters from this Clip', 12)}; use connected character reference images for identity.`,
    'Use the connected storyboard image as the main visual reference. Follow these storyboard panels in exact order and animate them as natural motion, not comic panels:',
    panels.map((panel) => `${panel.label}: ${compactPromptText(panel.text, 260)}`).join('\n'),
    'Do not skip, merge, or reorder the P beats. Do not add subtitles, speech bubbles, UI, panel borders, panel numbers, watermarks, or explanatory text.',
  ].filter(Boolean).join('\n');
}

function extractStoryboardPromptPanelTexts(value: unknown): Array<{ label: string; text: string }> {
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

function cleanStoryboardPromptPanelText(value: string) {
  return value
    .replace(/\b(?:shot size|angle|camera angle|camera movement|move|lens|focal length|action|key prop|dialogue)\s*[:=]/gi, '')
    .replace(/\b(?:image area|technical label strip|label strip)\b/gi, '')
    .replace(/\s*[|/]\s*/g, '; ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildLocalClipVideoPrompt(clip: Clip, clipScenes: BreakdownScene[]) {
  const duration = Math.round(getClipEstimatedDuration(clip, clipScenes) * 10) / 10;
  const beats = clipScenes.map((scene, index) => {
    const action = compactPromptText(scene.action || scene.description || scene.visualPrompt, 180);
    const dialogue = compactPromptText(scene.dialogue, 120);
    return `P${index + 1}: ${[action, dialogue ? `dialogue/reaction ${dialogue}` : ''].filter(Boolean).join('; ')}`;
  });
  return [
    `Clip video prompt for ${clip.title}.`,
    `Duration target: ${duration}s, 16:9 cinematic 3D animated dark comedy style.`,
    `Characters: ${compactList(clip.characters, 'characters from this Clip', 12)}.`,
    `Setting: ${clip.setting || 'current scene'}.`,
    compactPromptText(clip.plotGoal, 260),
    beats.length ? beats.join('\n') : compactPromptText(clip.startState || clip.endState || '', 320),
  ].filter(Boolean).join('\n');
}

function syncEpisodeClipBoardsToCanvas(options: EpisodeCanvasSyncOptions): EpisodeCanvasSyncResult {
  const store = useCanvasStore.getState();
  const episodeKey = stableCanvasIdPart(options.episodeId || options.episode, 'episode');
  const clips = options.clips.filter((clip) => clip.id);
  const useMultiReferenceStrategy = isSeedanceMultiReferenceStrategy(options.generationStrategy);
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
    const videoPrompt = useMultiReferenceStrategy
      ? (clip.seedancePrompt || buildLocalClipVideoPrompt(clip, clipScenes))
      : buildEpisodeClipVideoPrompt(clip, clipScenes);
    const videoAssetReferences = collectClipAssetReferences(clip, clipScenes, options.assets, MAX_VIDEO_REFERENCE_IMAGES, videoPrompt, {
      includeProps: useMultiReferenceStrategy,
      includeScenes: useMultiReferenceStrategy,
      allScenes: options.scenes,
      includeStoryboardPrompt: false,
      includeMissing: useMultiReferenceStrategy,
    });
    const storyboardSlotNodeId = `episode-sync-video-storyboard-slot-${episodeKey}-${clipKey}`;
    const videoReferencesWithCurrentStoryboard: ClipImageReference[] = [
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
        size: '16:9',
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
        prompt: videoPrompt,
        seedancePrompt: videoPrompt,
        videoPrompt,
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
      const signature = reference.kind === 'storyboard'
        ? `storyboard:${reference.assetId || url}`
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
        style: { width: reference.kind === 'storyboard' ? 340 : 260, height: preferredImageInputNodeHeight({ imageAspectRatio: reference.kind === 'storyboard' ? 1.78 : 1.45, fileName: `${reference.name}.png` }) },
        zIndex: 1,
        data: {
          label: reference.label,
          imageUrl: url,
          imageAspectRatio: reference.kind === 'storyboard' ? 1.78 : 1.45,
          fileName: `${reference.name}.png`,
          uploadStatus: url ? 'linked' : 'missing',
          sourcePrompt: reference.kind === 'storyboard'
            ? `${reference.label}，用于 ${clip.title || 'Clip'} 视频首帧/连续性参考`
            : `${reference.label}，用于 ${clip.title || 'Clip'} 视频连续性参考`,
          uploadError: url ? '' : '该资产还没有参考图，请上传或生成后再生成视频。',
          imageLoadError: false,
          ...(reference.kind === 'storyboard' ? { clipId: clip.id, clipNodeKind: 'storyboard', storyboardForClip: true } : { assetKind: reference.kind, assetName: reference.name }),
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

  nextNodes = recalculateCanvasSectionItemCounts(nextNodes);
  return { nodes: nextNodes, edges: nextEdges, storyboardCount, videoCount, removedIds, clips: nextClips };
}

function clipCanvasSectionTitle(clip: Clip, suffix: string) {
  return `${clip.title || 'Clip'} · ${suffix}`;
}

export type CanvasNodeProps = {
  id: string;
  data: any;
  selected?: boolean;
  width?: number;
  height?: number;
};

type ConnectionStartSnapshot = {
  nodeId: string;
  handleId: string | null;
  handleType: 'source' | 'target';
};

type ConnectionCreateMenu = ConnectionStartSnapshot & {
  x: number;
  y: number;
  flowX: number;
  flowY: number;
};

type ConnectionCreateOption = {
  key: string;
  type: CanvasNodeKind;
  label: string;
  desc: string;
  icon: React.ElementType;
  tone: string;
  data?: Record<string, unknown>;
};

const CONNECTION_CREATE_MENU_WIDTH = 300;
const CONNECTION_CREATE_MENU_HEIGHT = 330;
const CONNECTION_CREATE_MENU_MARGIN = 12;

function clientPointFromConnectionEvent(event: MouseEvent | TouchEvent): { x: number; y: number } | null {
  if ('changedTouches' in event && event.changedTouches.length > 0) {
    return { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY };
  }
  if ('clientX' in event) {
    return { x: event.clientX, y: event.clientY };
  }
  return null;
}

function clampConnectionMenuPoint(point: { x: number; y: number }): { x: number; y: number } {
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
      color="#38bdf8"
      lineStyle={{ borderWidth: 1 }}
      handleStyle={{
        width: 10,
        height: 10,
        borderRadius: 3,
        border: '1px solid #7dd3fc',
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
  tone?: 'default' | 'sky' | 'purple' | 'emerald';
  style?: React.CSSProperties;
}) {
  const borderClass =
    tone === 'sky' ? 'border-sky-500 hover:!bg-sky-500' : tone === 'purple' ? 'border-purple-500 hover:!bg-purple-500' : tone === 'emerald' ? 'border-emerald-500 hover:!bg-emerald-500' : 'border-zinc-500 hover:!bg-zinc-500';
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

function isImageDropFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name);
}

function getImageFileAspectRatio(file: File): Promise<number | null> {
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

const CANVAS_IMAGE_DRAG_TYPE = 'application/x-loohii-image-url';
const CANVAS_IMAGE_DRAG_TOKEN_TYPE = 'application/x-loohii-image-token';
const CANVAS_IMAGE_DRAG_PAYLOAD_TYPE = 'application/x-loohii-image-payload';

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

type CanvasImageDragPayload = {
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

const canvasImageDragRegistry = new Map<string, CanvasImageDragPayload>();

function isReusableImageSource(value: string): boolean {
  return Boolean(normalizeReusableImageSource(value));
}

function dataTransferHasImage(dataTransfer: DataTransfer): boolean {
  const files = Array.from(dataTransfer.files ?? []);
  if (files.some(isImageDropFile)) return true;
  const types = Array.from(dataTransfer.types ?? []);
  return types.includes('Files') || types.includes(CANVAS_IMAGE_DRAG_TOKEN_TYPE) || types.includes(CANVAS_IMAGE_DRAG_PAYLOAD_TYPE) || types.includes(CANVAS_IMAGE_DRAG_TYPE) || types.includes('text/uri-list') || types.includes('text/plain') || types.includes('text/html');
}

function normalizeCanvasImageDragPayload(value: Partial<CanvasImageDragPayload> & { url?: string }): CanvasImageDragPayload | null {
  const url = normalizeReusableImageSource(value.url ?? '');
  if (!url) return null;
  return {
    ...value,
    url,
    assetKind: normalizeWorkflowAssetKind(value.assetKind) ?? undefined,
  };
}

function extractDroppedImagePayload(dataTransfer: DataTransfer): CanvasImageDragPayload | null {
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

function extractDroppedImageUrl(dataTransfer: DataTransfer): string {
  return extractDroppedImagePayload(dataTransfer)?.url ?? '';
}

function imageLabelFromUrl(url: string): string {
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

function setImageDragData(dataTransfer: DataTransfer, imageUrl: string, payload: Partial<CanvasImageDragPayload> = {}) {
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
  if (!projectRequiresFruitCharacters(context, data)) return true;
  const text = value.toLowerCase();
  const fruitIdentity = effectiveFruitIdentityForAsset(data, true);
  return text.includes('project authority:') && promptHasConcreteFruit(value, fruitIdentity);
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
  const styleNotes = [
    projectContext.setupSettings?.customStyleName,
    projectContext.setupSettings?.customStylePrompt,
  ].filter(Boolean).join(' / ');
  const mustUseFruitIdentity = projectRequiresFruitCharacters(projectContext, data);
  const fruitIdentity = effectiveFruitIdentityForAsset(data, mustUseFruitIdentity);
  const mixedFruitGroup = isMixedRandomFruitIdentity(fruitIdentity);
  const projectAuthority = hasProjectPromptContext(projectContext)
    ? [
        'Project authority:',
        projectContext.title ? `Project title: ${projectContext.title}` : '',
        projectContext.description ? `Project description: ${projectContext.description}` : '',
        projectContext.globalPrompt ? `Project visual style: ${projectContext.globalPrompt}` : '',
        styleNotes ? `Style notes: ${styleNotes}` : '',
        projectContext.setupSettings?.projectTone ? `Tone: ${projectContext.setupSettings.projectTone}` : '',
        projectContext.setupSettings?.directorNotes ? `Director guidance: ${projectContext.setupSettings.directorNotes}` : '',
        projectContext.characterIdentityRules ? `Character identity rules: ${projectContext.characterIdentityRules}` : '',
        projectContext.negativePrompt ? `Project negative constraints: ${projectContext.negativePrompt}` : '',
        mustUseFruitIdentity
          ? fruitIdentity
            ? mixedFruitGroup
              ? 'Group fruit identity policy: mixed random fruit crowd. This is a group/background asset, so do not lock every individual to one fixed fruit. Randomly mix several fruit species across individuals based on the story tone while keeping all members anthropomorphic fruit.'
              : `Locked fruit identity: ${fruitIdentity}. This character must remain an unmistakable anthropomorphic ${fruitIdentity} character, not a normal human, animal, generic zombie, or non-fruit monster. Make the ${fruitIdentity} identity readable in the head/body silhouette, surface texture, color palette, and printed character-sheet labels.`
            : ''
          : '',
        '',
      ]
    : [];
  return [
    ...projectAuthority,
    `Asset kind: characters`,
    `Asset name: ${name}`,
    characterVariant === 'with-props' ? 'Character image variant: with signature carried props.' : 'Character image variant: clean base reference, no loose carried props.',
    data?.role ? `Asset role: ${data.role}` : '',
    fruitIdentity ? mixedFruitGroup ? 'Fruit species policy: mixed random fruit crowd. Choose a varied mix such as apple, orange, lemon, pear, grape, peach, banana, melon, kiwi, or strawberry individuals; do not make all members the same fruit.' : `Fruit species to draw and label clearly: ${fruitIdentity}` : '',
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
  const styleNotes = [
    projectContext.setupSettings?.customStyleName,
    projectContext.setupSettings?.customStylePrompt,
  ].filter(Boolean).join(' / ');
  return hasProjectPromptContext(projectContext)
    ? [
        'Project authority:',
        projectContext.title ? `Project title: ${projectContext.title}` : '',
        projectContext.description ? `Project description: ${projectContext.description}` : '',
        projectContext.globalPrompt ? `Project visual style: ${projectContext.globalPrompt}` : '',
        styleNotes ? `Style notes: ${styleNotes}` : '',
        projectContext.setupSettings?.projectTone ? `Tone: ${projectContext.setupSettings.projectTone}` : '',
        projectContext.negativePrompt ? `Project negative constraints: ${projectContext.negativePrompt}` : '',
        '',
      ].filter(Boolean)
    : [];
}

export function buildCanvasSceneFinalPrompt(data: any, referenceImageCount: number, projectContext: CanvasProjectPromptContext = {}): string {
  const name = String(data?.assetName || data?.name || data?.title || 'scene').trim();
  const description = String(data?.description || '').trim();
  const shortPrompt = firstCleanAssetPromptSeed(data?.visualPrompt, data?.prompt);
  return [
    ...buildCanvasAssetProjectAuthority(projectContext),
    'Asset kind: scenes',
    `Asset name: ${name}`,
    data?.timeOfDay ? `Time of day / lighting context: ${data.timeOfDay}` : '',
    description ? `Asset description: ${description}` : '',
    shortPrompt ? `User/asset prompt to preserve: ${shortPrompt}` : '',
    referenceImageCount > 0
      ? `Reference images supplied to the image model: ${referenceImageCount}. Use them as visual continuity references and do not contradict them.`
      : '',
    '',
    'Create a clean scene/location production reference image for an AI animation project.',
    'The image must be useful as a reusable environment reference, not a random cinematic still.',
    'Prioritize readable geography, staging zones, entrance/exit points, major props fixed in the space, material language, lighting direction, atmosphere, and scale cues.',
    'Keep the project visual style and tone consistent with the project authority above.',
    'Show the full usable location clearly with a stable camera angle and enough depth to understand where characters can stand and move.',
    'Do not add unrelated characters unless the asset facts explicitly require them. Do not turn this into a poster or title card.',
    'Single image only. No captions, no UI, no watermark, no decorative text, no random labels unless explicitly required by the asset facts.',
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

const workflowStages: Array<{
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

const assetGroups = [
  { key: 'characters' as const, title: '角色资产', desc: '角色图、事实卡、表演约束', icon: Boxes },
  { key: 'scenes' as const, title: '场景资产', desc: '空间图、氛围、时间点', icon: ImageIcon },
  { key: 'props' as const, title: '道具资产', desc: '关键物件、交互用途', icon: Package },
];

const batchCharacterAudioTargets = [
  { index: 1, name: 'Bob', aliases: ['bob'] },
  { index: 2, name: 'Chloe', aliases: ['chloe', 'chole'] },
  { index: 3, name: 'Leo', aliases: ['leo'] },
  { index: 4, name: 'Tiffany', aliases: ['tiffany'] },
  { index: 5, name: 'Eugene', aliases: ['eugene'] },
];

const assetImageAspectRatioOptions = [
  { value: '16:9', label: '16:9 横版' },
  { value: '1:1', label: '1:1 方图' },
  { value: '9:16', label: '9:16 竖版' },
  { value: '4:3', label: '4:3' },
];

const assetImageResolutionOptions = [
  { value: '1k', label: '1K' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' },
];

const assetLibraryCategories: Array<{ key: AssetLibraryCategory; label: string; icon: typeof Boxes }> = [
  { key: 'characters', label: '角色', icon: Users },
  { key: 'scenes', label: '场景', icon: ImageIcon },
  { key: 'props', label: '道具', icon: Package },
  { key: 'directorBoards', label: '导演板', icon: Clapperboard },
];

function isProjectNotFoundError(error: unknown): boolean {
  return error instanceof Error && /project not found/i.test(error.message);
}

function createDraftScenes(sourceText: string): BreakdownScene[] {
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

function countEnglishDialogueWords(text?: string) {
  return (String(text ?? '').match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?/g) ?? []).length;
}

function getDialoguePacing(scene: BreakdownScene) {
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

function formatClipDuration(clip: Clip) {
  const estimated = Number.isFinite(Number(clip.estimatedDuration)) ? `${clip.estimatedDuration}s` : '未估算';
  const target = Number.isFinite(Number(clip.targetDuration)) ? `${clip.targetDuration}s` : null;
  const max = Number.isFinite(Number(clip.maxDuration)) ? `${clip.maxDuration}s` : null;
  return [estimated, target ? `目标 ${target}` : null, max ? `上限 ${max}` : null].filter(Boolean).join(' / ');
}

function formatClipDialogue(clip: Clip) {
  const words = Number.isFinite(Number(clip.dialogueWordCount)) ? `${clip.dialogueWordCount} 词` : '0 词';
  if (clip.dialogueDensity === undefined || clip.dialogueDensity === null || clip.dialogueDensity === '') return words;
  const density =
    typeof clip.dialogueDensity === 'number'
      ? `${clip.dialogueDensity.toFixed(1)} w/s`
      : String(clip.dialogueDensity);
  return `${words} / ${density}`;
}

function getClipRiskItems(clip: Clip) {
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

function getClipPreflightStatus(clip: Clip) {
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

function isClipPreflightRisky(clip: Clip) {
  const status = getClipPreflightStatus(clip).toLowerCase();
  return getClipRiskItems(clip).length > 0 || /fail|warn|risk|需|失败|警告|风险/.test(status);
}

function compactList(items: string[] | undefined, fallback = '未指定', max = 3) {
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

function getClipScenes(clip: Clip, scenes: BreakdownScene[]) {
  const shotIds = new Set((clip.shotIds ?? []).map(String));
  if (shotIds.size === 0) return [];
  return scenes.filter((scene) => shotIds.has(scene.id));
}

function clipSceneSettings(clip: Clip, clipScenes: BreakdownScene[]): string[] {
  return uniqueClipNames([clip.setting, ...clipScenes.map((scene) => scene.setting)].filter((item): item is string => Boolean(item?.trim())));
}

function assetLooksLikeContinuityTeamMember(item: WorkflowAssetItem): boolean {
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

function inferContinuityCharactersForClip(clip: Clip, clipScenes: BreakdownScene[], allScenes: BreakdownScene[], assets?: WorkflowAssets) {
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
    clip.seedancePrompt,
    clip.storyboardPrompt,
    clip.storyboardNotes,
    ...clipScenes.flatMap((scene) => [scene.title, scene.description, scene.action, scene.dialogue, scene.references, scene.visualPrompt, scene.directorBoardPrompt]),
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

type ClipAssetReference = {
  kind: WorkflowAssetKind;
  name: string;
  label: string;
  url?: string;
  assetId?: string;
};

type ClipImageReference = {
  kind: WorkflowAssetKind | 'storyboard';
  name: string;
  label: string;
  url?: string;
  assetId?: string;
  nodeId?: string;
  sourceClipId?: string;
  sourceClipTitle?: string;
  targetClipId?: string;
};

type ClipStoryboardImageReference = {
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

type PreviousStoryboardReference = ClipStoryboardImageReference & {
  sourceClip?: Clip;
};

type EpisodeCanvasSyncResult = {
  nodes: any[];
  edges: any[];
  storyboardCount: number;
  videoCount: number;
  removedIds: Set<string>;
  clips: Clip[];
};

type EpisodeCanvasSyncOptions = {
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
};

type EpisodeCanvasSyncRequest = {
  episodeId?: string;
  clips?: Clip[];
  scenes?: BreakdownScene[];
  assets?: WorkflowAssets;
  episode?: string;
  refreshRecords?: boolean;
};

type WorkflowBreakdownRecoveryOptions = {
  stage: 'full-breakdown' | 'storyboard';
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

type FinalClipStoryboardPromptOptions = {
  clip: Clip;
  clips: Clip[];
  scenes: BreakdownScene[];
  assets: WorkflowAssets;
  nodes: Array<{ id: string; type?: string; data?: any }>;
  storyboardAssetRefs?: ClipStoryboardImageReference[];
  blockedStoryboardUrls?: Set<string>;
  basePrompt?: string;
};

type FinalClipStoryboardPromptResult = {
  prompt: string;
  references: ClipImageReference[];
  previousStoryboardRef: PreviousStoryboardReference | null;
};

type FinalizeClipStoryboardPrompt = (
  clip: Clip,
  basePrompt: string,
  clipsOverride?: Clip[],
  assetsOverride?: WorkflowAssets,
  scenesOverride?: BreakdownScene[],
) => FinalClipStoryboardPromptResult;

function buildFinalClipStoryboardPromptForCanvas(options: FinalClipStoryboardPromptOptions): FinalClipStoryboardPromptResult {
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

function workflowAssetImageUrl(item: WorkflowAssetItem) {
  return normalizeReusableImageSource(item.referenceImageUrl || item.generatedImageUrl || '');
}

function workflowAssetImageAssetId(item: WorkflowAssetItem) {
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

function workflowAssetStableId(item: WorkflowAssetItem) {
  return String(item.id || workflowAssetImageAssetId(item) || workflowAssetName(item) || '').trim();
}

export function findWorkflowAssetByName(items: WorkflowAssetItem[], name: string) {
  const target = normalizeCompareText(name);
  if (!target) return undefined;
  return items.find((item) => normalizeCompareText(workflowAssetName(item)) === target)
    ?? items.find((item) => {
      const assetName = normalizeCompareText(workflowAssetName(item));
      return Boolean(assetName && (assetName.includes(target) || target.includes(assetName)));
    });
}

function characterNameLooksPhysicallyPresent(searchableText: string, characterName: string): boolean {
  const name = normalizeCompareText(characterName);
  if (!name || !searchableText.includes(name)) return false;
  const escaped = escapeRegExp(name);
  const decorativeMention = new RegExp(`\\b${escaped}\\s+(poster|posters|portrait|portraits|photo|photos|image|images|billboard|billboards|logo|logos|sign|signs)\\b`);
  if (decorativeMention.test(searchableText)) return false;
  return true;
}

function pushClipAssetReference(
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

function propAliasCandidates(name: string, description = ''): string[] {
  const base = normalizeCompareText(name);
  const aliases = new Set<string>([base]);
  if (base.includes('shotgun')) aliases.add('shotgun');
  if (base.includes('magic pan') || base.includes('iron pan')) {
    aliases.add('magic pan');
    aliases.add('iron magic pan');
    aliases.add('iron pan');
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

function propTextHasExplicitOwner(propText: string, characterName: string): boolean {
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

function inferredPropNamesFromCharacter(character: WorkflowAssetItem): string[] {
  return mergeBoundPropNames([
    ...extractSignaturePropNames(character.signatureProps || ''),
    ...(character.signatureProps || '')
      .split(/[,;/|]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  ]);
}

function hasManualBoundPropNames(character: WorkflowAssetItem): boolean {
  return Array.isArray(character.boundPropNames);
}

function manualBoundPropNamesFromCharacter(character: WorkflowAssetItem): string[] {
  return mergeBoundPropNames((character.boundPropNames ?? []).map(String));
}

function selectedPropNamesFromCharacter(character: WorkflowAssetItem): string[] {
  return hasManualBoundPropNames(character)
    ? manualBoundPropNamesFromCharacter(character)
    : inferredPropNamesFromCharacter(character);
}

function formatBoundSignatureProps(character: WorkflowAssetItem, propName: string): string {
  return mergeBoundPropNames([...inferredPropNamesFromCharacter(character), propName]).join(', ');
}

function nextManualBoundPropNames(character: WorkflowAssetItem, propName: string, shouldBind: boolean): string[] {
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

function removeInferredBoundPropName(character: WorkflowAssetItem, propName: string): string {
  const target = normalizeCompareText(propName);
  return inferredPropNamesFromCharacter(character)
    .filter((item) => normalizeCompareText(item) !== target)
    .join(', ');
}

function propHasUsableImage(prop: WorkflowAssetItem): boolean {
  return Boolean(workflowAssetImageUrl(prop) || publicImageUrl(prop.referenceImageUrl) || publicImageUrl(prop.generatedImageUrl));
}

function propIsCarryableReference(prop: WorkflowAssetItem): boolean {
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

function propIsBoundToCharacter(character: WorkflowAssetItem, prop: WorkflowAssetItem): boolean {
  const propName = workflowAssetName(prop);
  if (!propName) return false;
  const propKey = normalizeCompareText(propName);
  return selectedPropNamesFromCharacter(character).some((signatureProp) => {
    const signatureKey = normalizeCompareText(signatureProp);
    return Boolean(signatureKey && signatureKey === propKey);
  });
}

function assetHistoryImageIsWithProps(image: WorkflowAssetImageHistoryItem): boolean {
  if (image.variant === 'with-props') return true;
  const text = [
    image.title,
    image.prompt,
    image.revisedPrompt,
  ].filter(Boolean).join('\n').toLowerCase();
  if (/character image variant:\s*with signature carried props|personal prop continuity|signature carried props|道具版|绑定道具|with-props/.test(text)) return true;
  return Boolean(image.prompt && image.referenceImageCount && image.referenceImageCount >= 2);
}

function reusableAssetHistoryImages(kind: WorkflowAssetKind, images: WorkflowAssetImageHistoryItem[]) {
  return images
    .filter((image) => image.id && normalizeReusableImageSource(image.url))
    .filter((image) => image.status ? !/failed|canceled/i.test(image.status) : true)
    .filter((image) => kind === 'characters' ? !assetHistoryImageIsWithProps(image) : true);
}

async function chooseReachableAssetHistoryImage(kind: WorkflowAssetKind, images: WorkflowAssetImageHistoryItem[]) {
  const reusable = reusableAssetHistoryImages(kind, images);
  const ordered = [
    ...reusable.filter((image) => image.isCurrent),
    ...reusable.filter((image) => !image.isCurrent),
  ];
  const seen = new Set<string>();
  for (const image of ordered) {
    if (seen.has(image.id)) continue;
    seen.add(image.id);
    if (await browserImageLooksReachable(image.url)) return image;
  }
  return null;
}

function generationRecordWorkflowAssetBusyKey(record: GenerationRecord): string | null {
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

function characterOwnsProp(character: WorkflowAssetItem, prop: WorkflowAssetItem): boolean {
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

function findCharacterPropReferences(character: WorkflowAssetItem, assets: WorkflowAssets, options: { includeMissing?: boolean } = {}): ClipAssetReference[] {
  const refs: ClipAssetReference[] = [];
  const seen = new Set<string>();
  for (const prop of assetArray(assets, 'props')) {
    if (characterOwnsProp(character, prop) && (options.includeMissing || propHasUsableImage(prop)) && propIsCarryableReference(prop)) {
      pushClipAssetReference(refs, seen, 'props', prop, `绑定道具: ${workflowAssetName(character)}`, options);
    }
  }
  return refs;
}

function collectClipAssetReferences(
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
  const searchableText = [
    clip.title,
    clip.plotGoal,
    clip.startState,
    clip.endState,
    clip.layoutMemory,
    clip.seedancePrompt,
    options.includeStoryboardPrompt !== false ? clip.storyboardPrompt : '',
    clip.storyboardNotes,
    extraSearchText,
    ...clipScenes.flatMap((scene) => [scene.title, scene.description, scene.action, scene.dialogue, scene.references, scene.visualPrompt, scene.directorBoardPrompt]),
  ].join('\n').toLowerCase();
  const searchableNormalized = normalizeCompareText(searchableText);
  const characterNames = [
    ...inferContinuityCharactersForClip(clip, clipScenes, options.allScenes ?? clipScenes, assets),
  ];
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
    if (!explicitCharacterKeys.has(characterKey) && characterNameLooksPhysicallyPresent(searchableNormalized, characterName)) {
      if (pushClipAssetReference(refs, seen, 'characters', character, '角色引用参考', { includeMissing })) {
        referencedCharacters.push(character);
      }
    }
  }

  if (includeScenes) {
    const settingNames = [clip.setting, ...clipScenes.map((scene) => scene.setting)].filter((item): item is string => Boolean(item?.trim()));
    for (const name of settingNames) {
      pushClipAssetReference(refs, seen, 'scenes', findWorkflowAssetByName(scenes, name), '场景参考', { includeMissing });
    }

    for (const scene of scenes) {
      const sceneName = workflowAssetName(scene);
      if (!sceneName) continue;
      if (searchableNormalized.includes(normalizeCompareText(sceneName))) {
        pushClipAssetReference(refs, seen, 'scenes', scene, '场景引用参考', { includeMissing });
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
      const mentioned = propAliasCandidates(propName, prop.description || '').some((alias) => alias && searchableNormalized.includes(alias));
      if (mentioned) {
        pushClipAssetReference(refs, seen, 'props', prop, '道具参考', { includeMissing });
      }
    }
  }

  return refs.slice(0, limit);
}

function isClipStoryboardNodeForClip(node: { type?: string; data?: any }, clip: Clip): boolean {
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

function findClipStoryboardNode(nodes: Array<{ id: string; type?: string; data?: any }>, clip: Clip) {
  const candidates = nodes.filter((node) => isClipStoryboardNodeForClip(node, clip));
  return candidates.find((node) => node.type === 'generation') ?? candidates[0];
}

export function normalizedClipNodeTitle(value: unknown): string {
  return normalizeCompareText(String(value || ''))
    .replace(/\s*(视频任务|故事板|storyboard|video task|clip-level director board|director board)\s*$/i, '')
    .trim();
}

function clipTitleTokens(clip: Clip): string[] {
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

function significantStoryboardTokens(value: unknown, limit = 40): string[] {
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

function textMatchesClip(text: string, clip: Clip): boolean {
  const normalized = normalizeCompareText(text);
  if (!normalized) return false;
  return clipTitleTokens(clip).some((token) => token.length >= 4 && normalized.includes(token));
}

function recordHasExplicitClipAnchor(text: string, clip: Clip): boolean {
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

function stripPreviousStoryboardReferenceText(value: unknown): string {
  return String(value || '')
    .replace(/Use the linked previous storyboard image[\s\S]*?as the continuity reference for scene layout[\s\S]*?(?:resetting the scene\.|character positions\.?)\s*/gi, ' ')
    .replace(/(^|\n)\s*上一个故事板[:：][^\n。.]*(?:[。.])?\s*(?=\n|$)/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeCharacterReferenceSheet(text: string): boolean {
  return /(character\s+(reference|model|turnaround|sheet)|model\s+sheet|reference\s+sheet|turnaround|orthographic|front\s+view|side\s+view|back\s+view|expression\s+sheet|pose\s+sheet|角色设定|角色三视图|表情表|设定图|转面图|正面|侧面|背面)/i.test(text);
}

function scoreClipStoryboardMatch(text: string, clip: Clip): number {
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

function bestStoryboardClipMatch(text: string, clips: Clip[]): Clip | undefined {
  let best: { clip: Clip; score: number } | null = null;
  for (const clip of clips) {
    const score = scoreClipStoryboardMatch(text, clip);
    if (!best || score > best.score) best = { clip, score };
  }
  return best && best.score >= 55 ? best.clip : undefined;
}

function storyboardReferenceMatchesClip(ref: ClipStoryboardImageReference, clip: Clip): boolean {
  if (ref.clipId && ref.clipId === clip.id) return true;
  if (ref.clipId && ref.clipId !== clip.id) return false;
  return scoreClipStoryboardMatch([ref.prompt, ref.clipTitle, ref.title].filter(Boolean).join('\n'), clip) >= 55;
}

function findExactClipStoryboardReference(
  refs: ClipStoryboardImageReference[],
  clip: Clip,
  blockedStoryboardUrls: Set<string> = new Set(),
): ClipStoryboardImageReference | null {
  return refs.find((ref) => Boolean(ref.url && ref.clipId === clip.id && !blockedStoryboardUrls.has(ref.url))) ?? null;
}

function canPreserveExistingClipStoryboardOutput(data: any, clip: Clip, episodeId: string, episodeTitle: string): boolean {
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

function looksLikeStoryboardPrompt(text: string): boolean {
  if (looksLikeCharacterReferenceSheet(text)) return false;
  return /(storyboard|director board|production board|clip-level director|故事板|导演板|分镜)/i.test(text);
}

export function generationRecordImageUrl(record: GenerationRecord): { url: string; assetId?: string; title?: string } | null {
  const asset = record.assets.find((item) => item.url && String(item.type || '').toUpperCase() === 'IMAGE') ?? record.assets.find((item) => item.url);
  const url = publicImageUrl(asset?.url);
  if (!url) return null;
  return { url, assetId: asset?.id, title: asset?.title };
}

function generationRecordImageUrls(record: GenerationRecord): Array<{ url: string; assetId?: string; title?: string }> {
  return record.assets
    .filter((item) => item.url && (!item.type || String(item.type).toUpperCase() === 'IMAGE'))
    .map((asset) => {
      const url = publicImageUrl(asset.url);
      return url ? { url, assetId: asset.id, title: asset.title } : null;
    })
    .filter((item): item is { url: string; assetId?: string; title?: string } => Boolean(item));
}

function generationRecordVideoUrl(record: GenerationRecord): { url: string; assetId?: string; title?: string } | null {
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

function canvasOutputImageVariantsEqual(
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

function isRecentGenerationRecord(record: GenerationRecord): boolean {
  const time = generationRecordTime(record);
  return time > 0 && Date.now() - time <= CANVAS_GENERATION_STALE_MS;
}

export function generationRecordPromptKey(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function clipPromptBatchStorageKey(kind: ClipPromptBatchKind, projectId: string | undefined, episodeId?: string): string {
  return `loohii-clip-prompt-batch:${kind}:${projectId || 'local'}:${episodeId || 'default'}`;
}

function readPersistedClipPromptBatch(kind: ClipPromptBatchKind, projectId: string | undefined, episodeId?: string): PersistedClipPromptBatch | null {
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

function writePersistedClipPromptBatch(batch: PersistedClipPromptBatch): void {
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

function clearPersistedClipPromptBatch(kind: ClipPromptBatchKind, projectId: string | undefined, episodeId?: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(clipPromptBatchStorageKey(kind, projectId, episodeId));
  } catch {
    // Ignore storage failures.
  }
}

function shouldResumePersistedClipPromptBatch(batch: PersistedClipPromptBatch, currentAiModelId: string, clipIds: string[]): boolean {
  const savedModelId = batch.aiModelId || '';
  const activeModelId = currentAiModelId || '';
  if (savedModelId !== activeModelId) return false;
  if ((batch.failedClipIds?.length ?? 0) > 0) return false;
  const availableClipIds = new Set(clipIds);
  const completedClipIds = new Set(batch.completedClipIds);
  return batch.clipIds.some((clipId) => availableClipIds.has(clipId) && !completedClipIds.has(clipId));
}

function shouldIgnoreStoppedCanvasGenerationRecord(
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

function shouldAllowMissingBackendTaskRecovery(node: { id?: string; data?: any }, record: GenerationRecord, prompt: string): boolean {
  const error = String(node.data?.error || '');
  if (!/没有找到对应的后端生成任务/.test(error)) return false;
  const nodeId = String(node.id || '').trim();
  if (!nodeId || generationRecordNodeId(record) !== nodeId) return false;
  return generationRecordPromptKey(record.prompt) === generationRecordPromptKey(prompt);
}

function generationRecordObject(value: unknown): Record<string, unknown> {
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

function generationRecordSourceEpisode(record: GenerationRecord): string {
  for (const metadata of generationRecordMetadataObjects(record)) {
    const sourceEpisode = readObjectString(metadata, 'sourceEpisode');
    if (sourceEpisode) return sourceEpisode;
  }
  return '';
}

function generationRecordSourceEpisodeId(record: GenerationRecord): string {
  for (const metadata of generationRecordMetadataObjects(record)) {
    const sourceEpisodeId = readObjectString(metadata, 'sourceEpisodeId');
    if (sourceEpisodeId) return sourceEpisodeId;
    const sourceEpisode = readObjectString(metadata, 'sourceEpisode');
    if (sourceEpisode && isWorkflowEpisodeId(sourceEpisode)) return sourceEpisode;
  }
  return '';
}

function generationRecordBelongsToEpisode(record: GenerationRecord, episodeId: string, episodeTitle = ''): boolean {
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

type CanvasGenerationRecoveryKeys = {
  generationIds: Set<string>;
  requestIds: Set<string>;
  nodeIds: Set<string>;
  promptKeys: Set<string>;
};

function canvasActiveGenerationRecoveryKeys(nodes: Array<{ id?: string; type?: string; data?: any }>): CanvasGenerationRecoveryKeys {
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

function generationRecordMatchesActiveCanvasGeneration(record: GenerationRecord, keys: CanvasGenerationRecoveryKeys): boolean {
  if (generationRecordInputKind(record) !== 'canvas-image-generation') return false;
  if (keys.generationIds.has(record.id)) return true;
  const requestId = generationRecordRequestId(record);
  if (requestId && keys.requestIds.has(requestId)) return true;
  const nodeId = generationRecordNodeId(record);
  if (nodeId && keys.nodeIds.has(nodeId)) return true;
  const promptKey = generationRecordPromptKey(record.prompt);
  return Boolean(promptKey && keys.promptKeys.has(promptKey));
}

function readMetadataBoolean(metadata: Record<string, unknown>, key: string): boolean | undefined {
  const value = metadata[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return undefined;
}

function metadataLooksLikeClipStoryboard(metadata: Record<string, unknown>): boolean {
  const storyboardForClip = readMetadataBoolean(metadata, 'storyboardForClip');
  if (storyboardForClip === false) return false;
  const clipNodeKind = readObjectString(metadata, 'clipNodeKind');
  if (clipNodeKind && clipNodeKind !== 'storyboard') return false;
  if (clipNodeKind === 'storyboard' || storyboardForClip === true) return true;
  const text = [readObjectString(metadata, 'title'), readObjectString(metadata, 'clipTitle')].join(' ');
  return /故事板|storyboard/i.test(text);
}

function workflowEpisodeLibraryTitle(episode: WorkflowEpisodeSummary): string {
  return episode.title || episode.selectedEpisode || episode.id || '未命名集';
}

function assetLibraryEpisodeMatches(episodeId: string, episodeFilter: AssetLibraryEpisodeFilter): boolean {
  return episodeFilter === 'all' || episodeId === episodeFilter;
}

function assetLibraryAssetDescription(item: WorkflowAssetItem): string {
  return [
    item.lockedVisualIdentity,
    item.description,
    item.visualPrompt,
    item.role,
    item.timeOfDay,
    item.function,
  ].find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

function collectEpisodeAssetLibraryItems(
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

function generationRecordStoryboardMetadataTitle(record: GenerationRecord): string {
  for (const metadata of generationRecordMetadataObjects(record)) {
    const title = readObjectString(metadata, 'clipTitle') || readObjectString(metadata, 'title');
    if (title) return title;
  }
  return '';
}

function generationRecordLooksLikeDirectorBoard(record: GenerationRecord, imageTitle = ''): boolean {
  if (looksLikeStoryboardPrompt(record.prompt)) return true;
  if (generationRecordMetadataObjects(record).some(metadataLooksLikeClipStoryboard)) return true;
  return /(storyboard|director board|production board|clip-level director|故事板|导演板|分镜)/i.test(imageTitle);
}

function collectDirectorBoardLibraryItems(
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

function generationRecordExplicitStoryboardClip(record: GenerationRecord, clips: Clip[]): Clip | undefined {
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

function stripPreviousStoryboardContinuityText(value: unknown): string {
  return stripPreviousStoryboardReferenceText(value)
    .replace(/Previous Clip end state to continue from:[\s\S]*?(?=(?:Reference image map:|Create one|Create a|Required continuity characters:|Character reference lock:|Dialogue lock:|Panel\s+\d+:|$))/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function storyboardRecordOwnershipText(record: GenerationRecord, image: { title?: string }): string {
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

function generationRecordReferenceImageCount(record: GenerationRecord): number {
  const input = generationRecordObject(record.input);
  const inputRefs = Array.isArray(input.referenceImageUrls) ? input.referenceImageUrls : [];
  if (inputRefs.length > 0) return inputRefs.length;
  const parameters = generationRecordObject(record.parameters);
  const imageUrls = Array.isArray(parameters.image_urls) ? parameters.image_urls : [];
  return imageUrls.length;
}

function generationRecordResolution(record: GenerationRecord): string {
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

function findLatestCanvasImageGenerationRecordForNode(
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

function findLatestCanvasVideoGenerationRecordForNode(
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

function storyboardReferencesFromGenerationRecords(
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

function nonStoryboardImageUrlsFromGenerationRecords(records: GenerationRecord[]): Set<string> {
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

function isStoryboardAssetReferenceForVideo(ref: ClipStoryboardImageReference, video: { data?: any }): boolean {
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

function isAutoVideoStoryboardReferenceNode(node: { id?: string; type?: string; data?: any }): boolean {
  return typeof node.id === 'string' &&
    node.id.startsWith('storyboard-ref-') &&
    node.type === 'imageInput' &&
    node.data?.clipNodeKind === 'storyboard' &&
    node.data?.storyboardForClip === true;
}

function isBlockedStoryboardSource(source: { type?: string; data?: any }, blockedStoryboardUrls: Set<string>): boolean {
  const url = canvasNodeReferenceUrl(source);
  return Boolean(url && blockedStoryboardUrls.has(url));
}

export function canvasNodeReferenceUrl(node: { type?: string; data?: any }): string {
  if (node.type === 'imageInput') return publicImageUrl(node.data?.imageUrl);
  if (node.type === 'character') return publicImageUrl(node.data?.avatar);
  if (node.type === 'generation') return publicImageUrl(node.data?.outputImage);
  return '';
}

export function canvasNodePromptText(node: { type?: string; data?: any } | undefined): string {
  const data = node?.data ?? {};
  if (node?.type === 'video') return String(data.seedancePrompt || data.videoPrompt || data.prompt || '').trim();
  if (node?.type === 'generation') return String(data.finalPrompt || data.prompt || data.submittedPrompt || data.visualPrompt || '').trim();
  if (node?.type === 'character') return String(data.finalPrompt || data.visualPrompt || data.prompt || data.traits || '').trim();
  if (node?.type === 'imageInput') return String(data.sourcePrompt || data.prompt || data.label || '').trim();
  if (node?.type === 'scene') return String(data.visualPrompt || data.directorBoardPrompt || data.description || '').trim();
  if (node?.type === 'translation') return String(data.translatedPrompt || data.sourcePrompt || '').trim();
  if (node?.type === 'promptOptimizer') return String(data.optimizedPrompt || data.sourcePrompt || '').trim();
  if (node?.type === 'promptInspector') return String(data.answer || data.sourcePrompt || '').trim();
  return String(data.finalPrompt || data.seedancePrompt || data.videoPrompt || data.prompt || data.sourcePrompt || data.description || '').trim();
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

function computeVideoNodeReferencePatch(
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

function cleanReferenceLabelName(value: unknown) {
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

function clipImageReferenceAsCanvasReference(ref: ClipImageReference): Pick<CanvasReferenceImage, 'name' | 'label' | 'kind'> {
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

function videoReferenceAutoEdgeId(sourceId: string, targetId: string): string {
  return `video-ref-${sourceId}-${targetId}`.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function canvasAutoEdgeId(prefix: string, sourceId: string, targetId: string): string {
  return `${prefix}-${sourceId}-${targetId}`.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function uniqueCanvasNodeId(base: string, nodes: Array<{ id: string }>): string {
  const normalizedBase = (base || 'node').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 140) || 'node';
  const existing = new Set(nodes.map((node) => node.id));
  if (!existing.has(normalizedBase)) return normalizedBase;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${normalizedBase}-${index}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${normalizedBase}-${Date.now().toString(36)}`;
}

function replacePreviousStoryboardContinuityPrompt(prompt: unknown, previous: PreviousStoryboardReference | null): string {
  const panelCount = detectStoryboardPanelCount(String(prompt || '')) || undefined;
  const cleaned = finalizeClipStoryboardImagePrompt(stripPreviousStoryboardContinuityText(prompt), panelCount)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return appendPreviousStoryboardContinuityPrompt(cleaned, previous);
}

function normalizeVideoReferenceGraph(
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

function isClipStoryboardAssetSection(node: { type?: string; data?: any }): boolean {
  return node.type === 'section' && node.data?.sectionKind === 'clip-storyboard-assets' && typeof node.data?.clipId === 'string';
}

function isStoryboardReferenceInputNode(node: { type?: string; data?: any }): boolean {
  return node.type === 'imageInput' && node.data?.clipNodeKind === 'storyboard-reference';
}

function preferredStoryboardReferenceNode(
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

function storyboardReferenceNodePriority(id: string): number {
  if (id.startsWith('episode-sync-story-ref-')) return 0;
  if (id.startsWith('storyboard-prev-')) return 1;
  return 2;
}

function normalizeClipStoryboardReferenceSections(
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

function collectClipStoryboardReferences(clip: Clip, nodes: Array<{ id: string; type?: string; data?: any }>): ClipImageReference[] {
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

function collectClipStoryboardImageReferences(
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

function findPreviousClipStoryboardReference(
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

function appendPreviousStoryboardContinuityPrompt(prompt: string, previous: PreviousStoryboardReference | null): string {
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

function collectClipVideoReferences(
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
  const assetRefs = collectClipAssetReferences(clip, clipScenes, assets, 100, extraSearchText, {
    includeProps: options.includeProps ?? false,
    includeScenes: options.includeScenes ?? false,
    includeStoryboardPrompt: false,
    includeMissing: options.includeMissing ?? false,
  });
  const ordered = [
    ...storyboardRefs,
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

function extractDialogueCharacterNamesFromScenes(clipScenes: BreakdownScene[], availableNames: string[]): string[] {
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

function pushUniqueDialogueName(found: string[], seen: Set<string>, name: string): boolean {
  const key = normalizeCompareText(name);
  if (!key || seen.has(key)) return false;
  seen.add(key);
  found.push(name);
  return true;
}

function dialogueNamesCharacter(dialogue: string, name: string): boolean {
  const escaped = escapeRegExp(name);
  return (
    new RegExp(`(?:^|[\\n;。.!?])\\s*${escaped}\\s*[:：]`, 'i').test(dialogue) ||
    new RegExp(`\\b${escaped}\\b\\s*(?:says|said|asks|asked|replies|responds|whispers|shouts|mutters|delivers|speaks)\\b`, 'i').test(dialogue)
  );
}

function extractDialogueCharacterNamesFromPrompt(prompt: string, availableNames: string[]): string[] {
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

function promptNamesSpeakingCharacter(text: string, name: string): boolean {
  const escaped = escapeRegExp(name);
  return (
    new RegExp(`(?:^|[\\n;。.!?])\\s*${escaped}\\s*[:：]["'“”‘’\\s]`, 'i').test(text) ||
    new RegExp(`\\b${escaped}\\b\\s*(?:says|said|asks|asked|replies|responds|whispers|shouts|mutters|speaks)\\b`, 'i').test(text) ||
    new RegExp(`\\b${escaped}\\b\\s*(?:delivers|gives)\\s+(?:the\\s+)?(?:spoken\\s+)?(?:dialogue|line)\\b`, 'i').test(text)
  );
}

function extractDialogueCharacterNames(
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

function collectCharacterAudioReferencesFromWorkflow(
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

function collectVideoNodeAudioReferences(
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

function characterAudioReferenceMetadata(refs: CharacterAudioReference[]) {
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

function compactPromptText(value: unknown, _max = Number.POSITIVE_INFINITY) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizePromptTextForParsing(value: unknown) {
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

function isClipStoryboardImagePrompt(prompt: string) {
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

function getClipEstimatedDuration(clip: Clip, clipScenes: BreakdownScene[]) {
  const estimated = Number(clip.estimatedDuration);
  if (Number.isFinite(estimated) && estimated > 0) return estimated;
  const sceneTotal = clipScenes.reduce((sum, scene) => sum + Math.max(0, Number(scene.durationSeconds ?? 0)), 0);
  return sceneTotal > 0 ? sceneTotal : 10;
}

function suggestClipStoryboardPanelCount(clip: Clip, clipScenes: BreakdownScene[]) {
  const duration = getClipEstimatedDuration(clip, clipScenes);
  const shotCount = Math.max(clipScenes.length, clip.shotIds?.length ?? 0);
  const dialogueWords = clip.dialogueWordCount ?? clipScenes.reduce((sum, scene) => sum + countEnglishDialogueWords(scene.dialogue), 0);
  const dialoguePressure = dialogueWords > 32 ? 1 : 0;

  if (duration < 6) return Math.max(MIN_CLIP_STORYBOARD_PANEL_COUNT, Math.min(6, shotCount + 2));
  if (duration <= 8) return Math.max(6, Math.min(8, shotCount + 3 + dialoguePressure));
  if (duration <= 12) return Math.max(8, Math.min(10, shotCount + 4 + dialoguePressure));
  return Math.max(10, Math.min(MAX_CLIP_STORYBOARD_PANEL_COUNT, shotCount + 5 + dialoguePressure));
}

function formatClipShotPromptLine(scene: BreakdownScene, index: number) {
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

function buildClipStoryboardPanelLines(clip: Clip, clipScenes: BreakdownScene[], panelCount: number) {
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

function storyboardVisibleCastForScene(scene: BreakdownScene, clip: Clip): string[] {
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

function storyboardPanelFramingForScene(scene: BreakdownScene, index: number): string {
  const text = normalizeCompareText([scene.title, scene.description, scene.action, scene.visualPrompt].join(' '));
  const hasDetailNeed = /\b(close|close-up|closeup|reaction|insert|detail|face|eyes|hand|prop|weapon)\b|特写|近景|反应|表情|眼神|手部|道具|武器|细节/.test(text);
  const hasWideNeed = /\b(wide|establishing|overhead|full room|group|team|everyone|all characters)\b|远景|全景|俯视|空间|全体|众人|主角团|所有角色/.test(text);
  if (hasDetailNeed || index % 3 === 1) return 'close-up / reaction close-up / detail insert';
  if (hasWideNeed) return 'brief medium group orientation only if needed, cropped toward the current action';
  if (index % 3 === 2) return 'medium close-up / over-the-shoulder';
  return 'medium close-up or tight medium shot';
}

function limitStoryboardVisibleCast(names: string[], scene: BreakdownScene, index: number): string[] {
  const unique = uniqueStrings(names).filter(Boolean);
  if (unique.length <= 2) return unique;
  const text = normalizeCompareText([scene.title, scene.description, scene.action, scene.dialogue, scene.references, scene.visualPrompt].join(' '));
  const needsGroup = /\b(group|team|everyone|all characters|crowd|surround|fight|battle|block|intercept|together)\b|全体|众人|主角团|团队|包围|战斗|拦截|一起/.test(text);
  if (needsGroup) return unique.slice(0, 3);
  return unique.slice(index % unique.length, index % unique.length + 2).concat(unique.slice(0, Math.max(0, (index % unique.length + 2) - unique.length))).slice(0, 2);
}

function clipStoryboardBoardLayoutStrategy(panelCount?: number) {
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

function buildClipDirectorBoardPrompt(clip: Clip, clipScenes: BreakdownScene[], panelChoice: ClipPanelCountChoice, allScenes: BreakdownScene[] = clipScenes, assets?: WorkflowAssets) {
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

function ensureClipStoryboardBoardLayoutPrompt(prompt: string, panelCount?: number) {
  const trimmed = stripLegacyClipStoryboardImageLayoutPrompt(String(prompt || '').trim());
  if (!trimmed) return trimmed;
  if (hasCompleteClipStoryboardBoardLayoutPrompt(trimmed)) return trimmed;
  return normalizeStoryboardPromptSpacing([clipStoryboardBoardLayoutStrategy(panelCount ?? detectStoryboardPanelCount(trimmed)), trimmed].filter(Boolean).join('\n\n'));
}

function finalizeClipStoryboardImagePrompt(prompt: string, panelCount?: number) {
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

function stripComicStoryboardLayoutPrompt(prompt: unknown) {
  return String(prompt || '')
    .replace(/Storyboard layout:\s*one 16:9 (?:compact\s*)?multi-panel comic page[\s\S]*?(?:Visible text stays to panel labels and speech bubbles\.|Use only panel numbers and intentional speech bubbles as visible text; camera, lens, movement, and shot metadata belong to the video prompt, not the image\.)\s*/gi, '')
    .replace(/Storyboard layout:\s*one 16:9 multi-panel comic page[\s\S]*?Place a small readable panel number label such as P1, P2, P3 in a corner of\s*(?=(?:Required continuity characters|Use linked|Create|Comic panels in reading order|Panel\s+\d+:|Character reference|Dialogue lock|$))/gi, '')
    .replace(/\b(?:each|the selected number of large sequential panels in left-to-right, top-to-bottom reading order\. Use a full-page comic grid with thin black gutters and large cinematic 3D American comic frames\. Place a small readable panel number label such as P1, P2, P3 in a corner of each)\s+panel\. Show spoken dialogue as clean white comic speech bubbles inside the relevant panels\. Visible text stays to panel labels and speech bubbles\./gi, ' ');
}

function hasCompleteClipStoryboardBoardLayoutPrompt(prompt: string) {
  return /Storyboard layout:\s*one 16:9 compact multi-panel comic page/i.test(prompt) &&
    /vertical-video-friendly frames/i.test(prompt) &&
    /Show spoken dialogue as clean white comic speech bubbles/i.test(prompt);
}

function stripLegacyClipStoryboardImageLayoutPrompt(prompt: string) {
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

function cleanStrayReferenceMapText(prompt: string) {
  return prompt
    .replace(/\b(?:each|the selected number of large sequential panels in left-to-right, top-to-bottom reading order\. Use a full-page comic grid with thin black gutters and large cinematic 3D American comic frames\. Place a small readable panel number label such as P1, P2, P3 in a corner of each)\s+panel\. Show spoken dialogue as clean white comic speech bubbles inside the relevant panels\. Visible text stays to panel labels and speech bubbles\./gi, ' ')
    .replace(/\s+Reference image map:\s+#\d+:[\s\S]*?(?=(?:\s+Required continuity characters:|\s+Use the linked previous storyboard image|\s+Create one|\s+Storyboard layout:|\s+Comic panels in reading order:|\s+Panel\s+\d+:|$))/gi, ' ')
    .replace(/^Reference image map:\s+[\s\S]*?(?=(?:\n\n|\n)?(?:Storyboard layout|Comic panels in reading order|Create|Required|Use the linked previous storyboard image|Clip title|This storyboard|Each panel|First infer|Setting|Characters present|Plot goal|Start state|End state|Shots to cover|Panel\s+\d+)\b|$)/i, '');
}

function cleanLegacyStoryboardText(prompt: string): string {
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

function cleanLegacyStoryboardPanelFieldText(prompt: string): string {
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

function cleanLegacyStoryboardShotFieldText(prompt: string): string {
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

function extractLegacyStoryboardField(body: string, field: string): string {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`${escaped}\\s*=\\s*([\\s\\S]*?)(?=\\s*\\|\\s*(?:title|camera|action|exact dialogue|dialogue|key prop|visual cue|panel label|visible cast|framing)\\s*=|;\\s*technical label|$)`, 'i'));
  return compactPromptText(match?.[1] || '', 420);
}

function dedupeStoryboardPanelSpeechBubbles(prompt: string): string {
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

function normalizeStoryboardDialogueKey(dialogue: string): string {
  return compactPromptText(dialogue)
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeStoryboardPromptSpacing(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function detectStoryboardPanelCount(prompt: string): number | undefined {
  const exact = prompt.match(/\bUse exactly\s+(\d{1,2})\s+(?:clear\s+)?panels?\b/i);
  const comic = prompt.match(/\bwith\s+(\d{1,2})\s+large\s+panels?\b/i);
  const labels = Array.from(prompt.matchAll(/\bPanel\s+(\d{1,2})\s*[:：]/gi)).map((match) => Number(match[1]));
  const count = Number(exact?.[1] || comic?.[1] || Math.max(0, ...labels));
  if (!Number.isFinite(count) || count <= 0) return undefined;
  return Math.max(MIN_CLIP_STORYBOARD_PANEL_COUNT, Math.min(MAX_CLIP_STORYBOARD_PANEL_COUNT, Math.round(count)));
}

function enforceClipStoryboardContinuityPrompt(
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


type WorkflowCenterOverlayProps = {
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
  scenes: BreakdownScene[];
  clips: Clip[];
  assets: WorkflowAssets;
  stageStatuses: Record<string, string>;
  workflowLoading: boolean;
  workflowSaving: boolean;
  workflowRunning: boolean;
  workflowError: string | null;
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
  onClose: () => void;
  onUploadClick: () => void;
  onAddWorkflowNode: (nodeType: CanvasNodeKind, title: string, description: string) => void;
  onAddSceneNode: (scene: BreakdownScene, index: number) => void;
  onAddClipStoryboardNode: (clip: Clip, prompt: string) => void | Promise<void>;
  onAddClipStoryboardImageReferenceNode: (clip: Clip, reference: ClipStoryboardImageReference) => void;
  onAddClipVideoNode: (clip: Clip, prompt: string) => void | Promise<void>;
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
  isAssetUploadBusy: (kind: WorkflowAssetKind, item: WorkflowAssetItem) => boolean;
  isAssetGenerationBusy: (kind: WorkflowAssetKind, item: WorkflowAssetItem) => boolean;
  optimizingClipId: string | null;
  generatingSeedanceClipId: string | null;
  inferBoardsAndVideoRunning: boolean;
};

type StageWorkPanelProps = {
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
  runBreakdown: () => void;
  rerunStoryboard: () => void;
  inferBoardsAndVideoToCanvas: () => InferBoardsAndVideoResult | Promise<InferBoardsAndVideoResult>;
  onSyncEpisodeBoardsToCanvas: (override?: EpisodeCanvasSyncRequest) => void | Promise<void>;
  setActiveStage: (stage: WorkflowStageKey) => void;
  onAddWorkflowNode: (nodeType: CanvasNodeKind, title: string, description: string) => void;
  onAddSceneNode: (scene: BreakdownScene, index: number) => void;
  onAddClipStoryboardNode: (clip: Clip, prompt: string) => void | Promise<void>;
  onAddClipStoryboardImageReferenceNode: (clip: Clip, reference: ClipStoryboardImageReference) => void;
  onAddClipVideoNode: (clip: Clip, prompt: string) => void | Promise<void>;
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
  isAssetUploadBusy: (kind: WorkflowAssetKind, item: WorkflowAssetItem) => boolean;
  isAssetGenerationBusy: (kind: WorkflowAssetKind, item: WorkflowAssetItem) => boolean;
  optimizingClipId: string | null;
  generatingSeedanceClipId: string | null;
  inferBoardsAndVideoRunning: boolean;
  workflowBusy: boolean;
  storyboardImageRefs: ClipStoryboardImageReference[];
};

type StoryboardSceneListProps = {
  scenes: BreakdownScene[];
  onAddSceneNode: (scene: BreakdownScene, index: number) => void;
  onEditScene: (sceneId: string) => void;
  onDeleteScene: (sceneId: string) => void;
  emptyTitle?: string;
  emptyDescription?: string;
};

function StoryboardSceneList({
  scenes,
  onAddSceneNode,
  onEditScene,
  onDeleteScene,
  emptyTitle = '还没有分镜脚本',
  emptyDescription = '先导入小说/剧本，再点击 AI智能拆解。',
}: StoryboardSceneListProps) {
  if (scenes.length === 0) {
    return (
      <div className="flex min-h-[180px] flex-col items-center justify-center p-6 text-center">
        <ListChecks className="mb-3 h-6 w-6 text-zinc-700" />
        <div className="text-[13px] font-medium text-zinc-300">{emptyTitle}</div>
        <div className="mt-1 text-[12px] text-zinc-600">{emptyDescription}</div>
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
              <span className="text-[13px] font-semibold text-zinc-100">
                {String(index + 1).padStart(2, '0')} · {scene.title}
              </span>
              <Badge className={cn(
                "border text-[10px]",
                scene.status === 'ready'
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/10"
                  : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-900"
              )}>
                {scene.status === 'ready' ? '可继续' : '待确认'}
              </Badge>
              {scene.durationSeconds !== undefined && (
                <Badge className="border border-amber-500/20 bg-amber-500/10 text-[10px] text-amber-200 hover:bg-amber-500/10">
                  {scene.durationSeconds}s
                </Badge>
              )}
              {pacing.words > 0 && (
                <Badge className={cn(
                  "border text-[10px]",
                  pacing.tooDense
                    ? "border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/10"
                    : "border-sky-500/20 bg-sky-500/10 text-sky-200 hover:bg-sky-500/10"
                )}>
                  台词 {pacing.wordsPerSecond.toFixed(1)} w/s
                </Badge>
              )}
            </div>
            <p className="mt-2 line-clamp-2 text-[12px] leading-5 text-zinc-400">{scene.description}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-zinc-500">
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
              className="h-8 border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
              onClick={() => onEditScene(scene.id)}
            >
              <Pencil className="h-3.5 w-3.5" />
              编辑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-indigo-300 hover:bg-indigo-500/10 hover:text-indigo-100"
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

function ClipStoryboardList({
  clips,
  scenes,
  assets,
  activeEpisodeId,
  storyboardImageRefs,
  workflowAiModelId,
  finalizeClipStoryboardPrompt,
  onAddSceneNode,
  onAddClipStoryboardNode,
  onAddClipStoryboardImageReferenceNode,
  onUpdateClipStoryboard,
  onSyncEpisodeBoardsToCanvas,
  onEditScene,
  onDeleteScene,
  onAcceptClip,
  onOptimizeClip,
  optimizingClipId,
  workflowBusy,
}: {
  clips: Clip[];
  scenes: BreakdownScene[];
  assets: WorkflowAssets;
  activeEpisodeId: string;
  storyboardImageRefs: ClipStoryboardImageReference[];
  workflowAiModelId: string;
  finalizeClipStoryboardPrompt: FinalizeClipStoryboardPrompt;
  onAddSceneNode: (scene: BreakdownScene, index: number) => void;
  onAddClipStoryboardNode: (clip: Clip, prompt: string) => void | Promise<void>;
  onAddClipStoryboardImageReferenceNode: (clip: Clip, reference: ClipStoryboardImageReference) => void;
  onUpdateClipStoryboard: (clipId: string, patch: { prompt?: string; panelCount?: number; notes?: string }) => void;
  onSyncEpisodeBoardsToCanvas: (override?: EpisodeCanvasSyncRequest) => void | Promise<void>;
  onEditScene: (sceneId: string) => void;
  onDeleteScene: (sceneId: string) => void;
  onAcceptClip: (clipId: string) => void;
  onOptimizeClip: (clipId: string) => void;
  optimizingClipId: string | null;
  workflowBusy: boolean;
}) {
  const { id: projectId } = useParams();
  const [selectedClipId, setSelectedClipId] = useState<string | null>(clips[0]?.id ?? null);
  const [clipPanelChoices, setClipPanelChoices] = useState<Record<string, ClipPanelCountChoice>>({});
  const [clipStoryboardDrafts, setClipStoryboardDrafts] = useState<Record<string, string>>({});
  const [clipStoryboardPlans, setClipStoryboardPlans] = useState<Record<string, ClipStoryboardPlan>>({});
  const [clipStoryboardLoadingId, setClipStoryboardLoadingId] = useState<string | null>(null);
  const [batchStoryboardRunning, setBatchStoryboardRunning] = useState(false);
  const [selectedStoryboardClipIds, setSelectedStoryboardClipIds] = useState<string[]>([]);
  const [clipStoryboardErrors, setClipStoryboardErrors] = useState<Record<string, string>>({});
  const storyboardResumeAttemptedRef = useRef(false);

  useEffect(() => {
    if (clips.length === 0) {
      setSelectedClipId(null);
      return;
    }
    setSelectedClipId((current) => (current && clips.some((clip) => clip.id === current) ? current : null));
  }, [clips]);

  useEffect(() => {
    const clipIds = new Set(clips.map((clip) => clip.id));
    setClipPanelChoices((current) => Object.fromEntries(Object.entries(current).filter(([clipId]) => clipIds.has(clipId))));
    setClipStoryboardDrafts((current) => {
      const next: Record<string, string> = {};
      for (const clip of clips) {
        const prompt = String(clip.storyboardPrompt || '');
        next[clip.id] = prompt || current[clip.id] || '';
      }
      return next;
    });
    setClipStoryboardPlans((current) => Object.fromEntries(Object.entries(current).filter(([clipId]) => clipIds.has(clipId))));
    setClipStoryboardErrors((current) => Object.fromEntries(Object.entries(current).filter(([clipId]) => clipIds.has(clipId))));
    setSelectedStoryboardClipIds((current) => current.filter((clipId) => clipIds.has(clipId)));
  }, [clips]);

  const generateClipStoryboardPrompt = async (
    clip: Clip,
    clipScenes: BreakdownScene[],
    panelChoice: ClipPanelCountChoice,
    options: { keepLoading?: boolean; skipCanvasSync?: boolean } = {},
  ): Promise<ClipStoryboardInferenceResult> => {
    if (!options.keepLoading) setClipStoryboardLoadingId(clip.id);
    setClipStoryboardErrors((current) => ({ ...current, [clip.id]: '' }));
    try {
      if (!projectId || projectId === 'local') {
        const prompt = buildClipDirectorBoardPrompt(clip, clipScenes, panelChoice, scenes, assets);
        const finalPrompt = finalizeClipStoryboardPrompt(clip, prompt).prompt;
        setClipStoryboardDrafts((current) => ({ ...current, [clip.id]: finalPrompt }));
        onUpdateClipStoryboard(clip.id, {
          prompt: finalPrompt,
          panelCount: panelChoice === 'ai' ? suggestClipStoryboardPanelCount(clip, clipScenes) : panelChoice,
          notes: projectId === 'local' ? '本地项目使用离线提示词模板。' : '',
        });
        setClipStoryboardPlans((current) => ({
          ...current,
          [clip.id]: {
            panelCount: panelChoice === 'ai' ? suggestClipStoryboardPanelCount(clip, clipScenes) : panelChoice,
            notes: projectId === 'local' ? '本地项目使用离线提示词模板。' : '',
          },
        }));
        const nextClip = {
          ...clip,
          storyboardPrompt: finalPrompt,
          storyboardPanelCount: panelChoice === 'ai' ? suggestClipStoryboardPanelCount(clip, clipScenes) : panelChoice,
          storyboardNotes: projectId === 'local' ? '本地项目使用离线提示词模板。' : '',
          seedancePrompt: '',
        };
        if (!options.skipCanvasSync) {
          void onSyncEpisodeBoardsToCanvas({
            clips: clips.map((item) => (item.id === clip.id ? nextClip : item)),
            scenes,
            assets,
          });
        }
        return { ok: true, clip: nextClip };
      }

      const result = await apiClient.planProjectWorkflowClipStoryboard(projectId, clip.id, {
        episodeId: activeEpisodeId,
        aiModelId: workflowAiModelId || undefined,
        panelMode: panelChoice === 'ai' ? 'ai' : 'manual',
        panelCount: panelChoice === 'ai' ? undefined : panelChoice,
      });
      const serverClip = result.clip && result.clip.id === clip.id ? result.clip : undefined;
      const workflowClips = result.workflow?.clips ?? clips;
      const workflowAssets = result.workflow?.assets ?? assets;
      const finalPrompt = finalizeClipStoryboardPrompt(
        { ...clip, ...serverClip, storyboardPrompt: result.prompt, seedancePrompt: '' },
        result.prompt,
        workflowClips,
        workflowAssets,
      ).prompt;
      setClipStoryboardDrafts((current) => ({ ...current, [clip.id]: finalPrompt }));
      onUpdateClipStoryboard(clip.id, {
        prompt: finalPrompt,
        panelCount: result.panelCount,
        notes: result.notes || '',
      });
      setClipStoryboardPlans((current) => ({
        ...current,
        [clip.id]: {
          panelCount: result.panelCount,
          notes: result.notes,
        },
      }));
      const nextClip = {
        ...clip,
        ...serverClip,
        storyboardPrompt: finalPrompt,
        storyboardPanelCount: result.panelCount,
        storyboardNotes: result.notes || '',
        seedancePrompt: '',
      };
      const nextWorkflowClips = workflowClips.map((item) => (item.id === clip.id ? nextClip : item));
      await persistStoryboardPromptToBackend(nextWorkflowClips, workflowAssets, (result.workflow?.breakdownScenes as BreakdownScene[] | undefined) ?? scenes);
      if (!options.skipCanvasSync) {
        void onSyncEpisodeBoardsToCanvas({
          clips: nextWorkflowClips,
          scenes: (result.workflow?.breakdownScenes as BreakdownScene[] | undefined) ?? scenes,
          assets: workflowAssets,
        });
      }
      return { ok: true, clip: nextClip };
    } catch (error) {
      setClipStoryboardErrors((current) => ({
        ...current,
        [clip.id]: error instanceof Error ? error.message : 'Clip 故事板推理失败',
      }));
      return { ok: false };
    } finally {
      if (!options.keepLoading) setClipStoryboardLoadingId(null);
    }
  };

  const selectedStoryboardClipSet = useMemo(() => new Set(selectedStoryboardClipIds), [selectedStoryboardClipIds]);
  const allStoryboardSelected = clips.length > 0 && selectedStoryboardClipIds.length === clips.length;
  const storyboardBatchBusy = batchStoryboardRunning || Boolean(clipStoryboardLoadingId);

  const persistStoryboardPromptToBackend = async (nextClips: Clip[], nextAssets: WorkflowAssets = assets, nextScenes: BreakdownScene[] = scenes) => {
    if (!projectId || projectId === 'local') return;
    try {
      await apiClient.saveProjectWorkflow(projectId, {
        episodeId: activeEpisodeId,
        breakdownScenes: nextScenes,
        clips: nextClips,
        assets: nextAssets,
      }, { episodeId: activeEpisodeId });
    } catch {
      // The local draft still updates immediately; autosave can retry later.
    }
  };

  const toggleStoryboardClipSelection = (clipId: string) => {
    setSelectedStoryboardClipIds((current) => (
      current.includes(clipId)
        ? current.filter((id) => id !== clipId)
        : [...current, clipId]
    ));
  };

  const runSelectedStoryboardInference = async () => {
    const selected = clips.filter((clip) => selectedStoryboardClipSet.has(clip.id));
    if (selected.length === 0 || storyboardBatchBusy) return;
    const now = new Date().toISOString();
    const initialBatch: PersistedClipPromptBatch = {
      version: 1,
      kind: 'storyboard',
      projectId: projectId || 'local',
      episodeId: activeEpisodeId,
      clipIds: selected.map((clip) => clip.id),
      completedClipIds: [],
      failedClipIds: [],
      panelChoices: Object.fromEntries(selected.map((clip) => [clip.id, clipPanelChoices[clip.id] ?? 'ai'])),
      aiModelId: workflowAiModelId || '',
      createdAt: now,
      updatedAt: now,
    };
    writePersistedClipPromptBatch(initialBatch);
    await runStoryboardInferenceBatch(initialBatch);
  };

  const runStoryboardInferenceBatch = async (batch: PersistedClipPromptBatch) => {
    const completed = new Set(batch.completedClipIds);
    const failed = new Set(batch.failedClipIds ?? []);
    const selected = batch.clipIds
      .map((clipId) => clips.find((clip) => clip.id === clipId))
      .filter((clip): clip is Clip => Boolean(clip))
      .filter((clip) => !completed.has(clip.id) && !failed.has(clip.id));
    if (selected.length === 0 || storyboardBatchBusy) {
      if (selected.length === 0) clearPersistedClipPromptBatch('storyboard', projectId, activeEpisodeId);
      return;
    }
    setSelectedStoryboardClipIds(batch.clipIds.filter((clipId) => clips.some((clip) => clip.id === clipId)));
    setBatchStoryboardRunning(true);
    let latestClips = clips;
    try {
      for (const clip of selected) {
        const clipScenes = getClipScenes(clip, scenes);
        const panelChoice = batch.panelChoices?.[clip.id] ?? clipPanelChoices[clip.id] ?? 'ai';
        setClipStoryboardLoadingId(clip.id);
        writePersistedClipPromptBatch({
          ...batch,
          completedClipIds: Array.from(completed),
          failedClipIds: Array.from(failed),
          currentClipId: clip.id,
        });
        const result = await generateClipStoryboardPrompt(clip, clipScenes, panelChoice, { keepLoading: true, skipCanvasSync: true });
        if (result.ok) {
          completed.add(clip.id);
          if (result.clip) {
            latestClips = latestClips.map((item) => (item.id === result.clip?.id ? result.clip : item));
          }
        } else {
          failed.add(clip.id);
        }
        writePersistedClipPromptBatch({
          ...batch,
          completedClipIds: Array.from(completed),
          failedClipIds: Array.from(failed),
          currentClipId: undefined,
        });
      }
    } finally {
      setClipStoryboardLoadingId(null);
      setBatchStoryboardRunning(false);
      clearPersistedClipPromptBatch('storyboard', projectId, activeEpisodeId);
      if (completed.size > 0) void onSyncEpisodeBoardsToCanvas({ clips: latestClips, scenes, assets });
    }
  };

  useEffect(() => {
    storyboardResumeAttemptedRef.current = false;
  }, [projectId, activeEpisodeId]);

  useEffect(() => {
    if (storyboardResumeAttemptedRef.current || clips.length === 0 || batchStoryboardRunning || clipStoryboardLoadingId) return;
    const persisted = readPersistedClipPromptBatch('storyboard', projectId, activeEpisodeId);
    if (!persisted) {
      storyboardResumeAttemptedRef.current = true;
      return;
    }
    storyboardResumeAttemptedRef.current = true;
    if (!shouldResumePersistedClipPromptBatch(persisted, workflowAiModelId, clips.map((clip) => clip.id))) {
      clearPersistedClipPromptBatch('storyboard', projectId, activeEpisodeId);
      return;
    }
    setClipPanelChoices((current) => ({ ...current, ...(persisted.panelChoices ?? {}) }));
    setSelectedStoryboardClipIds(persisted.clipIds.filter((clipId) => clips.some((clip) => clip.id === clipId)));
    void runStoryboardInferenceBatch(persisted);
  }, [activeEpisodeId, batchStoryboardRunning, clipStoryboardLoadingId, clips, projectId, workflowAiModelId]);

  return (
    <div className="divide-y divide-zinc-800">
      <div className="flex flex-col gap-3 px-4 py-3 text-[11px] text-zinc-500 xl:flex-row xl:items-center xl:justify-between">
        <div className="grid flex-1 gap-2 sm:grid-cols-4">
          <span>Clips {clips.length}</span>
          <span>分镜 {scenes.length}</span>
          <span>预计 {clips.reduce((sum, clip) => sum + Number(clip.estimatedDuration ?? 0), 0)}s</span>
          <span>已选 {selectedStoryboardClipIds.length}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="h-7 rounded-md border border-zinc-800 px-2 text-[11px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-100"
            onClick={() => setSelectedStoryboardClipIds(allStoryboardSelected ? [] : clips.map((clip) => clip.id))}
          >
            {allStoryboardSelected ? '清空选择' : '全选 Clip'}
          </button>
          <button
            type="button"
            className="h-7 rounded-md border border-zinc-800 px-2 text-[11px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-100"
            onClick={() => setSelectedClipId((current) => (current ? null : clips[0]?.id ?? null))}
          >
            {selectedClipId ? '收起详情' : '展开第一个'}
          </button>
          <Button
            type="button"
            size="sm"
            className="h-7 bg-amber-500 text-[11px] text-black hover:bg-amber-400"
            disabled={selectedStoryboardClipIds.length === 0 || storyboardBatchBusy}
            onClick={() => void runSelectedStoryboardInference()}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {batchStoryboardRunning ? `批量推理中 ${selectedStoryboardClipIds.length}` : `批量重新推理 ${selectedStoryboardClipIds.length || ''}`}
          </Button>
        </div>
      </div>

      {clips.map((clip, index) => {
        const active = selectedClipId === clip.id;
        const clipScenes = getClipScenes(clip, scenes);
        const continuityCharacters = inferContinuityCharactersForClip(clip, clipScenes, scenes, assets);
        const clipStoryboardPromptSource = clip.storyboardPrompt || clipStoryboardDrafts[clip.id] || '';
        const storyboardAssetReferences = collectClipAssetReferences(clip, clipScenes, assets, 100, clipStoryboardPromptSource, { includeProps: false, allScenes: scenes });
        const risks = getClipRiskItems(clip);
        const preflightRisky = isClipPreflightRisky(clip);
        const shotCount = clip.shotIds?.length ?? 0;
        const missingShotCount = Math.max(0, shotCount - clipScenes.length);
        const optimizing = optimizingClipId === clip.id;
        const panelChoice = clipPanelChoices[clip.id] ?? 'ai';
        const suggestedPanelCount = suggestClipStoryboardPanelCount(clip, clipScenes);
        const clipStoryboardDraft = enforceClipStoryboardContinuityPrompt(clipStoryboardPromptSource, clip, clipScenes, scenes, assets);
        const clipStoryboardPlan = clipStoryboardPlans[clip.id] ?? {
          panelCount: clip.storyboardPanelCount,
          notes: clip.storyboardNotes,
        };
        const clipStoryboardError = clipStoryboardErrors[clip.id] ?? '';
        const clipStoryboardLoading = clipStoryboardLoadingId === clip.id;
        const clipStoryboardImages = storyboardImageRefs.filter((ref) => storyboardReferenceMatchesClip(ref, clip));
        const shortClipWarning =
          getClipEstimatedDuration(clip, clipScenes) < 6
            ? '该 Clip 时长短于 6 秒，自动模式仍会至少生成 5 格；如果要按 15 秒节奏推进，建议先合并相邻 Clip。'
            : '';

        return (
          <div key={clip.id} className={cn("bg-[#141416]", active && "bg-[#18181b]")}>
            <div className="flex items-center gap-2 border-b border-zinc-900/70 px-4 py-2 text-[11px] text-zinc-500">
              <input
                type="checkbox"
                checked={selectedStoryboardClipSet.has(clip.id)}
                onChange={() => toggleStoryboardClipSelection(clip.id)}
                className="h-3.5 w-3.5 accent-amber-500"
              />
              <span>选择此 Clip 故事板提示词</span>
              {clipStoryboardLoading && (
                <span className="ml-auto text-amber-200">推理中...</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelectedClipId((current) => (current === clip.id ? null : clip.id))}
              className="grid w-full gap-3 p-4 text-left transition-colors hover:bg-[#18181b] xl:grid-cols-[112px_minmax(0,1.5fr)_150px_150px_minmax(0,1fr)_170px]"
            >
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-600">Clip 编号</div>
                <div className="mt-1 truncate font-mono text-[13px] font-semibold text-zinc-100">
                  C{String(index + 1).padStart(2, '0')}
                </div>
                <div className="mt-0.5 truncate font-mono text-[10px] text-zinc-600">{clip.id}</div>
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[13px] font-semibold text-zinc-100">{clip.title}</span>
                  {clip.panelCount !== undefined && (
                    <Badge className="border border-zinc-700 bg-zinc-900 text-[10px] text-zinc-400 hover:bg-zinc-900">
                      {clip.panelCount} panels
                    </Badge>
                  )}
                </div>
                <div className="mt-1 line-clamp-2 text-[12px] leading-5 text-zinc-400">
                  {clip.plotGoal || '未写入剧情目标'}
                </div>
              </div>

              <div className="min-w-0">
                <div className="text-[11px] text-zinc-600">预计时长</div>
                <div className="mt-1 text-[12px] leading-5 text-zinc-300">{formatClipDuration(clip)}</div>
              </div>

              <div className="min-w-0">
                <div className="text-[11px] text-zinc-600">台词词数/密度</div>
                <div className="mt-1 text-[12px] leading-5 text-zinc-300">{formatClipDialogue(clip)}</div>
              </div>

              <div className="min-w-0">
                <div className="text-[11px] text-zinc-600">场景 / 角色</div>
                <div className="mt-1 truncate text-[12px] text-zinc-300">
                  {[clip.setting, clip.sceneType].filter(Boolean).join(' · ') || '未指定'}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-zinc-500">{compactList(continuityCharacters.length ? continuityCharacters : clip.characters)}</div>
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap gap-1.5">
                  <Badge className="border border-indigo-500/20 bg-indigo-500/10 text-[10px] text-indigo-200 hover:bg-indigo-500/10">
                    {clip.storyboardControlLevel || '控制未定'}
                  </Badge>
                  <Badge className="border border-amber-500/20 bg-amber-500/10 text-[10px] text-amber-200 hover:bg-amber-500/10">
                    {clip.storyboardType || '类型未定'}
                  </Badge>
                  <Badge className="border border-emerald-500/20 bg-emerald-500/10 text-[10px] text-emerald-200 hover:bg-emerald-500/10">
                    {storyboardAssetReferences.length} 角色/场景参考
                  </Badge>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge
                    className={cn(
                      "border text-[10px]",
                      preflightRisky
                        ? "border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/10"
                        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/10"
                    )}
                  >
                    {getClipPreflightStatus(clip)}
                  </Badge>
                  <span className="truncate text-[11px] text-zinc-500">
                    {risks.length ? `${risks[0]}${risks.length > 1 ? ` +${risks.length - 1}` : ''}` : '无风险提示'}
                  </span>
                </div>
              </div>
            </button>

            {active && (
              <div className="border-t border-zinc-800 bg-[#111113] p-4">
                <div className="mb-4 flex flex-col gap-3 rounded-md border border-zinc-800 bg-[#0d0d0f] p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-semibold text-zinc-100">Clip 预检</span>
                      <Badge
                        className={cn(
                          "border text-[10px]",
                          preflightRisky
                            ? "border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/10"
                            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/10"
                        )}
                      >
                        {getClipPreflightStatus(clip)}
                      </Badge>
                    </div>
                    <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">
                      {risks.length ? risks.join('；') : '当前没有风险提示。'}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-8 border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                      onClick={() => onAcceptClip(clip.id)}
                      disabled={workflowBusy || optimizing}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      接受当前
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className={cn(
                        "h-8 text-black",
                        preflightRisky
                          ? "bg-red-400 hover:bg-red-300"
                          : "bg-amber-500 hover:bg-amber-400"
                      )}
                      onClick={() => onOptimizeClip(clip.id)}
                      disabled={workflowBusy || optimizing}
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      {optimizing ? '优化中...' : 'AI优化此 Clip'}
                    </Button>
                  </div>
                </div>
                <div className="grid gap-3 xl:grid-cols-2">
                  <div className="rounded-md border border-zinc-800 bg-[#0d0d0f] p-3">
                    <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-zinc-300">
                      <ArrowRight className="h-3.5 w-3.5 text-emerald-300" />
                      开始状态
                    </div>
                    <div className="text-[12px] leading-5 text-zinc-500">{clip.startState || '未指定'}</div>
                  </div>
                  <div className="rounded-md border border-zinc-800 bg-[#0d0d0f] p-3">
                    <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-zinc-300">
                      <CheckCircle2 className="h-3.5 w-3.5 text-amber-300" />
                      结束状态
                    </div>
                    <div className="text-[12px] leading-5 text-zinc-500">{clip.endState || '未指定'}</div>
                  </div>
                  <div className="rounded-md border border-zinc-800 bg-[#0d0d0f] p-3">
                    <div className="mb-2 text-[12px] font-medium text-zinc-300">Layout Memory</div>
                    <div className="whitespace-pre-wrap text-[12px] leading-5 text-zinc-500">{clip.layoutMemory || '未生成'}</div>
                  </div>
                  <div className="rounded-md border border-zinc-800 bg-[#0d0d0f] p-3">
                    <div className="mb-2 text-[12px] font-medium text-zinc-300">Seedance Prompt</div>
                    <div className="max-h-[220px] overflow-y-auto rounded border border-zinc-900 bg-[#09090b] px-3 py-2 whitespace-pre-wrap text-[12px] leading-5 text-zinc-500">
                      {clip.seedancePrompt || '未生成'}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-500">
                  <span className="rounded border border-zinc-800 bg-[#0d0d0f] px-2 py-1">
                    shotIds：{shotCount ? (clip.shotIds ?? []).join(', ') : '无'}
                  </span>
                  {clip.emotionArc && (
                    <span className="rounded border border-zinc-800 bg-[#0d0d0f] px-2 py-1">情绪弧：{clip.emotionArc}</span>
                  )}
                  {clip.directorFreedom && (
                    <span className="rounded border border-zinc-800 bg-[#0d0d0f] px-2 py-1">导演自由度：{clip.directorFreedom}</span>
                  )}
                </div>

                <div className="mt-4 rounded-lg border border-zinc-800 bg-[#141416]">
                  <div className="flex flex-col gap-2 border-b border-zinc-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-[13px] font-semibold text-zinc-100">已生成故事板图片</div>
                      <div className="mt-1 text-[11px] leading-4 text-zinc-500">
                        这里收纳当前 Clip 已生成的故事板图，可直接作为参考图放回画布。
                      </div>
                    </div>
                    <Badge className="w-fit border border-amber-500/25 bg-amber-500/10 text-[10px] text-amber-200 hover:bg-amber-500/10">
                      {clipStoryboardImages.length} 张
                    </Badge>
                  </div>
                  {clipStoryboardImages.length ? (
                    <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                      {clipStoryboardImages.map((reference) => (
                        <div key={`${reference.url}:${reference.nodeId || reference.assetId || ''}`} className="overflow-hidden rounded-md border border-zinc-800 bg-[#0d0d0f]">
                          <button
                            type="button"
                            className="block w-full bg-black"
                            onClick={(event) => previewCanvasImage(event, {
                              url: reference.url,
                              title: reference.title || `${clip.title || 'Clip'} 故事板`,
                              subtitle: '已生成故事板',
                            })}
                          >
                            <img
                              src={reference.url}
                              alt={reference.title || `${clip.title || 'Clip'} 故事板`}
                              className="aspect-video w-full object-cover"
                              loading="lazy"
                            />
                          </button>
                          <div className="space-y-2 p-2">
                            <div className="line-clamp-1 text-[11px] text-zinc-300">{reference.title || `${clip.title || 'Clip'} 故事板`}</div>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="h-7 w-full border border-zinc-700 bg-zinc-900 text-[11px] text-zinc-100 hover:bg-zinc-800"
                              onClick={() => onAddClipStoryboardImageReferenceNode(clip, reference)}
                            >
                              <ImageIcon className="h-3.5 w-3.5" />
                              放入画布
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 text-[12px] leading-5 text-zinc-500">
                      暂无已生成故事板图。先点击下方“放入画布生图”，在画布节点生成完成后会自动出现在这里。
                    </div>
                  )}
                </div>

                <div className="mt-4 rounded-lg border border-zinc-800 bg-[#141416]">
                  <div className="flex flex-col gap-3 border-b border-zinc-800 px-4 py-3 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-zinc-100">Clip 故事板提示词</div>
                      <div className="mt-1 text-[11px] leading-4 text-zinc-500">
                        按整个 Clip 调用文本模型先推理格数和故事板提示词；生成图片请放入画布生图节点。
                      </div>
                      {shortClipWarning && (
                        <div className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[11px] leading-4 text-amber-200">
                          {shortClipWarning}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 bg-amber-500 text-black hover:bg-amber-400"
                        disabled={clipStoryboardLoading}
                        onClick={() => void generateClipStoryboardPrompt(clip, clipScenes, panelChoice)}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        {clipStoryboardLoading ? '推理中...' : 'AI推理提示词'}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-8 border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                        disabled={!clipStoryboardDraft}
                        onClick={() => void onAddClipStoryboardNode(clip, clipStoryboardDraft)}
                      >
                        <ImagePlay className="h-3.5 w-3.5" />
                        放入画布生图
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-8 border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                        disabled={!clipStoryboardDraft}
                        onClick={() => void navigator.clipboard?.writeText(clipStoryboardDraft).catch(() => undefined)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        复制
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-3 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-zinc-500">宫格</span>
                      <button
                        type="button"
                        onClick={() => setClipPanelChoices((current) => ({ ...current, [clip.id]: 'ai' }))}
                        className={cn(
                          "h-8 rounded-md border px-3 text-[12px] transition-colors",
                          panelChoice === 'ai'
                            ? "border-amber-500 bg-amber-500/10 text-amber-200"
                            : "border-zinc-800 bg-[#0d0d0f] text-zinc-400 hover:border-zinc-700"
                        )}
                      >
                        AI推理
                      </button>
                      {CLIP_STORYBOARD_PANEL_CHOICES.map((count) => (
                        <button
                          key={count}
                          type="button"
                          onClick={() => setClipPanelChoices((current) => ({ ...current, [clip.id]: count }))}
                          className={cn(
                            "h-8 rounded-md border px-3 text-[12px] transition-colors",
                            panelChoice === count
                              ? "border-amber-500 bg-amber-500/10 text-amber-200"
                              : "border-zinc-800 bg-[#0d0d0f] text-zinc-400 hover:border-zinc-700"
                          )}
                        >
                          {count}格
                        </button>
                      ))}
                      <span className="text-[11px] text-zinc-500">
                        {clipStoryboardPlan?.panelCount
                          ? `AI结果：${clipStoryboardPlan.panelCount}格`
                          : `系统估算：${suggestedPanelCount}格`}
                      </span>
                    </div>
                    {clipStoryboardPlan?.notes && (
                      <div className="rounded-md border border-zinc-800 bg-[#0d0d0f] px-3 py-2 text-[11px] leading-4 text-zinc-500">
                        {clipStoryboardPlan.notes}
                      </div>
                    )}
                    {clipStoryboardError && (
                      <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] leading-4 text-red-200">
                        {clipStoryboardError}
                      </div>
                    )}
                    <textarea
                      className="min-h-[220px] w-full resize-y rounded-md border border-zinc-800 bg-[#0d0d0f] px-3 py-2 font-mono text-[12px] leading-5 text-zinc-100 outline-none focus:border-amber-500"
                      value={clipStoryboardDraft}
                      onChange={(event) => {
                        const nextPrompt = event.target.value;
                        setClipStoryboardDrafts((current) => ({
                          ...current,
                          [clip.id]: nextPrompt,
                        }));
                        onUpdateClipStoryboard(clip.id, {
                          prompt: nextPrompt,
                          panelCount: clipStoryboardPlan?.panelCount,
                          notes: clipStoryboardPlan?.notes || '',
                        });
                      }}
                      placeholder="点击生成提示词。这里会基于整个 Clip 的多个分镜生成故事板提示词，可继续手动修改。"
                    />
                  </div>
                </div>

                <div className="mt-4 rounded-lg border border-zinc-800 bg-[#141416]">
                  <div className="flex flex-col gap-2 border-b border-zinc-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-[13px] font-semibold text-zinc-100">Clip 内镜头列表</div>
                    <div className="flex flex-wrap gap-2 text-[11px] text-zinc-500">
                      <span>{clipScenes.length}/{shotCount} 已匹配</span>
                      {missingShotCount > 0 && <span className="text-amber-300">缺 {missingShotCount}</span>}
                    </div>
                  </div>
                  {clipScenes.length > 0 ? (
                    <StoryboardSceneList
                      scenes={clipScenes}
                      onAddSceneNode={onAddSceneNode}
                      onEditScene={onEditScene}
                      onDeleteScene={onDeleteScene}
                      emptyTitle="该 Clip 暂无分镜"
                      emptyDescription="shotIds 还没有匹配到当前分镜列表。"
                    />
                  ) : (
                    <div className="p-4 text-[12px] text-zinc-500">
                      {shotCount ? 'shotIds 还没有匹配到当前分镜列表。' : '该 Clip 暂无 shotIds。'}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ClipVideoPromptList({
  clips,
  scenes,
  assets,
  activeEpisodeId,
  workflowModels,
  workflowAiModelId,
  setWorkflowAiModelId,
  workflowModelsLoading,
  workflowModelError,
  onAddClipVideoNode,
  onGenerateClipSeedancePrompt,
  onSyncEpisodeBoardsToCanvas,
  generatingSeedanceClipId,
  workflowBusy,
}: {
  clips: Clip[];
  scenes: BreakdownScene[];
  assets: WorkflowAssets;
  activeEpisodeId: string;
  workflowModels: ModelConfig[];
  workflowAiModelId: string;
  setWorkflowAiModelId: (value: string) => void;
  workflowModelsLoading: boolean;
  workflowModelError: string | null;
  onAddClipVideoNode: (clip: Clip, prompt: string) => void;
  onGenerateClipSeedancePrompt: (clipId: string, options?: { skipCanvasSync?: boolean }) => ClipVideoPromptInferenceResult | Promise<ClipVideoPromptInferenceResult>;
  onSyncEpisodeBoardsToCanvas: (override?: EpisodeCanvasSyncRequest) => void | Promise<void>;
  generatingSeedanceClipId: string | null;
  workflowBusy: boolean;
}) {
  const { id: projectId } = useParams();
  const [selectedVideoPromptClipIds, setSelectedVideoPromptClipIds] = useState<string[]>([]);
  const [batchVideoPromptRunning, setBatchVideoPromptRunning] = useState(false);
  const videoPromptResumeAttemptedRef = useRef(false);

  useEffect(() => {
    const clipIds = new Set(clips.map((clip) => clip.id));
    setSelectedVideoPromptClipIds((current) => current.filter((clipId) => clipIds.has(clipId)));
  }, [clips]);

  const selectedVideoPromptClipSet = useMemo(() => new Set(selectedVideoPromptClipIds), [selectedVideoPromptClipIds]);
  const allVideoPromptsSelected = clips.length > 0 && selectedVideoPromptClipIds.length === clips.length;
  const videoPromptBatchBusy = batchVideoPromptRunning || Boolean(generatingSeedanceClipId) || workflowBusy;

  const toggleVideoPromptSelection = (clipId: string) => {
    setSelectedVideoPromptClipIds((current) => (
      current.includes(clipId)
        ? current.filter((id) => id !== clipId)
        : [...current, clipId]
    ));
  };

  const runSelectedVideoPromptInference = async () => {
    const selected = clips.filter((clip) => selectedVideoPromptClipSet.has(clip.id));
    if (selected.length === 0 || videoPromptBatchBusy) return;
    const now = new Date().toISOString();
    const initialBatch: PersistedClipPromptBatch = {
      version: 1,
      kind: 'video-prompt',
      projectId: projectId || 'local',
      episodeId: activeEpisodeId,
      clipIds: selected.map((clip) => clip.id),
      completedClipIds: [],
      failedClipIds: [],
      aiModelId: workflowAiModelId || '',
      createdAt: now,
      updatedAt: now,
    };
    writePersistedClipPromptBatch(initialBatch);
    await runVideoPromptInferenceBatch(initialBatch);
  };

  const runVideoPromptInferenceBatch = async (batch: PersistedClipPromptBatch) => {
    const completed = new Set(batch.completedClipIds);
    const failed = new Set(batch.failedClipIds ?? []);
    const selected = batch.clipIds
      .map((clipId) => clips.find((clip) => clip.id === clipId))
      .filter((clip): clip is Clip => Boolean(clip))
      .filter((clip) => !completed.has(clip.id) && !failed.has(clip.id));
    if (selected.length === 0 || videoPromptBatchBusy) {
      if (selected.length === 0) clearPersistedClipPromptBatch('video-prompt', batch.projectId, batch.episodeId || activeEpisodeId);
      return;
    }
    setSelectedVideoPromptClipIds(batch.clipIds.filter((clipId) => clips.some((clip) => clip.id === clipId)));
    setBatchVideoPromptRunning(true);
    let latestClips = clips;
    let latestScenes = scenes;
    let latestAssets = assets;
    let latestEpisode: string | undefined;
    try {
      for (const clip of selected) {
        writePersistedClipPromptBatch({
          ...batch,
          completedClipIds: Array.from(completed),
          failedClipIds: Array.from(failed),
          currentClipId: clip.id,
        });
        try {
          const result = await onGenerateClipSeedancePrompt(clip.id, { skipCanvasSync: true });
          if (!result.ok) throw new Error('视频提示词生成失败');
          if (result.clips) latestClips = result.clips;
          if (result.scenes) latestScenes = result.scenes;
          if (result.assets) latestAssets = result.assets;
          if (result.episode) latestEpisode = result.episode;
          completed.add(clip.id);
        } catch {
          failed.add(clip.id);
        }
        writePersistedClipPromptBatch({
          ...batch,
          completedClipIds: Array.from(completed),
          failedClipIds: Array.from(failed),
          currentClipId: undefined,
        });
      }
    } finally {
      setBatchVideoPromptRunning(false);
      clearPersistedClipPromptBatch('video-prompt', projectId, activeEpisodeId);
      if (completed.size > 0) {
        void onSyncEpisodeBoardsToCanvas({
          clips: latestClips,
          scenes: latestScenes,
          assets: latestAssets,
          episode: latestEpisode,
          refreshRecords: true,
        });
      }
    }
  };

  useEffect(() => {
    videoPromptResumeAttemptedRef.current = false;
  }, [projectId, activeEpisodeId]);

  useEffect(() => {
    if (videoPromptResumeAttemptedRef.current || clips.length === 0 || batchVideoPromptRunning || generatingSeedanceClipId || workflowBusy) return;
    const persisted = readPersistedClipPromptBatch('video-prompt', projectId, activeEpisodeId);
    if (!persisted) {
      videoPromptResumeAttemptedRef.current = true;
      return;
    }
    videoPromptResumeAttemptedRef.current = true;
    if (!shouldResumePersistedClipPromptBatch(persisted, workflowAiModelId, clips.map((clip) => clip.id))) {
      clearPersistedClipPromptBatch('video-prompt', projectId, activeEpisodeId);
      return;
    }
    setSelectedVideoPromptClipIds(persisted.clipIds.filter((clipId) => clips.some((clip) => clip.id === clipId)));
    void runVideoPromptInferenceBatch(persisted);
  }, [activeEpisodeId, batchVideoPromptRunning, clips, generatingSeedanceClipId, projectId, workflowAiModelId, workflowBusy]);

  if (clips.length === 0) {
    return (
      <div className="flex min-h-[220px] flex-col items-center justify-center p-6 text-center">
        <Film className="mb-3 h-6 w-6 text-zinc-700" />
        <div className="text-[13px] font-medium text-zinc-300">还没有 Clip 视频任务</div>
        <div className="mt-1 text-[12px] text-zinc-600">先完成分镜拆解，再在这里生成 Seedance 视频提示词。</div>
      </div>
    );
  }

  return (
    <div className="divide-y divide-zinc-800">
      <div className="flex flex-col gap-3 px-4 py-3 text-[11px] text-zinc-500 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="font-medium text-zinc-300">视频提示词文本模型</div>
          <div className="mt-1">可单独或多选顺序重新推理每个 Clip 的视频提示词。</div>
        </div>
        <div className="flex w-full flex-col gap-2 xl:w-auto xl:items-end">
          <div className="flex flex-wrap justify-start gap-2 xl:justify-end">
            <button
              type="button"
              className="h-8 rounded-md border border-zinc-800 px-2 text-[11px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-100"
              onClick={() => setSelectedVideoPromptClipIds(allVideoPromptsSelected ? [] : clips.map((clip) => clip.id))}
            >
              {allVideoPromptsSelected ? '清空选择' : '全选 Clip'}
            </button>
            <Button
              type="button"
              size="sm"
              className="h-8 bg-sky-500 text-[11px] text-black hover:bg-sky-400"
              disabled={selectedVideoPromptClipIds.length === 0 || videoPromptBatchBusy}
              onClick={() => void runSelectedVideoPromptInference()}
            >
              <Wand2 className="h-3.5 w-3.5" />
              {batchVideoPromptRunning ? `批量推理中 ${selectedVideoPromptClipIds.length}` : `批量重新推理 ${selectedVideoPromptClipIds.length || ''}`}
            </Button>
          </div>
          <div className="w-full sm:w-[320px]">
            <select
              value={workflowAiModelId}
              onChange={(event) => setWorkflowAiModelId(event.target.value)}
              disabled={workflowModelsLoading || videoPromptBatchBusy || workflowModels.length === 0}
              className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-[12px] text-zinc-100 outline-none focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">{workflowModelsLoading ? '加载模型中...' : '使用后端默认文本模型'}</option>
              {workflowModels.map((model) => (
                <option key={model.id} value={model.id}>{modelOptionLabel(model)}</option>
              ))}
            </select>
            {workflowModelError ? <div className="mt-1 text-[10px] text-red-300">{workflowModelError}</div> : null}
          </div>
        </div>
      </div>
      {clips.map((clip, index) => {
        const clipScenes = getClipScenes(clip, scenes);
        const prompt = clip.seedancePrompt || '';
        const references = collectClipAssetReferences(clip, clipScenes, assets);
        const generating = generatingSeedanceClipId === clip.id;
        return (
          <div key={clip.id} className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_220px]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedVideoPromptClipSet.has(clip.id)}
                  onChange={() => toggleVideoPromptSelection(clip.id)}
                  className="h-3.5 w-3.5 accent-sky-500"
                />
                <span className="font-mono text-[11px] text-zinc-500">C{String(index + 1).padStart(2, '0')}</span>
                <span className="text-[13px] font-semibold text-zinc-100">{clip.title}</span>
                <Badge className="border border-zinc-700 bg-zinc-900 text-[10px] text-zinc-400 hover:bg-zinc-900">
                  {formatClipDuration(clip)}
                </Badge>
                <Badge className="border border-sky-500/20 bg-sky-500/10 text-[10px] text-sky-200 hover:bg-sky-500/10">
                  {references.length} 参考图
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-zinc-500">
                <span className="rounded border border-zinc-800 bg-[#0d0d0f] px-2 py-1">场景：{clip.setting || '未指定'}</span>
                <span className="rounded border border-zinc-800 bg-[#0d0d0f] px-2 py-1">角色：{compactList(clip.characters, '未指定', 8)}</span>
                <span className="rounded border border-zinc-800 bg-[#0d0d0f] px-2 py-1">分镜：{clipScenes.length}/{clip.shotIds?.length ?? 0}</span>
              </div>
              <div className="mt-3 max-h-[260px] overflow-y-auto rounded-md border border-zinc-800 bg-[#09090b] px-3 py-2 font-mono text-[12px] leading-5 text-zinc-300 whitespace-pre-wrap">
                {prompt || '未生成。点击右侧“生成视频提示词”。'}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                size="sm"
                className="h-8 bg-amber-500 text-black hover:bg-amber-400"
                disabled={videoPromptBatchBusy}
                onClick={() => void onGenerateClipSeedancePrompt(clip.id)}
              >
                <Wand2 className="h-3.5 w-3.5" />
                {generating ? '推理中...' : prompt ? '重新推理视频提示词' : '推理视频提示词'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                disabled={!prompt}
                onClick={() => onAddClipVideoNode(clip, prompt)}
              >
                <Film className="h-3.5 w-3.5" />
                放入画布视频任务
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                disabled={!prompt}
                onClick={() => void navigator.clipboard?.writeText(prompt).catch(() => undefined)}
              >
                <Copy className="h-3.5 w-3.5" />
                复制
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StoryboardSceneEditor({
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
  const fieldClass = "w-full rounded-md border border-zinc-800 bg-[#09090b] px-3 py-2 text-[12px] leading-5 text-zinc-100 outline-none focus:border-amber-500";
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
          <Button variant="secondary" size="sm" className="h-8 border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800" onClick={save}>
            <Save className="h-3.5 w-3.5" />
            保存分镜
          </Button>
          <Button variant="ghost" size="sm" className="h-8 text-indigo-300 hover:bg-indigo-500/10 hover:text-indigo-100" onClick={() => onAddSceneNode(draft, 0)}>
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
            <textarea className={`${fieldClass} min-h-[96px] resize-y`} value={draft.visualPrompt ?? ''} onChange={(event) => update({ visualPrompt: event.target.value })} />
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

function CharacterPropPickerPanel({
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
        <div className="mt-3 rounded-md border border-dashed border-zinc-800 bg-[#09090b] px-3 py-3 text-[12px] text-zinc-500">
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
                  "group overflow-hidden rounded-md border bg-[#09090b] text-left transition-colors",
                  bound ? "border-orange-400 bg-orange-500/10" : "border-zinc-800 hover:border-orange-500/50",
                  busy && "cursor-wait opacity-70"
                )}
                disabled={busy}
                onClick={() => onSaveBinding(character, prop, !bound)}
              >
                <div className="relative aspect-square bg-zinc-950">
                  {imageUrl ? (
                    <img src={imageUrl} alt={propName} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-zinc-600">
                      <Package className="h-5 w-5" />
                    </div>
                  )}
                  <span className={cn(
                    "absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded border text-[10px]",
                    bound ? "border-orange-300 bg-orange-400 text-black" : "border-zinc-700 bg-black/60 text-zinc-400"
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
        <textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder={`自定义道具版提示词，例如：让 ${characterName} 自然拿着已选道具，保持当前角色脸型和服装。`}
          className="min-h-[84px] w-full resize-y rounded-md border border-zinc-800 bg-[#09090b] px-3 py-2 text-[12px] leading-5 text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-orange-500"
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

function AssetMiniList({
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
  if (items.length === 0) {
    return <div className="mt-3 rounded-md border border-dashed border-zinc-800 px-3 py-2 text-[12px] text-zinc-500">{emptyText}</div>;
  }

  return (
    <div className="mt-3 space-y-2">
      {items.map((item, index) => {
        const currentImageUrl = normalizeReusableImageSource(item.referenceImageUrl || item.generatedImageUrl || '');
        const generating = Boolean(isGenerationBusy?.(item));
        const uploading = Boolean(isUploadBusy?.(item));
        const propPickerOpen = Boolean(
          assetKind === 'characters' &&
          propPickerCharacter &&
          normalizeCompareText(workflowAssetName(propPickerCharacter)) === normalizeCompareText(workflowAssetName(item))
        );

        return (
        <div key={item.id ?? `${item.name}-${index}`} className="rounded-md border border-zinc-800 bg-[#09090b] px-3 py-2">
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
                <img
                  src={currentImageUrl}
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
                <span className="pointer-events-none absolute inset-0 hidden items-center justify-center bg-black/35 text-[10px] text-zinc-100 group-hover:flex">
                  预览
                </span>
              </button>
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-[12px] font-medium text-zinc-100">{item.name || `资产 ${index + 1}`}</div>
                {(item.role || item.timeOfDay || item.referenceAnalysisStatus) && (
                  <Badge className="shrink-0 border border-zinc-700 bg-zinc-900 text-[10px] text-zinc-400 hover:bg-zinc-900">
                    {item.referenceAnalysisStatus === 'succeeded' ? '已识图' : item.role || item.timeOfDay || item.referenceAnalysisStatus}
                  </Badge>
                )}
              </div>

              {(item.description || item.lockedVisualIdentity || item.visualPrompt) && (
                <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">
                  {item.lockedVisualIdentity || item.description || item.visualPrompt}
                </div>
              )}
              {assetKind === 'characters' ? (
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-500">
                  <Mic className={cn("h-3 w-3", item.referenceAudioUrl ? "text-emerald-300" : "text-zinc-600")} />
                  <span className="truncate">{item.referenceAudioUrl ? (item.voiceReferenceFileName || '已有角色音频参考') : '未上传角色音频参考'}</span>
                </div>
              ) : null}

              <div className="mt-2 flex flex-wrap gap-1.5">
                {onGenerateImage && item.name ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11px] text-violet-300 hover:bg-violet-500/10 hover:text-violet-100"
                    disabled={generationDisabled || generating}
                    onClick={() => onGenerateImage(item)}
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
                    className="h-7 px-2 text-[11px] text-sky-300 hover:bg-sky-500/10 hover:text-sky-100"
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
                    className="h-7 px-2 text-[11px] text-amber-300 hover:bg-amber-500/10 hover:text-amber-100"
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
                      "h-7 px-2 text-[11px] text-orange-300 hover:bg-orange-500/10 hover:text-orange-100",
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
                    className="h-7 px-2 text-[11px] text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-100"
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
                    className="h-7 px-2 text-[11px] text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-100"
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
                    className="h-7 px-2 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
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
                    className="h-7 px-2 text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
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
                    className="h-7 px-2 text-[11px] text-amber-300 hover:bg-amber-500/10 hover:text-amber-100"
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
                    className="h-7 px-2 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
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
                    className="h-7 px-2 text-[11px] text-red-300 hover:bg-red-500/10 hover:text-red-100"
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
    </div>
  );
}

function StageWorkPanel({
  activeStage,
  sourceReady,
  activeEpisodeId,
  scenes,
  clips,
  assets,
  selectedEpisode,
  workflowModels,
  workflowAiModelId,
  setWorkflowAiModelId,
  finalizeClipStoryboardPrompt,
  workflowModelsLoading,
  workflowModelError,
  runBreakdown,
  rerunStoryboard,
  inferBoardsAndVideoToCanvas,
  onSyncEpisodeBoardsToCanvas,
  setActiveStage,
  onAddWorkflowNode,
  onAddSceneNode,
  onAddClipStoryboardNode,
  onAddClipStoryboardImageReferenceNode,
  onAddClipVideoNode,
  onUpdateClipStoryboard,
  onDeleteScene,
  onEditScene,
  onAcceptClip,
  onOptimizeClip,
  onGenerateClipSeedancePrompt,
  onUploadAssetReference,
  onUploadAudioReference,
  onClearAudioReference,
  onBatchUploadCharacterAudioReferences,
  onOpenProjectGlobalSettings,
  onOpenCharacterPropPicker,
  onGenerateAssetImage,
  onOpenAssetHistory,
  onLoadAssetHistoryImages,
  onPreviewAssetImage,
  onAddAssetToCanvas,
  onClearAssetCurrentImage,
  onRemoveAsset,
  isAssetUploadBusy,
  isAssetGenerationBusy,
  optimizingClipId,
  generatingSeedanceClipId,
  inferBoardsAndVideoRunning,
  workflowBusy,
  storyboardImageRefs,
}: StageWorkPanelProps) {
  if (activeStage === 'assets') {
    return (
      <div className="space-y-4">
        <section className="rounded-lg border border-zinc-800 bg-[#141416] p-4">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[14px] font-semibold text-zinc-100">
                <Boxes className="h-4 w-4 text-emerald-300" />
                场景角色道具
              </div>
              <p className="mt-1 text-[12px] text-zinc-500">从当前集文本里提取角色、场景、道具，并进入资产区确认。</p>
            </div>
            <Button
              size="sm"
              className="h-8 bg-emerald-500 text-black hover:bg-emerald-400"
              disabled={!sourceReady}
              onClick={() => onAddWorkflowNode('asset', '资产提取任务', `${selectedEpisode} 的角色、场景、道具提取任务`)}
            >
              <Wand2 className="h-3.5 w-3.5" />
              创建资产提取任务
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
              disabled={workflowBusy}
              onClick={() => void onLoadAssetHistoryImages('all')}
            >
              <ImageIcon className="h-3.5 w-3.5" />
              一键加载历史图
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
              disabled={workflowBusy || assetArray(assets, 'characters').length === 0}
              onClick={onBatchUploadCharacterAudioReferences}
              title="一次选择 1-5 音频：1 Bob，2 Chloe，3 Leo，4 Tiffany，5 Eugene"
            >
              <Mic className="h-3.5 w-3.5" />
              批量上传角色音频
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {assetGroups.map((item) => {
              const Icon = item.icon;
              const items = assetArray(assets, item.key);
              return (
                <div
                  key={item.title}
                  className="rounded-lg border border-zinc-800 bg-[#0d0d0f] p-4 text-left"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-200">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="text-[13px] font-semibold text-zinc-100">{item.title}</div>
                      <div className="mt-1 text-[12px] leading-5 text-zinc-500">{item.desc}</div>
                    </div>
                    <Badge className="border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/10">
                      {items.length}
                    </Badge>
                  </div>
                  <AssetMiniList
                    assetKind={item.key}
                    items={items}
                    emptyText="还没有提取结果。运行 AI 智能拆解后会在这里显示。"
                    onUploadReference={(asset) => onUploadAssetReference(item.key, asset)}
                    onUploadAudioReference={item.key === 'characters' ? onUploadAudioReference : undefined}
                    onClearAudioReference={item.key === 'characters' ? onClearAudioReference : undefined}
                    onOpenCharacterPropPicker={item.key === 'characters' ? onOpenCharacterPropPicker : undefined}
                    onGenerateImage={(asset) => onGenerateAssetImage(item.key, asset)}
                    onOpenHistory={(asset, variantFilter) => onOpenAssetHistory(item.key, asset, variantFilter)}
                    onPreviewImage={onPreviewAssetImage}
                    onAddToCanvas={onAddAssetToCanvas}
                    onClearCurrentImage={(asset) => void onClearAssetCurrentImage(item.key, asset)}
                    onRemoveAsset={onRemoveAsset}
                    isUploadBusy={(asset) => isAssetUploadBusy(item.key, asset)}
                    isGenerationBusy={(asset) => isAssetGenerationBusy(item.key, asset)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-3 mr-2 h-7 text-[11px] text-sky-300 hover:bg-sky-500/10 hover:text-sky-100"
                    disabled={workflowBusy || items.length === 0}
                    onClick={() => void onLoadAssetHistoryImages(item.key)}
                  >
                    <ImageIcon className="h-3.5 w-3.5" />
                    加载历史图
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-3 h-7 text-[11px] text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-100"
                    onClick={() => onAddWorkflowNode('asset', item.title, `${item.desc} · 已提取 ${items.length} 个`)}
                  >
                    放入画布
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    );
  }

  if (activeStage === 'storyboard') {
    return (
      <div className="space-y-4">
        <section className="rounded-lg border border-zinc-800 bg-[#141416]">
          <div className="flex flex-col gap-3 border-b border-zinc-800 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[14px] font-semibold text-zinc-100">
                <ListChecks className="h-4 w-4 text-amber-300" />
                {clips.length > 0 ? 'Clip-First 分镜脚本' : '分镜脚本'}
              </div>
              <p className="mt-1 text-[12px] text-zinc-500">
                {clips.length > 0 ? '按 Clip 控制剧情目标、时长、风险和包含分镜。' : '把当前集拆成镜头、对白、动作、时长和导演板输入。'}
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[240px]">
                <label className="mb-1 block text-[11px] text-zinc-500">分镜脚本文本模型</label>
                <select
                  value={workflowAiModelId}
                  onChange={(event) => setWorkflowAiModelId(event.target.value)}
                  disabled={workflowModelsLoading || workflowBusy || workflowModels.length === 0}
                  className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-[12px] text-zinc-100 outline-none focus:border-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">{workflowModelsLoading ? '加载模型中...' : '使用后端默认文本模型'}</option>
                  {workflowModels.map((model) => (
                    <option key={model.id} value={model.id}>{modelOptionLabel(model)}</option>
                  ))}
                </select>
                {workflowModelError ? <div className="mt-1 text-[10px] text-red-300">{workflowModelError}</div> : null}
              </div>
              <Button variant="secondary" size="sm" className="h-8 border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800" onClick={() => setActiveStage('source')}>
                返回原文
              </Button>
              <Button size="sm" className="h-8 bg-amber-500 text-black hover:bg-amber-400" disabled={!sourceReady || workflowBusy} onClick={rerunStoryboard}>
                <Wand2 className="h-3.5 w-3.5" />
                {workflowBusy ? '拆解中...' : '重新拆解'}
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 bg-sky-500 text-black hover:bg-sky-400"
                disabled={clips.length === 0 || workflowBusy || inferBoardsAndVideoRunning}
                onClick={() => void inferBoardsAndVideoToCanvas()}
              >
                <Clapperboard className="h-3.5 w-3.5" />
                {inferBoardsAndVideoRunning ? '推理并同步中...' : '推理故事板+视频并放入画布'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                disabled={clips.length === 0}
                onClick={() => void onSyncEpisodeBoardsToCanvas()}
              >
                <Layers3 className="h-3.5 w-3.5" />
                同步本集到画布
              </Button>
            </div>
          </div>
          {clips.length > 0 ? (
            <ClipStoryboardList
              clips={clips}
              scenes={scenes}
              assets={assets}
              activeEpisodeId={activeEpisodeId}
              storyboardImageRefs={storyboardImageRefs}
              workflowAiModelId={workflowAiModelId}
              finalizeClipStoryboardPrompt={finalizeClipStoryboardPrompt}
              onAddSceneNode={onAddSceneNode}
              onAddClipStoryboardNode={onAddClipStoryboardNode}
              onAddClipStoryboardImageReferenceNode={onAddClipStoryboardImageReferenceNode}
              onUpdateClipStoryboard={onUpdateClipStoryboard}
              onSyncEpisodeBoardsToCanvas={onSyncEpisodeBoardsToCanvas}
              onEditScene={onEditScene}
              onDeleteScene={onDeleteScene}
              onAcceptClip={onAcceptClip}
              onOptimizeClip={onOptimizeClip}
              optimizingClipId={optimizingClipId}
              workflowBusy={workflowBusy}
            />
          ) : (
            <StoryboardSceneList
              scenes={scenes}
              onAddSceneNode={onAddSceneNode}
              onEditScene={onEditScene}
              onDeleteScene={onDeleteScene}
              emptyTitle="还没有分镜脚本"
              emptyDescription="先导入小说/剧本，再点击 AI智能拆解。"
            />
          )}
        </section>
      </div>
    );
  }

  if (activeStage === 'video') {
    return (
      <div className="space-y-4">
        <section className="rounded-lg border border-zinc-800 bg-[#141416]">
          <div className="flex flex-col gap-3 border-b border-zinc-800 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[14px] font-semibold text-zinc-100">
                <Film className="h-4 w-4 text-sky-300" />
                分镜视频提示词
              </div>
              <p className="mt-1 text-[12px] text-zinc-500">按 Clip 生成 Seedance 视频提示词；放入画布时优先接入已生成故事板、角色和场景参考，最多 9 张，道具有余量时再接入。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" className="h-8 border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800" onClick={() => setActiveStage('storyboard')}>
                返回分镜
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 bg-sky-500 text-black hover:bg-sky-400"
                disabled={clips.length === 0 || workflowBusy || inferBoardsAndVideoRunning}
                onClick={() => void inferBoardsAndVideoToCanvas()}
              >
                <Clapperboard className="h-3.5 w-3.5" />
                {inferBoardsAndVideoRunning ? '推理并同步中...' : '推理故事板+视频并放入画布'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                disabled={clips.length === 0}
                onClick={() => void onSyncEpisodeBoardsToCanvas()}
              >
                <Layers3 className="h-3.5 w-3.5" />
                同步本集到画布
              </Button>
            </div>
          </div>
          <ClipVideoPromptList
            clips={clips}
            scenes={scenes}
            assets={assets}
            activeEpisodeId={activeEpisodeId}
            workflowModels={workflowModels}
            workflowAiModelId={workflowAiModelId}
            setWorkflowAiModelId={setWorkflowAiModelId}
            workflowModelsLoading={workflowModelsLoading}
            workflowModelError={workflowModelError}
            onAddClipVideoNode={onAddClipVideoNode}
            onGenerateClipSeedancePrompt={onGenerateClipSeedancePrompt}
            onSyncEpisodeBoardsToCanvas={onSyncEpisodeBoardsToCanvas}
            generatingSeedanceClipId={generatingSeedanceClipId}
            workflowBusy={workflowBusy}
          />
        </section>
      </div>
    );
  }

  const stageCards: Record<Exclude<WorkflowStageKey, 'source' | 'assets' | 'storyboard' | 'video'>, Array<{ title: string; desc: string; icon: React.ElementType; nodeType: CanvasNodeKind }>> = {
    voice: [
      { title: '台词整理', desc: '从分镜脚本提取对白、旁白和字幕', icon: FileText, nodeType: 'workflow' },
      { title: '配音任务', desc: '按角色音色生成配音音频', icon: Sparkles, nodeType: 'workflow' },
      { title: '口型与字幕', desc: '把音频、字幕和视频片段对齐', icon: Film, nodeType: 'workflow' },
    ],
    preview: [
      { title: '镜头缺失检查', desc: '检查视频、音频、字幕和参考图是否缺失', icon: CheckCircle2, nodeType: 'workflow' },
      { title: '快速拼接', desc: '临时拼接片段用于预览节奏', icon: Film, nodeType: 'workflow' },
      { title: '问题回修', desc: '定位需要重绘、重配音或重生成的视频', icon: RotateCcw, nodeType: 'workflow' },
    ],
    edit: [
      { title: '剪辑时间线', desc: '把视频、音频、字幕推入剪辑区', icon: Film, nodeType: 'workflow' },
      { title: '导出检查', desc: '检查画幅、音量、字幕和片尾', icon: Download, nodeType: 'workflow' },
      { title: '发布资产包', desc: '整理导出记录和复用素材', icon: Package, nodeType: 'asset' },
    ],
  };

  const titleMap: Record<Exclude<WorkflowStageKey, 'source' | 'assets' | 'storyboard' | 'video'>, string> = {
    voice: '配音对口型',
    preview: '视频预览',
    edit: '后期剪辑',
  };

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-zinc-800 bg-[#141416] p-4">
        <div className="mb-4">
          <div className="text-[14px] font-semibold text-zinc-100">{titleMap[activeStage]}</div>
          <p className="mt-1 text-[12px] text-zinc-500">这里是当前阶段的操作区。真实生产 API 接入后，任务进度和结果会在这里显示。</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {stageCards[activeStage].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.title}
                type="button"
                onClick={() => onAddWorkflowNode(item.nodeType, item.title, item.desc)}
                className="rounded-lg border border-zinc-800 bg-[#0d0d0f] p-4 text-left transition-colors hover:border-amber-500/50"
              >
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-amber-500/10 text-amber-200">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="text-[13px] font-semibold text-zinc-100">{item.title}</div>
                <div className="mt-1 text-[12px] leading-5 text-zinc-500">{item.desc}</div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function WorkflowCenterOverlay({
  activeStage,
  setActiveStage,
  sourceText,
  setSourceText,
  sourceName,
  setSourceName,
  selectedEpisode,
  setSelectedEpisode,
  episodeList,
  activeEpisodeId,
  activeEpisodeSummary,
  episodeSwitching,
  episodeCreating,
  onSelectEpisode,
  onCreateNextEpisode,
  scenes,
  clips,
  assets,
  stageStatuses,
  workflowLoading,
  workflowSaving,
  workflowRunning,
  workflowError,
  workflowModels,
  workflowAiModelId,
  setWorkflowAiModelId,
  finalizeClipStoryboardPrompt,
  workflowModelsLoading,
  workflowModelError,
  runBreakdown,
  rerunStoryboard,
  inferBoardsAndVideoToCanvas,
  onSyncEpisodeBoardsToCanvas,
  onClose,
  onUploadClick,
  onAddWorkflowNode,
  onAddSceneNode,
  onAddClipStoryboardNode,
  onAddClipStoryboardImageReferenceNode,
  onAddClipVideoNode,
  onUpdateClipStoryboard,
  onUpdateScene,
  onDeleteScene,
  onAcceptClip,
  onOptimizeClip,
  onGenerateClipSeedancePrompt,
  onUploadAssetReference,
  onUploadAudioReference,
  onClearAudioReference,
  onBatchUploadCharacterAudioReferences,
  onOpenProjectGlobalSettings,
  onOpenCharacterPropPicker,
  onGenerateAssetImage,
  onOpenAssetHistory,
  onLoadAssetHistoryImages,
  onPreviewAssetImage,
  onAddAssetToCanvas,
  onClearAssetCurrentImage,
  onRemoveAsset,
  isAssetUploadBusy,
  isAssetGenerationBusy,
  optimizingClipId,
  generatingSeedanceClipId,
  inferBoardsAndVideoRunning,
  storyboardImageRefs,
}: WorkflowCenterOverlayProps) {
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const imported = sourceText.trim().length > 0;
  const hasBreakdown = scenes.length > 0;
  const hasStoryboard = hasBreakdown || clips.length > 0;
  const assetTotal = assetArray(assets, 'characters').length + assetArray(assets, 'scenes').length + assetArray(assets, 'props').length;
  const workflowBusy = workflowRunning || inferBoardsAndVideoRunning || workflowHasRunningStage(stageStatuses);
  const stageStatus = useMemo(() => {
    const status: Record<WorkflowStageKey, 'done' | 'current' | 'pending'> = {
      source: imported ? 'done' : 'current',
      assets: hasStoryboard ? 'done' : imported ? 'current' : 'pending',
      storyboard: hasStoryboard ? 'done' : 'pending',
      video: 'pending',
      voice: 'pending',
      preview: 'pending',
      edit: 'pending',
    };
    for (const stage of workflowStages) {
      const remote = stageStatuses[stage.key];
      if (remote === 'done') status[stage.key] = 'done';
      if (remote === 'running') status[stage.key] = 'current';
    }
    status[activeStage] = status[activeStage] === 'done' ? 'done' : 'current';
    return status;
  }, [activeStage, hasStoryboard, imported, stageStatuses]);

  const sourceStats = useMemo(() => {
    const text = sourceText.trim();
    const chars = text.length;
    const paragraphs = text ? text.split(/\n\s*\n/).filter((item) => item.trim()).length : 0;
    const estimatedScenes = Math.max(0, Math.min(24, Math.ceil(chars / 420)));
    return { chars, paragraphs, estimatedScenes };
  }, [sourceText]);
  const activeStageInfo = workflowStages.find((stage) => stage.key === activeStage) ?? workflowStages[0];
  const editingScene = editingSceneId ? scenes.find((scene) => scene.id === editingSceneId) : undefined;

  useEffect(() => {
    if (editingSceneId && !scenes.some((scene) => scene.id === editingSceneId)) {
      setEditingSceneId(null);
    }
  }, [editingSceneId, scenes]);

  return (
    <div className="absolute inset-3 left-16 z-30 flex min-h-0 overflow-hidden rounded-lg border border-zinc-800 bg-[#0d0d0f]/95 shadow-2xl backdrop-blur">
      <aside className="hidden w-[230px] shrink-0 border-r border-zinc-800 bg-[#111113] p-4 md:block">
        <div className="mb-5 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-500/10 text-amber-300">
            <PanelLeft className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-zinc-100">流程中心</div>
            <div className="text-[11px] text-zinc-500">多集生产工作台</div>
          </div>
        </div>

        <div className="space-y-2">
          {workflowStages.map((stage) => {
            const active = activeStage === stage.key;
            const status = stageStatus[stage.key];
            return (
              <button
                key={stage.key}
                type="button"
                onClick={() => setActiveStage(stage.key)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                  active
                    ? "border-amber-500/70 bg-amber-500/10"
                    : "border-transparent bg-transparent hover:border-zinc-800 hover:bg-[#18181b]"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                    status === 'done'
                      ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                      : status === 'current'
                        ? "border-amber-500 bg-amber-500/15 text-amber-300"
                        : "border-zinc-700 text-zinc-500"
                  )}
                >
                  {status === 'done' ? <CheckCircle2 className="h-3.5 w-3.5" /> : stage.num}
                </span>
                <span className="min-w-0">
                  <span className={cn("block text-[13px] font-medium", active ? "text-zinc-50" : "text-zinc-300")}>{stage.title}</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-zinc-500">{stage.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Production Flow</span>
              <Badge className="border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/10">
                {workflowLoading ? '加载中' : workflowBusy ? '拆解中' : workflowSaving ? '保存中' : sourceName ? '已保存' : '等待导入'}
              </Badge>
            </div>
            <div className="mt-1 truncate text-[15px] font-semibold text-zinc-100">{selectedEpisode} · {activeStageInfo.title}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="hidden h-8 bg-sky-500 text-black hover:bg-sky-400 sm:inline-flex"
              disabled={clips.length === 0 || workflowBusy}
              onClick={() => void inferBoardsAndVideoToCanvas()}
            >
              <Clapperboard className="h-3.5 w-3.5" />
              {inferBoardsAndVideoRunning ? '推理并同步中...' : '一键推理并放入画布'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="hidden h-8 text-zinc-400 hover:text-zinc-100 sm:inline-flex"
              onClick={() => onAddWorkflowNode('episode', selectedEpisode, '章节原文、资产、分镜和导演板的生产容器')}
            >
              放入章节节点
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-500 hover:text-zinc-100" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-h-0 overflow-y-auto p-4">
            {editingScene ? (
              <StoryboardSceneEditor
                scene={editingScene}
                selectedEpisode={selectedEpisode}
                onBack={() => setEditingSceneId(null)}
                onSave={(scene) => {
                  onUpdateScene(scene);
                  setEditingSceneId(scene.id);
                }}
                onDelete={onDeleteScene}
                onAddSceneNode={onAddSceneNode}
              />
            ) : activeStage === 'source' ? (
              <>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <section className="rounded-lg border border-zinc-800 bg-[#141416]">
                <div className="flex flex-col gap-3 border-b border-zinc-800 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-[14px] font-semibold text-zinc-100">
                      <FileText className="h-4 w-4 text-amber-300" />
                      原文导入
                    </div>
                    <p className="mt-1 text-[12px] text-zinc-500">先放入小说、短剧剧本或章节文本，再进入资产和分镜拆解。</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" className="h-8 border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800" onClick={onUploadClick}>
                      <UploadCloud className="h-3.5 w-3.5" />
                      导入文本
                    </Button>
                    <Button
                      size="sm"
                      className="h-8 bg-amber-500 text-black hover:bg-amber-400"
                      onClick={runBreakdown}
                      disabled={!imported || workflowBusy}
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      {workflowBusy ? '拆解中...' : 'AI智能拆解'}
                    </Button>
                  </div>
                </div>
                {workflowError && (
                  <div className="mx-4 mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] leading-5 text-red-200">
                    {workflowError}
                  </div>
                )}

                <div className="grid gap-4 p-4 lg:grid-cols-[180px_minmax(0,1fr)]">
                  <div className="space-y-3">
                    <div>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <label className="block text-[12px] font-medium text-zinc-400">当前集</label>
                        <button
                          type="button"
                          className="text-[11px] text-amber-300 hover:text-amber-100 disabled:cursor-not-allowed disabled:text-zinc-600"
                          disabled={episodeCreating || episodeSwitching || workflowBusy}
                          onClick={onCreateNextEpisode}
                        >
                          {episodeCreating ? '新增中...' : '新增下一集'}
                        </button>
                      </div>
                      <select
                        value={activeEpisodeId}
                        onChange={(event) => onSelectEpisode(event.target.value)}
                        disabled={episodeSwitching || workflowBusy}
                        className="h-9 w-full rounded-md border border-zinc-800 bg-[#0d0d0f] px-3 text-[13px] text-zinc-100 outline-none focus:border-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {episodeList.episodes.map((episode) => (
                          <option key={episode.id} value={episode.id}>
                            {episode.title || episode.selectedEpisode}
                          </option>
                        ))}
                      </select>
                      <input
                        value={selectedEpisode}
                        onChange={(event) => setSelectedEpisode(event.target.value)}
                        className="mt-2 h-9 w-full rounded-md border border-zinc-800 bg-[#0d0d0f] px-3 text-[13px] text-zinc-100 outline-none focus:border-amber-500"
                      />
                      <p className="mt-1 text-[11px] leading-4 text-zinc-500">
                        {episodeSwitching ? '正在切换剧集工作区...' : `画布：${activeEpisodeSummary?.canvasSceneId || activeEpisodeId}`}
                      </p>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">文件名</label>
                      <input
                        value={sourceName}
                        onChange={(event) => setSourceName(event.target.value)}
                        placeholder="可直接粘贴文本"
                        className="h-9 w-full rounded-md border border-zinc-800 bg-[#0d0d0f] px-3 text-[13px] text-zinc-100 outline-none focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">分镜推理文本模型</label>
                      <select
                        value={workflowAiModelId}
                        onChange={(event) => setWorkflowAiModelId(event.target.value)}
                        disabled={workflowModelsLoading || workflowBusy || workflowModels.length === 0}
                        className="h-9 w-full rounded-md border border-zinc-800 bg-[#0d0d0f] px-3 text-[13px] text-zinc-100 outline-none focus:border-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <option value="">{workflowModelsLoading ? '加载模型中...' : '使用后端默认文本模型'}</option>
                        {workflowModels.map((model) => (
                          <option key={model.id} value={model.id}>
                            {modelOptionLabel(model)}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-[11px] leading-4 text-zinc-500">
                        这里只用于资产文本提取和 Clip/分镜脚本推理；DeepSeek 不能识图也不影响这个文本流程。
                      </p>
                      {workflowModelError && (
                        <p className="mt-1 text-[11px] leading-4 text-red-300">{workflowModelError}</p>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-md border border-zinc-800 bg-[#0d0d0f] p-3">
                        <div className="text-[18px] font-semibold text-zinc-100">{sourceStats.chars}</div>
                        <div className="text-[11px] text-zinc-500">字符</div>
                      </div>
                      <div className="rounded-md border border-zinc-800 bg-[#0d0d0f] p-3">
                        <div className="text-[18px] font-semibold text-zinc-100">{sourceStats.estimatedScenes}</div>
                        <div className="text-[11px] text-zinc-500">预估段落</div>
                      </div>
                    </div>
                  </div>

                  <textarea
                    value={sourceText}
                    onChange={(event) => setSourceText(event.target.value)}
                    placeholder="粘贴小说或剧本文本。建议按章节、场景或自然段分隔，后续会从这里提取角色、场景、道具，再拆分分镜脚本和导演板。"
                    className="min-h-[280px] resize-none rounded-md border border-zinc-800 bg-[#09090b] p-3 font-mono text-[12px] leading-5 text-zinc-200 outline-none focus:border-amber-500"
                  />
                </div>
              </section>

              <section className="rounded-lg border border-zinc-800 bg-[#141416] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-[14px] font-semibold text-zinc-100">生产流程概览</div>
                  <Badge className="border border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-900">自动执行</Badge>
                </div>
                <div className="space-y-2">
                  {workflowSteps.map((item, index) => (
                    <div
                      key={item.key}
                      className="flex w-full items-center justify-between rounded-md border border-zinc-800 bg-[#0d0d0f] p-3 text-left"
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-100">
                          <span className="flex h-5 w-5 items-center justify-center rounded bg-zinc-900 text-[10px] text-zinc-500">{index + 1}</span>
                          {item.title}
                        </span>
                        <span className="mt-1 block text-[11px] leading-4 text-zinc-500">{item.desc}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <section className="mt-4 rounded-lg border border-zinc-800 bg-[#141416] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-[14px] font-semibold text-zinc-100">拆解结果</div>
                  <p className="mt-1 text-[12px] text-zinc-500">
                    {hasStoryboard
                      ? `已生成 ${clips.length ? `${clips.length} 个 Clip、` : ''}${scenes.length} 条分镜脚本，进入左侧第 03 阶段查看、编辑或删除。`
                      : 'AI智能拆解完成后会进入左侧第 03 阶段生成分镜脚本。'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                    onClick={() => setActiveStage('storyboard')}
                    disabled={!hasStoryboard}
                  >
                    进入分镜脚本
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-indigo-300 hover:bg-indigo-500/10 hover:text-indigo-100"
                    onClick={() => scenes.forEach((scene, index) => onAddSceneNode(scene, index))}
                    disabled={!hasBreakdown}
                  >
                    全部放入画布
                  </Button>
                </div>
              </div>
            </section>
              </>
            ) : (
              <StageWorkPanel
                activeStage={activeStage}
                sourceReady={imported}
                activeEpisodeId={activeEpisodeId}
                scenes={scenes}
                clips={clips}
                assets={assets}
                selectedEpisode={selectedEpisode}
                workflowModels={workflowModels}
                workflowAiModelId={workflowAiModelId}
                setWorkflowAiModelId={setWorkflowAiModelId}
                workflowModelsLoading={workflowModelsLoading}
                workflowModelError={workflowModelError}
                runBreakdown={runBreakdown}
                rerunStoryboard={rerunStoryboard}
                inferBoardsAndVideoToCanvas={inferBoardsAndVideoToCanvas}
                onSyncEpisodeBoardsToCanvas={onSyncEpisodeBoardsToCanvas}
                setActiveStage={setActiveStage}
                onAddWorkflowNode={onAddWorkflowNode}
                onAddSceneNode={onAddSceneNode}
                onAddClipStoryboardNode={onAddClipStoryboardNode}
                onAddClipStoryboardImageReferenceNode={onAddClipStoryboardImageReferenceNode}
                onAddClipVideoNode={onAddClipVideoNode}
                onUpdateClipStoryboard={onUpdateClipStoryboard}
                onDeleteScene={onDeleteScene}
                onEditScene={setEditingSceneId}
                onAcceptClip={onAcceptClip}
                onOptimizeClip={onOptimizeClip}
                onGenerateClipSeedancePrompt={onGenerateClipSeedancePrompt}
                onUploadAssetReference={onUploadAssetReference}
                onUploadAudioReference={onUploadAudioReference}
                onClearAudioReference={onClearAudioReference}
                onBatchUploadCharacterAudioReferences={onBatchUploadCharacterAudioReferences}
                onOpenProjectGlobalSettings={onOpenProjectGlobalSettings}
                onOpenCharacterPropPicker={onOpenCharacterPropPicker}
                onGenerateAssetImage={onGenerateAssetImage}
                onOpenAssetHistory={onOpenAssetHistory}
                onLoadAssetHistoryImages={onLoadAssetHistoryImages}
                onPreviewAssetImage={onPreviewAssetImage}
                onAddAssetToCanvas={onAddAssetToCanvas}
                onClearAssetCurrentImage={onClearAssetCurrentImage}
                onRemoveAsset={onRemoveAsset}
                isAssetUploadBusy={isAssetUploadBusy}
                isAssetGenerationBusy={isAssetGenerationBusy}
                optimizingClipId={optimizingClipId}
                generatingSeedanceClipId={generatingSeedanceClipId}
                inferBoardsAndVideoRunning={inferBoardsAndVideoRunning}
                workflowBusy={workflowBusy}
                storyboardImageRefs={storyboardImageRefs}
              />
            )}
          </div>

          <aside className="hidden min-h-0 overflow-y-auto border-l border-zinc-800 bg-[#111113] p-4 lg:block">
            <div className="mb-4">
              <div className="text-[13px] font-semibold text-zinc-100">项目流转状态</div>
              <div className="mt-1 text-[12px] text-zinc-500">按集处理，避免多集上下文互相污染。</div>
            </div>
            <div className="space-y-2">
              {[
                ['当前集', selectedEpisode],
                ['工作区', activeEpisodeSummary?.canvasSceneId || activeEpisodeId],
                ['文本段落', `${sourceStats.paragraphs}`],
                ['Clips', `${clips.length}`],
                ['分镜脚本', `${scenes.length}`],
                ['资产状态', assetTotal > 0 ? `${assetTotal} 个` : workflowBusy ? '提取中' : '未提取'],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between rounded-md border border-zinc-800 bg-[#0d0d0f] px-3 py-2">
                  <span className="text-[12px] text-zinc-500">{label}</span>
                  <span className="max-w-[160px] truncate text-[12px] font-medium text-zinc-100">{value}</span>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="text-[12px] font-medium text-amber-200">全局设定</div>
              <p className="mt-2 text-[12px] leading-5 text-amber-100/70">
                本项目的资产、分镜、故事板和视频提示词推理都会读取项目全局设定。
              </p>
              <Button
                type="button"
                size="sm"
                className="mt-3 h-8 w-full bg-amber-500 text-black hover:bg-amber-400"
                onClick={onOpenProjectGlobalSettings}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                编辑全局设定
              </Button>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function ProjectGlobalSettingsModal({
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
                    className="h-9 w-full rounded-md border border-zinc-700 bg-[#09090b] px-3 text-[13px] text-zinc-100 outline-none focus:border-amber-500"
                    value={draft.title}
                    onChange={(event) => onChange({ title: event.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">默认比例</label>
                  <select
                    className="h-9 w-full rounded-md border border-zinc-700 bg-[#09090b] px-3 text-[13px] text-zinc-100 outline-none focus:border-amber-500"
                    value={draft.ratio}
                    onChange={(event) => onChange({ ratio: event.target.value })}
                  >
                    {PROJECT_GLOBAL_RATIO_OPTIONS.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">项目描述</label>
                <textarea
                  className="h-20 w-full resize-none rounded-md border border-zinc-700 bg-[#09090b] px-3 py-2 text-[13px] leading-5 text-zinc-100 outline-none focus:border-amber-500"
                  value={draft.description}
                  onChange={(event) => onChange({ description: event.target.value })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">风格</label>
                  <select
                    className="h-9 w-full rounded-md border border-zinc-700 bg-[#09090b] px-3 text-[13px] text-zinc-100 outline-none focus:border-amber-500"
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
                    className="h-9 w-full rounded-md border border-zinc-700 bg-[#09090b] px-3 text-[13px] text-zinc-100 outline-none focus:border-amber-500"
                    value={draft.generationStrategy}
                    onChange={(event) => onChange({ generationStrategy: event.target.value })}
                  >
                    {PROJECT_GLOBAL_GENERATION_STRATEGIES.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.title}</option>)}
                  </select>
                </div>
              </div>
              {draft.style === '自定义' ? (
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">自定义风格名称</label>
                  <input
                    className="h-9 w-full rounded-md border border-zinc-700 bg-[#09090b] px-3 text-[13px] text-zinc-100 outline-none focus:border-amber-500"
                    value={draft.customStyleName}
                    onChange={(event) => onChange({ customStyleName: event.target.value })}
                    placeholder="例如：高饱和 3D 美漫黑色幽默"
                  />
                </div>
              ) : null}
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">风格补充</label>
                <textarea
                  className="h-24 w-full resize-none rounded-md border border-zinc-700 bg-[#09090b] px-3 py-2 text-[13px] leading-5 text-zinc-100 outline-none focus:border-amber-500"
                  value={draft.customStylePrompt}
                  onChange={(event) => onChange({ customStylePrompt: event.target.value })}
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
                  <textarea
                    className="h-24 w-full resize-none rounded-md border border-zinc-700 bg-[#09090b] px-3 py-2 text-[13px] leading-5 text-zinc-100 outline-none focus:border-amber-500"
                    value={draft.projectTone}
                    onChange={(event) => onChange({ projectTone: event.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">导演人工指导</label>
                  <textarea
                    className="h-24 w-full resize-none rounded-md border border-zinc-700 bg-[#09090b] px-3 py-2 text-[13px] leading-5 text-zinc-100 outline-none focus:border-amber-500"
                    value={draft.directorNotes}
                    onChange={(event) => onChange({ directorNotes: event.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">角色身份约束</label>
                  <textarea
                    className="h-24 w-full resize-none rounded-md border border-zinc-700 bg-[#09090b] px-3 py-2 text-[13px] leading-5 text-zinc-100 outline-none focus:border-amber-500"
                    value={draft.characterIdentityRules}
                    onChange={(event) => onChange({ characterIdentityRules: event.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">负面约束</label>
                  <textarea
                    className="h-24 w-full resize-none rounded-md border border-zinc-700 bg-[#09090b] px-3 py-2 font-mono text-[12px] leading-5 text-zinc-100 outline-none focus:border-amber-500"
                    value={draft.negativePrompt}
                    onChange={(event) => onChange({ negativePrompt: event.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">全局画面提示词</label>
                <textarea
                  className="h-28 w-full resize-y rounded-md border border-zinc-700 bg-[#09090b] px-3 py-2 font-mono text-[12px] leading-5 text-zinc-100 outline-none focus:border-amber-500"
                  value={draft.globalPrompt}
                  onChange={(event) => onChange({ globalPrompt: event.target.value })}
                />
              </div>
              <div>
                <div className="mb-2 text-[12px] font-medium text-zinc-400">详细剧本规则</div>
                <div className="grid gap-3 md:grid-cols-2">
                  {PROJECT_SCRIPT_RULE_TEMPLATES.map((rule) => (
                    <div key={rule.id} className="rounded-md border border-zinc-800 bg-[#0d0d0f] p-3">
                      <div className="mb-1.5 text-[12px] font-medium text-zinc-200">{rule.title}</div>
                      <textarea
                        className="h-20 w-full resize-none rounded border border-zinc-800 bg-[#09090b] px-2.5 py-2 text-[12px] leading-5 text-zinc-300 outline-none focus:border-amber-500"
                        value={draft.scriptRules[rule.id] ?? ''}
                        onChange={(event) => onChange({ scriptRules: { ...draft.scriptRules, [rule.id]: event.target.value } })}
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
            <Button type="button" variant="secondary" className="h-8 border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800" onClick={onClose} disabled={saving}>
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

function CanvasInner() {
  const [activePanel, setActivePanel] = useState<'workflow' | 'assets' | 'assetLibrary' | null>('workflow');
  const [activeWorkflowStage, setActiveWorkflowStage] = useState<WorkflowStageKey>('source');
  const [sourceText, setSourceText] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [selectedEpisode, setSelectedEpisode] = useState('第 1 集');
  const [episodeList, setEpisodeList] = useState<WorkflowEpisodeListResponse>(defaultEpisodeList);
  const [activeEpisodeId, setActiveEpisodeId] = useState('episode-001');
  const [episodeSwitching, setEpisodeSwitching] = useState(false);
  const [episodeCreating, setEpisodeCreating] = useState(false);
  const [breakdownScenes, setBreakdownScenes] = useState<BreakdownScene[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [workflowAssets, setWorkflowAssets] = useState<WorkflowAssets>(defaultWorkflowAssets);
  const [stageStatuses, setStageStatuses] = useState<Record<string, string>>({});
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflowSaving, setWorkflowSaving] = useState(false);
  const [workflowRunning, setWorkflowRunning] = useState(false);
  const [workflowInferAllRunning, setWorkflowInferAllRunning] = useState(false);
  const [optimizingClipId, setOptimizingClipId] = useState<string | null>(null);
  const [generatingSeedanceClipId, setGeneratingSeedanceClipId] = useState<string | null>(null);
  const [generationRecords, setGenerationRecords] = useState<GenerationRecord[]>([]);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [workflowModels, setWorkflowModels] = useState<ModelConfig[]>([]);
  const [workflowAiModelId, setWorkflowAiModelId] = useState('');
  const [workflowModelsLoading, setWorkflowModelsLoading] = useState(false);
  const [workflowModelError, setWorkflowModelError] = useState<string | null>(null);
  const [assetImageModels, setAssetImageModels] = useState<ModelConfig[]>([]);
  const [assetGenerationModelId, setAssetGenerationModelId] = useState('');
  const [assetGenerationAspectRatio, setAssetGenerationAspectRatio] = useState('16:9');
  const [assetGenerationResolution, setAssetGenerationResolution] = useState('2k');
  const [assetGenerationBusyKeys, setAssetGenerationBusyKeys] = useState<string[]>([]);
  const [assetGenerationStatus, setAssetGenerationStatus] = useState<string | null>(null);
  const [assetHistoryLoadBusy, setAssetHistoryLoadBusy] = useState(false);
  const [assetHistoryTarget, setAssetHistoryTarget] = useState<AssetHistoryTarget | null>(null);
  const [assetHistoryItems, setAssetHistoryItems] = useState<WorkflowAssetImageHistoryItem[]>([]);
  const [assetHistoryLoading, setAssetHistoryLoading] = useState(false);
  const [assetHistoryStatus, setAssetHistoryStatus] = useState<string | null>(null);
  const [assetImagePreview, setAssetImagePreview] = useState<AssetImagePreview | null>(null);
  const [propPickerCharacter, setPropPickerCharacter] = useState<WorkflowAssetItem | null>(null);
  const [propGenerationPrompt, setPropGenerationPrompt] = useState('');
  const [propBindingBusy, setPropBindingBusy] = useState(false);
  const [propBindingStatus, setPropBindingStatus] = useState<string | null>(null);
  const [assetHistoryVariantFilter, setAssetHistoryVariantFilter] = useState<'all' | 'with-props'>('all');
  const [assetUploadKind, setAssetUploadKind] = useState<WorkflowAssetKind>('characters');
  const [assetUploadName, setAssetUploadName] = useState('');
  const [assetUploadModelId, setAssetUploadModelId] = useState('');
  const [assetUploadBusyKeys, setAssetUploadBusyKeys] = useState<string[]>([]);
  const [assetUploadStatus, setAssetUploadStatus] = useState<string | null>(null);
  const [assetLibraryEpisodeId, setAssetLibraryEpisodeId] = useState<AssetLibraryEpisodeFilter>('all');
  const [assetLibraryCategory, setAssetLibraryCategory] = useState<AssetLibraryCategory>('characters');
  const [assetLibraryBundles, setAssetLibraryBundles] = useState<EpisodeWorkflowAssetBundle[]>([]);
  const [assetLibraryRecords, setAssetLibraryRecords] = useState<GenerationRecord[]>([]);
  const [assetLibraryLoading, setAssetLibraryLoading] = useState(false);
  const [assetLibraryStatus, setAssetLibraryStatus] = useState<string | null>(null);
  const [canvasDropActive, setCanvasDropActive] = useState(false);
  const [canvasDropStatus, setCanvasDropStatus] = useState<string | null>(null);
  const [projectUnavailable, setProjectUnavailable] = useState(false);
  const [workflowDraftProjectId, setWorkflowDraftProjectId] = useState<string | null>(null);
  const sourceFileRef = useRef<HTMLInputElement>(null);
  const canvasImageFileRef = useRef<HTMLInputElement>(null);
  const assetImageFileRef = useRef<HTMLInputElement>(null);
  const assetAudioFileRef = useRef<HTMLInputElement>(null);
  const pendingAssetUploadRef = useRef<{ kind: WorkflowAssetKind; name: string } | null>(null);
  const pendingAudioUploadRef = useRef<{ mode: 'single'; name: string } | { mode: 'batch' } | null>(null);
  const workflowInferAllActiveRequestStartedAtRef = useRef(0);
  const workflowInferAllExpectedClipIdsRef = useRef<string[]>([]);
  const workflowInferAllCompletedClipIdsRef = useRef<Set<string>>(new Set());
  const workflowBreakdownRecoveryRef = useRef<WorkflowBreakdownRecoveryOptions | null>(null);
  const syncEpisodeBoardsToCanvasRef = useRef<((override?: EpisodeCanvasSyncRequest) => Promise<void>) | null>(null);
  const { id: projectId = 'local' } = useParams<{ id: string }>();
  const currentProject = useProjectStore((s) => s.projects.find((project) => project.id === projectId));
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const updateProject = useProjectStore((s) => s.updateProject);
  const projectPromptContext = useMemo(() => compactProjectPromptContext(currentProject), [currentProject]);
  const [projectGlobalSettingsOpen, setProjectGlobalSettingsOpen] = useState(false);
  const [projectGlobalSettingsDraft, setProjectGlobalSettingsDraft] = useState<ProjectGlobalSettingsDraft>(() => createProjectGlobalSettingsDraft());
  const [projectGlobalSettingsSaving, setProjectGlobalSettingsSaving] = useState(false);
  const [projectGlobalSettingsError, setProjectGlobalSettingsError] = useState<string | null>(null);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const canvasLocalRevision = useCanvasStore((s) => s.localRevision);
  const setNodes = useCanvasStore((s) => s.setNodes);
  const setNodesTransient = useCanvasStore((s) => s.setNodesTransient);
  const setEdges = useCanvasStore((s) => s.setEdges);
  const setEdgesTransient = useCanvasStore((s) => s.setEdgesTransient);
  const applyRemoteCanvasScene = useCanvasStore((s) => s.applyRemoteScene);
  const markCanvasNodesDeleted = useCanvasStore((s) => s.markNodesDeleted);
  const loadCanvasScene = useCanvasStore((s) => s.loadScene);
  const saveCanvasScene = useCanvasStore((s) => s.saveScene);
  const addNode = useCanvasStore((s) => s.addNode);
  const onConnect = useCanvasStore((s) => s.onConnect);
  const { fitView, screenToFlowPosition, setNodes: setReactFlowNodes, setEdges: setReactFlowEdges } = useReactFlow();
  const canvasDropStatusTimerRef = useRef<number | null>(null);
  const canvasLoadedRef = useRef(false);
  const canvasAutoNormalizeTransitionRef = useRef('');
  const reactFlowNodeSignatureRef = useRef('');
  const reactFlowEdgeSignatureRef = useRef('');
  const activeCanvasSceneId = useMemo(() => workflowEpisodeCanvasSceneId(activeEpisodeId), [activeEpisodeId]);
  const activeEpisodeSummary = useMemo(
    () => episodeList.episodes.find((episode) => episode.id === activeEpisodeId) ?? episodeList.episodes[0],
    [activeEpisodeId, episodeList.episodes],
  );

  const showCanvasDropStatus = useCallback((message: string) => {
    setCanvasDropStatus(message);
    if (canvasDropStatusTimerRef.current) {
      window.clearTimeout(canvasDropStatusTimerRef.current);
    }
    canvasDropStatusTimerRef.current = window.setTimeout(() => {
      setCanvasDropStatus(null);
      canvasDropStatusTimerRef.current = null;
    }, 3500);
  }, []);

  useEffect(() => {
    if (!projectGlobalSettingsOpen) {
      setProjectGlobalSettingsDraft(createProjectGlobalSettingsDraft(currentProject));
      setProjectGlobalSettingsError(null);
    }
  }, [currentProject, projectGlobalSettingsOpen]);

  const openProjectGlobalSettings = useCallback(() => {
    setProjectGlobalSettingsDraft(createProjectGlobalSettingsDraft(currentProject));
    setProjectGlobalSettingsError(null);
    setProjectGlobalSettingsOpen(true);
  }, [currentProject]);

  const saveProjectGlobalSettings = useCallback(async () => {
    if (!projectId || projectId === 'local') {
      setProjectGlobalSettingsError('本地项目不能保存全局设定。');
      return;
    }
    const title = projectGlobalSettingsDraft.title.trim();
    if (!title) {
      setProjectGlobalSettingsError('项目名称不能为空。');
      return;
    }
    const finalStyle = projectGlobalSettingsDraft.style === '自定义'
      ? (projectGlobalSettingsDraft.customStyleName.trim() || '自定义风格')
      : projectGlobalSettingsDraft.style;
    setProjectGlobalSettingsSaving(true);
    setProjectGlobalSettingsError(null);
    try {
      const updated = await updateProject(projectId, {
        title,
        description: projectGlobalSettingsDraft.description,
        ratio: projectGlobalSettingsDraft.ratio,
        style: finalStyle,
        cover: currentProject?.cover || PROJECT_DEFAULT_COVER,
        globalPrompt: buildProjectGlobalPromptFromDraft(projectGlobalSettingsDraft),
        negativePrompt: projectGlobalSettingsDraft.negativePrompt,
        setupSettings: {
          customStyleName: projectGlobalSettingsDraft.customStyleName.trim(),
          customStylePrompt: projectGlobalSettingsDraft.customStylePrompt.trim(),
          generationStrategy: projectGlobalSettingsDraft.generationStrategy,
          projectTone: projectGlobalSettingsDraft.projectTone,
          directorNotes: projectGlobalSettingsDraft.directorNotes,
          characterIdentityRules: projectGlobalSettingsDraft.characterIdentityRules,
          globalPrompt: projectGlobalSettingsDraft.globalPrompt,
          scriptRules: projectGlobalSettingsDraft.scriptRules,
        },
      });
      if (!updated) throw new Error('项目保存失败，请确认项目仍然存在后重试。');
      await loadProjects();
      setProjectGlobalSettingsOpen(false);
      showCanvasDropStatus('项目全局设定已保存，后续推理会按新设定执行。');
    } catch (error) {
      setProjectGlobalSettingsError(error instanceof Error ? error.message : '项目全局设定保存失败。');
    } finally {
      setProjectGlobalSettingsSaving(false);
    }
  }, [currentProject?.cover, loadProjects, projectGlobalSettingsDraft, projectId, showCanvasDropStatus, updateProject]);

  const syncedAssetGenerationBusyKeys = useMemo(() => {
    const keys = generationRecords
      .map(generationRecordWorkflowAssetBusyKey)
      .filter((key): key is string => Boolean(key));
    return Array.from(new Set([...assetGenerationBusyKeys, ...keys]));
  }, [assetGenerationBusyKeys, generationRecords]);

  const isAssetGenerationBusy = useCallback((kind: WorkflowAssetKind, item: WorkflowAssetItem) => {
    const assetName = item.name?.trim();
    return Boolean(assetName && syncedAssetGenerationBusyKeys.includes(workflowAssetBusyKey(kind, assetName)));
  }, [syncedAssetGenerationBusyKeys]);

  const isAssetUploadBusy = useCallback((kind: WorkflowAssetKind, item: WorkflowAssetItem) => {
    const assetName = item.name?.trim();
    return Boolean(assetName && assetUploadBusyKeys.includes(workflowAssetBusyKey(kind, assetName)));
  }, [assetUploadBusyKeys]);

  const storyboardAssetReferences = useMemo(
    () => storyboardReferencesFromGenerationRecords(generationRecords, clips, { episodeId: activeEpisodeId, episode: selectedEpisode }),
    [activeEpisodeId, generationRecords, clips, selectedEpisode],
  );
  const assetLibraryEpisodes = useMemo(
    () => episodeList.episodes.length ? episodeList.episodes : defaultEpisodeList().episodes,
    [episodeList.episodes],
  );
  const assetLibraryAssetItems = useMemo(
    () => assetLibraryCategory === 'directorBoards'
      ? []
      : collectEpisodeAssetLibraryItems(assetLibraryBundles, assetLibraryCategory, assetLibraryEpisodeId),
    [assetLibraryBundles, assetLibraryCategory, assetLibraryEpisodeId],
  );
  const assetLibraryDirectorItems = useMemo(
    () => assetLibraryCategory === 'directorBoards'
      ? collectDirectorBoardLibraryItems(assetLibraryRecords, assetLibraryEpisodes, assetLibraryEpisodeId)
      : [],
    [assetLibraryCategory, assetLibraryEpisodeId, assetLibraryEpisodes, assetLibraryRecords],
  );
  const assetLibraryTotalCount = assetLibraryCategory === 'directorBoards'
    ? assetLibraryDirectorItems.length
    : assetLibraryAssetItems.length;
  const blockedStoryboardImageUrls = useMemo(
    () => nonStoryboardImageUrlsFromGenerationRecords(generationRecords),
    [generationRecords],
  );
  const clipStoryboardImageRefs = useMemo(
    () => clips.flatMap((clip) => collectClipStoryboardImageReferences(clip, nodes, storyboardAssetReferences, blockedStoryboardImageUrls)),
    [clips, nodes, storyboardAssetReferences, blockedStoryboardImageUrls],
  );
  const finalizeClipStoryboardPrompt = useCallback((
    clip: Clip,
    basePrompt: string,
    clipsOverride: Clip[] = clips,
    assetsOverride: WorkflowAssets = workflowAssets,
    scenesOverride: BreakdownScene[] = breakdownScenes,
  ) => buildFinalClipStoryboardPromptForCanvas({
    clip,
    clips: clipsOverride,
    scenes: scenesOverride,
    assets: assetsOverride,
    nodes: useCanvasStore.getState().nodes,
    storyboardAssetRefs: storyboardAssetReferences,
    blockedStoryboardUrls: blockedStoryboardImageUrls,
    basePrompt,
  }), [blockedStoryboardImageUrls, breakdownScenes, clips, storyboardAssetReferences, workflowAssets]);

  const normalizeCanvasStoryboardLinks = useCallback((rawNodes = useCanvasStore.getState().nodes, rawEdges = useCanvasStore.getState().edges) => {
    const normalizedStoryboards = normalizeClipStoryboardReferenceSections(clips, rawNodes, rawEdges, storyboardAssetReferences, blockedStoryboardImageUrls);
    const normalized = normalizeVideoReferenceGraph(
      normalizedStoryboards.nodes,
      normalizedStoryboards.edges,
      storyboardAssetReferences,
      blockedStoryboardImageUrls,
    );
    return normalized;
  }, [blockedStoryboardImageUrls, clips, storyboardAssetReferences]);

  useEffect(() => {
    if (generationRecords.length === 0 || nodes.length === 0) return;
    let changed = false;
    const nextNodes = nodes.map((node) => {
      if (node.type === 'video') {
        const videoStatus = String(node.data?.videoStatus || node.data?.status || '');
        if (!['generating', 'submitted'].includes(videoStatus)) return node;
        const prompt = String(node.data?.videoPrompt || node.data?.seedancePrompt || node.data?.prompt || '');
        const generationStartedAt = String(node.data?.generationStartedAt || '');
        const generationId = String(node.data?.generationId || '');
        const latestRecord = findLatestCanvasVideoGenerationRecordForNode(
          generationRecords,
          node,
          prompt,
          { ...(generationStartedAt ? { notBefore: generationStartedAt } : {}), generationId },
        );
        if (!latestRecord) return node;
        if (!generationStartedAt && !isRecentGenerationRecord(latestRecord)) return node;
        if (latestRecord.status === 'RUNNING' || latestRecord.status === 'QUEUED') return node;
        if (latestRecord.status === 'FAILED' || latestRecord.status === 'CANCELED') {
          const error = latestRecord.errorMessage || (latestRecord.status === 'CANCELED' ? '视频生成已取消。' : '视频生成失败。');
          if (node.data?.videoStatus === 'failed' && node.data?.videoError === error) return node;
          changed = true;
          return {
            ...node,
            data: {
              ...node.data,
              videoStatus: 'failed',
              status: 'failed',
              statusLabel: '视频生成失败',
              videoError: error,
              generationStartedAt: '',
              generationId: latestRecord.id || generationId,
            },
          };
        }
        if (latestRecord.status !== 'SUCCEEDED') return node;
        const video = generationRecordVideoUrl(latestRecord);
        if (!video?.url) return node;
        changed = true;
        return {
          ...node,
          data: {
            ...node.data,
            videoStatus: 'completed',
            status: 'completed',
            statusLabel: '视频已完成',
            videoError: '',
            outputVideo: video.url,
            outputVideoAssetId: video.assetId || node.data?.outputVideoAssetId || '',
            generationStartedAt: '',
            generationId: latestRecord.id || generationId,
          },
        };
      }
      if (node.type !== 'generation') return node;
      const status = String(node.data?.status || '');
      if (status && status !== 'generating' && status !== 'failed' && status !== 'waiting') return node;
      const prompt = String(node.data?.submittedPrompt || node.data?.finalPrompt || node.data?.prompt || '');
      const generationStartedAt = String(node.data?.generationStartedAt || '');
      const generationRequestId = String(node.data?.generationRequestId || '');
      const generationId = String(node.data?.generationId || '');
      const latestRecord = findLatestCanvasImageGenerationRecordForNode(
        generationRecords,
        node,
        prompt,
        { ...(generationStartedAt ? { notBefore: generationStartedAt, requestId: generationRequestId } : {}), generationId },
      );
      if (!latestRecord) {
        const age = canvasGenerationAgeMs(generationStartedAt);
        if (!generationId && status === 'generating' && age !== null && age > CANVAS_GENERATION_SUBMIT_CONFIRM_MS) {
          changed = true;
          return {
            ...node,
            data: {
              ...node.data,
              status: 'failed',
              error: '没有找到对应的后端生成任务，请重新生成。',
              generationStartedAt: '',
              generationRequestId: '',
            },
          };
        }
        return node;
      }
      const allowMissingTaskRecovery = shouldAllowMissingBackendTaskRecovery(node, latestRecord, prompt);
      if (!generationStartedAt && !isRecentGenerationRecord(latestRecord) && !allowMissingTaskRecovery) return node;
      if (shouldIgnoreStoppedCanvasGenerationRecord(node.data as Record<string, unknown> | undefined, latestRecord, prompt)) return node;
      if (latestRecord.status === 'RUNNING' || latestRecord.status === 'QUEUED') {
        const nextStartedAt = generationStartedAt || generationRecordStartedAt(latestRecord) || canvasGenerationStartedAt();
        const nextError = '后端已有同一图片生成请求正在运行，已接管等待。';
        if (
          node.data?.status === 'generating' &&
          node.data?.error === nextError &&
          node.data?.generationStartedAt === nextStartedAt
        ) return node;
        changed = true;
        return {
          ...node,
          data: {
            ...node.data,
            status: 'generating',
            error: nextError,
            generationStartedAt: nextStartedAt,
            generationRequestId,
            generationId: latestRecord.id || generationId,
          },
        };
      }
      if (latestRecord?.status === 'FAILED' || latestRecord?.status === 'CANCELED') {
        const rawError = latestRecord.errorMessage || (latestRecord.status === 'CANCELED' ? '生成已取消。' : '生成失败。');
        const error = appendCanvasImageGenerationRetryHint(
          rawError,
          generationRecordReferenceImageCount(latestRecord),
          generationRecordResolution(latestRecord),
        );
        if (
          node.data?.status === 'failed' &&
          node.data?.error === error &&
          !node.data?.generationStartedAt
        ) return node;
        changed = true;
        return {
          ...node,
          data: {
            ...node.data,
            status: 'failed',
            error,
            generationStartedAt: '',
            generationRequestId: '',
            generationId: latestRecord.id || generationId,
          },
        };
      }
      if (latestRecord.status !== 'SUCCEEDED') return node;
      const image = generationRecordImageUrl(latestRecord);
      if (!image?.url) return node;
      const outputImageVariants = generationRecordImageUrls(latestRecord);
      if (!generationStartedAt && node.data?.outputImage && node.data.outputImage !== image.url) return node;
      const nextOutputImageAssetId = image.assetId || node.data?.outputImageAssetId || '';
      if (
        node.data?.status === 'completed' &&
        node.data?.outputImage === image.url &&
        node.data?.outputImageAssetId === nextOutputImageAssetId &&
        canvasOutputImageVariantsEqual(node.data?.outputImages, outputImageVariants) &&
        !node.data?.generationStartedAt
      ) return node;
      changed = true;
      return {
        ...node,
        data: {
          ...node.data,
          status: 'completed',
          outputImage: image.url,
          outputImageAssetId: nextOutputImageAssetId,
          outputImages: outputImageVariants,
          finalPrompt: node.data?.finalPrompt || node.data?.prompt || prompt,
          submittedPrompt: latestRecord.prompt || prompt,
          manualFinalPrompt: true,
          mode: node.data?.mode || 'standalone',
          error: '后台长请求已完成，已自动恢复生成结果。',
          generationStartedAt: '',
          generationRequestId: '',
          generationId: latestRecord.id || generationId,
        },
      };
    });
    if (!changed) return;
    const latest = useCanvasStore.getState();
    const normalized = normalizeCanvasStoryboardLinks(nextNodes as any, latest.edges);
    if (!canvasNodeListsEqual(normalized.nodes as any[], latest.nodes as any[])) setNodes(normalized.nodes as any);
    if (!canvasEdgeListsEqual(normalized.edges as any[], latest.edges as any[])) setEdges(normalized.edges);
  }, [edges, generationRecords, nodes, normalizeCanvasStoryboardLinks, setEdges, setNodes]);

  useEffect(() => {
    if (projectId !== 'local' && !currentProject) {
      void loadProjects();
    }
  }, [currentProject, loadProjects, projectId]);

  const loadEpisodeWorkspace = useCallback(async (episodeId: string) => {
    if (!episodeId || !projectId || projectId === 'local') return;
    setEpisodeSwitching(true);
    setWorkflowLoading(true);
    setWorkflowError(null);
    canvasLoadedRef.current = false;
    try {
      const remote = await apiClient.getProjectWorkflow(projectId, { episodeId });
      if (remote) {
        applyWorkflowSnapshot(remote, {
          setEpisodeList,
          setActiveEpisodeId,
          setSourceText,
          setSourceName,
          setSelectedEpisode,
          setBreakdownScenes,
          setClips,
          setWorkflowAssets,
          setStageStatuses,
        });
        setWorkflowDraftProjectId(`${projectId}:${remote.episodeId || episodeId}`);
      } else {
        setActiveEpisodeId(episodeId);
        setWorkflowDraftProjectId(`${projectId}:${episodeId}`);
      }
      await loadCanvasScene(projectId, workflowEpisodeCanvasSceneId(episodeId));
      canvasLoadedRef.current = true;
      setGenerationRecords([]);
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : '剧集切换失败');
    } finally {
      setEpisodeSwitching(false);
      setWorkflowLoading(false);
    }
  }, [loadCanvasScene, projectId]);

  const createNextEpisodeWorkspace = useCallback(async () => {
    if (!projectId || projectId === 'local' || episodeCreating) return;
    const title = window.prompt('下一集名称', nextEpisodeTitle(episodeList.episodes));
    if (!title?.trim()) return;
    setEpisodeCreating(true);
    setWorkflowError(null);
    try {
      const result = await apiClient.createProjectWorkflowEpisode(projectId, {
        title: title.trim(),
        copyAssetsFromEpisodeId: activeEpisodeId,
      });
      setEpisodeList(result.episodes);
      await loadEpisodeWorkspace(result.episode.id);
      showCanvasDropStatus(`已新增 ${result.episode.title}，全局设定和角色资产沿用当前项目，分镜和画布为空。`);
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : '新增下一集失败');
    } finally {
      setEpisodeCreating(false);
    }
  }, [activeEpisodeId, episodeCreating, episodeList.episodes, loadEpisodeWorkspace, projectId, showCanvasDropStatus]);

  useEffect(() => {
    let cancelled = false;
    canvasLoadedRef.current = false;
    loadCanvasScene(projectId || 'local', activeCanvasSceneId)
      .then(() => {
        if (!cancelled) canvasLoadedRef.current = true;
      })
      .catch((error) => {
        if (!cancelled) setWorkflowError(error instanceof Error ? error.message : '画布加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [activeCanvasSceneId, loadCanvasScene, projectId]);

  useEffect(() => {
    if (!canvasLoadedRef.current || projectUnavailable || !projectId || projectId === 'local') return;
    const timer = window.setTimeout(() => {
      const canvasState = useCanvasStore.getState();
      if (!canvasLoadedRef.current || canvasState.activeProjectId !== projectId || canvasState.activeSceneId !== activeCanvasSceneId) return;
      saveCanvasScene(projectId, activeCanvasSceneId).catch(() => {
        // Local canvas persistence remains available if the remote save fails.
      });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [activeCanvasSceneId, canvasLocalRevision, projectId, projectUnavailable, saveCanvasScene]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; actionResults?: Array<Record<string, unknown>> }>).detail;
      if (!detail?.projectId || detail.projectId !== projectId || projectId === 'local') return;
      const results = Array.isArray(detail.actionResults) ? detail.actionResults : [];
      const shouldRefreshCanvas = results.some((result) => result?.ok && (
        result.canvasChanged ||
        result.stateVerified ||
        result.type === 'sync_episode_canvas' ||
        result.type === 'connect_asset_to_clip' ||
        result.type === 'connect_asset_to_all_clips'
      ));
      const shouldRefreshRecords = results.some((result) => result?.ok && (result.generationId || result.recordsChanged));
      const shouldRefreshProject = results.some((result) => result?.ok && (result.projectChanged || result.workflowChanged));
      if (shouldRefreshCanvas) {
        const refreshedSceneId = results
          .map((result) => String(result?.sceneId || ''))
          .find(Boolean) || activeCanvasSceneId;
        canvasLoadedRef.current = false;
        void loadCanvasScene(projectId, refreshedSceneId)
          .then(() => {
            canvasLoadedRef.current = true;
            showCanvasDropStatus(refreshedSceneId === activeCanvasSceneId ? '项目总控已更新画布。' : `项目总控已更新画布场景 ${refreshedSceneId}。`);
          })
          .catch((error) => {
            setWorkflowError(error instanceof Error ? error.message : '项目总控更新后画布刷新失败');
          });
      }
      if (shouldRefreshRecords) {
        window.dispatchEvent(new Event(CANVAS_GENERATION_RECORDS_REFRESH_EVENT));
      }
      if (shouldRefreshProject) {
        void loadProjects();
        void apiClient.getProjectWorkflow(projectId, { episodeId: activeEpisodeId })
          .then((remote) => {
            if (!remote) return;
            applyWorkflowSnapshot(remote, {
              setEpisodeList,
              setActiveEpisodeId,
              setSourceText,
              setSourceName,
              setSelectedEpisode,
              setBreakdownScenes,
              setClips,
              setWorkflowAssets,
              setStageStatuses,
            });
            setWorkflowDraftProjectId(`${projectId}:${remote.episodeId || activeEpisodeId}`);
          })
          .catch(() => {
            // The canvas update itself should remain visible even if workflow refresh fails.
          });
      }
    };
    window.addEventListener(AGENT_ACTIONS_APPLIED_EVENT, handler);
    return () => window.removeEventListener(AGENT_ACTIONS_APPLIED_EVENT, handler);
  }, [activeCanvasSceneId, activeEpisodeId, loadCanvasScene, loadProjects, projectId, showCanvasDropStatus]);

  useEffect(() => {
    if (!projectId || projectId === 'local') {
      setGenerationRecords([]);
      return;
    }
    let cancelled = false;
    const loadRecords = () => {
      apiClient.listGenerationRecords(projectId, { limit: 120, compact: true })
        .then((records) => {
          if (!cancelled) {
            const activeGenerationKeys = canvasActiveGenerationRecoveryKeys(useCanvasStore.getState().nodes);
            const filtered = records.filter((record) => (
              generationRecordBelongsToEpisode(record, activeEpisodeId, selectedEpisode) ||
              generationRecordMatchesActiveCanvasGeneration(record, activeGenerationKeys)
            ));
            setGenerationRecords(filtered);
          }
        })
        .catch(() => {
          if (!cancelled) setGenerationRecords([]);
        });
    };
    loadRecords();
    const timer = window.setInterval(loadRecords, 5000);
    window.addEventListener(CANVAS_GENERATION_RECORDS_REFRESH_EVENT, loadRecords);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener(CANVAS_GENERATION_RECORDS_REFRESH_EVENT, loadRecords);
    };
  }, [activeEpisodeId, projectId, selectedEpisode]);

  const loadAssetLibrary = useCallback(async () => {
    if (!projectId || projectId === 'local') {
      setAssetLibraryBundles([]);
      setAssetLibraryRecords([]);
      setAssetLibraryStatus('本地示例项目没有跨集资产库。');
      return;
    }
    setAssetLibraryLoading(true);
    setAssetLibraryStatus(null);
    try {
      const latestEpisodeList = await apiClient.listProjectWorkflowEpisodes(projectId).catch(() => null);
      const episodes = latestEpisodeList?.episodes?.length
        ? latestEpisodeList.episodes
        : assetLibraryEpisodes.length ? assetLibraryEpisodes : defaultEpisodeList().episodes;
      if (latestEpisodeList?.episodes?.length) setEpisodeList(latestEpisodeList);
      const [bundles, records] = await Promise.all([
        Promise.all(episodes.map(async (episode) => {
          try {
            const workflow = await apiClient.getProjectWorkflow(projectId, { episodeId: episode.id });
            return { episode, workflow };
          } catch {
            return { episode, workflow: null };
          }
        })),
        apiClient.listGenerationRecords(projectId, { limit: 300, compact: true }).catch(() => []),
      ]);
      setAssetLibraryBundles(bundles);
      setAssetLibraryRecords(records);
      const missing = bundles.filter((bundle) => !bundle.workflow).length;
      setAssetLibraryStatus(missing > 0 ? `已加载 ${bundles.length - missing}/${bundles.length} 集资产，${missing} 集读取失败。` : null);
    } catch (error) {
      setAssetLibraryBundles([]);
      setAssetLibraryRecords([]);
      setAssetLibraryStatus(error instanceof Error ? error.message : '全资产库加载失败');
    } finally {
      setAssetLibraryLoading(false);
    }
  }, [assetLibraryEpisodes, projectId]);

  useEffect(() => {
    if (assetLibraryEpisodeId !== 'all' && !assetLibraryEpisodes.some((episode) => episode.id === assetLibraryEpisodeId)) {
      setAssetLibraryEpisodeId('all');
    }
  }, [assetLibraryEpisodeId, assetLibraryEpisodes]);

  useEffect(() => {
    if (activePanel === 'assetLibrary') void loadAssetLibrary();
  }, [activePanel, projectId]);

  useEffect(() => {
    const handler = (event: Event) => {
      const preview = (event as CustomEvent<AssetImagePreview>).detail;
      if (preview?.url) setAssetImagePreview(preview);
    };
    window.addEventListener(CANVAS_IMAGE_PREVIEW_EVENT, handler);
    return () => window.removeEventListener(CANVAS_IMAGE_PREVIEW_EVENT, handler);
  }, []);

  useEffect(() => {
    let changed = false;
    const nextNodes = nodes.map((node) => {
      if (isVideoCanvasNode(node)) {
        const needsTypeUpdate = node.type !== 'video';
        const needsWidthUpdate = nodeStyleWidth(node.style) < 520;
        const needsCollapsedDefault = node.data?.videoParametersCollapsed === undefined;
        if (!needsTypeUpdate && !needsWidthUpdate && !needsCollapsedDefault) return node;
        changed = true;
        return {
          ...node,
          type: 'video',
          data: needsCollapsedDefault ? { ...node.data, videoParametersCollapsed: true } : node.data,
          style: needsWidthUpdate ? { ...node.style, width: 520 } : node.style,
        };
      }
      if (node.type !== 'imageInput') return node;
      const minWidth = preferredImageInputNodeWidth(node.data);
      const minHeight = preferredImageInputNodeHeight(node.data);
      const normalizedImageUrl = publicImageUrl(node.data?.imageUrl);
      const needsWidthUpdate = nodeStyleWidth(node.style) < minWidth;
      const needsHeightUpdate = numericCanvasSize(node.style?.height) !== minHeight;
      const needsUrlUpdate = Boolean(normalizedImageUrl && normalizedImageUrl !== node.data?.imageUrl);
      if (!needsWidthUpdate && !needsHeightUpdate && !needsUrlUpdate) return node;
      changed = true;
      return {
        ...node,
        data: needsUrlUpdate ? { ...node.data, imageUrl: normalizedImageUrl, uploadStatus: node.data?.uploadStatus || 'linked' } : node.data,
        style: { ...node.style, ...(needsWidthUpdate ? { width: minWidth } : {}), height: minHeight },
      };
    });
    if (changed) setNodesTransient(nextNodes);
  }, [nodes, setNodesTransient]);

  useEffect(() => {
    const latest = useCanvasStore.getState();
    const normalized = normalizeCanvasStoryboardLinks(latest.nodes, latest.edges);
    const normalizedNodes = normalized.nodes as any[];
    const normalizedEdges = normalized.edges as any[];
    if (
      canvasNodeListsEqual(normalizedNodes, latest.nodes as any[]) &&
      canvasEdgeListsEqual(normalizedEdges, latest.edges as any[])
    ) {
      canvasAutoNormalizeTransitionRef.current = '';
      return;
    }

    const inputSignature = canvasGraphChangeSignature(latest.nodes as any[], latest.edges as any[]);
    const outputSignature = canvasGraphChangeSignature(normalizedNodes, normalizedEdges);
    const transitionSignature = `${inputSignature}\n=>\n${outputSignature}`;
    if (canvasAutoNormalizeTransitionRef.current === transitionSignature) return;

    const convergence = normalizeCanvasStoryboardLinks(normalizedNodes, normalizedEdges);
    if (
      !canvasNodeListsEqual(convergence.nodes as any[], normalizedNodes) ||
      !canvasEdgeListsEqual(convergence.edges as any[], normalizedEdges)
    ) {
      canvasAutoNormalizeTransitionRef.current = transitionSignature;
      return;
    }

    canvasAutoNormalizeTransitionRef.current = transitionSignature;
    if (!canvasNodeListsEqual(normalizedNodes, latest.nodes as any[])) setNodesTransient(normalizedNodes as any);
    if (!canvasEdgeListsEqual(normalizedEdges, latest.edges as any[])) setEdgesTransient(normalizedEdges);
  }, [nodes, edges, normalizeCanvasStoryboardLinks, setEdgesTransient, setNodesTransient]);

  useEffect(() => () => {
    if (canvasDropStatusTimerRef.current) {
      window.clearTimeout(canvasDropStatusTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const workflow = (event as CustomEvent<{ workflow?: WorkflowState }>).detail?.workflow;
      if (!workflow) return;
      setWorkflowAssets(workflow.assets ?? defaultWorkflowAssets());
      setStageStatuses(workflow.stageStatuses ?? {});
    };
    window.addEventListener(WORKFLOW_ASSET_SYNC_EVENT, handler);
    return () => window.removeEventListener(WORKFLOW_ASSET_SYNC_EVENT, handler);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setWorkflowModelsLoading(true);
    setWorkflowModelError(null);

    apiClient.listModelConfigs()
      .then((configs) => {
        if (cancelled) return;
        const textModels = configs.models.filter(isWorkflowTextModel);
        const imageModels = configs.models.filter(isWorkflowImageModel);
        setWorkflowModels(textModels);
        setAssetImageModels(imageModels);
        const savedModelId = localStorage.getItem(`loohii-workflow-text-model:${projectId}`) ?? '';
        const savedImageModelId = localStorage.getItem(`loohii-workflow-image-model:${projectId}`) ?? '';
        setWorkflowAiModelId((current) => {
          if (current && textModels.some((model) => model.id === current)) return current;
          if (savedModelId && textModels.some((model) => model.id === savedModelId)) return savedModelId;
          return textModels[0]?.id ?? '';
        });
        setAssetGenerationModelId((current) => {
          if (current && imageModels.some((model) => model.id === current)) return current;
          if (savedImageModelId && imageModels.some((model) => model.id === savedImageModelId)) return savedImageModelId;
          return imageModels[0]?.id ?? '';
        });
      })
      .catch((error) => {
        if (!cancelled) {
          setWorkflowModels([]);
          setAssetImageModels([]);
          setWorkflowAiModelId('');
          setAssetGenerationModelId('');
          setWorkflowModelError(error instanceof Error ? error.message : '文本模型列表加载失败');
        }
      })
      .finally(() => {
        if (!cancelled) setWorkflowModelsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    try {
      if (workflowAiModelId) {
        localStorage.setItem(`loohii-workflow-text-model:${projectId}`, workflowAiModelId);
      }
    } catch {
      // Model selection is still kept in memory for the current session.
    }
  }, [projectId, workflowAiModelId]);

  useEffect(() => {
    try {
      if (assetGenerationModelId) {
        localStorage.setItem(`loohii-workflow-image-model:${projectId}`, assetGenerationModelId);
      }
    } catch {
      // Keep selection in memory for the current session.
    }
  }, [assetGenerationModelId, projectId]);

  useEffect(() => {
    setAssetUploadModelId((current) => current || workflowAiModelId);
  }, [workflowAiModelId]);

  useEffect(() => {
    let cancelled = false;
    setWorkflowLoading(true);
    setWorkflowError(null);
    setProjectUnavailable(false);
    setWorkflowDraftProjectId(null);

    async function loadWorkflow() {
      let remote = null;
      try {
        remote = await apiClient.getProjectWorkflow(projectId);
      } catch (error) {
        if (cancelled) return;
        if (isProjectNotFoundError(error)) {
          setProjectUnavailable(true);
          setWorkflowError('当前项目不存在，可能是旧本地示例项目或已被删除。请返回「我的项目」，从真实项目重新进入。');
          setSourceText('');
          setSourceName('');
          setSelectedEpisode('第 1 集');
          setEpisodeList(defaultEpisodeList());
          setActiveEpisodeId('episode-001');
          setBreakdownScenes([]);
          setClips([]);
          setWorkflowAssets(defaultWorkflowAssets());
          setStageStatuses({});
          return;
        }
        throw error;
      }
      if (cancelled) return;
      if (remote) {
        applyWorkflowSnapshot(remote, {
          setEpisodeList,
          setActiveEpisodeId,
          setSourceText,
          setSourceName,
          setSelectedEpisode,
          setBreakdownScenes,
          setClips,
          setWorkflowAssets,
          setStageStatuses,
        });
        setWorkflowDraftProjectId(`${projectId}:${remote.episodeId || 'episode-001'}`);
        return;
      }

      try {
        const raw = localStorage.getItem(`loohii-workflow-center:${projectId}`);
        if (raw) {
          const saved = JSON.parse(raw);
          setEpisodeList(defaultEpisodeList());
          setActiveEpisodeId('episode-001');
          setSourceText(typeof saved.sourceText === 'string' ? saved.sourceText : '');
          setSourceName(typeof saved.sourceName === 'string' ? saved.sourceName : '');
          setSelectedEpisode(typeof saved.selectedEpisode === 'string' ? saved.selectedEpisode : '第 1 集');
          setBreakdownScenes(Array.isArray(saved.breakdownScenes) ? saved.breakdownScenes : []);
          setClips(Array.isArray(saved.clips) ? saved.clips : []);
          setWorkflowAssets(saved.assets && typeof saved.assets === 'object' ? saved.assets : defaultWorkflowAssets());
          setStageStatuses(saved.stageStatuses && typeof saved.stageStatuses === 'object' ? saved.stageStatuses : {});
        } else {
          setEpisodeList(defaultEpisodeList());
          setActiveEpisodeId('episode-001');
          setSourceText('');
          setSourceName('');
          setSelectedEpisode('第 1 集');
          setBreakdownScenes([]);
          setClips([]);
          setWorkflowAssets(defaultWorkflowAssets());
          setStageStatuses({});
        }
      } catch {
        setEpisodeList(defaultEpisodeList());
        setActiveEpisodeId('episode-001');
        setSourceText('');
        setSourceName('');
        setSelectedEpisode('第 1 集');
        setBreakdownScenes([]);
        setClips([]);
        setWorkflowAssets(defaultWorkflowAssets());
        setStageStatuses({});
      } finally {
        setWorkflowDraftProjectId(`${projectId}:episode-001`);
      }
    }

    loadWorkflow()
      .catch((error) => {
        if (!cancelled) setWorkflowError(error instanceof Error ? error.message : '流程中心加载失败');
      })
      .finally(() => {
        if (!cancelled) setWorkflowLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (projectUnavailable) return;
    const draftKey = `${projectId}:${activeEpisodeId}`;
    if (workflowDraftProjectId !== draftKey) return;
    if (workflowInferAllRunning) return;
    if (workflowHasRunningStage(stageStatuses)) return;
    const draft = { episodeId: activeEpisodeId, sourceText, sourceName, selectedEpisode, breakdownScenes, clips, assets: workflowAssets, stageStatuses };
    try {
      localStorage.setItem(
        `loohii-workflow-center:${projectId}:${activeEpisodeId}`,
        JSON.stringify(draft)
      );
    } catch {
      // Ignore storage quota errors; the current session still keeps the data in memory.
    }

    const timer = window.setTimeout(() => {
      setWorkflowSaving(true);
      apiClient.saveProjectWorkflow(projectId, draft, { episodeId: activeEpisodeId })
        .catch((error) => {
          setWorkflowError(error instanceof Error ? error.message : '流程草稿保存失败');
        })
        .finally(() => setWorkflowSaving(false));
    }, 900);

    return () => window.clearTimeout(timer);
  }, [activeEpisodeId, breakdownScenes, clips, projectId, projectUnavailable, selectedEpisode, sourceName, sourceText, stageStatuses, workflowAssets, workflowDraftProjectId, workflowInferAllRunning]);

  useEffect(() => {
    if (projectUnavailable || workflowRunning || workflowInferAllRunning || !workflowHasRunningStage(stageStatuses)) return;
    let cancelled = false;
    let recovering = false;
    const timer = window.setInterval(() => {
      apiClient.getProjectWorkflow(projectId, { episodeId: activeEpisodeId })
        .then((remote) => {
          if (cancelled || !remote) return;
          const breakdownRecovery = workflowBreakdownRecoveryRef.current;
          if (
            breakdownRecovery &&
            workflowHasBreakdownResult(remote) &&
            workflowRunCompletedAfter(remote, breakdownRecovery.startedAtMs)
          ) {
            if (recovering) return;
            recovering = true;
            applyWorkflowBreakdownResult(remote, breakdownRecovery)
              .then(() => {
                if (cancelled) return;
                workflowBreakdownRecoveryRef.current = null;
                setWorkflowError(null);
                showCanvasDropStatus('后端已完成拆解，已从最新结果恢复到画布。');
              })
              .catch(() => {
                if (cancelled) return;
                applyWorkflowSnapshot(remote, {
                  setEpisodeList,
                  setActiveEpisodeId,
                  setSourceText,
                  setSourceName,
                  setSelectedEpisode,
                  setBreakdownScenes,
                  setClips,
                  setWorkflowAssets,
                  setStageStatuses,
                });
                setWorkflowDraftProjectId(`${projectId}:${remote.episodeId || activeEpisodeId}`);
              })
              .finally(() => {
                recovering = false;
              });
            return;
          }
          applyWorkflowSnapshot(remote, {
            setEpisodeList,
            setActiveEpisodeId,
            setSourceText,
            setSourceName,
            setSelectedEpisode,
            setBreakdownScenes,
            setClips,
            setWorkflowAssets,
            setStageStatuses,
          });
          setWorkflowDraftProjectId(`${projectId}:${remote.episodeId || activeEpisodeId}`);
        })
        .catch(() => {
          // Keep the last persisted state visible; the next poll can recover.
        });
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeEpisodeId, projectId, projectUnavailable, stageStatuses, workflowRunning, workflowInferAllRunning]);

  useEffect(() => {
    if (!workflowInferAllRunning || projectUnavailable || !projectId || projectId === 'local') return;
    let cancelled = false;
    let recovering = false;
    const recoverFromRemoteWorkflow = () => {
      if (recovering) return;
      apiClient.getProjectWorkflow(projectId, { episodeId: activeEpisodeId })
        .then((remote) => {
          if (
            cancelled ||
            !workflowRemoteBatchFinished(
              remote,
              workflowInferAllExpectedClipIdsRef.current,
              workflowInferAllActiveRequestStartedAtRef.current,
              workflowInferAllCompletedClipIdsRef.current,
            )
          ) return;
          recovering = true;
          applyWorkflowSnapshot(remote, {
            setEpisodeList,
            setActiveEpisodeId,
            setSourceText,
            setSourceName,
            setSelectedEpisode,
            setBreakdownScenes,
            setClips,
            setWorkflowAssets,
            setStageStatuses,
          });
          setWorkflowDraftProjectId(`${projectId}:${remote.episodeId || activeEpisodeId}`);
          setWorkflowInferAllRunning(false);
          showCanvasDropStatus('故事板和视频提示词已完成，已恢复远端结果。');
          const syncEpisodeBoardsToCanvas = syncEpisodeBoardsToCanvasRef.current;
          if (!syncEpisodeBoardsToCanvas) {
            recovering = false;
            return;
          }
          void syncEpisodeBoardsToCanvas({
            episodeId: remote.episodeId || activeEpisodeId,
            clips: remote.clips ?? [],
            scenes: remote.breakdownScenes as BreakdownScene[],
            assets: remote.assets ?? defaultWorkflowAssets(),
            episode: remote.selectedEpisode,
            refreshRecords: true,
          }).finally(() => {
            recovering = false;
          });
        })
        .catch(() => {
          // Keep the local in-flight state; the next poll can recover after a transient network error.
          recovering = false;
        });
    };
    recoverFromRemoteWorkflow();
    const timer = window.setInterval(recoverFromRemoteWorkflow, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeEpisodeId, projectId, projectUnavailable, showCanvasDropStatus, workflowInferAllRunning]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const currentNodes = useCanvasStore.getState().nodes;
      if (isAutoCanvasLayoutChangeBatch(changes)) {
        const layoutChanges = changes.filter((change) => !isMeasurementCanvasNodeChange(change));
        if (layoutChanges.length === 0 || layoutChanges.every(isTransientCanvasNodeChange)) return;
        const nextNodes = applyNodeChanges(layoutChanges, currentNodes);
        if (changes.some(isInteractiveCanvasResizeChange)) {
          setNodes(nextNodes);
        } else {
          setNodesTransient(nextNodes);
        }
        return;
      }
      const actionableChanges = changes.filter((change) => !isMeasurementCanvasNodeChange(change) && !isAutoCanvasLayoutChange(change));
      if (actionableChanges.length === 0) return;
      if (actionableChanges.every(isTransientCanvasNodeChange)) {
        return;
      }
      const durableChanges = actionableChanges.filter((change) => !isTransientCanvasNodeChange(change));
      if (durableChanges.length === 0) return;
      const removedIds = new Set(
        durableChanges
          .filter((change) => change.type === 'remove')
          .map((change) => change.id),
      );
      for (const nodeId of Array.from(removedIds)) {
        const node = currentNodes.find((item) => item.id === nodeId);
        if (node?.type !== 'section') continue;
        for (const descendantId of collectCanvasSectionDescendantIds(currentNodes, node.id)) {
          removedIds.add(descendantId);
        }
      }
      if (removedIds.size > 0) markCanvasNodesDeleted(removedIds);
      const changedNodes = applyNodeChanges(durableChanges, currentNodes);
      setNodes(detachNodesFromRemovedParents(changedNodes, removedIds, currentNodes));
    },
    [markCanvasNodesDeleted, setNodes, setNodesTransient]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const currentEdges = useCanvasStore.getState().edges;
      if (changes.every((change) => change.type === 'select')) {
        return;
      }
      const durableChanges = changes.filter((change) => change.type !== 'select');
      if (durableChanges.length === 0) return;
      setEdges(applyEdgeChanges(durableChanges, currentEdges));
    },
    [setEdges]
  );

  const handleAddNode = () => {
    const lastScene = nodes.filter((n) => n.type === 'scene').pop();
    const x = lastScene ? lastScene.position.x + 380 : 350;
    const y = lastScene ? lastScene.position.y : 100;
    addNode('scene', { x, y });
  };

  const handleAddWorkflowNode = (nodeType: CanvasNodeKind, title: string, description: string) => {
    const processNodes = useCanvasStore
      .getState()
      .nodes.filter((n) => ['episode', 'asset', 'workflow', 'directorBoard'].includes(String(n.type)));
    const x = 120;
    const y = 80 + processNodes.length * 140;
    addNode(nodeType, { x, y }, {
      title,
      description,
      kind: nodeType,
      scope: '多集生产流程',
      statusLabel: '待接入',
    });
  };

  const handleAddAssetToCanvas = (kind: WorkflowAssetKind, item: WorkflowAssetItem, options: { sourceEpisode?: string; sourceEpisodeId?: string } = {}) => {
    const nodeCount = useCanvasStore.getState().nodes.length;
    const x = 350 + (nodeCount % 4) * 320;
    const y = 100 + Math.floor(nodeCount / 4) * 220;
    const sectionPosition = { x: x - CANVAS_SECTION_PADDING_X, y: y - CANVAS_SECTION_HEADER_HEIGHT };
    const sectionWidth = 396;
    const sectionHeight = CANVAS_SECTION_HEADER_HEIGHT + CANVAS_SINGLE_ASSET_NODE_HEIGHT + CANVAS_SECTION_PADDING_BOTTOM;
    const assetName = workflowAssetName(item) || '未命名资产';
    const sourceEpisodeTitle = options.sourceEpisode || selectedEpisode;
    const sourceEpisodeId = options.sourceEpisodeId || activeEpisodeId;
    const sectionId = addCanvasSection(addNode, sectionPosition, { width: sectionWidth, height: sectionHeight }, {
      title: `${workflowAssetKindLabel(kind)} · ${assetName}`,
      description: '从资产区放入画布',
      tone: kind === 'characters' ? 'emerald' : kind === 'scenes' ? 'sky' : 'amber',
      itemCount: 1,
      assetKind: kind,
      assetName,
      sectionKind: 'workflow-asset',
      sourceEpisode: sourceEpisodeTitle,
      sourceEpisodeId,
    });
    const nodePosition = {
      x: sectionPosition.x + CANVAS_SECTION_PADDING_X,
      y: sectionPosition.y + CANVAS_SECTION_HEADER_HEIGHT,
    };
    const image = normalizeReusableImageSource(item.generatedImageUrl || item.referenceImageUrl || '');
    const imageAssetId = item.generatedImageAssetId || item.referenceImageAssetId || '';
    const prompt = firstCleanAssetPromptSeed(item.visualPrompt, item.lockedVisualIdentity, item.description);
    const assetNodeData = {
      title: assetName,
      assetKind: kind,
      assetName,
      prompt,
      visualPrompt: cleanAssetPromptSeed(item.visualPrompt) || prompt,
      description: item.description || '',
      timeOfDay: item.timeOfDay || '',
      function: item.function || '',
      projectPromptContext,
    };

    if (kind === 'characters') {
      const nodeId = addNode('character', nodePosition, {
        name: assetName || '未命名角色',
        assetKind: kind,
        assetName: assetName || '未命名角色',
        traits: item.lockedVisualIdentity || item.description || item.role || item.fruitIdentity || '待设定',
        avatar: image,
        generatedImage: item.generatedImageUrl || '',
        generatedImageAssetId: imageAssetId,
        finalPrompt: buildCanvasAssetFinalPrompt('characters', {
          name: assetName || '未命名角色',
          assetName: assetName || '未命名角色',
          role: item.role,
          visualPrompt: prompt,
          traits: item.lockedVisualIdentity || item.description || item.role || item.fruitIdentity || '',
          description: item.description,
          fruitIdentity: item.fruitIdentity,
        }, 0, projectPromptContext),
        visualPrompt: prompt,
        fruitIdentity: item.fruitIdentity || '',
        projectPromptContext,
        ratio: assetGenerationAspectRatio,
        resolution: assetGenerationResolution,
        sourceEpisode: sourceEpisodeTitle,
        sourceEpisodeId,
      });
      attachNodesToCanvasSection(sectionId, new Map([[nodeId, nodePosition]]));
    } else {
      const finalPrompt = buildCanvasAssetFinalPrompt(kind, assetNodeData, 0, projectPromptContext);
      const nodeId = addNode('generation', nodePosition, {
        ...assetNodeData,
        finalPrompt,
        status: image ? 'completed' : 'waiting',
        outputImage: image,
        outputImageAssetId: imageAssetId,
        size: assetGenerationAspectRatio,
        resolution: assetGenerationResolution,
        quality: 'high',
        format: 'png',
        sourceEpisode: sourceEpisodeTitle,
        sourceEpisodeId,
      });
      attachNodesToCanvasSection(sectionId, new Map([[nodeId, nodePosition]]));
    }
  };

  const handleAddLibraryAssetToCanvas = useCallback((entry: AssetLibraryItem) => {
    handleAddAssetToCanvas(entry.kind, entry.asset, {
      sourceEpisode: entry.episodeTitle,
      sourceEpisodeId: entry.episodeId,
    });
    showCanvasDropStatus(`已把 ${entry.episodeTitle} · ${entry.name} 放入当前画布。`);
  }, [handleAddAssetToCanvas, showCanvasDropStatus]);

  const loadMergedWorkflowAssets = async (): Promise<WorkflowAssets> => {
    if (projectUnavailable || !projectId || projectId === 'local') return workflowAssets;
    try {
      const [workflow, characters, scenes] = await Promise.all([
        apiClient.getProjectWorkflow(projectId, { episodeId: activeEpisodeId }),
        apiClient.listProjectCharacters(projectId).catch(() => []),
        apiClient.listProjectScenes(projectId).catch(() => []),
      ]);
      const merged = mergeWorkflowAssetsWithProjectRecords(
        workflow?.assets ?? workflowAssets,
        characters,
        scenes,
      );
      setWorkflowAssets(merged);
      if (workflow?.stageStatuses) setStageStatuses(workflow.stageStatuses);
      return merged;
    } catch {
      return workflowAssets;
    }
  };

  const handleSourceFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setSourceName(file.name);
      setSourceText(String(reader.result ?? ''));
      setActiveWorkflowStage('source');
      setActivePanel('workflow');
    };
    reader.readAsText(file);
  };

  const openAssetReferencePicker = (kind = assetUploadKind, name?: string) => {
    const assetName = (name ?? assetUploadName).trim();
    if (!assetName) {
      setAssetUploadStatus('先选择或填写资产名，再上传参考图。');
      return;
    }
    pendingAssetUploadRef.current = { kind, name: assetName };
    setAssetUploadKind(kind);
    setAssetUploadName(assetName);
    setAssetUploadStatus(`准备为 ${assetName} 上传参考图。`);
    assetImageFileRef.current?.click();
  };

  const handleUploadAssetReference = (kind: WorkflowAssetKind, item: WorkflowAssetItem) => {
    if (!item.name?.trim()) {
      setAssetUploadStatus('这个资产缺少名称，不能自动匹配。');
      return;
    }
    setActivePanel('assets');
    setActiveWorkflowStage('assets');
    openAssetReferencePicker(kind, item.name);
  };

  const handleUploadAudioReference = (item: WorkflowAssetItem) => {
    const assetName = workflowAssetName(item);
    if (!assetName) {
      setAssetUploadStatus('这个角色缺少名称，不能上传音频参考。');
      return;
    }
    setActivePanel('assets');
    setActiveWorkflowStage('assets');
    pendingAudioUploadRef.current = { mode: 'single', name: assetName };
    setAssetUploadStatus(`准备为 ${assetName} 上传角色音频参考。`);
    assetAudioFileRef.current?.click();
  };

  const handleBatchUploadCharacterAudioReferences = () => {
    if (projectUnavailable) {
      setAssetUploadStatus('当前项目不存在，无法上传角色音频。');
      return;
    }
    const characterNames = new Set(assetArray(workflowAssets, 'characters').map((item) => normalizeCompareText(workflowAssetName(item))).filter(Boolean));
    const missing = batchCharacterAudioTargets.filter((target) => !characterNames.has(normalizeCompareText(target.name))).map((target) => target.name);
    pendingAudioUploadRef.current = { mode: 'batch' };
    setActivePanel('assets');
    setActiveWorkflowStage('assets');
    setAssetUploadStatus(
      `准备批量上传角色音频：1 Bob，2 Chloe，3 Leo，4 Tiffany，5 Eugene。${missing.length ? `当前资产缺少：${missing.join('、')}，上传后会自动补齐。` : ''}`
    );
    assetAudioFileRef.current?.click();
  };

  const uploadCharacterAudioReferenceFile = async (assetName: string, file: File) => {
    const uploadKey = workflowAssetBusyKey('characters', `${assetName}:audio`);
    const local = await apiClient.uploadLocalFile({
      key: safeAudioUploadKey(projectId, file.name),
      file,
      contentType: file.type || 'audio/mpeg',
    });
    return apiClient.uploadCharacterReferenceAudio(projectId, {
      episodeId: activeEpisodeId,
      characterName: assetName,
      audioUrl: local.publicUrl,
      fileName: file.name,
      mimeType: local.contentType || file.type,
      sizeBytes: local.sizeBytes ?? file.size,
    }).finally(() => {
      setAssetUploadBusyKeys((current) => current.filter((key) => key !== uploadKey));
    });
  };

  const refreshCanvasAfterAudioReferenceChange = async () => {
    if (projectUnavailable || !projectId || projectId === 'local') return;
    try {
      canvasLoadedRef.current = false;
      await loadCanvasScene(projectId, activeCanvasSceneId);
      canvasLoadedRef.current = true;
    } catch {
      canvasLoadedRef.current = true;
    }
  };

  const uploadSingleCharacterAudioFile = async (assetName: string, file: File) => {
    const pending = pendingAudioUploadRef.current;
    if (!assetName) {
      setAssetUploadStatus('先选择角色，再上传音频参考。');
      return;
    }
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|ogg|opus|webm|flac)$/i.test(file.name)) {
      setAssetUploadStatus('请选择音频文件。');
      return;
    }
    const uploadKey = workflowAssetBusyKey('characters', `${assetName}:audio`);
    if (assetUploadBusyKeys.includes(uploadKey)) {
      setAssetUploadStatus(`${assetName} 的音频正在上传，请等待完成。`);
      return;
    }
    setAssetUploadBusyKeys((current) => current.includes(uploadKey) ? current : [...current, uploadKey]);
    setAssetUploadStatus(`正在上传 ${assetName} 的角色音频参考...`);
    try {
      const result = await uploadCharacterAudioReferenceFile(assetName, file);
      if (result.workflow) {
        setWorkflowAssets(result.workflow.assets ?? defaultWorkflowAssets());
        setStageStatuses(result.workflow.stageStatuses ?? {});
      } else {
        const remote = await apiClient.getProjectWorkflow(projectId, { episodeId: activeEpisodeId });
        if (remote) {
          setWorkflowAssets(remote.assets ?? defaultWorkflowAssets());
          setStageStatuses(remote.stageStatuses ?? {});
        }
      }
      await refreshCanvasAfterAudioReferenceChange();
      setAssetUploadStatus(`${assetName} 的角色音频参考已上传。后续视频节点会按台词角色自动带入。`);
    } catch (error) {
      setAssetUploadStatus(error instanceof Error ? error.message : '角色音频上传失败');
    } finally {
      if (
        pendingAudioUploadRef.current?.mode === 'single' &&
        normalizeCompareText(pendingAudioUploadRef.current.name) === normalizeCompareText(assetName)
      ) {
        pendingAudioUploadRef.current = null;
      }
    }
  };

  const batchAudioTargetForFile = (file: File): (typeof batchCharacterAudioTargets)[number] | null => {
    const base = file.name.replace(/\.[^.]+$/, '').trim().toLowerCase();
    const indexMatch = base.match(/(?:^|[^0-9])([1-5])(?:[^0-9]|$)/);
    if (indexMatch?.[1]) {
      return batchCharacterAudioTargets.find((target) => target.index === Number(indexMatch[1])) ?? null;
    }
    return batchCharacterAudioTargets.find((target) => target.aliases.some((alias) => base.includes(alias))) ?? null;
  };

  const uploadBatchCharacterAudioFiles = async (files: File[]) => {
    const audioFiles = files.filter((file) => file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|opus|webm|flac)$/i.test(file.name));
    if (audioFiles.length === 0) {
      setAssetUploadStatus('请选择音频文件。文件名需要包含 1-5 编号，或包含 Bob/Chloe/Leo/Tiffany/Eugene。');
      return;
    }
    const entries: Array<{ file: File; target: (typeof batchCharacterAudioTargets)[number] }> = [];
    const skipped: string[] = [];
    const seenTargets = new Set<number>();
    for (const file of audioFiles) {
      const target = batchAudioTargetForFile(file);
      if (!target || seenTargets.has(target.index) || assetUploadBusyKeys.includes(workflowAssetBusyKey('characters', `${target.name}:audio`))) {
        skipped.push(file.name);
        continue;
      }
      seenTargets.add(target.index);
      entries.push({ file, target });
    }
    if (entries.length === 0) {
      setAssetUploadStatus('没有匹配到可绑定音频。请把文件名改成 1、2、3、4、5 开头，或包含角色名。');
      return;
    }
    const busyKeys = entries.map((entry) => workflowAssetBusyKey('characters', `${entry.target.name}:audio`));
    setAssetUploadBusyKeys((current) => [...new Set([...current, ...busyKeys])]);
    setAssetUploadStatus(`正在批量上传 ${entries.length} 个角色音频...`);
    const succeeded: string[] = [];
    const failed: string[] = [];
    let latestWorkflow: WorkflowState | undefined;
    for (const entry of entries) {
      try {
        const result = await uploadCharacterAudioReferenceFile(entry.target.name, entry.file);
        if (result.workflow) latestWorkflow = result.workflow;
        succeeded.push(entry.target.name);
      } catch (error) {
        failed.push(`${entry.target.name}${error instanceof Error ? `：${error.message}` : ''}`);
      }
    }
    if (latestWorkflow) {
      setWorkflowAssets(latestWorkflow.assets ?? defaultWorkflowAssets());
      setStageStatuses(latestWorkflow.stageStatuses ?? {});
    } else {
      const remote = await apiClient.getProjectWorkflow(projectId, { episodeId: activeEpisodeId }).catch(() => null);
      if (remote) {
        setWorkflowAssets(remote.assets ?? defaultWorkflowAssets());
        setStageStatuses(remote.stageStatuses ?? {});
      }
    }
    await refreshCanvasAfterAudioReferenceChange();
    const missing = batchCharacterAudioTargets.filter((target) => !seenTargets.has(target.index)).map((target) => `${target.index}-${target.name}`);
    setAssetUploadStatus([
      succeeded.length ? `已绑定：${succeeded.join('、')}` : '',
      failed.length ? `失败：${failed.join('；')}` : '',
      missing.length ? `未收到：${missing.join('、')}` : '',
      skipped.length ? `未识别文件：${skipped.join('、')}` : '',
    ].filter(Boolean).join('。'));
  };

  const handleAssetAudioFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    if (projectUnavailable) {
      setAssetUploadStatus('当前项目不存在，无法上传角色音频。');
      return;
    }
    const pending = pendingAudioUploadRef.current;
    if (pending?.mode === 'batch' || files.length > 1) {
      pendingAudioUploadRef.current = null;
      await uploadBatchCharacterAudioFiles(files);
      return;
    }
    await uploadSingleCharacterAudioFile(pending?.mode === 'single' ? pending.name.trim() : '', files[0]);
  };

  const handleClearAudioReference = async (item: WorkflowAssetItem) => {
    const assetName = workflowAssetName(item);
    if (!assetName) {
      setAssetUploadStatus('这个角色缺少名称，不能取消音频参考。');
      return;
    }
    if (!item.referenceAudioUrl) {
      setAssetUploadStatus(`${assetName} 当前没有绑定音频参考。`);
      return;
    }
    if (projectUnavailable || !projectId || projectId === 'local') {
      setAssetUploadStatus('当前项目不存在，无法取消角色音频。');
      return;
    }
    const uploadKey = workflowAssetBusyKey('characters', `${assetName}:audio`);
    if (assetUploadBusyKeys.includes(uploadKey)) {
      setAssetUploadStatus(`${assetName} 的音频正在处理，请等待完成。`);
      return;
    }
    setAssetUploadBusyKeys((current) => current.includes(uploadKey) ? current : [...current, uploadKey]);
    setActivePanel('assets');
    setActiveWorkflowStage('assets');
    setAssetUploadStatus(`正在取消 ${assetName} 的角色音频参考...`);
    try {
      const result = await apiClient.clearCharacterReferenceAudio(projectId, {
        episodeId: activeEpisodeId,
        characterName: assetName,
      });
      setWorkflowAssets(result.workflow.assets ?? defaultWorkflowAssets());
      setStageStatuses(result.workflow.stageStatuses ?? {});
      await refreshCanvasAfterAudioReferenceChange();
      setAssetUploadStatus(`${assetName} 的角色音频参考已取消，历史音频文件仍保留。`);
    } catch (error) {
      setAssetUploadStatus(error instanceof Error ? error.message : '取消角色音频失败');
    } finally {
      setAssetUploadBusyKeys((current) => current.filter((key) => key !== uploadKey));
    }
  };

  const openCharacterPropPicker = (character: WorkflowAssetItem) => {
    const characterName = workflowAssetName(character);
    if (!characterName) {
      setAssetUploadStatus('这个角色缺少名称，不能绑定道具。');
      return;
    }
    setPropPickerCharacter(character);
    setPropGenerationPrompt('');
    setPropBindingStatus(null);
    setActivePanel('assets');
    setActiveWorkflowStage('assets');
  };

  const handleAssetReferenceFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (projectUnavailable) {
      setAssetUploadStatus('当前项目不存在，无法上传资产参考图。');
      return;
    }
    const pending = pendingAssetUploadRef.current;
    const uploadKind = pending?.kind ?? assetUploadKind;
    const assetName = (pending?.name || assetUploadName).trim();
    if (!assetName) {
      setAssetUploadStatus('先填写资产名，再上传参考图。');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setAssetUploadStatus('请选择图片文件。');
      return;
    }
    const uploadKey = workflowAssetBusyKey(uploadKind, assetName);
    if (assetUploadBusyKeys.includes(uploadKey)) {
      setAssetUploadStatus(`${assetName} 正在上传并识别，请等待完成。`);
      return;
    }
    setAssetUploadBusyKeys((current) => current.includes(uploadKey) ? current : [...current, uploadKey]);
    setAssetUploadStatus(`正在上传并识别 ${assetName} 的资产图...`);
    try {
      const local = await apiClient.uploadLocalFile({
        key: safeUploadKey(projectId, file.name, uploadKind),
        file,
        contentType: file.type || 'image/png',
      });
      const commonInput = {
        episodeId: activeEpisodeId,
        imageUrl: local.publicUrl,
        fileName: file.name,
        mimeType: local.contentType || file.type,
        sizeBytes: local.sizeBytes ?? file.size,
        aiModelId: assetUploadModelId || workflowAiModelId || undefined,
      };
      const result =
        uploadKind === 'characters'
          ? await apiClient.uploadCharacterReferenceImage(projectId, {
              characterName: assetName,
              ...commonInput,
            })
          : await apiClient.uploadWorkflowAssetReferenceImage(projectId, {
              episodeId: activeEpisodeId,
              assetKind: uploadKind,
              assetName,
              ...commonInput,
            });
      if (result.workflow) {
        setWorkflowAssets(result.workflow.assets ?? defaultWorkflowAssets());
        setStageStatuses(result.workflow.stageStatuses ?? {});
      } else {
        const remote = await apiClient.getProjectWorkflow(projectId, { episodeId: activeEpisodeId });
        if (remote) {
          setWorkflowAssets(remote.assets ?? defaultWorkflowAssets());
          setStageStatuses(remote.stageStatuses ?? {});
        }
      }
      setAssetUploadStatus(
        result.analysisError
          ? `图片已保存，但识图失败：${result.analysisError}`
          : `${assetName} 的参考图已上传，资产信息已更新。`
      );
      setActiveWorkflowStage('assets');
      setActivePanel('assets');
      if (
        assetHistoryTarget &&
        assetHistoryTarget.kind === uploadKind &&
        normalizeCompareText(assetHistoryTarget.asset.name ?? '') === normalizeCompareText(assetName)
      ) {
        void handleOpenAssetHistory(uploadKind, { ...assetHistoryTarget.asset, name: assetName });
      }
    } catch (error) {
      setAssetUploadStatus(error instanceof Error ? error.message : '资产参考图上传失败');
    } finally {
      setAssetUploadBusyKeys((current) => current.filter((key) => key !== uploadKey));
      if (
        pendingAssetUploadRef.current &&
        pendingAssetUploadRef.current.kind === uploadKind &&
        normalizeCompareText(pendingAssetUploadRef.current.name) === normalizeCompareText(assetName)
      ) {
        pendingAssetUploadRef.current = null;
      }
    }
  };

  const handleOpenAssetHistory = async (kind: WorkflowAssetKind, item: WorkflowAssetItem, variantFilter: 'all' | 'with-props' = 'all') => {
    const assetName = item.name?.trim();
    if (!assetName) {
      setAssetHistoryStatus('这个资产缺少名称，无法读取历史图片。');
      return;
    }
    if (projectUnavailable) {
      setAssetHistoryStatus('当前项目不存在，无法读取资产历史。');
      return;
    }
    setAssetHistoryTarget({ kind, asset: item });
    setAssetHistoryVariantFilter(variantFilter);
    setAssetHistoryLoading(true);
    setAssetHistoryStatus(null);
    try {
      const result = await apiClient.listWorkflowAssetImages(projectId, { assetKind: kind, assetName, episodeId: activeEpisodeId });
      setAssetHistoryItems(result.images);
      const filteredCount = variantFilter === 'with-props' ? result.images.filter(assetHistoryImageIsWithProps).length : result.images.length;
      setAssetHistoryStatus(filteredCount > 0 ? null : variantFilter === 'with-props' ? `${assetName} 暂无已生成的道具版图片。请先用小包裹入口生成。` : `${assetName} 暂无历史图片。`);
      setActiveWorkflowStage('assets');
      setActivePanel('assets');
    } catch (error) {
      setAssetHistoryItems([]);
      setAssetHistoryStatus(error instanceof Error ? error.message : '资产历史图片加载失败');
    } finally {
      setAssetHistoryLoading(false);
    }
  };

  const handleLoadAssetHistoryImages = async (kind: AssetHistoryLoadKind = 'all') => {
    if (assetHistoryLoadBusy) return;
    if (projectUnavailable || !projectId || projectId === 'local') {
      setAssetGenerationStatus('当前项目不存在，无法加载历史图片。');
      return;
    }
    const targetKinds: WorkflowAssetKind[] = kind === 'all' ? ['characters', 'scenes', 'props'] : [kind];
    const candidates = targetKinds.flatMap((assetKind) => assetArray(workflowAssets, assetKind)
      .map((asset) => ({ kind: assetKind, asset, name: workflowAssetName(asset), currentUrl: workflowAssetImageUrl(asset) }))
      .filter((item) => item.name));
    if (candidates.length === 0) {
      setAssetGenerationStatus('当前资产区没有可匹配的资产。');
      return;
    }

    setAssetHistoryLoadBusy(true);
    setAssetGenerationStatus(`正在检查 ${candidates.length} 个资产当前图片是否可访问...`);
    const reachableChecks = await Promise.all(candidates.map(async (target) => ({
      ...target,
      currentReachable: target.currentUrl ? await browserImageLooksReachable(target.currentUrl) : false,
    })));
    const targets = reachableChecks.filter((target) => !target.currentReachable);
    if (targets.length === 0) {
      setAssetGenerationStatus('当前资产图片都可正常访问，未重新加载历史图。');
      setAssetHistoryLoadBusy(false);
      return;
    }
    setAssetGenerationBusyKeys((current) => Array.from(new Set([
      ...current,
      ...targets.map((target) => workflowAssetBusyKey(target.kind, target.name)),
    ])));
    setAssetGenerationStatus(`正在为 ${targets.length} 个缺失或失效图片的资产查找可用历史图...`);
    try {
      let latestWorkflow: WorkflowState | null = null;
      let matched = 0;
      let scanned = 0;
      const missed: string[] = [];
      for (const target of targets) {
        scanned += 1;
        setAssetGenerationStatus(`正在验证历史图片 ${scanned}/${targets.length}：${target.name}`);
        const history = await apiClient.listWorkflowAssetImages(projectId, {
          assetKind: target.kind,
          assetName: target.name,
          episodeId: activeEpisodeId,
        });
        const image = await chooseReachableAssetHistoryImage(target.kind, history.images);
        if (!image) {
          missed.push(target.name);
          continue;
        }
        const selected = await apiClient.selectWorkflowAssetImage(projectId, {
          episodeId: activeEpisodeId,
          assetKind: target.kind,
          assetName: target.name,
          assetId: image.id,
        });
        latestWorkflow = selected.workflow;
        matched += 1;
      }
      if (latestWorkflow) {
        setWorkflowAssets(latestWorkflow.assets ?? defaultWorkflowAssets());
        setStageStatuses(latestWorkflow.stageStatuses ?? {});
        setWorkflowDraftProjectId(`${projectId}:${latestWorkflow.episodeId || activeEpisodeId}`);
      }
      setAssetGenerationStatus(matched > 0
        ? `已从可访问历史图片加载 ${matched}/${targets.length} 个资产。${missed.length ? `未匹配：${missed.slice(0, 6).join('、')}${missed.length > 6 ? '等' : ''}` : ''}`
        : `没有匹配到可访问的历史图片。${missed.length ? `检查过：${missed.slice(0, 6).join('、')}${missed.length > 6 ? '等' : ''}` : ''}`);
    } catch (error) {
      setAssetGenerationStatus(error instanceof Error ? error.message : '历史图片加载失败');
    } finally {
      setAssetGenerationBusyKeys((current) => current.filter((key) => !targets.some((target) => key === workflowAssetBusyKey(target.kind, target.name))));
      setAssetHistoryLoadBusy(false);
    }
  };

  const saveCharacterPropBinding = async (character: WorkflowAssetItem, prop: WorkflowAssetItem, shouldBind: boolean) => {
    const characterName = workflowAssetName(character);
    const propName = workflowAssetName(prop);
    if (!characterName || !propName) return;
    if (projectUnavailable) {
      setPropBindingStatus('当前项目不存在，无法保存道具绑定。');
      return;
    }
    setPropBindingBusy(true);
    setPropBindingStatus(`${shouldBind ? '正在绑定' : '正在取消绑定'} ${propName}...`);
    try {
      const characters = assetArray(workflowAssets, 'characters');
      let matchedCharacter = false;
      const nextCharacters = characters.map((current) => {
        if (normalizeCompareText(workflowAssetName(current)) !== normalizeCompareText(characterName)) return current;
        matchedCharacter = true;
        const boundPropNames = nextManualBoundPropNames(current, propName, shouldBind);
        return {
          ...current,
          boundPropNames,
        };
      });
      if (!matchedCharacter) {
        const boundPropNames = nextManualBoundPropNames(character, propName, shouldBind);
        nextCharacters.push({
          ...character,
          name: characterName,
          boundPropNames,
        });
      }
      const nextAssets: WorkflowAssets = {
        ...workflowAssets,
        characters: nextCharacters,
        scenes: assetArray(workflowAssets, 'scenes'),
        props: assetArray(workflowAssets, 'props'),
      };
      const draft = { episodeId: activeEpisodeId, sourceText, sourceName, selectedEpisode, breakdownScenes, clips, assets: nextAssets, stageStatuses };
      setWorkflowAssets(nextAssets);
      setPropPickerCharacter((current) => {
        if (!current || normalizeCompareText(workflowAssetName(current)) !== normalizeCompareText(characterName)) return current;
        return nextCharacters.find((item) => normalizeCompareText(workflowAssetName(item)) === normalizeCompareText(characterName)) ?? current;
      });
      const saved = await apiClient.saveProjectWorkflow(projectId, draft, { episodeId: activeEpisodeId });
      if (saved) {
        setWorkflowAssets(saved.assets ?? nextAssets);
        setStageStatuses(saved.stageStatuses ?? stageStatuses);
        const savedCharacter = assetArray(saved.assets ?? nextAssets, 'characters')
          .find((item) => normalizeCompareText(workflowAssetName(item)) === normalizeCompareText(characterName));
        if (savedCharacter) setPropPickerCharacter(savedCharacter);
      }
      setPropBindingStatus(shouldBind ? `${propName} 已绑定到 ${characterName}。` : `${propName} 已从 ${characterName} 取消绑定。`);
    } catch (error) {
      setPropBindingStatus(error instanceof Error ? error.message : '道具绑定保存失败');
    } finally {
      setPropBindingBusy(false);
    }
  };

  const handleSelectAssetHistoryImage = async (image: WorkflowAssetImageHistoryItem) => {
    const target = assetHistoryTarget;
    const assetName = target?.asset.name?.trim();
    if (!target || !assetName || !image.id) return;
    setAssetHistoryLoading(true);
    setAssetHistoryStatus(`正在把 ${assetName} 的历史图设为当前图...`);
    try {
      const result = await apiClient.selectWorkflowAssetImage(projectId, {
        episodeId: activeEpisodeId,
        assetKind: target.kind,
        assetName,
        assetId: image.id,
      });
      setWorkflowAssets(result.workflow.assets ?? defaultWorkflowAssets());
      setStageStatuses(result.workflow.stageStatuses ?? {});
      setAssetHistoryTarget((current) => current ? {
        ...current,
        asset: assetArray(result.workflow.assets ?? defaultWorkflowAssets(), target.kind)
          .find((candidate) => normalizeCompareText(candidate.name ?? '') === normalizeCompareText(assetName)) ?? current.asset,
      } : current);
      const refreshed = await apiClient.listWorkflowAssetImages(projectId, { assetKind: target.kind, assetName, episodeId: activeEpisodeId });
      setAssetHistoryItems(refreshed.images);
      setAssetHistoryStatus(`${assetName} 当前图已切换。`);
    } catch (error) {
      setAssetHistoryStatus(error instanceof Error ? error.message : '资产历史图切换失败');
    } finally {
      setAssetHistoryLoading(false);
    }
  };

  const handleClearAssetCurrentImage = async (kind: WorkflowAssetKind, item: WorkflowAssetItem) => {
    const assetName = item.name?.trim();
    if (!assetName) return;
    if (isAssetGenerationBusy(kind, item) || isAssetUploadBusy(kind, item)) return;
    if (projectUnavailable) {
      setAssetGenerationStatus('当前项目不存在，无法取消当前资产图。');
      return;
    }
    const busyKey = workflowAssetBusyKey(kind, assetName);
    setAssetGenerationBusyKeys((current) => current.includes(busyKey) ? current : [...current, busyKey]);
    setAssetGenerationStatus(`正在取消 ${assetName} 的当前图...`);
    if (
      assetHistoryTarget &&
      assetHistoryTarget.kind === kind &&
      normalizeCompareText(assetHistoryTarget.asset.name ?? '') === normalizeCompareText(assetName)
    ) {
      setAssetHistoryLoading(true);
      setAssetHistoryStatus(`正在取消 ${assetName} 的当前图...`);
    }
    try {
      const result = await apiClient.clearWorkflowAssetImage(projectId, {
        episodeId: activeEpisodeId,
        assetKind: kind,
        assetName,
      });
      setWorkflowAssets(result.workflow.assets ?? defaultWorkflowAssets());
      setStageStatuses(result.workflow.stageStatuses ?? {});
      setWorkflowDraftProjectId(`${projectId}:${result.workflow.episodeId || activeEpisodeId}`);
      setAssetGenerationStatus(`${assetName} 当前图已取消，历史图片仍保留。`);
      if (
        assetHistoryTarget &&
        assetHistoryTarget.kind === kind &&
        normalizeCompareText(assetHistoryTarget.asset.name ?? '') === normalizeCompareText(assetName)
      ) {
        const refreshed = await apiClient.listWorkflowAssetImages(projectId, { assetKind: kind, assetName, episodeId: activeEpisodeId });
        setAssetHistoryItems(refreshed.images);
        setAssetHistoryTarget((current) => current ? {
          ...current,
          asset: assetArray(result.workflow.assets ?? defaultWorkflowAssets(), kind)
            .find((candidate) => normalizeCompareText(candidate.name ?? '') === normalizeCompareText(assetName)) ?? current.asset,
        } : current);
        setAssetHistoryStatus(`${assetName} 当前图已取消，历史图片仍保留。`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '取消当前资产图失败';
      setAssetGenerationStatus(message);
      if (
        assetHistoryTarget &&
        assetHistoryTarget.kind === kind &&
        normalizeCompareText(assetHistoryTarget.asset.name ?? '') === normalizeCompareText(assetName)
      ) {
        setAssetHistoryStatus(message);
      }
    } finally {
      setAssetGenerationBusyKeys((current) => current.filter((key) => key !== busyKey));
      if (
        assetHistoryTarget &&
        assetHistoryTarget.kind === kind &&
        normalizeCompareText(assetHistoryTarget.asset.name ?? '') === normalizeCompareText(assetName)
      ) {
        setAssetHistoryLoading(false);
      }
    }
  };

  const handleDeleteAssetHistoryImage = async (image: WorkflowAssetImageHistoryItem) => {
    const target = assetHistoryTarget;
    const assetName = target?.asset.name?.trim();
    if (!target || !assetName || !image.id) return;
    if (!window.confirm(`删除「${assetName}」的这张历史图片？${image.isCurrent ? ' 这张是当前图，删除后会清空当前图。' : ''}`)) return;
    setAssetHistoryLoading(true);
    setAssetHistoryStatus(`正在删除 ${assetName} 的历史图...`);
    try {
      const result = await apiClient.deleteWorkflowAssetImage(projectId, {
        episodeId: activeEpisodeId,
        assetKind: target.kind,
        assetName,
        assetId: image.id,
      });
      setWorkflowAssets(result.workflow.assets ?? defaultWorkflowAssets());
      setStageStatuses(result.workflow.stageStatuses ?? {});
      const refreshed = await apiClient.listWorkflowAssetImages(projectId, { assetKind: target.kind, assetName, episodeId: activeEpisodeId });
      setAssetHistoryItems(refreshed.images);
      setAssetHistoryStatus(result.removedCurrent ? `${assetName} 历史图已删除，当前图已清空。` : `${assetName} 历史图已删除。`);
    } catch (error) {
      setAssetHistoryStatus(error instanceof Error ? error.message : '资产历史图删除失败');
    } finally {
      setAssetHistoryLoading(false);
    }
  };

  const handleRemoveWorkflowAsset = async (kind: WorkflowAssetKind, item: WorkflowAssetItem) => {
    const assetName = item.name?.trim();
    if (!assetName) return;
    if (isAssetGenerationBusy(kind, item)) return;
    if (projectUnavailable) {
      setAssetGenerationStatus('当前项目不存在，无法移除资产。');
      return;
    }
    if (!window.confirm(`从当前项目资产库移除「${assetName}」？历史图片不会删除。`)) return;
    setAssetGenerationStatus(`正在移除 ${assetName}...`);
    try {
      const result = await apiClient.removeWorkflowAsset(projectId, { episodeId: activeEpisodeId, assetKind: kind, assetName });
      setWorkflowAssets(result.workflow.assets ?? defaultWorkflowAssets());
      setStageStatuses(result.workflow.stageStatuses ?? {});
      if (
        assetHistoryTarget &&
        assetHistoryTarget.kind === kind &&
        normalizeCompareText(assetHistoryTarget.asset.name ?? '') === normalizeCompareText(assetName)
      ) {
        setAssetHistoryTarget(null);
        setAssetHistoryItems([]);
        setAssetHistoryStatus(null);
      }
      setAssetGenerationStatus(result.removed ? `${assetName} 已从当前资产库移除。` : `${assetName} 不在当前资产库中。`);
    } catch (error) {
      setAssetGenerationStatus(error instanceof Error ? error.message : '资产移除失败');
    }
  };

  const handleGenerateAssetImage = async (kind: WorkflowAssetKind, item: WorkflowAssetItem, options: GenerateAssetImageOptions = {}) => {
    const assetName = item.name?.trim();
    if (!assetName) return;
    const busyKey = workflowAssetBusyKey(kind, assetName);
    const variant = options.variant === 'with-props' ? 'with-props' : 'clean';
    const variantLabel = kind === 'characters' && variant === 'with-props' ? '道具版' : '';
    const isPropVariant = kind === 'characters' && variant === 'with-props';
    const setGenerationMessage = (message: string) => {
      setAssetGenerationStatus(message);
      if (isPropVariant) setPropBindingStatus(message);
    };
    if (assetGenerationBusyKeys.includes(busyKey)) {
      setGenerationMessage(`${assetName}${variantLabel ? ` ${variantLabel}` : ''}资产图正在生成中，请等待完成后再重试。`);
      return;
    }
    if (projectUnavailable) {
      setGenerationMessage('当前项目不存在，无法生成资产图。');
      return;
    }
    const explicitReferenceImageUrl = publicImageUrl(options.referenceImageUrl);
    const currentReferenceImageUrl = publicImageUrl(item.referenceImageUrl) || publicImageUrl(item.generatedImageUrl);
    const shouldUseCurrentReference = Boolean(options.useCurrentReference && !explicitReferenceImageUrl);
    if (shouldUseCurrentReference && !currentReferenceImageUrl) {
      setGenerationMessage(`${assetName} 还没有当前参考图，无法参考生成。`);
      return;
    }
    const explicitReferenceUrls = [
      explicitReferenceImageUrl,
      ...(options.extraReferenceImageUrls ?? []).map(publicImageUrl),
    ].filter(Boolean);
    const linkedPropRefs = kind === 'characters' && variant === 'with-props' ? findCharacterPropReferences(item, workflowAssets) : [];
    const linkedPropUrls = linkedPropRefs.map((reference) => publicImageUrl(reference.url)).filter(Boolean);
    const referenceImageUrls = [
      ...explicitReferenceUrls,
      ...(shouldUseCurrentReference ? [currentReferenceImageUrl] : []),
      ...linkedPropUrls,
    ].filter((url, index, urls) => Boolean(url) && urls.indexOf(url) === index);
    if (variant === 'with-props') {
      if (!currentReferenceImageUrl && !explicitReferenceImageUrl) {
        setGenerationMessage(`${assetName} 需要先有一张角色图，才能生成道具版。`);
        return;
      }
      if (linkedPropRefs.length === 0 || linkedPropUrls.length === 0) {
        setGenerationMessage(`${assetName} 没有找到已选择且有图片的道具。请先上传/生成对应道具图，并在小包裹面板里点选要合成的道具。`);
        return;
      }
    }
    setAssetGenerationBusyKeys((current) => current.includes(busyKey) ? current : [...current, busyKey]);
    const modeLabel = explicitReferenceImageUrl ? '参考选中历史图' : shouldUseCurrentReference ? '参考当前图' : '全新';
    const propLabel = linkedPropRefs.length ? `，合成道具：${linkedPropRefs.map((reference) => reference.name).join('、')}` : '';
    setGenerationMessage(`正在${modeLabel}生成 ${assetName}${variantLabel ? ` ${variantLabel}` : ''}资产图${propLabel}... ${assetGenerationAspectRatio} / ${assetGenerationResolution.toUpperCase()}`);
    try {
      const assetPrompt = firstCleanAssetPromptSeed(item.visualPrompt, item.lockedVisualIdentity, item.description);
      const customPrompt = options.customPrompt?.trim();
      const useExactCustomPrompt = Boolean(options.preservePromptExact && customPrompt);
      const referenceCount = referenceImageUrls.length;
      const prompt = useExactCustomPrompt ? customPrompt : buildCanvasAssetFinalPrompt(kind, {
        name: assetName,
        assetName,
        role: item.role,
        visualPrompt: assetPrompt,
        prompt: assetPrompt,
        customGenerationPrompt: customPrompt || undefined,
        traits: item.lockedVisualIdentity || item.description || item.role || item.fruitIdentity || '',
        description: item.description,
        fruitIdentity: item.fruitIdentity,
        signatureProps: item.signatureProps,
        boundPropNames: variant === 'with-props' ? linkedPropRefs.map((reference) => reference.name) : selectedPropNamesFromCharacter(item),
        primaryLook: item.primaryLook,
        habitualActions: item.habitualActions,
        variant,
        timeOfDay: item.timeOfDay,
        function: item.function,
      }, referenceCount, projectPromptContext);
      if (!isCanvasPromptWithinApiLimit(prompt)) {
        setGenerationMessage(canvasPromptTooLongError('image', prompt.length));
        return;
      }
      const result = await apiClient.generateWorkflowAssetImage(projectId, {
        episodeId: activeEpisodeId,
        assetKind: kind,
        assetName,
        prompt,
        usePromptAsFinal: true,
        preservePromptExact: useExactCustomPrompt,
        variant,
        aiModelId: assetGenerationModelId || undefined,
        size: assetGenerationAspectRatio,
        useCurrentReference: false,
        referenceImageUrls: referenceImageUrls.length ? referenceImageUrls : undefined,
        writeBackToAsset: variant === 'with-props' ? false : undefined,
        parameters: { resolution: assetGenerationResolution, quality: 'high', format: 'png' },
      });
      setWorkflowAssets(result.workflow.assets ?? defaultWorkflowAssets());
      setStageStatuses(result.workflow.stageStatuses ?? {});
      setActiveWorkflowStage('assets');
      setActivePanel('assets');
      setGenerationMessage(variant === 'with-props'
        ? `${assetName} 道具版资产图已生成到历史图。需要使用时点“道具版”选择并设为当前图。${assetGenerationAspectRatio} / ${assetGenerationResolution.toUpperCase()}`
        : `${assetName}资产图已生成并写回资产，可在历史图中切换当前图。${assetGenerationAspectRatio} / ${assetGenerationResolution.toUpperCase()}`);
      if (
        assetHistoryTarget &&
        assetHistoryTarget.kind === kind &&
        normalizeCompareText(assetHistoryTarget.asset.name ?? '') === normalizeCompareText(assetName)
      ) {
        const refreshed = await apiClient.listWorkflowAssetImages(projectId, { assetKind: kind, assetName, episodeId: activeEpisodeId });
        setAssetHistoryItems(refreshed.images);
      }
    } catch (error) {
      setGenerationMessage(error instanceof Error ? error.message : '资产图生成失败');
    } finally {
      setAssetGenerationBusyKeys((current) => current.filter((key) => key !== busyKey));
    }
  };

  const applyWorkflowBreakdownResult = async (
    workflow: WorkflowState,
    options: {
      stage: 'full-breakdown' | 'storyboard';
      assetsFallback: WorkflowAssets;
    },
  ) => {
    const scenes = workflow.breakdownScenes as BreakdownScene[];
    const workflowEpisodeId = workflow.episodeId || activeEpisodeId;
    applyWorkflowSnapshot(workflow, {
      setEpisodeList,
      setActiveEpisodeId,
      setSourceText,
      setSourceName,
      setSelectedEpisode,
      setBreakdownScenes,
      setClips,
      setWorkflowAssets,
      setStageStatuses,
    });
    setWorkflowDraftProjectId(`${projectId}:${workflowEpisodeId}`);
    setActiveWorkflowStage('storyboard');
    if (scenes.length) {
      if (options.stage === 'full-breakdown') {
        handleAddWorkflowNode('episode', workflow.selectedEpisode || selectedEpisode, `${workflow.sourceName || sourceName || '手动输入文本'} · 已导入原文`);
        handleAddWorkflowNode('asset', '资产提取任务', '已由文本模型提取角色、场景、道具资产');
        handleAddWorkflowNode('workflow', '分镜脚本拆解', `已生成 ${workflow.clips?.length ?? 0} 个 Clip、${scenes.length} 条结构化分镜脚本`);
        handleAddWorkflowNode('directorBoard', '章节导演板', '可基于分镜脚本继续生成空间图和六宫格导演板');
      } else {
        handleAddWorkflowNode('workflow', '分镜脚本重新拆解', `已重新生成 ${workflow.clips?.length ?? 0} 个 Clip、${scenes.length} 条结构化分镜脚本`);
      }
    }
    await handleSyncEpisodeBoardsToCanvas({
      episodeId: workflowEpisodeId,
      clips: workflow.clips ?? [],
      scenes,
      assets: workflow.assets ?? options.assetsFallback,
      episode: workflow.selectedEpisode,
      refreshRecords: true,
    });
  };

  const recoverWorkflowBreakdownAfterRequestError = async (
    error: unknown,
    options: WorkflowBreakdownRecoveryOptions,
  ) => {
    if (!shouldRecoverWorkflowAfterRequestError(error)) return false;
    try {
      const remote = await apiClient.getProjectWorkflow(projectId, { episodeId: activeEpisodeId });
      if (workflowHasBreakdownResult(remote) && workflowRunCompletedAfter(remote, options.startedAtMs)) {
        await applyWorkflowBreakdownResult(remote, options);
        workflowBreakdownRecoveryRef.current = null;
        setWorkflowError(null);
        showCanvasDropStatus('后端已完成拆解，已从最新结果恢复。');
        return true;
      }
      if (remote && workflowHasRunningStage(remote.stageStatuses) && workflowRunStartedAfter(remote, options.startedAtMs)) {
        workflowBreakdownRecoveryRef.current = options;
        applyWorkflowSnapshot(remote, {
          setEpisodeList,
          setActiveEpisodeId,
          setSourceText,
          setSourceName,
          setSelectedEpisode,
          setBreakdownScenes,
          setClips,
          setWorkflowAssets,
          setStageStatuses,
        });
        setWorkflowDraftProjectId(`${projectId}:${remote.episodeId || activeEpisodeId}`);
        setWorkflowError(null);
        showCanvasDropStatus('后端已收到拆解请求，前端连接中断后将继续等待远端结果。');
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const handleRunBreakdown = async () => {
    if (!sourceText.trim() || workflowRunning || workflowInferAllRunning || workflowHasRunningStage(stageStatuses)) return;
    if (projectUnavailable) {
      setWorkflowError('当前项目不存在，无法运行 AI 智能拆解。请返回「我的项目」重新进入真实项目。');
      return;
    }
    const startedAtMs = Date.now();
    setWorkflowRunning(true);
    setWorkflowError(null);
    setStageStatuses((current) => ({ ...current, assets: 'running', storyboard: 'running' }));

    try {
      const result = await apiClient.runProjectWorkflow(projectId, {
        episodeId: activeEpisodeId,
        stage: 'full-breakdown',
        sourceText,
        sourceName,
        selectedEpisode,
        aiModelId: workflowAiModelId || undefined,
      });
      await applyWorkflowBreakdownResult(result.workflow, {
        stage: 'full-breakdown',
        assetsFallback: defaultWorkflowAssets(),
      });
    } catch (error) {
      const recovered = await recoverWorkflowBreakdownAfterRequestError(error, {
        stage: 'full-breakdown',
        startedAtMs,
        assetsFallback: defaultWorkflowAssets(),
      });
      if (recovered) return;
      setStageStatuses((current) => ({ ...current, assets: 'failed', storyboard: 'failed' }));
      setWorkflowError(error instanceof Error ? error.message : 'AI智能拆解失败');
    } finally {
      setWorkflowRunning(false);
    }
  };

  const handleRerunStoryboard = async () => {
    if (!sourceText.trim() || workflowRunning || workflowInferAllRunning || workflowHasRunningStage(stageStatuses)) return;
    if (projectUnavailable) {
      setWorkflowError('当前项目不存在，无法重新拆解分镜脚本。请返回「我的项目」重新进入真实项目。');
      return;
    }
    const startedAtMs = Date.now();
    setWorkflowRunning(true);
    setWorkflowError(null);
    setStageStatuses((current) => ({ ...current, source: 'done', storyboard: 'running' }));

    try {
      const result = await apiClient.runProjectWorkflow(projectId, {
        episodeId: activeEpisodeId,
        stage: 'storyboard',
        sourceText,
        sourceName,
        selectedEpisode,
        aiModelId: workflowAiModelId || undefined,
      });
      await applyWorkflowBreakdownResult(result.workflow, {
        stage: 'storyboard',
        assetsFallback: workflowAssets,
      });
    } catch (error) {
      const recovered = await recoverWorkflowBreakdownAfterRequestError(error, {
        stage: 'storyboard',
        startedAtMs,
        assetsFallback: workflowAssets,
      });
      if (recovered) return;
      setStageStatuses((current) => ({ ...current, storyboard: 'failed' }));
      setWorkflowError(error instanceof Error ? error.message : '分镜脚本重新拆解失败');
    } finally {
      setWorkflowRunning(false);
    }
  };

  const handleSyncEpisodeBoardsToCanvas = useCallback(async (override?: EpisodeCanvasSyncRequest) => {
    setActivePanel(null);
    showCanvasDropStatus('正在同步本集故事板和视频板到画布...');
    try {
      const targetEpisodeId = override?.episodeId ?? activeEpisodeId;
      const generationStrategy = projectGenerationStrategy(currentProject);
      if (projectId && projectId !== 'local') {
        const remoteSync = await apiClient.syncEpisodeCanvas(projectId, { episodeId: targetEpisodeId, generationStrategy });
        applyRemoteCanvasScene(remoteSync);
        if (remoteSync.workflow) {
          applyWorkflowSnapshot(remoteSync.workflow, {
            setEpisodeList,
            setActiveEpisodeId,
            setSourceText,
            setSourceName,
            setSelectedEpisode,
            setBreakdownScenes,
            setClips,
            setWorkflowAssets,
            setStageStatuses,
          });
          setWorkflowDraftProjectId(`${projectId}:${remoteSync.workflow.episodeId || targetEpisodeId}`);
        }
        showCanvasDropStatus(`已从后端同步 ${remoteSync.storyboardCount} 个图片分镜故事板和 ${remoteSync.videoCount} 个视频板到画布，恢复 ${remoteSync.recoveredStoryboardCount} 张已生成故事板图，未自动生成。`);
        window.setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 0);
        return;
      }
      const targetClips = override?.clips ?? clips;
      const targetScenes = override?.scenes ?? breakdownScenes;
      const targetEpisode = override?.episode ?? selectedEpisode;
      if (targetClips.length === 0) {
        showCanvasDropStatus('当前集还没有 Clip，无法同步故事板和视频板。');
        return;
      }
      const targetAssets = override?.assets ?? await loadMergedWorkflowAssets();
      let latestStoryboardAssetReferences = storyboardAssetReferences;
      let latestBlockedStoryboardImageUrls = blockedStoryboardImageUrls;
      if (override?.refreshRecords && projectId && projectId !== 'local') {
        try {
          const latestRecords = await apiClient.listGenerationRecords(projectId, { limit: 300, compact: true });
          const targetEpisodeId = override?.episodeId ?? activeEpisodeId;
          const filteredRecords = latestRecords.filter((record) => generationRecordBelongsToEpisode(record, targetEpisodeId, targetEpisode));
          setGenerationRecords(filteredRecords);
          latestStoryboardAssetReferences = storyboardReferencesFromGenerationRecords(filteredRecords, targetClips, { episodeId: targetEpisodeId, episode: targetEpisode });
          latestBlockedStoryboardImageUrls = nonStoryboardImageUrlsFromGenerationRecords(filteredRecords);
        } catch {
          // Keep the currently loaded generation record snapshot.
        }
      }
      const result = syncEpisodeClipBoardsToCanvas({
        episodeId: override?.episodeId ?? activeEpisodeId,
        episode: targetEpisode,
        clips: targetClips,
        scenes: targetScenes,
        assets: targetAssets,
        generationStrategy,
        storyboardAssetRefs: latestStoryboardAssetReferences,
        blockedStoryboardUrls: latestBlockedStoryboardImageUrls,
        projectPromptContext,
        imageModelId: assetGenerationModelId || undefined,
        imageResolution: assetGenerationResolution,
      });
      const store = useCanvasStore.getState();
      if (!canvasNodeListsEqual(result.nodes as any[], store.nodes as any[])) {
        store.setNodes(result.nodes);
      }
      const latestStore = useCanvasStore.getState();
      if (!canvasEdgeListsEqual(result.edges as any[], latestStore.edges as any[])) {
        latestStore.setEdges(result.edges);
      }
      const clipPromptChanged = result.clips.some((nextClip) => {
        const previousClip = targetClips.find((item) => item.id === nextClip.id);
        return previousClip?.storyboardPrompt !== nextClip.storyboardPrompt || previousClip?.seedancePrompt !== nextClip.seedancePrompt;
      });
      if (clipPromptChanged) {
        setClips((current) => current.map((clip) => result.clips.find((item) => item.id === clip.id) ?? clip));
        if (projectId && projectId !== 'local') {
          void apiClient.saveProjectWorkflow(projectId, {
            episodeId: override?.episodeId ?? activeEpisodeId,
            breakdownScenes: targetScenes,
            clips: result.clips,
            assets: targetAssets,
          }, { episodeId: override?.episodeId ?? activeEpisodeId }).catch(() => {
            // Autosave will retry from local state if this immediate sync save fails.
          });
        }
      }
      if (result.removedIds.size > 0) store.markNodesDeleted(result.removedIds);
      showCanvasDropStatus(`已按 ${targetEpisode} 顺序同步 ${result.storyboardCount} 个图片分镜故事板和 ${result.videoCount} 个视频板到画布，未自动生成。`);
      window.setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 0);
    } catch (error) {
      showCanvasDropStatus(`同步本集到画布失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [
    assetGenerationModelId,
    assetGenerationResolution,
    activeEpisodeId,
    applyRemoteCanvasScene,
    blockedStoryboardImageUrls,
    breakdownScenes,
    clips,
    currentProject,
    fitView,
    loadMergedWorkflowAssets,
    projectId,
    projectPromptContext,
    selectedEpisode,
    showCanvasDropStatus,
    storyboardAssetReferences,
  ]);
  useEffect(() => {
    syncEpisodeBoardsToCanvasRef.current = handleSyncEpisodeBoardsToCanvas;
    return () => {
      if (syncEpisodeBoardsToCanvasRef.current === handleSyncEpisodeBoardsToCanvas) {
        syncEpisodeBoardsToCanvasRef.current = null;
      }
    };
  }, [handleSyncEpisodeBoardsToCanvas]);

  const handleInferBoardsAndVideoToCanvas = async (): Promise<InferBoardsAndVideoResult> => {
    if (workflowInferAllRunning || workflowRunning || generatingSeedanceClipId || workflowHasRunningStage(stageStatuses)) {
      return { ok: false, completed: 0, failed: 0 };
    }
    if (projectUnavailable) {
      setWorkflowError('当前项目不存在，无法一键推理并放入画布。请返回「我的项目」重新进入真实项目。');
      return { ok: false, completed: 0, failed: 0 };
    }
    if (!projectId || projectId === 'local') {
      setWorkflowError('本地项目不能调用后端模型推理。请进入真实项目后再执行。');
      return { ok: false, completed: 0, failed: 0 };
    }
    if (clips.length === 0) {
      setWorkflowError('当前集还没有 Clip，无法一键推理故事板和视频提示词。');
      return { ok: false, completed: 0, failed: 0 };
    }

    const initialClipIds = clips.map((clip) => clip.id).filter(Boolean);
    setWorkflowInferAllRunning(true);
    workflowInferAllActiveRequestStartedAtRef.current = Date.now();
    workflowInferAllExpectedClipIdsRef.current = initialClipIds;
    workflowInferAllCompletedClipIdsRef.current = new Set();
    setWorkflowError(null);
    setActiveWorkflowStage('video');
    setStageStatuses((current) => ({ ...current, storyboard: 'running', video: 'running' }));
    showCanvasDropStatus(`正在按顺序推理 ${clips.length} 个 Clip 的故事板和视频提示词...`);

    let latestClips = clips;
    let latestScenes = breakdownScenes;
    let latestAssets = workflowAssets;
    let latestEpisode = selectedEpisode;
    let completed = 0;
    let failed = 0;

    try {
      for (const clip of clips) {
        try {
          const storyboardResult = await apiClient.planProjectWorkflowClipStoryboard(projectId, clip.id, {
            episodeId: activeEpisodeId,
            aiModelId: workflowAiModelId || undefined,
            panelMode: 'ai',
          });
          if (storyboardResult.workflow) {
            latestClips = storyboardResult.workflow.clips ?? latestClips;
            latestScenes = storyboardResult.workflow.breakdownScenes as BreakdownScene[];
            latestAssets = storyboardResult.workflow.assets ?? latestAssets;
            latestEpisode = storyboardResult.workflow.selectedEpisode || latestEpisode;
          } else if (storyboardResult.clip) {
            latestClips = latestClips.map((item) => (item.id === storyboardResult.clip?.id ? storyboardResult.clip : item));
          }
          const plannedClip = storyboardResult.clip ?? latestClips.find((item) => item.id === clip.id) ?? clip;
          const finalPrompt = finalizeClipStoryboardPrompt(plannedClip, storyboardResult.prompt || plannedClip.storyboardPrompt || '', latestClips, latestAssets, latestScenes).prompt;
          latestClips = latestClips.map((item) => (
            item.id === clip.id
              ? {
                  ...item,
                  ...plannedClip,
                  storyboardPrompt: finalPrompt,
                  storyboardPanelCount: storyboardResult.panelCount,
                  storyboardNotes: storyboardResult.notes || plannedClip.storyboardNotes || '',
                  seedancePrompt: '',
                }
              : item
          ));
          await apiClient.saveProjectWorkflow(projectId, {
            episodeId: activeEpisodeId,
            breakdownScenes: latestScenes,
            clips: latestClips,
            assets: latestAssets,
          }, { episodeId: activeEpisodeId });
          setBreakdownScenes(latestScenes);
          setClips(latestClips);
          setWorkflowAssets(latestAssets);
          setStageStatuses((current) => ({ ...current, ...(storyboardResult.workflow?.stageStatuses ?? {}), storyboard: 'done', video: 'running' }));

          const videoResult = await apiClient.generateProjectWorkflowClipSeedancePrompt(projectId, clip.id, {
            episodeId: activeEpisodeId,
            aiModelId: workflowAiModelId || undefined,
          });
          latestClips = videoResult.workflow.clips ?? latestClips;
          latestScenes = videoResult.workflow.breakdownScenes as BreakdownScene[];
          latestAssets = videoResult.workflow.assets ?? latestAssets;
          latestEpisode = videoResult.workflow.selectedEpisode || latestEpisode;
          setBreakdownScenes(latestScenes);
          setClips(latestClips);
          setWorkflowAssets(latestAssets);
          setStageStatuses((current) => ({ ...current, ...(videoResult.workflow.stageStatuses ?? {}), storyboard: 'done', video: 'running' }));
          completed += 1;
          workflowInferAllCompletedClipIdsRef.current.add(clip.id);
        } catch {
          failed += 1;
        }
      }

      const finalStageStatuses = {
        ...stageStatuses,
        storyboard: completed > 0 ? 'done' : 'failed',
        video: completed > 0 ? 'done' : 'failed',
      };
      setStageStatuses(finalStageStatuses);
      if (completed > 0) {
        try {
          const saved = await apiClient.saveProjectWorkflow(projectId, {
            episodeId: activeEpisodeId,
            breakdownScenes: latestScenes,
            clips: latestClips,
            assets: latestAssets,
            stageStatuses: finalStageStatuses,
          }, { episodeId: activeEpisodeId });
          if (saved) {
            latestClips = saved.clips ?? latestClips;
            latestScenes = saved.breakdownScenes as BreakdownScene[];
            latestAssets = saved.assets ?? latestAssets;
            latestEpisode = saved.selectedEpisode || latestEpisode;
            const savedWithFinalStatus = {
              ...saved,
              stageStatuses: {
                ...(saved.stageStatuses ?? {}),
                storyboard: finalStageStatuses.storyboard,
                video: finalStageStatuses.video,
              },
            };
            applyWorkflowSnapshot(saved, {
              setEpisodeList,
              setActiveEpisodeId,
              setSourceText,
              setSourceName,
              setSelectedEpisode,
              setBreakdownScenes,
              setClips,
              setWorkflowAssets,
              setStageStatuses,
            });
            setStageStatuses(savedWithFinalStatus.stageStatuses);
            setWorkflowDraftProjectId(`${projectId}:${saved.episodeId || activeEpisodeId}`);
          }
        } catch {
          // The local completed state stays visible; autosave can retry from the same state.
        }
        await handleSyncEpisodeBoardsToCanvas({
          episodeId: activeEpisodeId,
          clips: latestClips,
          scenes: latestScenes,
          assets: latestAssets,
          episode: latestEpisode,
          refreshRecords: true,
        });
        showCanvasDropStatus(`已完成 ${completed} 个 Clip 的故事板和视频提示词推理，并同步到画布。${failed ? `失败 ${failed} 个。` : ''}`);
      } else {
        showCanvasDropStatus('故事板和视频提示词推理失败，未同步到画布。');
      }
      return { ok: completed > 0, completed, failed };
    } catch (error) {
      setStageStatuses((current) => ({ ...current, storyboard: 'failed', video: 'failed' }));
      setWorkflowError(error instanceof Error ? error.message : '一键推理并放入画布失败');
      return { ok: false, completed, failed: failed || clips.length - completed };
    } finally {
      setWorkflowInferAllRunning(false);
      workflowInferAllActiveRequestStartedAtRef.current = 0;
      workflowInferAllExpectedClipIdsRef.current = [];
      workflowInferAllCompletedClipIdsRef.current = new Set();
    }
  };

  const handleAddSceneNode = (scene: BreakdownScene, index: number) => {
    try {
      const sceneNodes = nodes.filter((n) => n.type === 'scene');
      addNode('scene', { x: 420 + index * 330, y: 220 + (index % 2) * 180 }, {
        title: scene.title,
        description: scene.description,
        action: scene.action,
        dialogue: scene.dialogue,
        durationSeconds: scene.durationSeconds,
        visualPrompt: scene.visualPrompt,
        directorBoardPrompt: scene.directorBoardPrompt,
        status: 'waiting',
        sourceEpisode: selectedEpisode,
        sourceEpisodeId: activeEpisodeId,
      });
      setActivePanel(null);
      showCanvasDropStatus('已把分镜放入画布。');
      if (sceneNodes.length === 0) {
        fitView({ padding: 0.25, duration: 300 });
      }
    } catch (error) {
      showCanvasDropStatus(`分镜放入画布失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleAddClipStoryboardNode = async (clip: Clip, prompt: string) => {
    setActivePanel(null);
    showCanvasDropStatus('正在放入故事板生图节点...');
    try {
      const nodeCount = useCanvasStore.getState().nodes.length;
      const x = 420 + (nodeCount % 3) * 380;
      const y = 160 + Math.floor(nodeCount / 3) * 260;
      const clipScenes = getClipScenes(clip, breakdownScenes);
      const latestAssets = await loadMergedWorkflowAssets();
      let latestStoryboardAssetReferences = storyboardAssetReferences;
      let latestBlockedStoryboardImageUrls = blockedStoryboardImageUrls;
      if (projectId && projectId !== 'local') {
        try {
          const latestRecords = await apiClient.listGenerationRecords(projectId, { limit: 300, compact: true });
          const filteredRecords = latestRecords.filter((record) => generationRecordBelongsToEpisode(record, activeEpisodeId, selectedEpisode));
          setGenerationRecords(filteredRecords);
          latestStoryboardAssetReferences = storyboardReferencesFromGenerationRecords(filteredRecords, clips, { episodeId: activeEpisodeId, episode: selectedEpisode });
          latestBlockedStoryboardImageUrls = nonStoryboardImageUrlsFromGenerationRecords(filteredRecords);
        } catch {
          // Keep the currently loaded generation record snapshot.
        }
      }
      const previousStoryboardRef = findPreviousClipStoryboardReference(
        clip,
        clips,
        useCanvasStore.getState().nodes,
        latestStoryboardAssetReferences,
        latestBlockedStoryboardImageUrls,
      );
      const savedPanelCount = Number(clip.storyboardPanelCount);
      const storyboardPanelCount = Number.isFinite(savedPanelCount) && savedPanelCount >= MIN_CLIP_STORYBOARD_PANEL_COUNT && savedPanelCount <= MAX_CLIP_STORYBOARD_PANEL_COUNT
        ? savedPanelCount
        : suggestClipStoryboardPanelCount(clip, clipScenes);
      const finalStoryboardPrompt = finalizeClipStoryboardImagePrompt(prompt, storyboardPanelCount);
      const promptWithContinuity = appendPreviousStoryboardContinuityPrompt(
        enforceClipStoryboardContinuityPrompt(finalStoryboardPrompt, clip, clipScenes, breakdownScenes, latestAssets),
        previousStoryboardRef,
      );
      const previousStoryboardNodeId = previousStoryboardRef?.nodeId || '';
      const assetReferenceLimit = previousStoryboardRef ? 8 : 9;
      const assetReferences = collectClipAssetReferences(clip, clipScenes, latestAssets, assetReferenceLimit, promptWithContinuity, { includeProps: false, includeScenes: false, allScenes: breakdownScenes });
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
          targetClipId: clip.id,
        }] : []),
        ...assetReferences,
      ];
      const promptWithReferenceMap = appendReferenceImageMapPrompt(
        promptWithContinuity,
        references.map(clipImageReferenceAsCanvasReference),
      );
      const storyboardResolution = assetGenerationResolution;
      const referenceGrid = canvasReferenceGridMetrics(references.length);
      const hasReferenceArea = references.length > 0;
      const referenceAreaWidth = hasReferenceArea ? referenceGrid.width : 0;
      const sectionWidth = CANVAS_SECTION_PADDING_X * 2 + (hasReferenceArea ? referenceAreaWidth + CANVAS_TARGET_SECTION_GAP : 0) + 380;
      const sectionHeight = CANVAS_SECTION_HEADER_HEIGHT + Math.max(referenceGrid.height, CANVAS_GENERATION_NODE_HEIGHT) + CANVAS_SECTION_PADDING_BOTTOM;
      const sectionPosition = {
        x: hasReferenceArea ? x - 420 : x - CANVAS_SECTION_PADDING_X,
        y: y - CANVAS_SECTION_HEADER_HEIGHT,
      };
      const referenceBasePosition = {
        x: sectionPosition.x + CANVAS_SECTION_PADDING_X,
        y: sectionPosition.y + CANVAS_SECTION_HEADER_HEIGHT,
      };
      const generationPosition = {
        x: referenceBasePosition.x + (hasReferenceArea ? referenceAreaWidth + CANVAS_TARGET_SECTION_GAP : 0),
        y: referenceBasePosition.y,
      };
      const sectionId = addCanvasSection(addNode, sectionPosition, { width: sectionWidth, height: sectionHeight }, {
        title: clipCanvasSectionTitle(clip, '故事板参考资产'),
        description: references.length ? '角色参考和上一个故事板连到右侧故事板生图；道具由角色图承载' : '当前没有匹配到可用资产参考图',
        tone: 'amber',
        itemCount: references.length + 1,
        clipId: clip.id,
        sectionKind: 'clip-storyboard-assets',
        sourceEpisode: selectedEpisode,
        sourceEpisodeId: activeEpisodeId,
      });
      const childPositions = new Map<string, { x: number; y: number }>();
      const generationNodeId = addNode('generation', generationPosition, {
        mode: 'standalone',
        title: `${clip.title || 'Clip'} 故事板`,
        description: references.length
          ? `Clip 级导演故事板生图节点，已接入 ${references.length} 张角色/场景参考图`
          : 'Clip 级导演故事板生图节点，当前没有匹配到可用资产参考图',
        prompt: promptWithReferenceMap,
        finalPrompt: promptWithReferenceMap,
        manualFinalPrompt: true,
        status: 'waiting',
        size: '16:9',
        resolution: storyboardResolution,
        quality: 'high',
        format: 'png',
        storyboardPanelCount,
        modelId: assetGenerationModelId || undefined,
        projectPromptContext,
        clipId: clip.id,
        clipTitle: clip.title,
        clipNodeKind: 'storyboard',
        storyboardForClip: true,
        previousStoryboardAssetId: previousStoryboardRef?.assetId || previousStoryboardNodeId,
        sourceEpisode: selectedEpisode,
        sourceEpisodeId: activeEpisodeId,
      });
      childPositions.set(generationNodeId, generationPosition);
      const hasPreviousStoryboardReference = references.some((reference) => reference.kind === 'storyboard' && publicImageUrl(reference.url));
      if (!hasPreviousStoryboardReference && previousStoryboardNodeId && useCanvasStore.getState().nodes.some((node) => node.id === previousStoryboardNodeId)) {
        onConnect({
          source: previousStoryboardNodeId,
          sourceHandle: null,
          target: generationNodeId,
          targetHandle: null,
        });
      }
      references.forEach((reference, index) => {
        const referencePosition = canvasReferenceGridPosition(referenceBasePosition, index);
        const referenceNodeId = addNode('imageInput', {
          x: referencePosition.x,
          y: referencePosition.y,
        }, {
          label: reference.label,
          imageUrl: reference.url,
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
          sourceEpisode: selectedEpisode,
          sourceEpisodeId: activeEpisodeId,
        });
        childPositions.set(referenceNodeId, referencePosition);
        onConnect({
          source: referenceNodeId,
          sourceHandle: null,
          target: generationNodeId,
          targetHandle: null,
        });
      });
      attachNodesToCanvasSection(sectionId, childPositions);
      showCanvasDropStatus(
        references.length
          ? `已把故事板生图节点和 ${references.length} 张参考放入画布并连线。${previousStoryboardRef ? '已接入上一个故事板延续场景和站位。' : ''}`
          : '已把故事板生图节点放入画布，但没有找到带图片的相关资产参考。'
      );
      window.setTimeout(() => fitView({ padding: 0.22, duration: 300 }), 0);
    } catch (error) {
      showCanvasDropStatus(`故事板放入画布失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleAddClipStoryboardImageReferenceNode = (clip: Clip, reference: ClipStoryboardImageReference) => {
    if (!reference.url) {
      showCanvasDropStatus('这张故事板没有可用图片 URL，无法放入画布。');
      return;
    }
    setActivePanel(null);
    if (reference.nodeId && useCanvasStore.getState().nodes.some((node) => node.id === reference.nodeId)) {
      setActivePanel(null);
      window.setTimeout(() => fitView({ padding: 0.24, duration: 300 }), 0);
      showCanvasDropStatus('这张故事板图已经在画布里。');
      return;
    }
    try {
      const nodeCount = useCanvasStore.getState().nodes.length;
      addNode('imageInput', {
        x: 420 + (nodeCount % 3) * 360,
        y: 160 + Math.floor(nodeCount / 3) * 260,
      }, {
        label: reference.title || `${clip.title || 'Clip'} 故事板`,
        imageUrl: reference.url,
        fileName: `${reference.title || `${clip.title || 'Clip'}-storyboard`}.png`,
        uploadStatus: 'linked',
        sourcePrompt: reference.prompt || clip.storyboardPrompt || '',
        uploadError: '',
        imageLoadError: false,
        clipId: clip.id,
        clipNodeKind: 'storyboard',
        storyboardForClip: true,
        assetId: reference.assetId || '',
        sourceEpisode: selectedEpisode,
        sourceEpisodeId: activeEpisodeId,
      });
      showCanvasDropStatus('已把故事板图片作为参考图放入画布。');
      window.setTimeout(() => fitView({ padding: 0.24, duration: 300 }), 0);
    } catch (error) {
      showCanvasDropStatus(`故事板图片放入画布失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleAddClipVideoNode = async (clip: Clip, prompt: string) => {
    setActivePanel(null);
    showCanvasDropStatus('正在放入视频任务...');
    try {
      const nodeCount = useCanvasStore.getState().nodes.length;
      const x = 420 + (nodeCount % 3) * 380;
      const y = 160 + Math.floor(nodeCount / 3) * 260;
      const clipScenes = getClipScenes(clip, breakdownScenes);
      const latestAssets = await loadMergedWorkflowAssets();
      const existingNodes = useCanvasStore.getState().nodes;
      const useMultiReferenceStrategy = isSeedanceMultiReferenceStrategy(projectGenerationStrategy(currentProject));
      const currentStoryboardNode = useMultiReferenceStrategy ? null : findClipStoryboardNode(existingNodes, clip);
      const references = collectClipVideoReferences(clip, clipScenes, latestAssets, existingNodes, storyboardAssetReferences, blockedStoryboardImageUrls, prompt, {
        includeStoryboard: !useMultiReferenceStrategy,
        includeProps: useMultiReferenceStrategy,
        includeScenes: useMultiReferenceStrategy,
        includeMissing: useMultiReferenceStrategy,
      });
      const exactStoryboardRef = useMultiReferenceStrategy ? undefined : findExactClipStoryboardReference(storyboardAssetReferences, clip, blockedStoryboardImageUrls);
      const currentStoryboardUrl = exactStoryboardRef?.url || (currentStoryboardNode ? canvasNodeReferenceUrl(currentStoryboardNode) : '');
      const currentStoryboardAssetId = exactStoryboardRef?.assetId || String(currentStoryboardNode?.data?.outputImageAssetId || currentStoryboardNode?.data?.assetId || '');
      const characterAudioRefs = collectCharacterAudioReferencesFromWorkflow(
        extractDialogueCharacterNames(prompt, clipScenes, assetArray(latestAssets, 'characters'), clip.characters),
        latestAssets,
      );
      const characterAudioMetadata = characterAudioReferenceMetadata(characterAudioRefs);
      const videoReferences = references
        .filter((reference) => reference.kind !== 'storyboard')
        .slice(0, Math.max(0, useMultiReferenceStrategy ? MAX_VIDEO_REFERENCE_IMAGES : MAX_VIDEO_REFERENCE_IMAGES - 1));
      const newReferenceCount = videoReferences.length + (useMultiReferenceStrategy ? 0 : 1);
      const audioReferenceCount = characterAudioRefs.length;
      const totalReferenceNodeCount = newReferenceCount + audioReferenceCount;
      const assetReferenceCount = videoReferences.filter((reference) => reference.kind !== 'storyboard').length;
      const storyboardReferenceCount = useMultiReferenceStrategy ? 0 : 1;
      const referenceGrid = canvasReferenceGridMetrics(totalReferenceNodeCount);
      const hasReferenceArea = totalReferenceNodeCount > 0;
      const referenceAreaWidth = hasReferenceArea ? referenceGrid.width : 0;
      const sectionWidth = CANVAS_SECTION_PADDING_X * 2 + (hasReferenceArea ? referenceAreaWidth + CANVAS_TARGET_SECTION_GAP : 0) + 540;
      const sectionHeight = CANVAS_SECTION_HEADER_HEIGHT + Math.max(referenceGrid.height, CANVAS_VIDEO_NODE_HEIGHT) + CANVAS_SECTION_PADDING_BOTTOM;
      const sectionPosition = {
        x: hasReferenceArea ? x - 420 : x - CANVAS_SECTION_PADDING_X,
        y: y - CANVAS_SECTION_HEADER_HEIGHT,
      };
      const referenceBasePosition = {
        x: sectionPosition.x + CANVAS_SECTION_PADDING_X,
        y: sectionPosition.y + CANVAS_SECTION_HEADER_HEIGHT,
      };
      const videoPosition = {
        x: referenceBasePosition.x + (hasReferenceArea ? referenceAreaWidth + CANVAS_TARGET_SECTION_GAP : 0),
        y: referenceBasePosition.y,
      };
      const sectionId = addCanvasSection(addNode, sectionPosition, { width: sectionWidth, height: sectionHeight }, {
        title: clipCanvasSectionTitle(clip, '视频参考资产'),
        description: useMultiReferenceStrategy
          ? `已接入 ${assetReferenceCount} 个多参资产节点、${audioReferenceCount} 个台词音频坑位`
          : `已接入 ${storyboardReferenceCount} 个故事板坑位、${assetReferenceCount} 张资产参考、${audioReferenceCount} 个台词音频坑位`,
        tone: 'sky',
        itemCount: totalReferenceNodeCount + 1,
        clipId: clip.id,
        sectionKind: 'clip-video-assets',
        sourceEpisode: selectedEpisode,
        sourceEpisodeId: activeEpisodeId,
        characters: clip.characters ?? [],
        ...characterAudioMetadata,
      });
      const childPositions = new Map<string, { x: number; y: number }>();
      const videoNodeId = addNode('video', videoPosition, {
        kind: 'video',
        workflowKind: 'video',
        title: `${clip.title || 'Clip'} 视频任务`,
        description: useMultiReferenceStrategy
          ? `Seedance 多参视频提示词已就绪，已接入 ${assetReferenceCount} 个资产参考节点`
          : `Seedance 视频提示词已就绪，已接入对应故事板坑位和 ${assetReferenceCount} 张资产参考图`,
        scope: '分镜视频',
        statusLabel: '待生成视频',
        prompt,
        seedancePrompt: prompt,
        videoPrompt: prompt,
        clipId: clip.id,
        duration: getClipEstimatedDuration(clip, clipScenes),
        durationSeconds: normalizeVideoDuration(getClipEstimatedDuration(clip, clipScenes)),
        resolution: '720p',
        includeAudio: true,
        ratio: 'adaptive',
        count: 1,
        videoParametersCollapsed: true,
        referenceCount: newReferenceCount,
        generationStrategy: useMultiReferenceStrategy ? SEEDANCE_MULTI_REF_STRATEGY : projectGenerationStrategy(currentProject),
        audioReferenceCount,
        sourceEpisode: selectedEpisode,
        sourceEpisodeId: activeEpisodeId,
        ...characterAudioMetadata,
      });
      childPositions.set(videoNodeId, videoPosition);
      if (!useMultiReferenceStrategy) {
        const storyboardSlotPosition = canvasReferenceGridPosition(referenceBasePosition, 0);
        const storyboardSlotNodeId = addNode('imageInput', {
          x: storyboardSlotPosition.x,
          y: storyboardSlotPosition.y,
        }, {
          ...storyboardSlotImageData(clip, currentStoryboardUrl, currentStoryboardAssetId, exactStoryboardRef?.prompt),
          sourceEpisode: selectedEpisode,
          sourceEpisodeId: activeEpisodeId,
        });
        childPositions.set(storyboardSlotNodeId, storyboardSlotPosition);
        if (currentStoryboardNode) {
          onConnect({
            source: currentStoryboardNode.id,
            sourceHandle: null,
            target: storyboardSlotNodeId,
            targetHandle: null,
          });
        }
        onConnect({
          source: storyboardSlotNodeId,
          sourceHandle: null,
          target: videoNodeId,
          targetHandle: null,
        });
      }
      let createdReferenceIndex = useMultiReferenceStrategy ? 0 : 1;
      videoReferences.forEach((reference) => {
        const url = publicImageUrl(reference.url);
        const referencePosition = canvasReferenceGridPosition(referenceBasePosition, createdReferenceIndex);
        createdReferenceIndex += 1;
        const referenceNodeId = addNode('imageInput', {
          x: referencePosition.x,
          y: referencePosition.y,
        }, {
          label: reference.label,
          imageUrl: url,
          imageAspectRatio: 1.45,
          fileName: `${reference.name}.png`,
          uploadStatus: url ? 'linked' : 'missing',
          sourcePrompt: `${reference.label}，用于 ${clip.title || 'Clip'} 视频连续性参考`,
          uploadError: url ? '' : '该资产还没有参考图，请上传或生成后再生成视频。',
          imageLoadError: false,
          ...(reference.kind === 'storyboard' ? { clipId: clip.id, clipNodeKind: 'storyboard', storyboardForClip: true } : {}),
          assetKind: reference.kind === 'storyboard' ? undefined : reference.kind,
          assetName: reference.name,
          assetId: reference.assetId || '',
          sourceEpisode: selectedEpisode,
          sourceEpisodeId: activeEpisodeId,
        });
        childPositions.set(referenceNodeId, referencePosition);
        onConnect({
          source: referenceNodeId,
          sourceHandle: null,
          target: videoNodeId,
          targetHandle: null,
        });
      });
      characterAudioRefs.forEach((reference) => {
        const referencePosition = canvasReferenceGridPosition(referenceBasePosition, createdReferenceIndex);
        createdReferenceIndex += 1;
        const audioUrl = publicAudioUrl(reference.url);
        const audioNodeId = addNode('audio', {
          x: referencePosition.x,
          y: referencePosition.y,
        }, {
          kind: 'audio',
          workflowKind: 'audio',
          label: `音频参考: ${reference.name}`,
          title: `${reference.name} 音频参考`,
          characterName: reference.name,
          assetName: reference.name,
          assetKind: 'audio',
          audioUrl,
          referenceAudioUrl: audioUrl,
          referenceAudioAssetId: reference.assetId || '',
          assetId: reference.assetId || '',
          fileName: reference.fileName || `${reference.name}-voice-reference`,
          uploadStatus: audioUrl ? 'linked' : 'missing',
          uploadError: audioUrl ? '' : '该角色还没有绑定音频参考',
          sourcePrompt: audioUrl
            ? `${reference.name} 的台词音频参考，用于 ${clip.title || 'Clip'} 视频生成`
            : `${reference.name} 在 ${clip.title || 'Clip'} 有台词，但还没有绑定音频参考`,
          sourceEpisode: selectedEpisode,
          sourceEpisodeId: activeEpisodeId,
        });
        childPositions.set(audioNodeId, referencePosition);
        onConnect({
          source: audioNodeId,
          sourceHandle: null,
          target: videoNodeId,
          targetHandle: null,
        });
      });
      attachNodesToCanvasSection(sectionId, childPositions);
      showCanvasDropStatus(useMultiReferenceStrategy
        ? `已把多参视频任务放入画布，并接入 ${assetReferenceCount} 个资产参考和 ${audioReferenceCount} 个台词音频坑位。`
        : `已把视频任务放入画布，并接入故事板坑位、${assetReferenceCount} 个资产参考和 ${audioReferenceCount} 个台词音频坑位。`);
      window.setTimeout(() => fitView({ padding: 0.22, duration: 300 }), 0);
    } catch (error) {
      showCanvasDropStatus(`视频任务放入画布失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleUpdateScene = (scene: BreakdownScene) => {
    setBreakdownScenes((current) => current.map((item) => (item.id === scene.id ? scene : item)));
  };

  const handleDeleteScene = (sceneId: string) => {
    setBreakdownScenes((current) => current.filter((scene) => scene.id !== sceneId));
  };

  const handleAcceptClip = (clipId: string) => {
    setClips((current) => current.map((clip) => {
      if (clip.id !== clipId) return clip;
      const preflight = clip.preflight && typeof clip.preflight === 'object' ? clip.preflight : {};
      return {
        ...clip,
        preflight: {
          ...preflight,
          pass: true,
          status: '已接受',
          warnings: [],
          risks: [],
          riskTips: [],
          issues: [],
        },
      };
    }));
  };

  const handleUpdateClipStoryboard = (clipId: string, patch: { prompt?: string; panelCount?: number; notes?: string }) => {
    setClips((current) => current.map((clip) => {
      if (clip.id !== clipId) return clip;
      return {
        ...clip,
        ...(patch.prompt !== undefined ? { storyboardPrompt: patch.prompt } : {}),
        ...(patch.panelCount !== undefined ? { storyboardPanelCount: patch.panelCount } : {}),
        ...(patch.notes !== undefined ? { storyboardNotes: patch.notes } : {}),
        ...(patch.prompt !== undefined ? { seedancePrompt: '' } : {}),
      };
    }));
    if (patch.prompt !== undefined) {
      setStageStatuses((current) => ({ ...current, video: 'idle' }));
    }
  };

  const handleOptimizeClip = async (clipId: string) => {
    if (optimizingClipId) return;
    if (projectUnavailable) {
      setWorkflowError('当前项目不存在，无法优化 Clip。请返回「我的项目」重新进入真实项目。');
      return;
    }
    setOptimizingClipId(clipId);
    setWorkflowError(null);
    try {
      const workflow = await apiClient.optimizeProjectWorkflowClip(projectId, clipId, {
        episodeId: activeEpisodeId,
        aiModelId: workflowAiModelId || undefined,
      });
      applyWorkflowSnapshot(workflow, {
        setEpisodeList,
        setActiveEpisodeId,
        setSourceText,
        setSourceName,
        setSelectedEpisode,
        setBreakdownScenes,
        setClips,
        setWorkflowAssets,
        setStageStatuses,
      });
      setWorkflowDraftProjectId(`${projectId}:${workflow.episodeId || activeEpisodeId}`);
      setActiveWorkflowStage('storyboard');
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : 'AI优化 Clip 失败');
    } finally {
      setOptimizingClipId(null);
    }
  };

  const handleGenerateClipSeedancePrompt = async (clipId: string, options: { skipCanvasSync?: boolean } = {}): Promise<ClipVideoPromptInferenceResult> => {
    if (generatingSeedanceClipId) return { ok: false };
    if (projectUnavailable) {
      setWorkflowError('当前项目不存在，无法生成视频提示词。请返回「我的项目」重新进入真实项目。');
      return { ok: false };
    }
    setGeneratingSeedanceClipId(clipId);
    setWorkflowError(null);
    try {
      const result = await apiClient.generateProjectWorkflowClipSeedancePrompt(projectId, clipId, {
        episodeId: activeEpisodeId,
        aiModelId: workflowAiModelId || undefined,
      });
      applyWorkflowSnapshot(result.workflow, {
        setEpisodeList,
        setActiveEpisodeId,
        setSourceText,
        setSourceName,
        setSelectedEpisode,
        setBreakdownScenes,
        setClips,
        setWorkflowAssets,
        setStageStatuses,
      });
      setWorkflowDraftProjectId(`${projectId}:${result.workflow.episodeId || activeEpisodeId}`);
      setActiveWorkflowStage('video');
      if (result.prompt) {
        let changed = false;
        const nextNodes = useCanvasStore.getState().nodes.map((node) => {
          if (!isVideoCanvasNode(node) || node.data?.clipId !== clipId) return node;
          changed = true;
          return {
            ...node,
            data: {
              ...node.data,
              prompt: result.prompt,
              seedancePrompt: result.prompt,
              videoPrompt: result.prompt,
              statusLabel: '视频提示词已更新',
              videoError: '',
            },
          };
        });
        if (changed) setNodes(nextNodes as any);
      }
      const nextAssets = result.workflow.assets ?? workflowAssets;
      if (!options.skipCanvasSync) {
        void handleSyncEpisodeBoardsToCanvas({
          episodeId: result.workflow.episodeId || activeEpisodeId,
          clips: result.workflow.clips ?? [],
          scenes: result.workflow.breakdownScenes as BreakdownScene[],
          assets: nextAssets,
          episode: result.workflow.selectedEpisode,
          refreshRecords: true,
        });
      }
      return {
        ok: true,
        clips: result.workflow.clips ?? [],
        scenes: result.workflow.breakdownScenes as BreakdownScene[],
        assets: nextAssets,
        episode: result.workflow.selectedEpisode,
      };
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : '视频提示词生成失败');
      return { ok: false };
    } finally {
      setGeneratingSeedanceClipId(null);
    }
  };

  const handleFitView = () => {
    fitView({ padding: 0.2, duration: 300 });
  };

  // --- Context menu state ---
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number;
    flowX: number; flowY: number;
    nodeId?: string;
  } | null>(null);
  const [selectedCanvasNodeIds, setSelectedCanvasNodeIds] = useState<string[]>([]);
  const [selectedCanvasEdgeIds, setSelectedCanvasEdgeIds] = useState<string[]>([]);
  const selectedCanvasNodeIdSet = useMemo(() => new Set(selectedCanvasNodeIds), [selectedCanvasNodeIds]);
  const selectedCanvasEdgeIdSet = useMemo(() => new Set(selectedCanvasEdgeIds), [selectedCanvasEdgeIds]);
  const selectedCanvasNodes = useMemo(() => nodes.filter((node) => selectedCanvasNodeIdSet.has(node.id)), [nodes, selectedCanvasNodeIdSet]);
  const selectedCanvasEdges = useMemo(() => edges.filter((edge) => selectedCanvasEdgeIdSet.has(edge.id)), [edges, selectedCanvasEdgeIdSet]);
  const selectedContentNodes = useMemo(
    () => selectedCanvasNodes.filter((node) => node.type !== 'section'),
    [selectedCanvasNodes],
  );
  const selectedSectionNodes = useMemo(
    () => selectedCanvasNodes.filter((node) => node.type === 'section'),
    [selectedCanvasNodes],
  );
  const contextMenuNode = useMemo(
    () => (contextMenu?.nodeId ? nodes.find((node) => node.id === contextMenu.nodeId) : null),
    [contextMenu?.nodeId, nodes],
  );
  const contextMenuIsSection = contextMenuNode?.type === 'section';
  const [connectionStart, setConnectionStart] = useState<ConnectionStartSnapshot | null>(null);
  const [connectionCreateMenu, setConnectionCreateMenu] = useState<ConnectionCreateMenu | null>(null);
  const connectionStartRef = useRef<ConnectionStartSnapshot | null>(null);
  const connectionMenuJustOpenedRef = useRef(false);
  useOnSelectionChange({
    onChange: useCallback(({ nodes: selectedNodes, edges: selectedEdges }) => {
      const nextNodeIds = selectedNodes.map((node) => node.id).sort();
      const nextEdgeIds = selectedEdges.map((edge) => edge.id).sort();
      setSelectedCanvasNodeIds((current) => canvasIdListsEqual(current, nextNodeIds) ? current : nextNodeIds);
      setSelectedCanvasEdgeIds((current) => canvasIdListsEqual(current, nextEdgeIds) ? current : nextEdgeIds);
    }, []),
  });

  // --- Node editing drawer ---
  const [editingNode, setEditingNode] = useState<string | null>(null);
  const editingNodeData = useMemo(() => {
    if (!editingNode) return null;
    return nodes.find((n) => n.id === editingNode) ?? null;
  }, [editingNode, nodes]);

  const handleEditNodeField = useCallback((field: string, value: string) => {
    if (!editingNode) return;
    const updateNodeData = useCanvasStore.getState().updateNodeData;
    updateNodeData(editingNode, { [field]: value });
  }, [editingNode]);

  const handlePaneDoubleClick = useCallback((event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('.react-flow__node')) return;
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      flowX: 0,
      flowY: 0,
    });
  }, []);

  const handlePaneContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      flowX: 0,
      flowY: 0,
    });
  }, []);

  const handleNodeContextMenu = useCallback((event: React.MouseEvent, node: { id: string }) => {
    event.preventDefault();
    event.stopPropagation();
    const nodeIsAlreadySelected = selectedCanvasNodeIdSet.has(node.id);
    if (!nodeIsAlreadySelected) {
      setSelectedCanvasNodeIds([node.id]);
      setSelectedCanvasEdgeIds([]);
    }
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      flowX: 0,
      flowY: 0,
      nodeId: node.id,
    });
  }, [selectedCanvasNodeIdSet]);

  const closeFloatingMenus = useCallback(() => {
    if (connectionMenuJustOpenedRef.current) return;
    setContextMenu(null);
    setConnectionCreateMenu(null);
  }, []);

  const handleContextAddNode = useCallback((type: CanvasNodeKind) => {
    if (!contextMenu) return;
    const position = screenToFlowPosition({ x: contextMenu.x, y: contextMenu.y });
    addNode(type, position);
    setContextMenu(null);
  }, [contextMenu, addNode, screenToFlowPosition]);

  const handleCreateSectionFromSelection = useCallback(() => {
    const selectedNodeIds = selectedCanvasNodeIds;
    const selectedNodes = useCanvasStore.getState().nodes.filter((node) => selectedNodeIds.includes(node.id) && node.type !== 'section');
    if (selectedNodes.length === 0) {
      showCanvasDropStatus('请先框选要放入分区的节点。');
      setContextMenu(null);
      return;
    }
    const allNodes = useCanvasStore.getState().nodes;
    const bounds = canvasNodesBoundingBox(selectedNodes, allNodes);
    if (!bounds) {
      showCanvasDropStatus('选中节点无法计算分区范围。');
      setContextMenu(null);
      return;
    }
    const sectionPosition = {
      x: bounds.minX - CANVAS_SECTION_PADDING_X,
      y: bounds.minY - CANVAS_SECTION_HEADER_HEIGHT,
    };
    const sectionSize = {
      width: Math.max(360, bounds.width + CANVAS_SECTION_PADDING_X * 2),
      height: Math.max(220, bounds.height + CANVAS_SECTION_HEADER_HEIGHT + CANVAS_SECTION_PADDING_BOTTOM),
    };
    const title = selectedNodes.length > 1 ? `分区 · ${selectedNodes.length} 个节点` : '分区 · 1 个节点';
    const sectionId = addCanvasSection(addNode, sectionPosition, sectionSize, {
      title,
      description: '框选节点生成的分区',
      tone: 'zinc',
      itemCount: selectedNodes.length,
      sectionKind: 'manual-selection',
    });
    const childPositions = new Map<string, { x: number; y: number }>();
    const nodeById = new Map(allNodes.map((item) => [item.id, item]));
    for (const node of selectedNodes) {
      if (node.id === sectionId || node.type === 'section') continue;
      childPositions.set(node.id, canvasNodeAbsolutePosition(node, nodeById));
    }
    attachNodesToCanvasSection(sectionId, childPositions);
    setContextMenu(null);
    showCanvasDropStatus(`已把 ${childPositions.size} 个节点放入分区。`);
  }, [addNode, selectedCanvasNodeIds, showCanvasDropStatus]);

  const handleUngroupSelection = useCallback(() => {
    const store = useCanvasStore.getState();
    const allNodes = store.nodes;
    const selectedNodeIds = selectedCanvasNodeIds;
    const selectedNodes = allNodes.filter((node) => selectedNodeIds.includes(node.id));
    const selectedSectionIds = new Set(selectedNodes.filter((node) => node.type === 'section').map((node) => node.id));
    const selectedParentIds = new Set(selectedNodes.map((node) => node.parentId).filter((value): value is string => Boolean(value)));
    const targetSectionIds = new Set([...selectedSectionIds, ...selectedParentIds]);
    if (targetSectionIds.size === 0) {
      showCanvasDropStatus('没有选中可取消的分区。');
      setContextMenu(null);
      return;
    }
    const nodeById = new Map(allNodes.map((node) => [node.id, node]));
    const childIds = new Set<string>();
    for (const node of allNodes) {
      if (node.parentId && targetSectionIds.has(node.parentId)) childIds.add(node.id);
    }
    const nextNodes = allNodes
      .filter((node) => !targetSectionIds.has(node.id))
      .map((node) => {
        if (!childIds.has(node.id)) return node;
        const absolutePosition = canvasNodeAbsolutePosition(node, nodeById);
        return {
          ...node,
          parentId: undefined,
          extent: node.extent === 'parent' ? undefined : node.extent,
          expandParent: undefined,
          position: absolutePosition,
          selected: true,
        };
      });
    const nextEdges = store.edges.filter((edge) => !targetSectionIds.has(edge.source) && !targetSectionIds.has(edge.target));
    store.setNodes(recalculateCanvasSectionItemCounts(nextNodes));
    store.setEdges(nextEdges);
    setContextMenu(null);
    showCanvasDropStatus(`已取消 ${targetSectionIds.size} 个分区。`);
  }, [selectedCanvasNodeIds, showCanvasDropStatus]);

  const openConnectionCreateMenu = useCallback((point: { x: number; y: number }, start: ConnectionStartSnapshot) => {
    const menuPoint = clampConnectionMenuPoint(point);
    const flowPosition = screenToFlowPosition(point);
    connectionMenuJustOpenedRef.current = true;
    setConnectionCreateMenu({
      x: menuPoint.x,
      y: menuPoint.y,
      flowX: flowPosition.x,
      flowY: flowPosition.y,
      nodeId: start.nodeId,
      handleId: start.handleId,
      handleType: start.handleType,
    });
    setContextMenu(null);
    window.setTimeout(() => {
      connectionMenuJustOpenedRef.current = false;
    }, 250);
  }, [screenToFlowPosition]);

  const handleConnectStart: OnConnectStart = useCallback((_event, params) => {
    if (!params.nodeId || !params.handleType) return;
    const start = {
      nodeId: params.nodeId,
      handleId: params.handleId,
      handleType: params.handleType,
    };
    connectionStartRef.current = start;
    setConnectionStart(start);
    setConnectionCreateMenu(null);
    setContextMenu(null);
  }, []);

  const handleConnectEnd: OnConnectEnd = useCallback((event, connectionState) => {
    if (connectionState.toNode) {
      connectionStartRef.current = null;
      setConnectionStart(null);
      setConnectionCreateMenu(null);
      return;
    }

    const point = clientPointFromConnectionEvent(event);
    const fromHandle = connectionState.fromHandle;
    const start = fromHandle?.nodeId && fromHandle?.type
      ? {
          nodeId: fromHandle.nodeId,
          handleId: fromHandle.id ?? null,
          handleType: fromHandle.type,
        }
      : connectionStartRef.current ?? connectionStart;
    if (!point || !start) {
      connectionStartRef.current = null;
      setConnectionStart(null);
      return;
    }

    openConnectionCreateMenu(point, start);
    connectionStartRef.current = null;
    setConnectionStart(null);
  }, [connectionStart, openConnectionCreateMenu]);

  const handleCanvasPointerUpCapture = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = connectionStartRef.current;
    if (!start) return;
    const target = event.target as HTMLElement;
    if (target.closest('.react-flow__handle')) return;
    const point = { x: event.clientX, y: event.clientY };
    window.setTimeout(() => {
      const latestStart = connectionStartRef.current;
      if (!latestStart) return;
      openConnectionCreateMenu(point, latestStart);
      connectionStartRef.current = null;
      setConnectionStart(null);
    }, 0);
  }, [openConnectionCreateMenu]);

  useEffect(() => {
    if (!connectionStart) return;
    const handleDocumentPointerUp = (event: PointerEvent) => {
      const point = { x: event.clientX, y: event.clientY };
      window.setTimeout(() => {
        const latestStart = connectionStartRef.current;
        if (!latestStart) return;
        openConnectionCreateMenu(point, latestStart);
        connectionStartRef.current = null;
        setConnectionStart(null);
      }, 0);
    };
    document.addEventListener('pointerup', handleDocumentPointerUp, true);
    return () => {
      document.removeEventListener('pointerup', handleDocumentPointerUp, true);
    };
  }, [connectionStart, openConnectionCreateMenu]);

  const handleConnectionCreateNode = useCallback((option: ConnectionCreateOption) => {
    if (!connectionCreateMenu) return;
    const newNodeId = addNode(option.type, {
      x: connectionCreateMenu.flowX,
      y: connectionCreateMenu.flowY,
    }, option.data);
    const connection: Connection = connectionCreateMenu.handleType === 'target'
      ? {
          source: newNodeId,
          sourceHandle: null,
          target: connectionCreateMenu.nodeId,
          targetHandle: connectionCreateMenu.handleId,
        }
      : {
          source: connectionCreateMenu.nodeId,
          sourceHandle: connectionCreateMenu.handleId,
          target: newNodeId,
          targetHandle: null,
        };
    onConnect(connection);
    setConnectionCreateMenu(null);
  }, [addNode, connectionCreateMenu, onConnect]);

  const connectionCreateOptions = useMemo<ConnectionCreateOption[]>(() => {
    if (!connectionCreateMenu) return [];
    if (connectionCreateMenu.handleType === 'target') {
      return [
        { key: 'image-input', type: 'imageInput', label: '图片输入', desc: '作为上游参考图', icon: ImageIcon, tone: 'text-sky-300' },
        { key: 'image-generation', type: 'generation', label: '图片', desc: '生成或重绘图片', icon: ImagePlay, tone: 'text-emerald-300', data: { mode: 'standalone', title: '自由生图' } },
        { key: 'character', type: 'character', label: '角色', desc: '引用角色资产', icon: Users, tone: 'text-violet-300' },
        { key: 'asset', type: 'asset', label: '资产', desc: '引用项目资产', icon: Package, tone: 'text-amber-300' },
      ];
    }
    return [
      { key: 'text', type: 'workflow', label: '文本', desc: '脚本、广告词、品牌文案', icon: FileText, tone: 'text-zinc-100', data: { title: '文本生成', description: '引用该节点生成文本', workflowKind: 'text' } },
      { key: 'translation', type: 'translation', label: '翻译', desc: '把上游提示词翻译后继续连接', icon: Languages, tone: 'text-cyan-300', data: { title: '提示词翻译' } },
      { key: 'prompt-optimizer', type: 'promptOptimizer', label: '优化', desc: '手动优化不过审提示词', icon: Wand2, tone: 'text-violet-300', data: { title: '提示词优化' } },
      { key: 'prompt-inspector', type: 'promptInspector', label: '检查', desc: '向上游提示词提问', icon: ClipboardCheck, tone: 'text-amber-300', data: { title: '提示词检查' } },
      { key: 'image', type: 'generation', label: '图片', desc: '参考图、资产图、自由生图', icon: ImagePlay, tone: 'text-emerald-300', data: { mode: 'standalone', title: '自由生图' } },
      { key: 'video', type: 'video', label: '视频', desc: '引用该节点生成视频', icon: Film, tone: 'text-sky-300', data: { title: '视频生成', description: '引用该节点生成视频', workflowKind: 'video' } },
      { key: 'world', type: 'workflow', label: '3D 世界', desc: '空间、场景、世界构建', icon: Layers3, tone: 'text-zinc-100', data: { title: '3D 世界', description: '引用该节点构建空间世界', workflowKind: 'world' } },
    ];
  }, [connectionCreateMenu]);

  const addDroppedImageInputNode = useCallback((
    position: { x: number; y: number },
    data: { imageUrl: string; label: string; fileName?: string; imageAspectRatio?: number | null; uploadStatus?: string; sourcePrompt?: string },
  ) => {
    addNode('imageInput', position, {
      label: data.label || '图片输入',
      imageUrl: data.imageUrl,
      fileName: data.fileName || data.label || '',
      imageAspectRatio: data.imageAspectRatio || undefined,
      uploadStatus: data.uploadStatus || 'uploaded',
      sourcePrompt: data.sourcePrompt || '',
      uploadError: '',
      imageLoadError: false,
    });
  }, [addNode]);

  const addDroppedGenerationNode = useCallback((position: { x: number; y: number }, payload: CanvasImageDragPayload) => {
    const assetKind = normalizeWorkflowAssetKind(payload.assetKind) ?? 'characters';
    const assetName = payload.assetName || payload.label || imageLabelFromUrl(payload.url);
    const prompt = payload.prompt || payload.revisedPrompt || '';
    addNode('generation', position, {
      title: assetName,
      assetKind,
      assetName,
      prompt,
      finalPrompt: prompt,
      visualPrompt: prompt,
      status: 'completed',
      outputImage: payload.url,
      outputImageAssetId: payload.assetId || '',
      generationId: payload.generationId || '',
      revisedPrompt: payload.revisedPrompt || '',
      size: payload.size || assetGenerationAspectRatio,
      resolution: payload.resolution || assetGenerationResolution,
      quality: payload.quality || 'high',
      modelLabel: payload.modelLabel || '',
      projectPromptContext,
    });
  }, [addNode, assetGenerationAspectRatio, assetGenerationResolution, projectPromptContext]);

  const handleCanvasDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasImage(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setCanvasDropActive(true);
  }, []);

  const handleCanvasDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      setCanvasDropActive(false);
    }
  }, []);

  const handleCanvasDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasImage(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    setCanvasDropActive(false);

    const basePosition = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const dropPosition = { x: basePosition.x - 90, y: basePosition.y - 70 };
    const existingImagePayload = extractDroppedImagePayload(event.dataTransfer);
    if (existingImagePayload) {
      if (existingImagePayload.nodeType === 'generation') {
        addDroppedGenerationNode(dropPosition, existingImagePayload);
        showCanvasDropStatus('已把历史生成图和本次提示词放入画布。');
        return;
      }
      addDroppedImageInputNode(dropPosition, {
        imageUrl: existingImagePayload.url,
        label: existingImagePayload.label || imageLabelFromUrl(existingImagePayload.url),
        fileName: existingImagePayload.fileName || existingImagePayload.label || imageLabelFromUrl(existingImagePayload.url),
        sourcePrompt: existingImagePayload.prompt || '',
        uploadStatus: 'linked',
      });
      showCanvasDropStatus('已用现有图片创建图片输入节点。');
      return;
    }

    const imageFiles = Array.from(event.dataTransfer.files ?? []).filter(isImageDropFile);

    if (imageFiles.length > 0) {
      if (projectUnavailable) {
        showCanvasDropStatus('当前项目不存在，不能上传图片到画布。');
        return;
      }
      setCanvasDropStatus(`正在上传 ${imageFiles.length} 张图片...`);
      let added = 0;
      for (const [index, file] of imageFiles.entries()) {
        try {
          const [publicUrl, aspectRatio] = await Promise.all([
            uploadCanvasReferenceFile(projectId || 'local', file),
            getImageFileAspectRatio(file),
          ]);
          addDroppedImageInputNode(
            { x: dropPosition.x + index * 28, y: dropPosition.y + index * 28 },
            {
              imageUrl: publicUrl,
              label: file.name || '图片输入',
              fileName: file.name,
              imageAspectRatio: aspectRatio,
              uploadStatus: 'uploaded',
            },
          );
          added += 1;
          setCanvasDropStatus(`已添加 ${added}/${imageFiles.length} 张图片到画布。`);
        } catch (error) {
          showCanvasDropStatus(error instanceof Error ? error.message : '图片拖入上传失败。');
          return;
        }
      }
      showCanvasDropStatus(`已添加 ${added} 张图片输入节点。`);
      return;
    }

    showCanvasDropStatus('没有识别到可用图片。请拖入图片文件或公网图片。');
  }, [addDroppedGenerationNode, addDroppedImageInputNode, projectId, projectUnavailable, screenToFlowPosition, showCanvasDropStatus]);

  const handleCanvasImageFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const imageFiles = Array.from(event.target.files ?? []).filter(isImageDropFile);
    event.target.value = '';
    if (imageFiles.length === 0) return;
    if (projectUnavailable) {
      showCanvasDropStatus('当前项目不存在，不能上传图片到画布。');
      return;
    }
    const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const basePosition = { x: center.x - 130, y: center.y - 90 };
    setCanvasDropStatus(`正在上传 ${imageFiles.length} 张图片到画布...`);
    let added = 0;
    for (const [index, file] of imageFiles.entries()) {
      try {
        const [publicUrl, aspectRatio] = await Promise.all([
          uploadCanvasReferenceFile(projectId || 'local', file),
          getImageFileAspectRatio(file),
        ]);
        addDroppedImageInputNode(
          { x: basePosition.x + index * 34, y: basePosition.y + index * 34 },
          {
            imageUrl: publicUrl,
            label: file.name || '图片输入',
            fileName: file.name,
            imageAspectRatio: aspectRatio,
            uploadStatus: 'uploaded',
          },
        );
        added += 1;
      } catch (error) {
        showCanvasDropStatus(error instanceof Error ? error.message : '图片上传到画布失败。');
        return;
      }
    }
    showCanvasDropStatus(`已上传 ${added} 张图片，并创建图片输入节点。`);
  }, [addDroppedImageInputNode, projectId, projectUnavailable, screenToFlowPosition, showCanvasDropStatus]);

  const handleAddHistoryImageInputToCanvas = useCallback((imageUrl: string, label: string, sourcePrompt?: string) => {
    const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    addDroppedImageInputNode(
      { x: center.x - 130, y: center.y - 90 },
      {
        imageUrl,
        label,
        fileName: label,
        sourcePrompt: sourcePrompt || '',
        uploadStatus: 'linked',
      },
    );
    showCanvasDropStatus('已作为图片输入放入画布。');
  }, [addDroppedImageInputNode, screenToFlowPosition, showCanvasDropStatus]);

  const handleAddLibraryDirectorBoardToCanvas = useCallback((entry: DirectorBoardLibraryItem) => {
    const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    addDroppedImageInputNode(
      { x: center.x - 150, y: center.y - 100 },
      {
        imageUrl: entry.imageUrl,
        label: entry.name || '导演板',
        fileName: `${entry.episodeTitle}-${entry.name || '导演板'}.png`,
        imageAspectRatio: 1.78,
        sourcePrompt: entry.prompt,
        uploadStatus: 'linked',
      },
    );
    showCanvasDropStatus(`已把 ${entry.episodeTitle} · ${entry.name} 作为图片输入放入画布。`);
  }, [addDroppedImageInputNode, screenToFlowPosition, showCanvasDropStatus]);

  const handleContextDeleteNode = useCallback(() => {
    if (!contextMenu?.nodeId) return;
    const store = useCanvasStore.getState();
    const target = store.nodes.find((node) => node.id === contextMenu.nodeId);
    if (!target) {
      setContextMenu(null);
      return;
    }
    if (target.type === 'section') {
      const descendantIds = collectCanvasSectionDescendantIds(store.nodes, target.id);
      const removeIds = new Set([target.id, ...descendantIds]);
      if (!window.confirm(`确定删除这个分区里的 ${descendantIds.size} 个节点吗？分区和相关连线也会删除。`)) return;
      const nextNodes = store.nodes.filter((node) => !removeIds.has(node.id));
      const nextEdges = store.edges.filter((edge) => !removeIds.has(edge.source) && !removeIds.has(edge.target));
      store.markNodesDeleted(removeIds);
      store.setNodes(recalculateCanvasSectionItemCounts(nextNodes));
      store.setEdges(nextEdges);
      showCanvasDropStatus(`已删除分区和 ${descendantIds.size} 个分区内节点。`);
      setContextMenu(null);
      return;
    }
    store.removeNode(contextMenu.nodeId);
    setContextMenu(null);
  }, [contextMenu, showCanvasDropStatus]);

  const handleContextDuplicateNode = useCallback(() => {
    if (!contextMenu?.nodeId) return;
    const source = nodes.find((n) => n.id === contextMenu.nodeId);
    if (!source) return;
    if (source.type === 'section') {
      showCanvasDropStatus('分区复制暂不支持，请框选分区内节点后重新创建分区。');
      setContextMenu(null);
      return;
    }
    addNode(
      (source.type as CanvasNodeKind) || 'scene',
      { x: source.position.x + 50, y: source.position.y + 50 },
      { ...source.data }
    );
    setContextMenu(null);
  }, [contextMenu, nodes, addNode]);

  // --- Batch delete ---
  const handleDeleteSelected = useCallback(() => {
    const selectedNodeIds = selectedCanvasNodeIds;
    const selectedEdgeIds = selectedCanvasEdgeIds;
    const selectedNodes = nodes.filter((n) => selectedNodeIds.includes(n.id));
    const selectedEdges = edges.filter((e) => selectedEdgeIds.includes(e.id));
    if (selectedNodes.length === 0 && selectedEdges.length === 0) return;
    const count = selectedNodes.length + selectedEdges.length;
    if (!window.confirm(`确定删除选中的 ${count} 个元素吗？`)) return;
    const nodeIds = new Set(selectedNodes.map((n) => n.id));
    for (const node of selectedNodes) {
      if (node.type !== 'section') continue;
      for (const descendantId of collectCanvasSectionDescendantIds(nodes, node.id)) {
        nodeIds.add(descendantId);
      }
    }
    const newNodes = detachNodesFromRemovedParents(nodes, nodeIds, nodes);
    const newEdges = edges.filter((e) => !selectedEdgeIds.includes(e.id) && !nodeIds.has(e.source) && !nodeIds.has(e.target));
    markCanvasNodesDeleted(nodeIds);
    setNodes(newNodes);
    setEdges(newEdges);
    setSelectedCanvasNodeIds([]);
    setSelectedCanvasEdgeIds([]);
  }, [nodes, edges, markCanvasNodesDeleted, selectedCanvasEdgeIds, selectedCanvasNodeIds, setNodes, setEdges]);

  // --- Reset canvas ---
  const handleResetCanvas = useCallback(() => {
    if (!window.confirm('确定要清空画布吗？所有节点和连线将被删除，此操作不可撤销。')) return;
    markCanvasNodesDeleted(nodes.map((node) => node.id));
    setNodes([]);
    setEdges([]);
  }, [markCanvasNodesDeleted, nodes, setNodes, setEdges]);

  // Keyboard shortcut for delete
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
        if (selectedCanvasNodeIds.length > 0 || selectedCanvasEdgeIds.length > 0) {
          e.preventDefault();
          handleDeleteSelected();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleDeleteSelected, selectedCanvasEdgeIds.length, selectedCanvasNodeIds.length]);

  // --- Edge click to disconnect ---
  const handleEdgeClick = useCallback((_event: React.MouseEvent, edge: { id: string; source: string; target: string }) => {
    const sourceNode = nodes.find((n) => n.id === edge.source);
    const targetNode = nodes.find((n) => n.id === edge.target);
    const label = `${sourceNode?.data?.title || sourceNode?.data?.name || edge.source} → ${targetNode?.data?.title || targetNode?.data?.name || edge.target}`;
    if (window.confirm(`断开连线「${label}」？`)) {
      setEdges(edges.filter((e) => e.id !== edge.id));
    }
  }, [nodes, edges, setEdges]);

  // --- Auto-trigger downstream when upstream completes ---
  const prevNodeStatuses = useRef<Record<string, string>>({});

  useEffect(() => {
    const currentStatuses: Record<string, string> = {};
    for (const node of nodes) {
      if (node.data?.status) {
        currentStatuses[node.id] = node.data.status as string;
      }
    }

    const prev = prevNodeStatuses.current;
    for (const node of nodes) {
      const nodeStatus = node.data?.status as string | undefined;
      if (nodeStatus === 'completed' && prev[node.id] && prev[node.id] !== 'completed') {
        const downstreamEdges = edges.filter((e) => e.source === node.id);
        for (const edge of downstreamEdges) {
          const target = nodes.find((n) => n.id === edge.target);
          if (target && target.data?.status === 'waiting') {
            const updateNodeData = useCanvasStore.getState().updateNodeData;
            updateNodeData(target.id, { status: 'generating' });
            setTimeout(() => {
              updateNodeData(target.id, {
                status: 'completed',
                image: target.data?.image || 'https://images.unsplash.com/photo-1618331835717-801e976710b2?w=600&q=80',
              });
            }, 3000);
          }
        }
      }
    }

    prevNodeStatuses.current = currentStatuses;
  }, [nodes, edges]);

  const flowNodes = useMemo(() => uniqueCanvasNodesById(normalizeReactFlowCanvasNodes(nodes as any[]) as typeof nodes), [nodes]);
  const nodeStatusById = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of nodes) {
      const status = node.data?.status;
      if (typeof status === 'string') map.set(node.id, status);
    }
    return map;
  }, [nodes]);

  // Style edges based on connection status
  const styledEdges = useMemo(() => {
    let changed = false;
    const nextEdges = edges.map((edge) => {
      const sourceStatus = nodeStatusById.get(edge.source);
      const targetStatus = nodeStatusById.get(edge.target);

      let style = { ...edge.style };
      let animated = edge.animated ?? false;

      if (sourceStatus === 'completed' && targetStatus === 'generating') {
        style = { ...style, stroke: '#6366f1', strokeWidth: 2 };
        animated = true;
      } else if (sourceStatus === 'completed' && targetStatus === 'completed') {
        style = { ...style, stroke: '#22c55e', strokeWidth: 1.5 };
        animated = false;
      } else if (sourceStatus === 'completed') {
        style = { ...style, stroke: '#6366f1', strokeWidth: 1.5 };
        animated = false;
      } else {
        style = { ...style, stroke: '#3f3f46' };
        animated = false;
      }

      if (edge.animated === animated && canvasStyleValuesEqual(edge.style, style)) return edge;
      changed = true;
      return { ...edge, style, animated };
    });
    return changed ? nextEdges : edges;
  }, [edges, nodeStatusById]);

  useEffect(() => {
    const signature = flowNodes.map(canvasNodeChangeSignature).join('\n');
    if (reactFlowNodeSignatureRef.current === signature) return;
    reactFlowNodeSignatureRef.current = signature;
    setReactFlowNodes(flowNodes);
  }, [flowNodes, setReactFlowNodes]);

  useEffect(() => {
    const signature = styledEdges
      .map((edge) => [
        edge.id,
        edge.source,
        edge.target,
        edge.sourceHandle || '',
        edge.targetHandle || '',
        edge.type || '',
        edge.animated ? '1' : '0',
        stableCanvasValue(edge.style),
        stableCanvasValue(edge.data),
      ].join('|'))
      .join('\n');
    if (reactFlowEdgeSignatureRef.current === signature) return;
    reactFlowEdgeSignatureRef.current = signature;
    setReactFlowEdges(styledEdges);
  }, [styledEdges, setReactFlowEdges]);

  return (
    <div className="flex h-full flex-col bg-[#09090b]">
      {/* Toolbar */}
      <div className="z-10 flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-[#141416] px-3 py-2 sm:flex-nowrap sm:px-4">
        <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto sm:gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="h-8 gap-1 bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
            onClick={handleAddNode}
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">添加节点</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-8 gap-1 bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
            onClick={() => canvasImageFileRef.current?.click()}
          >
            <UploadCloud className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">上传图片</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-8 gap-1 bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
            onClick={openProjectGlobalSettings}
            disabled={projectUnavailable}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">全局设定</span>
          </Button>
          <div className="mx-1 h-4 w-px shrink-0 bg-zinc-700 sm:mx-2" />
          <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-zinc-100" title="撤销">
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-zinc-100" title="重做">
            <RotateCw className="h-4 w-4" />
          </Button>
          <div className="mx-1 h-4 w-px shrink-0 bg-zinc-700 sm:mx-2" />
          <Button variant="ghost" size="sm" className="h-8 shrink-0 text-zinc-400 hover:text-zinc-100">自动布局</Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 text-zinc-400 hover:text-zinc-100"
            onClick={handleFitView}
          >
            适应屏幕
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 text-zinc-400 hover:text-zinc-100"
            onClick={handleDeleteSelected}
            disabled={selectedCanvasNodes.length === 0 && selectedCanvasEdges.length === 0}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">删除选中</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 text-zinc-400 hover:text-zinc-100"
            onClick={handleCreateSectionFromSelection}
            disabled={selectedContentNodes.length === 0}
          >
            <Layers3 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">给选中分区</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 text-zinc-400 hover:text-zinc-100"
            onClick={handleUngroupSelection}
            disabled={selectedSectionNodes.length === 0 && !selectedContentNodes.some((node) => node.parentId)}
          >
            <X className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">取消分区</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
            onClick={handleResetCanvas}
          >
            清空画布
          </Button>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button className="h-8 gap-1.5 bg-indigo-600 hover:bg-indigo-500">
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">导出项目</span>
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <div
        className="relative h-full w-full flex-1 overflow-hidden"
        onContextMenu={(event) => event.preventDefault()}
        onDoubleClick={handlePaneDoubleClick}
        onClick={contextMenu || connectionCreateMenu ? closeFloatingMenus : undefined}
        onPointerUpCapture={handleCanvasPointerUpCapture}
        onDragOverCapture={handleCanvasDragOver}
        onDragOver={handleCanvasDragOver}
        onDragLeave={handleCanvasDragLeave}
        onDropCapture={handleCanvasDrop}
        onDrop={handleCanvasDrop}
      >
        <ReactFlow
          defaultNodes={flowNodes}
          defaultEdges={styledEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={handleConnectStart}
          onConnectEnd={handleConnectEnd}
          nodeTypes={nodeTypes}
          onPaneContextMenu={handlePaneContextMenu}
          onNodeContextMenu={handleNodeContextMenu}
          onEdgeClick={handleEdgeClick}
          selectionKeyCode="Control"
          multiSelectionKeyCode="Control"
          selectionMode={SelectionMode.Partial}
          deleteKeyCode={null}
          minZoom={0.08}
          maxZoom={2.5}
          fitView
          className="bg-[#09090b]"
          colorMode="dark"
        >
          <Background color="#27272a" gap={20} size={1} />
          <Controls className="!bg-[#141416] !border-zinc-800 !fill-zinc-400" />
          <MiniMap
            className="hidden overflow-hidden rounded-lg !border-zinc-800 !bg-[#141416] sm:block"
            nodeColor={(n) => {
              if (n.type === 'scene') return '#27272a';
              return '#18181b';
            }}
            maskColor="rgba(0, 0, 0, 0.5)"
          />
        </ReactFlow>

        {/* Connection create menu */}
        {connectionCreateMenu && (
          <div
            className="fixed z-50 w-[300px] overflow-hidden rounded-xl border border-zinc-700/80 bg-[#1b1b1f]/98 p-3 shadow-2xl backdrop-blur"
            style={{ left: connectionCreateMenu.x, top: connectionCreateMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 px-1">
              <div className="text-[12px] font-semibold text-zinc-400">
                {connectionCreateMenu.handleType === 'target' ? '选择上游引用节点' : '引用该节点生成'}
              </div>
            </div>
            <div className="space-y-2">
              {connectionCreateOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.key}
                    type="button"
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-zinc-800/90"
                    onClick={() => handleConnectionCreateNode(option)}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-100">
                      <Icon className={cn("h-5 w-5", option.tone)} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold leading-5 text-zinc-100">{option.label}</span>
                      <span className="mt-0.5 block truncate text-[12px] leading-4 text-zinc-500">{option.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {(canvasDropActive || canvasDropStatus) && (
          <div className="pointer-events-none absolute inset-x-0 top-4 z-[70] flex justify-center px-4">
            <div
              className={cn(
                "rounded-lg border px-4 py-2 text-[12px] shadow-2xl backdrop-blur",
                canvasDropActive
                  ? "border-sky-400/70 bg-sky-500/15 text-sky-100"
                  : "border-zinc-700 bg-[#141416]/95 text-zinc-200",
              )}
            >
              {canvasDropActive ? '松开鼠标，将图片作为「图片输入」节点放入画布' : canvasDropStatus}
            </div>
          </div>
        )}

        {/* Context Menu */}
        {contextMenu && (
          <div
            className="fixed z-50 min-w-[160px] rounded-lg border border-zinc-700 bg-[#1a1a1e] py-1 shadow-xl"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.nodeId ? (
              <>
                {selectedContentNodes.length > 0 ? (
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-zinc-800"
                    onClick={handleCreateSectionFromSelection}
                  >
                    <Layers3 className="h-3.5 w-3.5 text-zinc-300" /> 给选中节点分区
                  </button>
                ) : null}
                {(selectedSectionNodes.length > 0 || selectedContentNodes.some((node) => node.parentId)) ? (
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-zinc-800"
                    onClick={handleUngroupSelection}
                  >
                    <X className="h-3.5 w-3.5 text-zinc-400" /> 取消分区
                  </button>
                ) : null}
                {(selectedContentNodes.length > 0 || selectedSectionNodes.length > 0) ? <div className="my-1 border-t border-zinc-800" /> : null}
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-zinc-800"
                  onClick={handleContextDuplicateNode}
                >
                  <Copy className="h-3.5 w-3.5 text-zinc-400" /> 复制节点
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-red-400 hover:bg-zinc-800"
                  onClick={handleContextDeleteNode}
                >
                  <Trash2 className="h-3.5 w-3.5" /> {contextMenuIsSection ? '删除分区内节点' : '删除节点'}
                </button>
              </>
            ) : (
              <>
                <div className="px-3 py-1.5 text-[11px] font-medium text-zinc-500">添加节点</div>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-zinc-800"
                  onClick={() => handleContextAddNode('scene')}
                >
                  <ImageIcon className="h-3.5 w-3.5 text-emerald-400" /> 分镜
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-zinc-800"
                  onClick={() => handleContextAddNode('character')}
                >
                  <Users className="h-3.5 w-3.5 text-violet-400" /> 角色
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-zinc-800"
                  onClick={() => handleContextAddNode('asset')}
                >
                  <Package className="h-3.5 w-3.5 text-amber-400" /> 资产
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-zinc-800"
                  onClick={() => handleContextAddNode('episode')}
                >
                  <Film className="h-3.5 w-3.5 text-sky-400" /> 章节
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-zinc-800"
                  onClick={() => handleContextAddNode('workflow')}
                >
                  <Layers3 className="h-3.5 w-3.5 text-indigo-400" /> 工作流
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-zinc-800"
                  onClick={() => handleContextAddNode('video')}
                >
                  <MonitorPlay className="h-3.5 w-3.5 text-sky-400" /> 视频
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-zinc-800"
                  onClick={() => handleContextAddNode('imageInput')}
                >
                  <ImageIcon className="h-3.5 w-3.5 text-sky-400" /> 图片输入
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-zinc-800"
                  onClick={() => handleContextAddNode('generation')}
                >
                  <Wand2 className="h-3.5 w-3.5 text-purple-400" /> 生成图片
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-zinc-800"
                  onClick={() => handleContextAddNode('translation')}
                >
                  <Languages className="h-3.5 w-3.5 text-cyan-400" /> 翻译提示词
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-zinc-800"
                  onClick={() => handleContextAddNode('promptOptimizer')}
                >
                  <Wand2 className="h-3.5 w-3.5 text-violet-400" /> 优化提示词
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-zinc-800"
                  onClick={() => handleContextAddNode('promptInspector')}
                >
                  <ClipboardCheck className="h-3.5 w-3.5 text-amber-400" /> 检查提示词
                </button>
                {selectedContentNodes.length > 0 ? (
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-zinc-800"
                    onClick={handleCreateSectionFromSelection}
                  >
                    <Layers3 className="h-3.5 w-3.5 text-zinc-300" /> 给选中节点分区
                  </button>
                ) : null}
                {(selectedSectionNodes.length > 0 || selectedContentNodes.some((node) => node.parentId)) ? (
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-zinc-800"
                    onClick={handleUngroupSelection}
                  >
                    <X className="h-3.5 w-3.5 text-zinc-400" /> 取消分区
                  </button>
                ) : null}
                <div className="my-1 border-t border-zinc-800" />
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-zinc-200 hover:bg-zinc-800"
                  onClick={() => { handleDeleteSelected(); setContextMenu(null); }}
                  disabled={selectedCanvasNodes.length === 0}
                >
                  <Trash2 className="h-3.5 w-3.5 text-zinc-400" /> 删除选中
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-red-400 hover:bg-zinc-800"
                  onClick={() => { handleResetCanvas(); setContextMenu(null); }}
                >
                  <X className="h-3.5 w-3.5" /> 清空画布
                </button>
              </>
            )}
          </div>
        )}

        {/* Node Editing Drawer */}
        {editingNode && editingNodeData && (
          <div className="absolute right-0 top-0 z-30 flex h-full w-[340px] flex-col border-l border-zinc-800 bg-[#141416] shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <div className="text-[14px] font-semibold text-zinc-100">
                {editingNodeData.type === 'character' ? '编辑角色' : editingNodeData.type === 'scene' ? '编辑分镜' : editingNodeData.type === 'imageInput' ? '编辑图片输入' : editingNodeData.type === 'translation' ? '编辑翻译节点' : editingNodeData.type === 'promptOptimizer' ? '编辑优化节点' : editingNodeData.type === 'promptInspector' ? '编辑检查节点' : editingNodeData.type === 'section' ? '编辑分区' : '编辑节点'}
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-zinc-100" onClick={() => setEditingNode(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {editingNodeData.type === 'character' ? (
                <>
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">角色名称</label>
                    <input
                      className="w-full rounded-md border border-zinc-700 bg-[#09090b] px-3 py-2 text-[13px] text-zinc-100 focus:border-indigo-500 focus:outline-none"
                      value={editingNodeData.data.name || ''}
                      onChange={(e) => handleEditNodeField('name', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">角色特征</label>
                    <textarea
                      className="w-full resize-none rounded-md border border-zinc-700 bg-[#09090b] px-3 py-2 text-[13px] leading-5 text-zinc-100 focus:border-indigo-500 focus:outline-none"
                      rows={3}
                      value={editingNodeData.data.traits || ''}
                      onChange={(e) => handleEditNodeField('traits', e.target.value)}
                    />
                  </div>
                  {editingNodeData.data.avatar && (
                    <div>
                      <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">头像预览</label>
                      <img
                        src={editingNodeData.data.avatar}
                        alt="avatar"
                        className="h-20 w-20 cursor-zoom-in rounded-full border border-zinc-700 object-cover"
                        onDoubleClick={(event) => previewCanvasImage(event, { url: editingNodeData.data.avatar, title: editingNodeData.data.name || '角色图', subtitle: '头像预览' })}
                      />
                    </div>
                  )}
                </>
              ) : editingNodeData.type === 'scene' ? (
                <>
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">分镜标题</label>
                    <input
                      className="w-full rounded-md border border-zinc-700 bg-[#09090b] px-3 py-2 text-[13px] text-zinc-100 focus:border-indigo-500 focus:outline-none"
                      value={editingNodeData.data.title || ''}
                      onChange={(e) => handleEditNodeField('title', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">场景描述</label>
                    <textarea
                      className="w-full resize-none rounded-md border border-zinc-700 bg-[#09090b] px-3 py-2 text-[12px] leading-5 text-zinc-200 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none"
                      rows={3}
                      value={editingNodeData.data.description || ''}
                      onChange={(e) => handleEditNodeField('description', e.target.value)}
                    />
                  </div>
                  {editingNodeData.data.image && (
                    <div>
                      <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">当前图片</label>
                      <img
                        src={editingNodeData.data.image}
                        alt="scene"
                        className="aspect-video w-full cursor-zoom-in rounded-md border border-zinc-700 object-cover"
                        onDoubleClick={(event) => previewCanvasImage(event, { url: editingNodeData.data.image, title: editingNodeData.data.title || '分镜图', subtitle: editingNodeData.data.description || undefined })}
                      />
                    </div>
                  )}
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">生图提示词（完整）</label>
                    <p className="mb-1 text-[11px] text-zinc-600">此提示词将直接发送给生图模型</p>
                    <textarea
                      className="w-full resize-none rounded-md border border-zinc-700 bg-[#09090b] px-3 py-2 text-[12px] leading-5 text-zinc-200 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none"
                      rows={6}
                      placeholder="描述场景的完整视觉内容，包括环境、光线、构图、风格等..."
                      value={editingNodeData.data.visualPrompt || ''}
                      onChange={(e) => handleEditNodeField('visualPrompt', e.target.value)}
                    />
                  </div>
                  <div className="rounded-md border border-zinc-800 bg-[#09090b] p-3">
                    <div className="text-[11px] font-medium text-zinc-500 mb-1">状态</div>
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", editingNodeData.data.status === 'completed' ? 'bg-green-500' : editingNodeData.data.status === 'generating' ? 'bg-yellow-500' : 'bg-zinc-600')} />
                      <span className="text-[12px] text-zinc-300">
                        {editingNodeData.data.status === 'completed' ? '已完成' : editingNodeData.data.status === 'generating' ? '生成中' : '等待生成'}
                      </span>
                    </div>
                  </div>
                </>
              ) : editingNodeData.type === 'imageInput' ? (
                <>
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">标签</label>
                    <input
                      className="w-full rounded-md border border-zinc-700 bg-[#09090b] px-3 py-2 text-[13px] text-zinc-100 focus:border-indigo-500 focus:outline-none"
                      value={editingNodeData.data.label || ''}
                      onChange={(e) => handleEditNodeField('label', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">图片 URL</label>
                    <input
                      className="w-full rounded-md border border-zinc-700 bg-[#09090b] px-3 py-2 text-[13px] text-zinc-100 focus:border-indigo-500 focus:outline-none"
                      placeholder="https://..."
                      value={editingNodeData.data.imageUrl || ''}
                      onChange={(e) => handleEditNodeField('imageUrl', e.target.value)}
                    />
                  </div>
                  {editingNodeData.data.imageUrl && (
                    <div>
                      <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">预览</label>
                      <img
                        src={editingNodeData.data.imageUrl}
                        alt="参考图"
                        className="w-full cursor-zoom-in rounded-md border border-zinc-700 object-cover"
                        onDoubleClick={(event) => previewCanvasImage(event, { url: editingNodeData.data.imageUrl, title: editingNodeData.data.label || '图片输入', subtitle: '参考图' })}
                      />
                    </div>
                  )}
                  <p className="text-[11px] text-zinc-500">将此节点连线到分镜或角色节点，生成时会作为参考图输入。</p>
                </>
              ) : editingNodeData.type === 'section' ? (
                <>
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">分区标题</label>
                    <input
                      className="w-full rounded-md border border-zinc-700 bg-[#09090b] px-3 py-2 text-[13px] text-zinc-100 focus:border-indigo-500 focus:outline-none"
                      value={editingNodeData.data.title || ''}
                      onChange={(e) => handleEditNodeField('title', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">说明</label>
                    <textarea
                      className="w-full resize-none rounded-md border border-zinc-700 bg-[#09090b] px-3 py-2 text-[12px] leading-5 text-zinc-200 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none"
                      rows={3}
                      value={editingNodeData.data.description || ''}
                      onChange={(e) => handleEditNodeField('description', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">颜色</label>
                    <select
                      className="w-full rounded-md border border-zinc-700 bg-[#09090b] px-3 py-2 text-[13px] text-zinc-100 focus:border-indigo-500 focus:outline-none"
                      value={editingNodeData.data.tone || 'zinc'}
                      onChange={(e) => handleEditNodeField('tone', e.target.value)}
                    >
                      <option value="zinc">灰色</option>
                      <option value="amber">黄色</option>
                      <option value="sky">蓝色</option>
                      <option value="emerald">绿色</option>
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">节点标题</label>
                    <input
                      className="w-full rounded-md border border-zinc-700 bg-[#09090b] px-3 py-2 text-[13px] text-zinc-100 focus:border-indigo-500 focus:outline-none"
                      value={editingNodeData.data.title || ''}
                      onChange={(e) => handleEditNodeField('title', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">描述</label>
                    <textarea
                      className="w-full resize-none rounded-md border border-zinc-700 bg-[#09090b] px-3 py-2 text-[12px] leading-5 text-zinc-200 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none"
                      rows={4}
                      value={editingNodeData.data.description || ''}
                      onChange={(e) => handleEditNodeField('description', e.target.value)}
                    />
                  </div>
                </>
              )}
            </div>
            <div className="border-t border-zinc-800 px-4 py-3">
              <Button
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white"
                onClick={() => setEditingNode(null)}
              >
                完成编辑
              </Button>
            </div>
          </div>
        )}

        {projectUnavailable && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 p-4">
            <div className="w-full max-w-md rounded-lg border border-red-500/30 bg-[#141416] p-5 shadow-2xl">
              <div className="mb-2 text-[15px] font-semibold text-zinc-100">项目不存在</div>
              <p className="text-[13px] leading-6 text-zinc-400">
                当前链接指向旧本地示例项目或已删除项目，后端没有对应记录。请回到「我的项目」，从真实项目卡片重新进入。
              </p>
              <div className="mt-5 flex justify-end">
                <Link to="/app/dashboard">
                  <Button className="h-8 bg-indigo-600 text-white hover:bg-indigo-500">返回我的项目</Button>
                </Link>
              </div>
            </div>
          </div>
        )}
        <div className="absolute left-3 top-3 z-20 flex flex-col gap-2">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            title="流程中心"
            className={cn(
              "h-10 w-10 border border-zinc-700 bg-[#141416] text-zinc-200 shadow-xl hover:bg-zinc-800",
              activePanel === 'workflow' && "border-indigo-500 text-indigo-200"
            )}
            onClick={() => setActivePanel((value) => (value === 'workflow' ? null : 'workflow'))}
          >
            <ListChecks className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            title="资产区"
            className={cn(
              "h-10 w-10 border border-zinc-700 bg-[#141416] text-zinc-200 shadow-xl hover:bg-zinc-800",
              activePanel === 'assets' && "border-emerald-500 text-emerald-200"
            )}
            onClick={() => setActivePanel((value) => (value === 'assets' ? null : 'assets'))}
          >
            <Boxes className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            title="全资产库"
            className={cn(
              "h-10 w-10 border border-zinc-700 bg-[#141416] text-zinc-200 shadow-xl hover:bg-zinc-800",
              activePanel === 'assetLibrary' && "border-amber-500 text-amber-200"
            )}
            onClick={() => setActivePanel((value) => (value === 'assetLibrary' ? null : 'assetLibrary'))}
          >
            <PackageOpen className="h-4 w-4" />
          </Button>
        </div>

        <input
          ref={sourceFileRef}
          type="file"
          accept=".txt,.md,.markdown,text/plain,text/markdown"
          className="hidden"
          onChange={handleSourceFile}
        />
        <input
          ref={canvasImageFileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleCanvasImageFile}
        />
        <input
          ref={assetImageFileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleAssetReferenceFile}
        />
        <input
          ref={assetAudioFileRef}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.opus,.webm,.flac"
          multiple
          className="hidden"
          onChange={handleAssetAudioFile}
        />

        {activePanel === 'workflow' && (
          <WorkflowCenterOverlay
            activeStage={activeWorkflowStage}
            setActiveStage={setActiveWorkflowStage}
            sourceText={sourceText}
            setSourceText={setSourceText}
            sourceName={sourceName}
            setSourceName={setSourceName}
            selectedEpisode={selectedEpisode}
            setSelectedEpisode={setSelectedEpisode}
            episodeList={episodeList}
            activeEpisodeId={activeEpisodeId}
            activeEpisodeSummary={activeEpisodeSummary}
            episodeSwitching={episodeSwitching}
            episodeCreating={episodeCreating}
            finalizeClipStoryboardPrompt={finalizeClipStoryboardPrompt}
            onSelectEpisode={(episodeId) => {
              if (episodeId !== activeEpisodeId) void loadEpisodeWorkspace(episodeId);
            }}
            onCreateNextEpisode={() => void createNextEpisodeWorkspace()}
            scenes={breakdownScenes}
            clips={clips}
            assets={workflowAssets}
            stageStatuses={stageStatuses}
            workflowLoading={workflowLoading}
            workflowSaving={workflowSaving}
            workflowRunning={workflowRunning}
            workflowError={workflowError}
            workflowModels={workflowModels}
            workflowAiModelId={workflowAiModelId}
            setWorkflowAiModelId={setWorkflowAiModelId}
            workflowModelsLoading={workflowModelsLoading}
            workflowModelError={workflowModelError}
            runBreakdown={handleRunBreakdown}
            rerunStoryboard={handleRerunStoryboard}
            inferBoardsAndVideoToCanvas={handleInferBoardsAndVideoToCanvas}
            onSyncEpisodeBoardsToCanvas={handleSyncEpisodeBoardsToCanvas}
            onClose={() => setActivePanel(null)}
            onUploadClick={() => sourceFileRef.current?.click()}
            onAddWorkflowNode={handleAddWorkflowNode}
            onAddSceneNode={handleAddSceneNode}
            onAddClipStoryboardNode={handleAddClipStoryboardNode}
            onAddClipStoryboardImageReferenceNode={handleAddClipStoryboardImageReferenceNode}
            onAddClipVideoNode={handleAddClipVideoNode}
            onUpdateClipStoryboard={handleUpdateClipStoryboard}
            onUpdateScene={handleUpdateScene}
            onDeleteScene={handleDeleteScene}
            onAcceptClip={handleAcceptClip}
            onOptimizeClip={handleOptimizeClip}
            onGenerateClipSeedancePrompt={handleGenerateClipSeedancePrompt}
            onUploadAssetReference={handleUploadAssetReference}
            onUploadAudioReference={handleUploadAudioReference}
            onClearAudioReference={handleClearAudioReference}
            onBatchUploadCharacterAudioReferences={handleBatchUploadCharacterAudioReferences}
            onOpenProjectGlobalSettings={openProjectGlobalSettings}
            onOpenCharacterPropPicker={openCharacterPropPicker}
            onGenerateAssetImage={handleGenerateAssetImage}
            onOpenAssetHistory={handleOpenAssetHistory}
            onLoadAssetHistoryImages={handleLoadAssetHistoryImages}
            onPreviewAssetImage={setAssetImagePreview}
            onAddAssetToCanvas={handleAddAssetToCanvas}
            onClearAssetCurrentImage={handleClearAssetCurrentImage}
            onRemoveAsset={handleRemoveWorkflowAsset}
            isAssetUploadBusy={isAssetUploadBusy}
            isAssetGenerationBusy={isAssetGenerationBusy}
            optimizingClipId={optimizingClipId}
            generatingSeedanceClipId={generatingSeedanceClipId}
            inferBoardsAndVideoRunning={workflowInferAllRunning}
            storyboardImageRefs={clipStoryboardImageRefs}
          />
        )}

        {activePanel === 'assetLibrary' && (
          <div className="absolute bottom-3 left-16 top-3 z-20 flex w-[34vw] min-w-[520px] max-w-[760px] max-[900px]:w-[calc(100%-5rem)] max-[900px]:min-w-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-[#111113]/95 shadow-2xl backdrop-blur">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
              <div className="flex min-w-0 items-center gap-2 text-[14px] font-semibold text-zinc-100">
                <PackageOpen className="h-4 w-4 shrink-0 text-amber-300" />
                <span className="truncate">全资产库</span>
                <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                  {assetLibraryTotalCount}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px] text-zinc-400 hover:text-zinc-100"
                  disabled={assetLibraryLoading}
                  onClick={() => void loadAssetLibrary()}
                >
                  <RotateCw className={cn("h-3.5 w-3.5", assetLibraryLoading && "animate-spin")} />
                  刷新
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-100" onClick={() => setActivePanel(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="shrink-0 border-b border-zinc-800 bg-[#111113] px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={assetLibraryEpisodeId}
                  onChange={(event) => setAssetLibraryEpisodeId(event.target.value)}
                  className="h-8 min-w-[150px] rounded-md border border-zinc-800 bg-[#09090b] px-2 text-[12px] text-zinc-100 outline-none focus:border-amber-500"
                >
                  <option value="all">全部剧集</option>
                  {assetLibraryEpisodes.map((episode) => (
                    <option key={episode.id} value={episode.id}>
                      {workflowEpisodeLibraryTitle(episode)}
                    </option>
                  ))}
                </select>
                <div className="flex flex-1 flex-wrap gap-1">
                  {assetLibraryCategories.map((category) => {
                    const Icon = category.icon;
                    const active = assetLibraryCategory === category.key;
                    return (
                      <button
                        key={category.key}
                        type="button"
                        className={cn(
                          "inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-[12px] transition-colors",
                          active
                            ? "border-amber-500 bg-amber-500/10 text-amber-100"
                            : "border-zinc-800 bg-[#09090b] text-zinc-400 hover:border-zinc-700 hover:text-zinc-100"
                        )}
                        onClick={() => setAssetLibraryCategory(category.key)}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {category.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {assetLibraryStatus && (
                <div className="mt-2 rounded-md border border-zinc-800 bg-[#09090b] px-3 py-2 text-[11px] leading-4 text-zinc-400">
                  {assetLibraryStatus}
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {assetLibraryLoading ? (
                <div className="rounded-lg border border-dashed border-zinc-800 bg-[#09090b] px-4 py-8 text-center text-[12px] text-zinc-500">
                  正在加载所有剧集资产...
                </div>
              ) : assetLibraryCategory === 'directorBoards' ? (
                assetLibraryDirectorItems.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-zinc-800 bg-[#09090b] px-4 py-8 text-center text-[12px] text-zinc-500">
                    暂无导演板图片记录。
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 2xl:grid-cols-3">
                    {assetLibraryDirectorItems.map((item) => (
                      <div key={item.id} className="overflow-hidden rounded-md border border-zinc-800 bg-[#09090b]">
                        <button
                          type="button"
                          draggable
                          className="group relative aspect-video w-full bg-zinc-950"
                          onDragStart={(event) => setImageDragData(event.dataTransfer, item.imageUrl, {
                            label: item.name,
                            fileName: `${item.episodeTitle}-${item.name}.png`,
                            prompt: item.prompt,
                            assetId: item.imageAssetId,
                            generationId: item.generationId,
                          })}
                          onClick={() => setAssetImagePreview({
                            url: item.imageUrl,
                            title: item.name,
                            subtitle: `${item.episodeTitle} · 导演板`,
                          })}
                          onDoubleClick={() => setAssetImagePreview({
                            url: item.imageUrl,
                            title: item.name,
                            subtitle: `${item.episodeTitle} · 导演板`,
                          })}
                        >
                          <img
                            src={item.imageUrl}
                            alt={item.name}
                            draggable
                            className="h-full w-full object-cover transition-transform group-hover:scale-105"
                            onDragStart={(event) => setImageDragData(event.dataTransfer, item.imageUrl, {
                              label: item.name,
                              fileName: `${item.episodeTitle}-${item.name}.png`,
                              prompt: item.prompt,
                              assetId: item.imageAssetId,
                              generationId: item.generationId,
                            })}
                          />
                          <span className="pointer-events-none absolute inset-0 hidden items-center justify-center bg-black/35 text-[10px] text-zinc-100 group-hover:flex">
                            预览 / 拖入
                          </span>
                        </button>
                        <div className="space-y-2 p-2">
                          <div className="min-w-0">
                            <div className="truncate text-[12px] font-medium text-zinc-100">{item.name}</div>
                            <div className="mt-0.5 truncate text-[10px] text-zinc-500">{item.episodeTitle}</div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 w-full text-[11px] text-amber-300 hover:bg-amber-500/10 hover:text-amber-100"
                            onClick={() => handleAddLibraryDirectorBoardToCanvas(item)}
                          >
                            <Layers3 className="h-3.5 w-3.5" />
                            放入画布
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : assetLibraryAssetItems.length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-800 bg-[#09090b] px-4 py-8 text-center text-[12px] text-zinc-500">
                  当前筛选下暂无资产。
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 2xl:grid-cols-3">
                  {assetLibraryAssetItems.map((item) => {
                    const category = assetLibraryCategories.find((entry) => entry.key === item.kind);
                    const Icon = category?.icon ?? Package;
                    const preview = item.imageUrl ? {
                      url: item.imageUrl,
                      title: item.name,
                      subtitle: `${item.episodeTitle} · ${workflowAssetKindLabel(item.kind)}`,
                    } : null;
                    return (
                      <div key={item.id} className="overflow-hidden rounded-md border border-zinc-800 bg-[#09090b]">
                        {item.imageUrl ? (
                          <button
                            type="button"
                            draggable
                            className="group relative aspect-square w-full bg-zinc-950"
                            onDragStart={(event) => setImageDragData(event.dataTransfer, item.imageUrl, {
                              label: item.name,
                              fileName: item.name,
                              assetKind: item.kind,
                              assetName: item.name,
                              assetId: item.imageAssetId,
                            })}
                            onClick={() => preview && setAssetImagePreview(preview)}
                            onDoubleClick={() => preview && setAssetImagePreview(preview)}
                          >
                            <img
                              src={item.imageUrl}
                              alt={item.name}
                              draggable
                              className="h-full w-full object-cover transition-transform group-hover:scale-105"
                              onDragStart={(event) => setImageDragData(event.dataTransfer, item.imageUrl, {
                                label: item.name,
                                fileName: item.name,
                                assetKind: item.kind,
                                assetName: item.name,
                                assetId: item.imageAssetId,
                              })}
                            />
                            <span className="pointer-events-none absolute inset-0 hidden items-center justify-center bg-black/35 text-[10px] text-zinc-100 group-hover:flex">
                              预览 / 拖入
                            </span>
                          </button>
                        ) : (
                          <div className="flex aspect-square w-full items-center justify-center bg-zinc-950 text-zinc-700">
                            <Icon className="h-8 w-8" />
                          </div>
                        )}
                        <div className="space-y-2 p-2">
                          <div className="min-w-0">
                            <div className="truncate text-[12px] font-medium text-zinc-100">{item.name}</div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-zinc-500">
                              <span className="truncate">{item.episodeTitle}</span>
                              <span className="shrink-0">·</span>
                              <span className="shrink-0">{workflowAssetKindLabel(item.kind)}</span>
                            </div>
                          </div>
                          {item.description && (
                            <div className="line-clamp-2 text-[10px] leading-4 text-zinc-500">
                              {item.description}
                            </div>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 w-full text-[11px] text-amber-300 hover:bg-amber-500/10 hover:text-amber-100"
                            onClick={() => handleAddLibraryAssetToCanvas(item)}
                          >
                            <Layers3 className="h-3.5 w-3.5" />
                            放入画布
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {activePanel === 'assets' && (
          <div className="absolute bottom-3 left-16 top-3 z-20 flex w-[520px] max-w-[calc(100%-5rem)] flex-col overflow-hidden rounded-lg border border-zinc-800 bg-[#111113]/95 shadow-2xl backdrop-blur">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-zinc-100">
                <Boxes className="h-4 w-4 text-emerald-300" />
                项目资产
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-100" onClick={() => setActivePanel(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-3 overflow-y-auto p-4">
              <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
                <div className="flex items-center gap-2 text-[13px] font-medium text-violet-100">
                  <ImageIcon className="h-4 w-4 text-violet-300" />
                  资产图生成
                </div>
                <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <p className="text-[12px] leading-5 text-violet-100/60">
                    在下方资产卡片直接上传参考图或生成图片；也可以把同名历史图加载回当前集资产。
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 shrink-0 bg-emerald-500 text-[11px] text-black hover:bg-emerald-400"
                    disabled={assetHistoryLoadBusy}
                    onClick={() => void handleLoadAssetHistoryImages('all')}
                  >
                    <ImageIcon className="h-3.5 w-3.5" />
                    {assetHistoryLoadBusy ? '加载中...' : '一键加载历史图'}
                  </Button>
                </div>
                <div className="mt-3 space-y-2">
                  <label className="block text-[11px] font-medium text-violet-100/70">
                    图片模型
                    <select
                      value={assetGenerationModelId}
                      onChange={(event) => setAssetGenerationModelId(event.target.value)}
                      disabled={workflowModelsLoading || assetImageModels.length === 0}
                      className="mt-1 h-8 w-full rounded-md border border-zinc-800 bg-[#0d0d0f] px-3 text-[12px] text-zinc-100 outline-none focus:border-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="">{assetImageModels.length === 0 ? '未配置图片模型' : '使用后端默认图片模型'}</option>
                      {assetImageModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {modelOptionLabel(model)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-[11px] font-medium text-violet-100/70">
                      比例
                      <select
                        value={assetGenerationAspectRatio}
                        onChange={(event) => setAssetGenerationAspectRatio(event.target.value)}
                        className="mt-1 h-8 w-full rounded-md border border-zinc-800 bg-[#0d0d0f] px-2 text-[12px] text-zinc-100 outline-none focus:border-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {assetImageAspectRatioOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-[11px] font-medium text-violet-100/70">
                      大小
                      <select
                        value={assetGenerationResolution}
                        onChange={(event) => setAssetGenerationResolution(event.target.value)}
                        className="mt-1 h-8 w-full rounded-md border border-zinc-800 bg-[#0d0d0f] px-2 text-[12px] text-zinc-100 outline-none focus:border-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {assetImageResolutionOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="block text-[11px] font-medium text-emerald-100/70">
                    参考图识别模型
                    <select
                      value={assetUploadModelId}
                      onChange={(event) => setAssetUploadModelId(event.target.value)}
                      disabled={workflowModelsLoading || assetUploadBusyKeys.length > 0 || workflowModels.length === 0}
                      className="mt-1 h-8 w-full rounded-md border border-zinc-800 bg-[#0d0d0f] px-3 text-[12px] text-zinc-100 outline-none focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="">{workflowModelsLoading ? '加载模型中...' : '使用当前文本模型'}</option>
                      {workflowModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {modelOptionLabel(model)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {assetUploadStatus && (
                  <div className="mt-2 rounded-md border border-zinc-800 bg-[#0d0d0f] px-3 py-2 text-[11px] leading-4 text-zinc-400">
                    {assetUploadStatus}
                  </div>
                )}
                {assetGenerationStatus && (
                  <div className="mt-2 rounded-md border border-zinc-800 bg-[#0d0d0f] px-3 py-2 text-[11px] leading-4 text-zinc-400">
                    {assetGenerationStatus}
                  </div>
                )}
              </div>
              {assetHistoryTarget && (
                <div className="rounded-lg border border-zinc-800 bg-[#18181b] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-zinc-100">
                        {assetHistoryTarget.asset.name || '资产'} {assetHistoryVariantFilter === 'with-props' ? '道具版图片' : '历史图片'}
                      </div>
                      <div className="mt-1 text-[11px] leading-4 text-zinc-500">
                        {assetHistoryVariantFilter === 'with-props'
                          ? '这里选择已经生成好的角色道具版图，并设为当前图。新道具版请从小包裹入口生成。'
                          : '每条记录保留当次实际提示词。可拖入画布继续修改，也可设为当前图或参考生成。'}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-zinc-500 hover:text-zinc-100"
                      onClick={() => {
                        setAssetHistoryTarget(null);
                        setAssetHistoryItems([]);
                        setAssetHistoryStatus(null);
                        setAssetHistoryVariantFilter('all');
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {assetHistoryStatus && (
                    <div className="mt-2 rounded-md border border-zinc-800 bg-[#0d0d0f] px-3 py-2 text-[11px] leading-4 text-zinc-400">
                      {assetHistoryStatus}
                    </div>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {assetHistoryItems
                      .filter((image) => assetHistoryVariantFilter === 'with-props' ? assetHistoryImageIsWithProps(image) : true)
                      .map((image) => {
                        const imageUrl = normalizeReusableImageSource(image.url) || image.url;
                        const actualPrompt = image.prompt || image.revisedPrompt || '';
                        const metaItems = [
                          image.modelLabel,
                          image.size,
                          image.resolution?.toUpperCase(),
                          image.quality ? image.quality.toUpperCase() : '',
                          image.referenceImageCount ? `${image.referenceImageCount} 参考` : '',
                          formatDurationMs(image.durationMs),
                        ].filter(Boolean);
                        const dragPayload: Partial<CanvasImageDragPayload> = {
                          nodeType: 'imageInput',
                          assetKind: assetHistoryTarget.kind,
                          assetName: assetHistoryTarget.asset.name || image.title || '资产历史图',
                          assetId: image.id,
                          generationId: image.generationId,
                          label: assetHistoryTarget.asset.name || image.title || '资产历史图',
                          prompt: actualPrompt,
                          revisedPrompt: image.revisedPrompt,
                          source: image.source,
                          size: image.size,
                          resolution: image.resolution,
                          quality: image.quality,
                          modelLabel: image.modelLabel,
                        };
                        const preview = {
                          url: imageUrl,
                          title: image.title || assetHistoryTarget.asset.name || '资产历史图',
                          subtitle: `${assetImageSourceLabel(image.source)}${metaItems.length ? ` · ${metaItems.join(' · ')}` : ''}${image.createdAt ? ` · ${new Date(image.createdAt).toLocaleString()}` : ''}`,
                        };
                        return (
                          <div key={image.id} className="overflow-hidden rounded-md border border-zinc-800 bg-[#09090b]">
                            <div className="relative aspect-square bg-zinc-950">
                              <button
                                type="button"
                                draggable
                                className="group h-full w-full"
                                title="拖到画布会创建图片输入节点，并保留本次实际提示词"
                                onDragStart={(event) => setImageDragData(event.dataTransfer, imageUrl, dragPayload)}
                                onClick={() => setAssetImagePreview(preview)}
                                onDoubleClick={() => setAssetImagePreview(preview)}
                              >
                                <img
                                  src={imageUrl}
                                  alt={image.title || '资产历史图'}
                                  draggable
                                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                                  onDragStart={(event) => setImageDragData(event.dataTransfer, imageUrl, dragPayload)}
                                  onDoubleClick={() => setAssetImagePreview(preview)}
                                />
                                <span className="pointer-events-none absolute inset-0 hidden items-center justify-center bg-black/35 text-[10px] text-zinc-100 group-hover:flex">
                                  图片输入 / 预览
                                </span>
                              </button>
                              {image.isCurrent && (
                                <span className="absolute left-1 top-1 rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-medium text-black">
                                  当前
                                </span>
                              )}
                            </div>
                            <div className="space-y-1 p-2">
                              <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-500">
                                <span>{assetImageSourceLabel(image.source)}</span>
                                <span>{image.createdAt ? new Date(image.createdAt).toLocaleDateString() : ''}</span>
                              </div>
                              {metaItems.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {metaItems.slice(0, 4).map((meta) => (
                                    <span key={meta} className="rounded border border-zinc-800 bg-[#141416] px-1.5 py-0.5 text-[9px] text-zinc-500">
                                      {meta}
                                    </span>
                                  ))}
                                </div>
                              )}
                              <div className="rounded border border-zinc-800 bg-[#101014] p-2">
                                <div className="mb-1 flex items-center justify-between gap-2">
                                  <span className="text-[10px] text-zinc-500">本次实际提示词</span>
                                  {actualPrompt ? (
                                    <button
                                      type="button"
                                      className="inline-flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-100"
                                      onClick={() => void navigator.clipboard?.writeText(actualPrompt).catch(() => undefined)}
                                    >
                                      <Copy className="h-3 w-3" />
                                      复制
                                    </button>
                                  ) : null}
                                </div>
                                <div className="max-h-20 overflow-y-auto whitespace-pre-wrap text-[10px] leading-4 text-zinc-400">
                                  {actualPrompt || '旧记录未保存提示词。'}
                                </div>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className={cn(
                                  "h-7 w-full text-[11px]",
                                  image.isCurrent
                                    ? "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                                    : "text-zinc-200 hover:bg-zinc-800 hover:text-zinc-50"
                                )}
                                disabled={assetHistoryLoading}
                                onClick={() => image.isCurrent
                                  ? void handleClearAssetCurrentImage(assetHistoryTarget.kind, assetHistoryTarget.asset)
                                  : void handleSelectAssetHistoryImage(image)}
                              >
                                {image.isCurrent ? '取消当前' : '设为当前'}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-full text-[11px] text-amber-300 hover:bg-amber-500/10 hover:text-amber-100"
                                onClick={() => handleAddHistoryImageInputToCanvas(imageUrl, assetHistoryTarget.asset.name || image.title || '资产历史图', actualPrompt)}
                              >
                                作为图片输入
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-full text-[11px] text-sky-300 hover:bg-sky-500/10 hover:text-sky-100"
                                disabled={isAssetGenerationBusy(assetHistoryTarget.kind, assetHistoryTarget.asset)}
                                onClick={() => handleGenerateAssetImage(assetHistoryTarget.kind, assetHistoryTarget.asset, { referenceImageUrl: imageUrl })}
                              >
                                {isAssetGenerationBusy(assetHistoryTarget.kind, assetHistoryTarget.asset) ? '生成中...' : '用此图参考生成'}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-full text-[11px] text-red-300 hover:bg-red-500/10 hover:text-red-100"
                                disabled={assetHistoryLoading}
                                onClick={() => handleDeleteAssetHistoryImage(image)}
                              >
                                <Trash2 className="h-3 w-3" />
                                删除历史图
                              </Button>
                            </div>
                        </div>
                        );
                      })}
                  </div>
                  {assetHistoryLoading && (
                    <div className="mt-2 text-[11px] text-zinc-500">正在读取资产历史...</div>
                  )}
                </div>
              )}
              {assetGroups.map((item) => {
                const Icon = item.icon;
                const items = assetArray(workflowAssets, item.key);
                return (
                  <div key={item.title} className="rounded-lg border border-zinc-800 bg-[#18181b] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-200">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-[13px] font-medium text-zinc-100">
                            <span>{item.title}</span>
                            <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400">{items.length}</span>
                          </div>
                          <div className="mt-1 text-[12px] leading-5 text-zinc-500">{item.desc}</div>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 text-[11px] text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-100"
                        onClick={() => handleAddWorkflowNode('asset', item.title, item.desc)}
                      >
                        放入画布
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-3 h-7 text-[11px] text-sky-300 hover:bg-sky-500/10 hover:text-sky-100"
                      disabled={assetHistoryLoadBusy || items.length === 0}
                      onClick={() => void handleLoadAssetHistoryImages(item.key)}
                    >
                      <ImageIcon className="h-3.5 w-3.5" />
                      加载本组历史图
                    </Button>
                    {item.key === 'characters' ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mt-3 ml-2 h-7 text-[11px] text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-100"
                        disabled={assetUploadBusyKeys.length > 0 || items.length === 0}
                        onClick={handleBatchUploadCharacterAudioReferences}
                        title="一次选择 1-5 音频：1 Bob，2 Chloe，3 Leo，4 Tiffany，5 Eugene"
                      >
                        <Mic className="h-3.5 w-3.5" />
                        批量上传音频
                      </Button>
                    ) : null}
                    <AssetMiniList
                      assetKind={item.key}
                      items={items}
                      emptyText="暂无提取资产"
                      onUploadReference={(asset) => handleUploadAssetReference(item.key, asset)}
                      onUploadAudioReference={item.key === 'characters' ? handleUploadAudioReference : undefined}
                      onClearAudioReference={item.key === 'characters' ? handleClearAudioReference : undefined}
                      onOpenCharacterPropPicker={item.key === 'characters' ? openCharacterPropPicker : undefined}
                      onGenerateImage={(asset) => handleGenerateAssetImage(item.key, asset)}
                      onOpenHistory={(asset, variantFilter) => handleOpenAssetHistory(item.key, asset, variantFilter)}
                      onPreviewImage={setAssetImagePreview}
                      onAddToCanvas={handleAddAssetToCanvas}
                      onClearCurrentImage={(asset) => void handleClearAssetCurrentImage(item.key, asset)}
                      onRemoveAsset={handleRemoveWorkflowAsset}
                      propPickerCharacter={item.key === 'characters' ? propPickerCharacter : null}
                      workflowAssets={workflowAssets}
                      propGenerationPrompt={propGenerationPrompt}
                      propBindingBusy={propBindingBusy}
                      propBindingStatus={propBindingStatus}
                      onPropGenerationPromptChange={setPropGenerationPrompt}
                      onCloseCharacterPropPicker={() => {
                        setPropPickerCharacter(null);
                        setPropBindingStatus(null);
                      }}
                      onSaveCharacterPropBinding={(character, prop, shouldBind) => void saveCharacterPropBinding(character, prop, shouldBind)}
                      onGenerateCharacterPropImage={(character, customPrompt) => handleGenerateAssetImage('characters', character, { useCurrentReference: true, variant: 'with-props', customPrompt, preservePromptExact: true })}
                      isUploadBusy={(asset) => isAssetUploadBusy(item.key, asset)}
                      isGenerationBusy={(asset) => isAssetGenerationBusy(item.key, asset)}
                    />
                  </div>
                );
              })}
              <div className="rounded-lg border border-zinc-800 bg-[#18181b] p-3">
                <div className="flex items-center gap-2 text-[13px] font-medium text-zinc-100">
                  <Film className="h-4 w-4 text-amber-300" />
                  导演板资产
                </div>
                <div className="mt-1 text-[12px] leading-5 text-zinc-500">空间图、六宫格、上一板连续性参考</div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-3 h-7 text-[11px] text-amber-300 hover:bg-amber-500/10 hover:text-amber-100"
                  onClick={() => handleAddWorkflowNode('directorBoard', '章节导演板资产', '空间图、六宫格、上一板连续性参考')}
                >
                  放入画布
                </Button>
              </div>
            </div>
          </div>
        )}

        {assetImagePreview && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 p-5 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            onClick={() => setAssetImagePreview(null)}
          >
            <div
              className="inline-flex max-h-[calc(100vh-2.5rem)] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-lg border border-zinc-800 bg-[#111113] shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold text-zinc-100">{assetImagePreview.title}</div>
                  {assetImagePreview.subtitle && (
                    <div className="truncate text-[11px] text-zinc-500">{assetImagePreview.subtitle}</div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 px-2 text-[12px] text-zinc-400 hover:text-zinc-100"
                    onClick={() => void downloadCanvasImagePreview(assetImagePreview)}
                  >
                    <Download className="h-3.5 w-3.5" />
                    下载
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-zinc-500 hover:text-zinc-100"
                    onClick={() => setAssetImagePreview(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center bg-[#09090b] p-3">
                <img
                  src={assetImagePreview.url}
                  alt={assetImagePreview.title}
                  className="block h-auto max-h-[calc(100vh-8rem)] w-auto max-w-[calc(100vw-4rem)] rounded-md object-contain"
                />
              </div>
            </div>
          </div>
        )}
        <ProjectGlobalSettingsModal
          open={projectGlobalSettingsOpen}
          draft={projectGlobalSettingsDraft}
          saving={projectGlobalSettingsSaving}
          error={projectGlobalSettingsError}
          onChange={(patch) => setProjectGlobalSettingsDraft((current) => ({ ...current, ...patch }))}
          onClose={() => {
            if (projectGlobalSettingsSaving) return;
            setProjectGlobalSettingsOpen(false);
            setProjectGlobalSettingsError(null);
          }}
          onSave={() => void saveProjectGlobalSettings()}
        />
      </div>
    </div>
  );
}

export function ProjectCanvasPage() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
