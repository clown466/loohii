/**
 * Shared data normalizer functions used across domain API modules.
 */
import type { Project } from '../../stores/useProjectStore'
import { maskSecret, normalizeOptionalNumber, normalizeStringArray } from './httpClient'
import type {
  ApiUser,
  ModelConfig,
  ModelConfigsResponse,
  ModelProviderConfig,
  ProviderTestResult,
  WorkflowBreakdownScene,
  WorkflowClip,
  WorkflowEpisodeListResponse,
  WorkflowEpisodeSummary,
  WorkflowState,
} from './types'

export function avatarFor(name: string): string {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`
}

export function normalizeUser(value: any, emailFallback = ''): ApiUser {
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

export function normalizeProject(value: any): Project {
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

export function normalizeModelProvider(value: any): ModelProviderConfig {
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

export function normalizeModelConfig(value: any): ModelConfig {
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

export function normalizeModelConfigs(value: any): ModelConfigsResponse {
  const root = Array.isArray(value) ? { models: value } : value ?? {}
  const providersSource = root.providers ?? root.providerConfigs ?? root.data?.providers ?? []
  const modelsSource = root.models ?? root.configs ?? root.items ?? root.data?.models ?? []
  const providers = Array.isArray(providersSource) ? providersSource.map(normalizeModelProvider) : []
  const models = Array.isArray(modelsSource) ? modelsSource.map(normalizeModelConfig) : []
  return { providers, models }
}

export function normalizeWorkflowState(value: any): WorkflowState {
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

export function normalizeWorkflowEpisodeList(value: any): WorkflowEpisodeListResponse | undefined {
  if (!value || typeof value !== 'object') return undefined
  const episodesSource = Array.isArray(value.episodes) ? value.episodes : []
  const seen = new Set<string>()
  const episodes = episodesSource
    .map((item: any): WorkflowEpisodeSummary => ({
      id: String(item?.id ?? ''),
      title: String(item?.title ?? item?.selectedEpisode ?? '未命名集'),
      selectedEpisode: String(item?.selectedEpisode ?? item?.title ?? '未命名集'),
      canvasSceneId: String(item?.canvasSceneId ?? item?.id ?? 'default'),
      updatedAt: item?.updatedAt ? String(item.updatedAt) : undefined,
      sourceName: item?.sourceName ? String(item.sourceName) : undefined,
      clipCount: Number.isFinite(Number(item?.clipCount)) ? Number(item.clipCount) : 0,
      sceneCount: Number.isFinite(Number(item?.sceneCount)) ? Number(item.sceneCount) : 0,
    }))
    .filter((item: WorkflowEpisodeSummary) => {
      if (!item.id || seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
  const requestedActiveEpisodeId = String(value.activeEpisodeId ?? '')
  const activeEpisodeId = episodes.some((episode) => episode.id === requestedActiveEpisodeId)
    ? requestedActiveEpisodeId
    : episodes[0]?.id ?? ''
  return {
    activeEpisodeId,
    episodes,
  }
}

export function normalizeWorkflowScene(value: any): WorkflowBreakdownScene {
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

export function normalizeWorkflowClip(value: any): WorkflowClip {
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

export function normalizeProviderTestResult(value: any): ProviderTestResult {
  const ok = Boolean(value?.ok ?? value?.success ?? value?.connected ?? value?.healthy)
  return {
    ok,
    message: String(value?.message ?? value?.error ?? (ok ? '连接测试成功' : '连接测试失败')),
    raw: value,
  }
}

export function toLegacyProject(project: Partial<Project>) {
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
