import type { Edge, Node } from '@xyflow/react'
import type { Project } from '../stores/useProjectStore'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

interface ApiEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface ApiRequestOptions {
  method?: HttpMethod
  body?: unknown
  token?: string | null
  signal?: AbortSignal
  cache?: RequestCache
}

export interface ApiUser {
  id: string
  name: string
  email: string
  avatar: string
  credits: number
  token?: string
}

export interface AgentSendMessageRequest {
  content: string
  projectId?: string
  conversationId?: string
  context?: Record<string, unknown>
}

export interface AgentSendMessageResponse {
  id?: string
  content: string
  metadata?: {
    [key: string]: unknown
    conversationId?: string
    progress?: number
    imageUrl?: string
    actions?: { label: string; action: string }[]
  }
}

export interface AgentConversation {
  id: string
  title: string
  preview: string
  messageCount: number
  createdAt: string
  updatedAt: string
}

export interface AgentHistoryMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  metadata?: Record<string, unknown>
}

export interface CanvasScene {
  projectId: string
  sceneId?: string
  nodes: Node[]
  edges: Edge[]
  deletedNodeIds?: string[]
  baseUpdatedAt?: string
  updatedAt?: string
}

export interface EpisodeCanvasSyncResponse extends CanvasScene {
  episodeId?: string
  storyboardCount: number
  videoCount: number
  recoveredStoryboardCount: number
  workflow?: WorkflowState | null
}

export interface WorkflowBreakdownScene {
  id: string
  title: string
  description: string
  references?: string
  action?: string
  dialogue?: string
  durationSeconds?: number
  shotSize?: string
  cameraAngle?: string
  cameraMove?: string
  composition?: string
  lens?: string
  aperture?: string
  shutter?: string
  iso?: string
  sound?: string
  music?: string
  subtitle?: string
  characters?: string[]
  setting?: string
  visualPrompt?: string
  directorBoardPrompt?: string
  status?: 'draft' | 'ready' | string
}

export interface WorkflowClip {
  id: string
  title: string
  plotGoal?: string
  targetDuration?: number
  maxDuration?: number
  estimatedDuration?: number
  sceneType?: string
  storyboardControlLevel?: string
  storyboardType?: string
  panelCount?: number
  startState?: string
  endState?: string
  emotionArc?: string
  dialogueWordCount?: number
  dialogueDensity?: number | string
  characters?: string[]
  setting?: string
  shotIds?: string[]
  layoutMemory?: string
  directorFreedom?: string
  seedancePrompt?: string
  storyboardPrompt?: string
  storyboardPanelCount?: number
  storyboardNotes?: string
  preflight?: Record<string, unknown> | string
}

export interface WorkflowState {
  episodeId?: string
  sourceText: string
  sourceName: string
  selectedEpisode: string
  activeStage?: string
  breakdownScenes: WorkflowBreakdownScene[]
  clips?: WorkflowClip[]
  assets?: {
    characters?: unknown[]
    scenes?: unknown[]
    props?: unknown[]
  }
  stageStatuses?: Record<string, string>
  updatedAt?: string
  lastRun?: Record<string, unknown>
  episodes?: WorkflowEpisodeListResponse
}

export interface WorkflowEpisodeSummary {
  id: string
  title: string
  selectedEpisode: string
  canvasSceneId: string
  updatedAt?: string
  sourceName?: string
  clipCount: number
  sceneCount: number
}

export interface WorkflowEpisodeListResponse {
  activeEpisodeId: string
  episodes: WorkflowEpisodeSummary[]
}

export interface WorkflowRunResponse {
  workflow: WorkflowState
  run: {
    id: string
    status: string
    model?: {
      id: string
      provider: string
      model: string
      displayName: string
    }
    scenesCreated?: number
    charactersUpserted?: number
    completedAt?: string
  }
}

export interface ModelProviderConfig {
  id: string
  displayName: string
  providerType: string
  baseUrl?: string
  apiKeyMasked?: string
  hasApiKey?: boolean
  isActive?: boolean
  createdAt?: string
  updatedAt?: string
}

export interface ModelConfig {
  id: string
  providerConfigId?: string
  providerConfig?: ModelProviderConfig
  provider: string
  model: string
  displayName: string
  modality: string
  capabilities: string[]
  defaultParams: Record<string, unknown>
  costCredits: number
  apiKey?: string
  apiKeyMasked?: string
  hasApiKey?: boolean
  isActive: boolean
  createdAt?: string
  updatedAt?: string
}

export interface ModelConfigsResponse {
  providers: ModelProviderConfig[]
  models: ModelConfig[]
}

export interface ProviderConfigInput {
  displayName: string
  providerType: string
  baseUrl?: string
  apiKey?: string
}

export interface ModelConfigInput {
  providerConfigId?: string
  provider: string
  model: string
  displayName: string
  modality: string
  capabilities?: string[]
  defaultParams?: Record<string, unknown>
  costCredits?: number
  apiKey?: string
  isActive?: boolean
}

export interface DraftModelTestInput {
  existingModelId?: string
  providerConfigId: string
  model: string
  displayName?: string
  modality: string
  capabilities?: string[]
  defaultParams?: Record<string, unknown>
  apiKey?: string
}

export interface ProviderTestResult {
  ok: boolean
  message: string
  raw?: unknown
}

export interface WorkflowAssetImageGenerationInput {
  episodeId?: string
  assetKind: 'characters' | 'scenes' | 'props'
  assetName: string
  prompt?: string
  usePromptAsFinal?: boolean
  preservePromptExact?: boolean
  variant?: 'clean' | 'with-props'
  aiModelId?: string
  size?: string
  useCurrentReference?: boolean
  referenceImageUrls?: string[]
  referenceAssetIds?: string[]
  writeBackToAsset?: boolean
  parameters?: Record<string, unknown>
}

export interface CanvasImageGenerationInput {
  prompt: string
  aiModelId?: string
  size?: string
  referenceImageUrls?: string[]
  count?: number
  parameters?: Record<string, unknown>
  metadata?: Record<string, unknown>
  submitOnly?: boolean
}

export interface CanvasVideoGenerationInput {
  prompt: string
  aiModelId?: string
  resolution?: string
  durationSeconds?: number
  ratio?: string
  count?: number
  referenceImageUrls?: string[]
  referenceAudioUrls?: string[]
  parameters?: Record<string, unknown>
  metadata?: Record<string, unknown>
  submitId?: string
  dryRun?: boolean
}

export interface CanvasPromptTranslationInput {
  prompt: string
  aiModelId?: string
  sourceLanguage?: 'auto' | 'Chinese' | 'English'
  targetLanguage?: 'English' | 'Chinese'
  preserveStructure?: boolean
  context?: string
}

export interface CanvasPromptTranslationResponse {
  prompt: string
  translatedPrompt: string
  sourceLanguage?: string
  targetLanguage?: string
  model?: unknown
  durationMs?: number
}

export interface CanvasPromptInspectionInput {
  prompt: string
  question: string
  aiModelId?: string
  context?: string
}

export interface CanvasPromptInspectionResponse {
  prompt: string
  question: string
  answer: string
  model?: unknown
  durationMs?: number
}

export interface CanvasPromptOptimizationInput {
  prompt: string
  aiModelId?: string
  targetProvider?: string
  failureReason?: string
  context?: string
}

export interface CanvasPromptOptimizationResponse {
  prompt: string
  optimizedPrompt: string
  targetProvider?: string
  failureReason?: string
  model?: unknown
  durationMs?: number
}

export interface CanvasVideoGenerationResponse {
  generation?: unknown
  asset?: unknown
  video?: {
    url?: string
    mimeType?: string
  }
  submitId?: string
  genStatus?: string
  references?: {
    referenceImageUrls?: string[]
    referenceAudioUrls?: string[]
    storyboardImageUrl?: string
    source?: string
    imageSourceNodeIds?: string[]
    audioSourceNodeIds?: string[]
  }
  raw?: unknown
}

