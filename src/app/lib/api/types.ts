/**
 * Shared type definitions for API responses and requests.
 */
import type { Edge, Node } from '@xyflow/react'

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
  modelId?: string
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