export interface ClipStoryboardPlanResponse {
  panelCount: number
  prompt: string
  notes?: string
  continuityCharacters?: string[]
  model?: unknown
  workflow?: WorkflowState
  clip?: WorkflowClip
}

export interface ClipSeedancePromptResponse {
  workflow: WorkflowState
  clip?: WorkflowClip
  prompt: string
}

export interface WorkflowAssetImageHistoryItem {
  id: string
  url: string
  title?: string
  source?: string
  prompt?: string
  revisedPrompt?: string
  modelId?: string
  modelLabel?: string
  modelProvider?: string
  size?: string
  resolution?: string
  quality?: string
  referenceImageCount?: number
  variant?: string
  durationMs?: number
  status?: string
  createdAt?: string
  generationId?: string
  isCurrent?: boolean
}

export interface WorkflowAssetImageGenerationResponse {
  workflow?: WorkflowState
  generation?: unknown
  asset?: unknown
  assets?: unknown[]
  prompt?: string
  image?: {
    url?: string
    revisedPrompt?: string
    providerId?: string
  }
  images?: Array<{
    url?: string
    revisedPrompt?: string
    providerId?: string
  }>
}

export interface GenerationRecordAsset {
  id: string
  type?: string
  title?: string
  url?: string
  mimeType?: string
  metadata?: unknown
  createdAt?: string
}

export interface GenerationRecordModel {
  id?: string
  provider?: string
  model?: string
  displayName?: string
  modality?: string
  costCredits?: number
  providerConfig?: {
    displayName?: string
    providerType?: string
  } | null
}

export interface GenerationRecord {
  id: string
  projectId?: string
  aiModelId?: string
  prompt: string
  negativePrompt?: string
  input?: unknown
  parameters?: unknown
  status: string
  errorMessage?: string
  creditCost?: number
  queuedAt?: string
  startedAt?: string
  completedAt?: string
  createdAt?: string
  updatedAt?: string
  assets: GenerationRecordAsset[]
  aiModel?: GenerationRecordModel | null
}

export interface CharacterReferenceImageInput {
  episodeId?: string
  characterName: string
  imageDataUrl?: string
  imageUrl?: string
  fileName?: string
  mimeType?: string
  sizeBytes?: number
  aiModelId?: string
}

export interface CharacterReferenceAudioInput {
  episodeId?: string
  characterName: string
  audioUrl: string
  fileName?: string
  mimeType?: string
  sizeBytes?: number
}

export interface ClearCharacterReferenceAudioInput {
  episodeId?: string
  characterName: string
}

export interface WorkflowAssetReferenceImageInput {
  episodeId?: string
  assetKind: 'characters' | 'scenes' | 'props'
  assetName: string
  imageDataUrl?: string
  imageUrl?: string
  fileName?: string
  mimeType?: string
  sizeBytes?: number
  aiModelId?: string
}

export interface CharacterReferenceImageResponse {
  character?: unknown
  asset?: unknown
  analysis?: Record<string, unknown> | null
  analysisError?: string
  workflow?: WorkflowState
}

export interface ProjectCharacterAsset {
  id?: string
  title?: string
  url?: string
  metadata?: Record<string, unknown>
}

export interface ProjectCharacterRecord {
  id: string
  name: string
  role?: string
  bio?: string
  prompt?: string
  traits?: Record<string, unknown>
  assets?: ProjectCharacterAsset[]
}

export interface ProjectSceneRecord {
  id: string
  title: string
  summary?: string
  prompt?: string
  metadata?: Record<string, unknown>
}

export interface PresignedUploadResponse {
  key: string
  uploadUrl: string
  publicUrl?: string
  headers?: Record<string, string>
  expiresInSeconds?: number
}

export interface LocalImageUploadResponse {
  key: string
  publicUrl: string
  contentType?: string
  sizeBytes?: number
}

const API_TOKEN_KEY = 'loohii-api-token'
export const API_AUTH_EXPIRED_EVENT = 'loohii:auth-expired'

function getApiBaseUrl(): string {
  const value = import.meta.env.VITE_API_URL as string | undefined
  if (!value?.trim()) return ''
  return value.replace(/\/+$/, '')
}

function getToken(): string | null {
  return localStorage.getItem(API_TOKEN_KEY)
}

function setToken(token?: string | null) {
  if (token) {
    localStorage.setItem(API_TOKEN_KEY, token)
  } else {
    localStorage.removeItem(API_TOKEN_KEY)
  }
}

function isEnvelope<T>(value: unknown): value is ApiEnvelope<T> {
  return !!value && typeof value === 'object' && ('code' in value || 'data' in value || 'message' in value)
}

async function request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const baseUrl = getApiBaseUrl()

  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ?? getToken() ? { Authorization: options.token ?? getToken() ?? '' } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      cache: options.cache,
    })
  } catch (error) {
    throw new Error(formatNetworkError(error))
  }

  let payload: unknown = null
  const text = await response.text()
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      const snippet = summarizeNonJsonResponse(text)
      if (!response.ok) {
        throw new Error(formatHttpError(response.status, response.statusText, snippet))
      }
      throw new Error(`接口返回了非 JSON 内容：${snippet || response.statusText || 'empty response'}`)
    }
  }

  if (!response.ok) {
    if (response.status === 401) {
      setToken(null)
      window.dispatchEvent(new CustomEvent(API_AUTH_EXPIRED_EVENT, { detail: { path } }))
    }
    const message = isEnvelope(payload) ? payload.message : response.statusText
    throw new Error(message || formatHttpError(response.status, response.statusText))
  }

  if (isEnvelope<T>(payload)) {
    if (payload.code && payload.code >= 400) {
      throw new Error(payload.message || 'API request failed')
    }
    return payload.data as T
  }

  return payload as T
}

function summarizeNonJsonResponse(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
}

function formatHttpError(status: number, statusText: string, snippet = ''): string {
  if (status === 504) {
    return 'AI 请求超过网关等待时间（504）。后端可能还在处理，请稍后刷新；如果是生图任务，请减少提示词/参考图数量或降低分辨率后重试。'
  }
  if (status === 502) {
    return '后端服务暂时不可用（502），请稍后重试。'
  }
  const detail = snippet ? `：${snippet}` : ''
  return `接口请求失败（${status} ${statusText || 'Error'}）${detail}`
}

function formatNetworkError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '')
  if (/failed to fetch|fetch failed|networkerror|load failed/i.test(message)) {
    return '网络请求没有连到后端（Failed to fetch）。请确认网络正常后重试；如果刚刚触发生图，可能是长请求被浏览器或网关中断。'
  }
  return message || '网络请求失败，请稍后重试。'
}

async function tryRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T | null> {
  try {
    return await request<T>(path, options)
  } catch {
    return null
  }
}

function numberId(id: string): number | null {
  const value = Number(id)
  return Number.isFinite(value) ? value : null
}

function avatarFor(name: string): string {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`
}

function normalizeUser(value: any, emailFallback = ''): ApiUser {
  const name = String(value?.name ?? value?.username ?? emailFallback.split('@')[0] ?? 'User')
  return {
    id: String(value?.id ?? value?.userId ?? crypto.randomUUID()),
    name,
    email: String(value?.email ?? emailFallback),
    avatar: String(value?.avatar ?? avatarFor(name)),
    credits: Number(value?.credits ?? 1250),
    token: value?.token,
  }
}

function normalizeProject(value: any): Project {
  const title = String(value?.title ?? value?.name ?? '未命名项目')
  const cover = String(
    value?.cover ??
      value?.poster ??
      value?.image ??
      'https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?q=80&w=800&auto=format&fit=crop'
  )
  const setupSettings =
    value?.setupSettings && typeof value.setupSettings === 'object'
      ? value.setupSettings
      : value?.settings?.setupSettings && typeof value.settings.setupSettings === 'object'
        ? value.settings.setupSettings
        : undefined

  return {
    id: String(value?.id ?? crypto.randomUUID()),
    title,
    ratio: String(value?.ratio ?? value?.videoRatio ?? '16:9'),
    style: String(value?.style ?? value?.artStyle ?? value?.type ?? '动漫风'),
    cover,
    description: value?.description ?? value?.intro ?? undefined,
    globalPrompt: value?.globalPrompt ?? value?.directorManual ?? undefined,
    negativePrompt: value?.negativePrompt ?? undefined,
    setupSettings,
    createdAt: new Date(value?.createdAt ?? value?.createTime ?? Date.now()).toISOString(),
    scenes: Number(value?.scenes ?? value?.storyboardCount ?? 0),
    completedScenes: Number(value?.completedScenes ?? value?.completedStoryboardCount ?? 0),
  }
}

function maskSecret(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  if (value.includes('*') || value.includes('•')) return value
  if (value.length <= 8) return '••••••••'
  return `${value.slice(0, 3)}••••${value.slice(-4)}`
}

function normalizeModelProvider(value: any): ModelProviderConfig {
  const maskedKey = value?.apiKeyMasked ?? value?.maskedApiKey ?? value?.apiKeyPreview ?? maskSecret(value?.apiKey)
  return {
    id: String(value?.id ?? value?.providerConfigId ?? value?.providerId ?? crypto.randomUUID()),
    displayName: String(value?.displayName ?? value?.name ?? value?.provider ?? value?.providerType ?? '未命名供应商'),
    providerType: String(value?.providerType ?? value?.type ?? value?.provider ?? 'custom'),
    baseUrl: value?.baseUrl ?? value?.baseURL ?? value?.endpoint ?? undefined,
    apiKeyMasked: maskSecret(maskedKey),
    hasApiKey: Boolean(value?.hasApiKey ?? maskedKey ?? value?.apiKey),
    isActive: Boolean(value?.isActive ?? value?.enabled ?? value?.active ?? true),
    createdAt: value?.createdAt,
    updatedAt: value?.updatedAt,
  }
}

function normalizeModelConfig(value: any): ModelConfig {
  const provider = String(value?.provider ?? value?.providerType ?? value?.providerName ?? 'custom')
  const model = String(value?.model ?? value?.modelName ?? value?.name ?? 'unknown')
  const maskedKey = value?.apiKeyMasked ?? value?.maskedApiKey ?? value?.apiKeyPreview ?? maskSecret(value?.apiKey)
  const capabilities = Array.isArray(value?.capabilities)
    ? value.capabilities.map(String)
    : typeof value?.capabilities === 'string'
      ? value.capabilities.split(',').map((item: string) => item.trim()).filter(Boolean)
      : value?.capabilities && typeof value.capabilities === 'object'
        ? Object.entries(value.capabilities)
            .filter(([, enabled]) => Boolean(enabled))
            .map(([key]) => String(key))
        : []

  return {
    id: String(value?.id ?? value?.modelId ?? value?.configId ?? model),
    providerConfigId: value?.providerConfigId === undefined ? undefined : String(value.providerConfigId),
    providerConfig: value?.providerConfig && typeof value.providerConfig === 'object' ? normalizeModelProvider(value.providerConfig) : undefined,
    provider,
    model,
    displayName: String(value?.displayName ?? value?.label ?? model),
    modality: String(value?.modality ?? value?.type ?? 'text-to-image'),
    capabilities,
    defaultParams: value?.defaultParams && typeof value.defaultParams === 'object' ? value.defaultParams : {},
    costCredits: Number(value?.costCredits ?? value?.credits ?? value?.cost ?? 0),
    apiKey: typeof value?.apiKey === 'string' ? value.apiKey : undefined,
    apiKeyMasked: maskSecret(maskedKey),
    hasApiKey: Boolean(value?.hasApiKey ?? maskedKey ?? value?.apiKey),
    isActive: Boolean(value?.isActive ?? value?.enabled ?? value?.active ?? true),
    createdAt: value?.createdAt,
    updatedAt: value?.updatedAt,
  }
}

function normalizeModelConfigs(value: any): ModelConfigsResponse {
  const root = Array.isArray(value) ? { models: value } : value ?? {}
  const providersSource = root.providers ?? root.providerConfigs ?? root.data?.providers ?? []
  const modelsSource = root.models ?? root.configs ?? root.items ?? root.data?.models ?? []
  const providers = Array.isArray(providersSource) ? providersSource.map(normalizeModelProvider) : []
  const models = Array.isArray(modelsSource) ? modelsSource.map(normalizeModelConfig) : []
  return { providers, models }
}

function normalizeWorkflowState(value: any): WorkflowState {
  const root = value?.workflow ?? value ?? {}
  return {
    episodeId: root.episodeId ? String(root.episodeId) : undefined,
    sourceText: String(root.sourceText ?? ''),
    sourceName: String(root.sourceName ?? ''),
    selectedEpisode: String(root.selectedEpisode ?? '第 1 集'),
    activeStage: root.activeStage,
    breakdownScenes: Array.isArray(root.breakdownScenes) ? root.breakdownScenes.map(normalizeWorkflowScene) : [],
    clips: Array.isArray(root.clips) ? root.clips.map(normalizeWorkflowClip) : undefined,
    assets: root.assets && typeof root.assets === 'object' ? root.assets : { characters: [], scenes: [], props: [] },
    stageStatuses: root.stageStatuses && typeof root.stageStatuses === 'object' ? root.stageStatuses : {},
    updatedAt: root.updatedAt,
    lastRun: root.lastRun,
    episodes: normalizeWorkflowEpisodeList(root.episodes),
  }
}

function normalizeWorkflowEpisodeList(value: any): WorkflowEpisodeListResponse | undefined {
  if (!value || typeof value !== 'object') return undefined
  const episodesSource = Array.isArray(value.episodes) ? value.episodes : []
  const episodes = episodesSource.map((item: any): WorkflowEpisodeSummary => ({
    id: String(item?.id ?? ''),
    title: String(item?.title ?? item?.selectedEpisode ?? '未命名集'),
    selectedEpisode: String(item?.selectedEpisode ?? item?.title ?? '未命名集'),
    canvasSceneId: String(item?.canvasSceneId ?? item?.id ?? 'default'),
    updatedAt: item?.updatedAt ? String(item.updatedAt) : undefined,
    sourceName: item?.sourceName ? String(item.sourceName) : undefined,
    clipCount: Number.isFinite(Number(item?.clipCount)) ? Number(item.clipCount) : 0,
    sceneCount: Number.isFinite(Number(item?.sceneCount)) ? Number(item.sceneCount) : 0,
  })).filter((item) => item.id)
  return {
    activeEpisodeId: String(value.activeEpisodeId ?? episodes[0]?.id ?? ''),
    episodes,
  }
}

function normalizeWorkflowScene(value: any): WorkflowBreakdownScene {
  return {
    id: String(value?.id ?? crypto.randomUUID()),
    title: String(value?.title ?? '未命名分镜'),
    description: String(value?.description ?? value?.summary ?? ''),
    references: value?.references,
    action: value?.action,
    dialogue: value?.dialogue,
    durationSeconds: Number.isFinite(Number(value?.durationSeconds)) ? Number(value.durationSeconds) : undefined,
    shotSize: value?.shotSize,
    cameraAngle: value?.cameraAngle,
    cameraMove: value?.cameraMove,
    composition: value?.composition,
    lens: value?.lens,
    aperture: value?.aperture,
    shutter: value?.shutter,
    iso: value?.iso,
    sound: value?.sound,
    music: value?.music,
    subtitle: value?.subtitle,
    characters: Array.isArray(value?.characters) ? value.characters.map(String) : [],
    setting: value?.setting,
    visualPrompt: value?.visualPrompt,
    directorBoardPrompt: value?.directorBoardPrompt,
    status: value?.status,
  }
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

function normalizeWorkflowClip(value: any): WorkflowClip {
  const id = String(value?.id ?? crypto.randomUUID())
  return {
    id,
    title: String(value?.title ?? `Clip ${id}`),
    plotGoal: value?.plotGoal,
    targetDuration: normalizeOptionalNumber(value?.targetDuration),
    maxDuration: normalizeOptionalNumber(value?.maxDuration),
    estimatedDuration: normalizeOptionalNumber(value?.estimatedDuration),
    sceneType: value?.sceneType,
    storyboardControlLevel: value?.storyboardControlLevel,
    storyboardType: value?.storyboardType,
    panelCount: normalizeOptionalNumber(value?.panelCount),
    startState: value?.startState,
    endState: value?.endState,
    emotionArc: value?.emotionArc,
    dialogueWordCount: normalizeOptionalNumber(value?.dialogueWordCount),
    dialogueDensity: value?.dialogueDensity,
    characters: normalizeStringArray(value?.characters),
    setting: value?.setting,
    shotIds: normalizeStringArray(value?.shotIds),
    layoutMemory: value?.layoutMemory,
    directorFreedom: value?.directorFreedom,
    seedancePrompt: value?.seedancePrompt,
    storyboardPrompt: value?.storyboardPrompt,
    storyboardPanelCount: normalizeOptionalNumber(value?.storyboardPanelCount),
    storyboardNotes: value?.storyboardNotes,
    preflight:
      value?.preflight && (typeof value.preflight === 'object' || typeof value.preflight === 'string')
        ? value.preflight
        : undefined,
  }
}

function normalizeProviderTestResult(value: any): ProviderTestResult {
  const ok = Boolean(value?.ok ?? value?.success ?? value?.connected ?? value?.healthy)
  return {
    ok,
    message: String(value?.message ?? value?.error ?? (ok ? '连接测试成功' : '连接测试失败')),
    raw: value,
  }
}

function toLegacyProject(project: Partial<Project>) {
  return {
    projectType: 'animation',
    name: project.title ?? '未命名项目',
    intro: project.description ?? '',
    type: project.style ?? '动漫风',
    artStyle: project.style ?? '动漫风',
    directorManual: project.globalPrompt ?? '',
    videoRatio: project.ratio ?? '16:9',
    imageModel: 'default',
    videoModel: 'default',
    imageQuality: 'standard',
    mode: 'storyboard',
  }
}

export const apiClient = {
  get configured() {
    return true
  },

  getToken,
  setToken,

  async signIn(email: string, password: string): Promise<ApiUser> {
    let response: any
    try {
      response = await request<any>('/api/auth/sign-in', {
        method: 'POST',
        body: { email, password },
      })
    } catch (modernError) {
      try {
        response = await request<any>('/api/login', {
          method: 'POST',
          body: { username: email, password },
        })
      } catch {
        throw modernError
      }
    }

    const user = normalizeUser(response.user ?? response, email)
    setToken(user.token ?? response.token)
    return user
  },

  async signUp(name: string, email: string, password: string): Promise<ApiUser> {
    const created = await request<any>('/api/auth/sign-up', {
      method: 'POST',
      body: { name, email, password },
    })

    const user = normalizeUser(created.user ?? created, email)
    setToken(user.token ?? created.token)
    return user
  },

  async updateProfile(data: Partial<ApiUser>): Promise<ApiUser | null> {
    const user = await tryRequest<any>('/api/auth/me', {
      method: 'PATCH',
      body: data,
    })
    return user ? normalizeUser(user.user ?? user) : null
  },

  async listProjects(): Promise<Project[] | null> {
    const modern = await tryRequest<any[]>('/api/projects')
    const legacy = modern ?? (await tryRequest<any[]>('/api/project/getProject', { method: 'POST', body: {} }))
    return legacy ? legacy.map(normalizeProject) : null
  },

  async createProject(project: Omit<Project, 'id' | 'createdAt'>): Promise<Project | null> {
    const modern = await tryRequest<any>('/api/projects', {
      method: 'POST',
      body: project,
    })
    if (modern) return normalizeProject(modern.project ?? modern)

    const legacy = await tryRequest<any>('/api/project/addProject', {
      method: 'POST',
      body: toLegacyProject(project),
    })
    if (!legacy) return null

    const projects = await this.listProjects()
    return projects?.[0] ?? null
  },

  async updateProject(id: string, data: Partial<Project>): Promise<Project | null> {
    const modern = await tryRequest<any>(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: data,
    })
    if (modern) return normalizeProject(modern.project ?? modern)

    const numericId = numberId(id)
    if (numericId === null) return null
    const current = (await this.listProjects())?.find((project) => project.id === id)
    const legacy = await tryRequest<any>('/api/project/editProject', {
      method: 'POST',
      body: { id: numericId, ...toLegacyProject({ ...current, ...data }) },
    })
    return legacy ? normalizeProject({ ...current, ...data, id }) : null
  },

  async deleteProject(id: string): Promise<boolean> {
    const modern = await tryRequest<unknown>(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    if (modern !== null) return true

    const numericId = numberId(id)
    if (numericId === null) return false
    return (await tryRequest<unknown>('/api/project/delProject', {
      method: 'POST',
      body: { id: numericId },
    })) !== null
  },

  async listProjectCharacters(projectId: string): Promise<ProjectCharacterRecord[]> {
    const result = await request<any[]>(`/api/projects/${encodeURIComponent(projectId)}/characters`)
    return Array.isArray(result) ? result.map((item: any) => ({
      id: String(item?.id ?? ''),
      name: String(item?.name ?? '').trim(),
      role: item?.role ? String(item.role) : undefined,
      bio: item?.bio ? String(item.bio) : undefined,
      prompt: item?.prompt ? String(item.prompt) : undefined,
      traits: item?.traits && typeof item.traits === 'object' ? item.traits : {},
      assets: Array.isArray(item?.assets) ? item.assets.map((asset: any) => ({
        id: asset?.id ? String(asset.id) : undefined,
        title: asset?.title ? String(asset.title) : undefined,
        url: asset?.url ? String(asset.url) : undefined,
        metadata: asset?.metadata && typeof asset.metadata === 'object' ? asset.metadata : undefined,
      })) : [],
    })).filter((item) => item.id && item.name) : []
  },

  async listProjectScenes(projectId: string): Promise<ProjectSceneRecord[]> {
    const result = await request<any[]>(`/api/projects/${encodeURIComponent(projectId)}/scenes`)
    return Array.isArray(result) ? result.map((item: any) => ({
      id: String(item?.id ?? ''),
      title: String(item?.title ?? '').trim(),
      summary: item?.summary ? String(item.summary) : undefined,
      prompt: item?.prompt ? String(item.prompt) : undefined,
      metadata: item?.metadata && typeof item.metadata === 'object' ? item.metadata : {},
    })).filter((item) => item.id && item.title) : []
  },

  async sendAgentMessage(requestData: AgentSendMessageRequest): Promise<AgentSendMessageResponse | null> {
    const response = await tryRequest<any>('/api/agent/messages', {
      method: 'POST',
      body: requestData,
    })
    if (!response) return null
    return {
      id: response.id,
      content: String(response.content ?? response.message ?? ''),
      metadata: response.metadata,
    }
  },

  async listAgentConversations(projectId: string): Promise<AgentConversation[]> {
    const response = await tryRequest<any[]>(`/api/agent/conversations?projectId=${encodeURIComponent(projectId)}`, {
      cache: 'no-store',
    })
    return Array.isArray(response) ? response.map((item: any) => ({
      id: String(item?.id ?? ''),
      title: String(item?.title ?? '新对话'),
      preview: String(item?.preview ?? ''),
      messageCount: Number(item?.messageCount ?? 0),
      createdAt: String(item?.createdAt ?? ''),
      updatedAt: String(item?.updatedAt ?? ''),
    })).filter((item) => item.id) : []
  },

  async loadAgentConversationMessages(projectId: string, conversationId: string): Promise<AgentHistoryMessage[]> {
    const response = await tryRequest<any[]>(`/api/agent/conversations/${encodeURIComponent(conversationId)}/messages?projectId=${encodeURIComponent(projectId)}`, {
      cache: 'no-store',
    })
    return Array.isArray(response) ? response.map((item: any) => ({
      id: String(item?.id ?? crypto.randomUUID()),
      role: item?.role === 'user' ? 'user' : 'assistant',
      content: String(item?.content ?? ''),
      createdAt: String(item?.createdAt ?? ''),
      metadata: item?.metadata && typeof item.metadata === 'object' ? item.metadata : undefined,
    })).filter((item) => item.content) : []
  },

  async deleteAgentConversation(projectId: string, conversationId: string): Promise<boolean> {
    const response = await tryRequest<{ deleted?: number }>(
      `/api/agent/conversations/${encodeURIComponent(conversationId)}?projectId=${encodeURIComponent(projectId)}`,
      { method: 'DELETE' }
    )
    return response !== null
  },

  async loadCanvasScene(projectId: string, sceneId = 'default'): Promise<CanvasScene | null> {
    if (projectId === 'local') return null
    const modernPath = `/api/canvas/scenes/${encodeURIComponent(projectId)}/${encodeURIComponent(sceneId)}`
    const numericProjectId = numberId(projectId)
    const numericSceneId = numberId(sceneId)

    if (numericProjectId === null || numericSceneId === null) {
      const modern = await request<any>(modernPath, { cache: 'no-store' })
      return {
        projectId,
        sceneId,
        nodes: Array.isArray(modern.nodes) ? modern.nodes : [],
        edges: Array.isArray(modern.edges) ? modern.edges : [],
        updatedAt: modern.updatedAt,
      }
    }

    const modern = await tryRequest<any>(modernPath, { cache: 'no-store' })
    if (modern) {
      const nodes = Array.isArray(modern.nodes) ? modern.nodes : []
      const edges = Array.isArray(modern.edges) ? modern.edges : []
      if (!modern.updatedAt && nodes.length === 0 && edges.length === 0) return null
      return {
        projectId,
        sceneId,
        nodes,
        edges,
        updatedAt: modern.updatedAt,
      }
    }

    if (numericProjectId === null || numericSceneId === null) return null

    const legacy = await tryRequest<any>('/api/production/getFlowData', {
      method: 'POST',
      body: { projectId: numericProjectId, episodesId: numericSceneId },
    })
    if (!legacy) return null

    return {
      projectId,
      sceneId,
      nodes: legacy.canvas?.nodes ?? legacy.nodes ?? [],
      edges: legacy.canvas?.edges ?? legacy.edges ?? [],
      updatedAt: legacy.updatedAt,
    }
  },

  async saveCanvasScene(scene: CanvasScene): Promise<CanvasScene | null> {
    if (scene.projectId === 'local') return null
    const sceneId = scene.sceneId ?? 'default'
    const modernPath = `/api/canvas/scenes/${encodeURIComponent(scene.projectId)}/${encodeURIComponent(sceneId)}`
    const numericProjectId = numberId(scene.projectId)
    const numericSceneId = numberId(sceneId)
    const modern = numericProjectId === null || numericSceneId === null
      ? await request<any>(modernPath, {
          method: 'PUT',
          body: scene,
          cache: 'no-store',
        })
      : await tryRequest<any>(modernPath, {
          method: 'PUT',
          body: scene,
          cache: 'no-store',
        })
    if (modern !== null) {
      return {
        projectId: scene.projectId,
        sceneId,
        nodes: Array.isArray(modern.nodes) ? modern.nodes : scene.nodes,
        edges: Array.isArray(modern.edges) ? modern.edges : scene.edges,
        updatedAt: modern.updatedAt,
      }
    }

    if (numericProjectId === null || numericSceneId === null) return null

    const saved = await tryRequest<unknown>('/api/production/saveFlowData', {
      method: 'POST',
      body: {
        projectId: numericProjectId,
        episodesId: numericSceneId,
        data: { canvas: { nodes: scene.nodes, edges: scene.edges } },
      },
    })
    return saved !== null ? scene : null
  },

  async syncEpisodeCanvas(projectId: string, input: { episodeId?: string; generationStrategy?: string } = {}): Promise<EpisodeCanvasSyncResponse> {
    const result = await request<any>(`/api/canvas/projects/${encodeURIComponent(projectId)}/sync-episode`, {
      method: 'POST',
      body: input,
      cache: 'no-store',
    })
    return {
      projectId,
      sceneId: String(result?.sceneId ?? input.episodeId ?? 'default'),
      episodeId: result?.episodeId ? String(result.episodeId) : input.episodeId,
      nodes: Array.isArray(result?.nodes) ? result.nodes : [],
      edges: Array.isArray(result?.edges) ? result.edges : [],
      updatedAt: result?.updatedAt,
      storyboardCount: Number(result?.storyboardCount ?? 0),
      videoCount: Number(result?.videoCount ?? 0),
      recoveredStoryboardCount: Number(result?.recoveredStoryboardCount ?? 0),
      workflow: result?.workflow ? normalizeWorkflowState(result.workflow) : null,
    }
  },

  async listProjectWorkflowEpisodes(projectId: string): Promise<WorkflowEpisodeListResponse> {
    const result = await request<any>(`/api/workflows/projects/${encodeURIComponent(projectId)}/workflow/episodes`, { cache: 'no-store' })
    return normalizeWorkflowEpisodeList(result) ?? { activeEpisodeId: '', episodes: [] }
  },

  async createProjectWorkflowEpisode(projectId: string, input: { title: string; copyAssetsFromEpisodeId?: string }): Promise<{ episode: WorkflowEpisodeSummary; episodes: WorkflowEpisodeListResponse; workflow: WorkflowState }> {
    const result = await request<any>(`/api/workflows/projects/${encodeURIComponent(projectId)}/workflow/episodes`, {
      method: 'POST',
      body: input,
      cache: 'no-store',
    })
    return {
      episode: normalizeWorkflowEpisodeList({ activeEpisodeId: result?.episode?.id, episodes: [result?.episode] })?.episodes[0] ?? {
        id: '',
        title: input.title,
        selectedEpisode: input.title,
        canvasSceneId: '',
        clipCount: 0,
        sceneCount: 0,
      },
      episodes: normalizeWorkflowEpisodeList(result?.episodes) ?? { activeEpisodeId: '', episodes: [] },
      workflow: normalizeWorkflowState(result?.workflow),
    }
  },

  async getProjectWorkflow(projectId: string, options: { episodeId?: string } = {}): Promise<WorkflowState | null> {
    const params = options.episodeId ? `?${new URLSearchParams({ episodeId: options.episodeId }).toString()}` : ''
    const workflow = await request<any>(`/api/workflows/projects/${encodeURIComponent(projectId)}/workflow${params}`, { cache: 'no-store' })
    return workflow ? normalizeWorkflowState(workflow) : null
  },

  async saveProjectWorkflow(projectId: string, draft: Partial<WorkflowState>, options: { episodeId?: string } = {}): Promise<WorkflowState | null> {
    const params = options.episodeId ? `?${new URLSearchParams({ episodeId: options.episodeId }).toString()}` : ''
    const workflow = await request<any>(`/api/workflows/projects/${encodeURIComponent(projectId)}/workflow${params}`, {
      method: 'PUT',
      body: { ...draft, ...(options.episodeId ? { episodeId: options.episodeId } : {}) },
    })
    return workflow ? normalizeWorkflowState(workflow) : null
  },

  async runProjectWorkflow(projectId: string, input: {
    episodeId?: string
    stage: 'assets' | 'storyboard' | 'full-breakdown'
    sourceText: string
    sourceName?: string
    selectedEpisode: string
    aiModelId?: string
  }): Promise<WorkflowRunResponse> {
    const params = input.episodeId ? `?${new URLSearchParams({ episodeId: input.episodeId }).toString()}` : ''
    const result = await request<any>(`/api/workflows/projects/${encodeURIComponent(projectId)}/workflow/run${params}`, {
      method: 'POST',
      body: input,
    })
    return {
      workflow: normalizeWorkflowState(result.workflow),
      run: result.run,
    }
  },

  async optimizeProjectWorkflowClip(projectId: string, clipId: string, input: { aiModelId?: string; episodeId?: string } = {}): Promise<WorkflowState> {
    const params = input.episodeId ? `?${new URLSearchParams({ episodeId: input.episodeId }).toString()}` : ''
    const workflow = await request<any>(
      `/api/workflows/projects/${encodeURIComponent(projectId)}/workflow/clips/${encodeURIComponent(clipId)}/optimize${params}`,
      {
        method: 'POST',
        body: input,
      }
    )
    return normalizeWorkflowState(workflow)
  },

  async generateProjectWorkflowClipSeedancePrompt(projectId: string, clipId: string, input: { aiModelId?: string; episodeId?: string } = {}): Promise<ClipSeedancePromptResponse> {
    const params = input.episodeId ? `?${new URLSearchParams({ episodeId: input.episodeId }).toString()}` : ''
    const result = await request<any>(
      `/api/workflows/projects/${encodeURIComponent(projectId)}/workflow/clips/${encodeURIComponent(clipId)}/seedance-prompt${params}`,
      {
        method: 'POST',
        body: input,
      }
    )
    return {
      workflow: normalizeWorkflowState(result.workflow),
      clip: result.clip ? normalizeWorkflowClip(result.clip) : undefined,
      prompt: String(result.prompt || result.clip?.seedancePrompt || ''),
    }
  },

  async planProjectWorkflowClipStoryboard(projectId: string, clipId: string, input: { aiModelId?: string; panelMode?: 'ai' | 'manual'; panelCount?: number; episodeId?: string } = {}): Promise<ClipStoryboardPlanResponse> {
    const params = input.episodeId ? `?${new URLSearchParams({ episodeId: input.episodeId }).toString()}` : ''
    const result = await request<any>(
      `/api/workflows/projects/${encodeURIComponent(projectId)}/workflow/clips/${encodeURIComponent(clipId)}/storyboard-plan${params}`,
      {
        method: 'POST',
        body: input,
      }
    )
    return {
      panelCount: Number(result.panelCount) || 6,
      prompt: String(result.prompt || ''),
      notes: result.notes ? String(result.notes) : undefined,
      continuityCharacters: Array.isArray(result.continuityCharacters) ? result.continuityCharacters.map(String).filter(Boolean) : undefined,
      model: result.model,
      workflow: result.workflow ? normalizeWorkflowState(result.workflow) : undefined,
      clip: result.clip ? normalizeWorkflowClip(result.clip) : undefined,
    }
  },

  async uploadCharacterReferenceImage(projectId: string, input: CharacterReferenceImageInput): Promise<CharacterReferenceImageResponse> {
    const params = input.episodeId ? `?${new URLSearchParams({ episodeId: input.episodeId }).toString()}` : ''
    const result = await request<any>(`/api/projects/${encodeURIComponent(projectId)}/characters/reference-image${params}`, {
      method: 'POST',
      body: input,
    })
    return {
      character: result.character,
      asset: result.asset,
      analysis: result.analysis ?? null,
      analysisError: result.analysisError,
      workflow: result.workflow ? normalizeWorkflowState(result.workflow) : undefined,
    }
  },

  async uploadCharacterReferenceAudio(projectId: string, input: CharacterReferenceAudioInput): Promise<CharacterReferenceImageResponse> {
    const params = input.episodeId ? `?${new URLSearchParams({ episodeId: input.episodeId }).toString()}` : ''
    const result = await request<any>(`/api/projects/${encodeURIComponent(projectId)}/characters/reference-audio${params}`, {
      method: 'POST',
      body: input,
    })
    return {
      character: result.character,
      asset: result.asset,
      workflow: result.workflow ? normalizeWorkflowState(result.workflow) : undefined,
    }
  },

  async clearCharacterReferenceAudio(projectId: string, input: ClearCharacterReferenceAudioInput): Promise<{ workflow: WorkflowState; character?: unknown; cleared: boolean }> {
    const params = input.episodeId ? `?${new URLSearchParams({ episodeId: input.episodeId }).toString()}` : ''
    const result = await request<any>(`/api/projects/${encodeURIComponent(projectId)}/characters/reference-audio${params}`, {
      method: 'DELETE',
      body: {
        characterName: input.characterName,
      },
    })
    return {
      workflow: normalizeWorkflowState(result.workflow),
      character: result.character,
      cleared: Boolean(result.cleared),
    }
  },

  async uploadWorkflowAssetReferenceImage(projectId: string, input: WorkflowAssetReferenceImageInput): Promise<CharacterReferenceImageResponse> {
    const params = input.episodeId ? `?${new URLSearchParams({ episodeId: input.episodeId }).toString()}` : ''
    const result = await request<any>(`/api/workflows/projects/${encodeURIComponent(projectId)}/workflow/assets/reference-image${params}`, {
      method: 'POST',
      body: input,
    })
    return {
      character: result.character,
      asset: result.asset,
      analysis: result.analysis ?? null,
      analysisError: result.analysisError,
      workflow: result.workflow ? normalizeWorkflowState(result.workflow) : undefined,
    }
  },

  async generateWorkflowAssetImage(projectId: string, input: WorkflowAssetImageGenerationInput, options: { signal?: AbortSignal } = {}): Promise<WorkflowAssetImageGenerationResponse> {
    const params = input.episodeId ? `?${new URLSearchParams({ episodeId: input.episodeId }).toString()}` : ''
    const result = await request<any>(`/api/workflows/projects/${encodeURIComponent(projectId)}/workflow/assets/generate-image${params}`, {
      method: 'POST',
      body: input,
      signal: options.signal,
    })
    return {
      workflow: normalizeWorkflowState(result.workflow),
      generation: result.generation,
      asset: result.asset,
      assets: Array.isArray(result.assets) ? result.assets : undefined,
      prompt: result.prompt ? String(result.prompt) : undefined,
      image: result.image,
      images: Array.isArray(result.images) ? result.images : undefined,
    }
  },

  async generateCanvasImage(projectId: string, input: CanvasImageGenerationInput, options: { signal?: AbortSignal } = {}): Promise<WorkflowAssetImageGenerationResponse> {
    const result = await request<any>(`/api/workflows/projects/${encodeURIComponent(projectId)}/workflow/canvas/generate-image`, {
      method: 'POST',
      body: input,
      signal: options.signal,
    })
    return {
      generation: result.generation,
      asset: result.asset,
      assets: Array.isArray(result.assets) ? result.assets : undefined,
      prompt: result.prompt ? String(result.prompt) : undefined,
      image: result.image,
      images: Array.isArray(result.images) ? result.images : undefined,
    }
  },

  async generateCanvasVideo(projectId: string, input: CanvasVideoGenerationInput, options: { signal?: AbortSignal } = {}): Promise<CanvasVideoGenerationResponse> {
    const result = await request<any>(`/api/workflows/projects/${encodeURIComponent(projectId)}/workflow/canvas/generate-video`, {
      method: 'POST',
      body: input,
      signal: options.signal,
    })
    return {
      generation: result.generation,
      asset: result.asset,
      video: result.video,
      submitId: result.submitId ? String(result.submitId) : undefined,
      genStatus: result.genStatus ? String(result.genStatus) : undefined,
      references: result.references,
      raw: result.raw,
    }
  },

  async translateCanvasPrompt(projectId: string, input: CanvasPromptTranslationInput, options: { signal?: AbortSignal } = {}): Promise<CanvasPromptTranslationResponse> {
    const result = await request<any>(`/api/workflows/projects/${encodeURIComponent(projectId)}/workflow/canvas/translate-prompt`, {
      method: 'POST',
      body: input,
      signal: options.signal,
    })
    return {
      prompt: String(result.prompt || input.prompt || ''),
      translatedPrompt: String(result.translatedPrompt || ''),
      sourceLanguage: result.sourceLanguage ? String(result.sourceLanguage) : undefined,
      targetLanguage: result.targetLanguage ? String(result.targetLanguage) : undefined,
      model: result.model,
      durationMs: Number.isFinite(Number(result.durationMs)) ? Number(result.durationMs) : undefined,
    }
  },

  async optimizeCanvasPrompt(projectId: string, input: CanvasPromptOptimizationInput, options: { signal?: AbortSignal } = {}): Promise<CanvasPromptOptimizationResponse> {
    const result = await request<any>(`/api/workflows/projects/${encodeURIComponent(projectId)}/workflow/canvas/optimize-prompt`, {
      method: 'POST',
      body: input,
      signal: options.signal,
    })
    return {
      prompt: String(result.prompt || input.prompt || ''),
      optimizedPrompt: String(result.optimizedPrompt || ''),
      targetProvider: result.targetProvider ? String(result.targetProvider) : undefined,
      failureReason: result.failureReason ? String(result.failureReason) : undefined,
      model: result.model,
      durationMs: Number.isFinite(Number(result.durationMs)) ? Number(result.durationMs) : undefined,
    }
  },

  async inspectCanvasPrompt(projectId: string, input: CanvasPromptInspectionInput, options: { signal?: AbortSignal } = {}): Promise<CanvasPromptInspectionResponse> {
    const result = await request<any>(`/api/workflows/projects/${encodeURIComponent(projectId)}/workflow/canvas/inspect-prompt`, {
      method: 'POST',
      body: input,
      signal: options.signal,
    })
    return {
      prompt: String(result.prompt || input.prompt || ''),
      question: String(result.question || input.question || ''),
      answer: String(result.answer || ''),
      model: result.model,
      durationMs: Number.isFinite(Number(result.durationMs)) ? Number(result.durationMs) : undefined,
    }
  },

  async listWorkflowAssetImages(projectId: string, input: { assetKind: 'characters' | 'scenes' | 'props'; assetName: string; episodeId?: string }): Promise<{ images: WorkflowAssetImageHistoryItem[] }> {
    const params = new URLSearchParams({
      assetKind: input.assetKind,
      assetName: input.assetName,
    })
    if (input.episodeId) params.set('episodeId', input.episodeId)
    const result = await request<any>(`/api/workflows/projects/${encodeURIComponent(projectId)}/workflow/assets/images?${params.toString()}`)
    return {
      images: Array.isArray(result.images) ? result.images.map((item: any) => ({
        id: String(item.id ?? ''),
        url: String(item.url ?? ''),
        title: item.title ? String(item.title) : undefined,
        source: item.source ? String(item.source) : undefined,
        prompt: item.prompt ? String(item.prompt) : undefined,
        revisedPrompt: item.revisedPrompt ? String(item.revisedPrompt) : undefined,
        modelId: item.modelId ? String(item.modelId) : undefined,
        modelLabel: item.modelLabel ? String(item.modelLabel) : undefined,
        modelProvider: item.modelProvider ? String(item.modelProvider) : undefined,
        size: item.size ? String(item.size) : undefined,
        resolution: item.resolution ? String(item.resolution) : undefined,
        quality: item.quality ? String(item.quality) : undefined,
        referenceImageCount: Number.isFinite(Number(item.referenceImageCount)) ? Number(item.referenceImageCount) : undefined,
        variant: item.variant ? String(item.variant) : undefined,
        durationMs: Number.isFinite(Number(item.durationMs)) ? Number(item.durationMs) : undefined,
        status: item.status ? String(item.status) : undefined,
        createdAt: item.createdAt ? String(item.createdAt) : undefined,
        generationId: item.generationId ? String(item.generationId) : undefined,
        isCurrent: Boolean(item.isCurrent),
      })).filter((item: WorkflowAssetImageHistoryItem) => item.id && item.url) : [],
    }
  },

  async selectWorkflowAssetImage(projectId: string, input: { assetKind: 'characters' | 'scenes' | 'props'; assetName: string; assetId: string; episodeId?: string }): Promise<{ workflow: WorkflowState; asset?: unknown }> {
    const params = input.episodeId ? `?${new URLSearchParams({ episodeId: input.episodeId }).toString()}` : ''
    const result = await request<any>(`/api/workflows/projects/${encodeURIComponent(projectId)}/workflow/assets/select-image${params}`, {
      method: 'POST',
      body: input,
    })
    return {
      workflow: normalizeWorkflowState(result.workflow),
      asset: result.asset,
    }
  },

  async clearWorkflowAssetImage(projectId: string, input: { assetKind: 'characters' | 'scenes' | 'props'; assetName: string; episodeId?: string }): Promise<{ workflow: WorkflowState }> {
    const params = input.episodeId ? `?${new URLSearchParams({ episodeId: input.episodeId }).toString()}` : ''
    const result = await request<any>(`/api/workflows/projects/${encodeURIComponent(projectId)}/workflow/assets/clear-image${params}`, {
      method: 'POST',
      body: {
        assetKind: input.assetKind,
        assetName: input.assetName,
      },
    })
    return {
      workflow: normalizeWorkflowState(result.workflow),
    }
  },

  async deleteWorkflowAssetImage(projectId: string, input: { assetKind: 'characters' | 'scenes' | 'props'; assetName: string; assetId: string; episodeId?: string }): Promise<{ workflow: WorkflowState; deleted: boolean; removedCurrent: boolean }> {
    const params = input.episodeId ? `?${new URLSearchParams({ episodeId: input.episodeId }).toString()}` : ''
    const result = await request<any>(`/api/workflows/projects/${encodeURIComponent(projectId)}/workflow/assets/images/${encodeURIComponent(input.assetId)}${params}`, {
      method: 'DELETE',
      body: {
        assetKind: input.assetKind,
        assetName: input.assetName,
      },
    })
    return {
      workflow: normalizeWorkflowState(result.workflow),
      deleted: Boolean(result.deleted),
      removedCurrent: Boolean(result.removedCurrent),
    }
  },

  async removeWorkflowAsset(projectId: string, input: { assetKind: 'characters' | 'scenes' | 'props'; assetName: string; episodeId?: string }): Promise<{ workflow: WorkflowState; removed: boolean }> {
    const params = input.episodeId ? `?${new URLSearchParams({ episodeId: input.episodeId }).toString()}` : ''
    const result = await request<any>(`/api/workflows/projects/${encodeURIComponent(projectId)}/workflow/assets${params}`, {
      method: 'DELETE',
      body: input,
    })
    return {
      workflow: normalizeWorkflowState(result.workflow),
      removed: Boolean(result.removed),
    }
  },

  async createUploadPresign(input: { key: string; contentType: string }): Promise<PresignedUploadResponse> {
    return request<PresignedUploadResponse>('/api/uploads/presign', {
      method: 'POST',
      body: input,
    })
  },

  async uploadLocalImage(input: { key: string; imageDataUrl: string; contentType?: string }): Promise<LocalImageUploadResponse> {
    return request<LocalImageUploadResponse>('/api/uploads/local-image', {
      method: 'POST',
      body: input,
    })
  },

  async uploadLocalFile(input: { key: string; file: File; contentType?: string }): Promise<LocalImageUploadResponse> {
    const baseUrl = getApiBaseUrl()
    const response = await fetch(`${baseUrl}/api/uploads/local-file?${new URLSearchParams({ key: input.key }).toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': input.contentType || input.file.type || 'application/octet-stream',
        ...(getToken() ? { Authorization: getToken() ?? '' } : {}),
      },
      body: input.file,
    })

    const text = await response.text()
    let payload: unknown = null
    if (text) {
      try {
        payload = JSON.parse(text)
      } catch {
        if (!response.ok) throw new Error(formatHttpError(response.status, response.statusText, summarizeNonJsonResponse(text)))
        throw new Error(`接口返回了非 JSON 内容：${summarizeNonJsonResponse(text) || response.statusText || 'empty response'}`)
      }
    }

    if (!response.ok) {
      const message = isEnvelope(payload) ? payload.message : response.statusText
      throw new Error(message || formatHttpError(response.status, response.statusText))
    }

    return isEnvelope<LocalImageUploadResponse>(payload) ? payload.data as LocalImageUploadResponse : payload as LocalImageUploadResponse
  },

  async listGenerationRecords(projectId?: string, options: { limit?: number; compact?: boolean } = {}): Promise<GenerationRecord[]> {
    const searchParams = new URLSearchParams()
    if (projectId && projectId !== 'local') searchParams.set('projectId', projectId)
    if (Number.isFinite(options.limit)) searchParams.set('limit', String(Math.max(1, Math.min(300, Math.floor(options.limit as number)))))
    if (options.compact) searchParams.set('compact', '1')
    const params = searchParams.toString() ? `?${searchParams.toString()}` : ''
    const records = await request<any[]>(`/api/generation-records${params}`, { cache: 'no-store' })
    return Array.isArray(records) ? records.map((item) => ({
      id: String(item.id ?? ''),
      projectId: item.projectId ? String(item.projectId) : undefined,
      aiModelId: item.aiModelId ? String(item.aiModelId) : undefined,
      prompt: String(item.prompt ?? ''),
      negativePrompt: item.negativePrompt ? String(item.negativePrompt) : undefined,
      input: item.input,
      parameters: item.parameters,
      status: String(item.status ?? ''),
      errorMessage: item.errorMessage ? String(item.errorMessage) : undefined,
      creditCost: Number.isFinite(Number(item.creditCost)) ? Number(item.creditCost) : undefined,
      queuedAt: item.queuedAt ? String(item.queuedAt) : undefined,
      startedAt: item.startedAt ? String(item.startedAt) : undefined,
      completedAt: item.completedAt ? String(item.completedAt) : undefined,
      createdAt: item.createdAt ? String(item.createdAt) : undefined,
      updatedAt: item.updatedAt ? String(item.updatedAt) : undefined,
      assets: Array.isArray(item.assets) ? item.assets.map((asset: any) => ({
        id: String(asset.id ?? ''),
        type: asset.type ? String(asset.type) : undefined,
        title: asset.title ? String(asset.title) : undefined,
        url: asset.url ? String(asset.url) : undefined,
        mimeType: asset.mimeType ? String(asset.mimeType) : undefined,
        metadata: asset.metadata,
        createdAt: asset.createdAt ? String(asset.createdAt) : undefined,
      })).filter((asset: GenerationRecordAsset) => asset.id) : [],
      aiModel: item.aiModel ? {
        id: item.aiModel.id ? String(item.aiModel.id) : undefined,
        provider: item.aiModel.provider ? String(item.aiModel.provider) : undefined,
        model: item.aiModel.model ? String(item.aiModel.model) : undefined,
        displayName: item.aiModel.displayName ? String(item.aiModel.displayName) : undefined,
        modality: item.aiModel.modality ? String(item.aiModel.modality) : undefined,
        costCredits: Number.isFinite(Number(item.aiModel.costCredits)) ? Number(item.aiModel.costCredits) : undefined,
        providerConfig: item.aiModel.providerConfig ? {
          displayName: item.aiModel.providerConfig.displayName ? String(item.aiModel.providerConfig.displayName) : undefined,
          providerType: item.aiModel.providerConfig.providerType ? String(item.aiModel.providerConfig.providerType) : undefined,
        } : null,
      } : null,
    })).filter((item) => item.id) : []
  },

  async retryGenerationRecord(generationId: string): Promise<GenerationRecord> {
    return request<GenerationRecord>(`/api/generation-records/${encodeURIComponent(generationId)}/retry`, { method: 'POST' })
  },

  async deleteGenerationRecord(generationId: string): Promise<void> {
    await request(`/api/generation-records/${encodeURIComponent(generationId)}`, { method: 'DELETE' })
  },

  async downloadImageBlob(input: { url: string; filename: string }): Promise<Blob> {
    const baseUrl = getApiBaseUrl()
    const response = await fetch(`${baseUrl}/api/uploads/download-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(getToken() ? { Authorization: getToken() ?? '' } : {}),
      },
      body: JSON.stringify(input),
    })

    if (!response.ok) {
      const text = await response.text()
      let message = response.statusText
      try {
        const payload = JSON.parse(text)
        message = payload?.message || payload?.data?.message || message
      } catch {
        message = summarizeNonJsonResponse(text) || message
      }
      throw new Error(message || `下载失败：${response.status}`)
    }

    return response.blob()
  },

  async listModelConfigs(): Promise<ModelConfigsResponse> {
    const modern = await tryRequest<any>('/api/model-configs', { cache: 'no-store' })
    if (modern !== null) return normalizeModelConfigs(modern)

    const models = await request<any>('/api/models')
    return normalizeModelConfigs(Array.isArray(models) ? { models } : models)
  },

  async createModelProvider(data: ProviderConfigInput): Promise<ModelProviderConfig> {
    const created = await request<any>('/api/model-configs/providers', {
      method: 'POST',
      body: data,
    })
    return normalizeModelProvider(created?.provider ?? created)
  },

  async updateModelProvider(id: string, data: Partial<ProviderConfigInput>): Promise<ModelProviderConfig> {
    const updated = await request<any>(`/api/model-configs/providers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: data,
    })
    return normalizeModelProvider(updated?.provider ?? updated)
  },

  async disableModelProvider(id: string): Promise<boolean> {
    await request<unknown>(`/api/model-configs/providers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    return true
  },

  async testModelProvider(id: string): Promise<ProviderTestResult> {
    const result = await request<any>(`/api/model-configs/providers/${encodeURIComponent(id)}/test`, {
      method: 'POST',
    })
    return normalizeProviderTestResult(result)
  },

  async testModelConfig(id: string): Promise<ProviderTestResult> {
    const result = await request<any>(`/api/model-configs/${encodeURIComponent(id)}/test`, {
      method: 'POST',
    })
    return normalizeProviderTestResult(result)
  },

  async testDraftModelConfig(data: DraftModelTestInput): Promise<ProviderTestResult> {
    const result = await request<any>('/api/model-configs/test-draft', {
      method: 'POST',
      body: data,
    })
    return normalizeProviderTestResult(result)
  },

  async upsertModelConfig(data: ModelConfigInput): Promise<ModelConfig> {
    const saved = await request<any>('/api/model-configs', {
      method: 'POST',
      body: data,
    })
    return normalizeModelConfig(saved?.model ?? saved)
  },

  async updateModelConfig(id: string, data: Partial<ModelConfigInput>): Promise<ModelConfig> {
    const updated = await request<any>(`/api/model-configs/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: data,
    })
    return normalizeModelConfig(updated?.model ?? updated)
  },

  async disableModelConfig(id: string): Promise<boolean> {
    await request<unknown>(`/api/model-configs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    return true
  },
}
