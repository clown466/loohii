/**
 * Workflow API: episodes, workflow state, runs, clips, assets, character references.
 */
import { request } from './httpClient'
import {
  normalizeWorkflowClip,
  normalizeWorkflowEpisodeList,
  normalizeWorkflowState,
} from './normalizers'
import type {
  CharacterReferenceAudioInput,
  CharacterReferenceImageInput,
  CharacterReferenceImageResponse,
  ClearCharacterReferenceAudioInput,
  ClipSeedancePromptResponse,
  ClipStoryboardPlanResponse,
  WorkflowAssetImageGenerationInput,
  WorkflowAssetImageGenerationResponse,
  WorkflowAssetImageHistoryItem,
  WorkflowAssetReferenceImageInput,
  WorkflowEpisodeListResponse,
  WorkflowEpisodeSummary,
  WorkflowRunResponse,
  WorkflowState,
} from './types'

const workflowGetCache = new Map<string, { expiresAt: number; value: WorkflowState | null }>()
const workflowGetPending = new Map<string, Promise<WorkflowState | null>>()
const WORKFLOW_GET_CACHE_MS = 1000

export const workflowApi = {
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
    const cacheKey = `${projectId}:${options.episodeId ?? ''}`
    const cached = workflowGetCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.value
    const pending = workflowGetPending.get(cacheKey)
    if (pending) return pending
    const params = options.episodeId ? `?${new URLSearchParams({ episodeId: options.episodeId }).toString()}` : ''
    const promise = request<any>(`/api/workflows/projects/${encodeURIComponent(projectId)}/workflow${params}`, { cache: 'no-store' })
      .then((workflow) => {
        const normalized = workflow ? normalizeWorkflowState(workflow) : null
        workflowGetCache.set(cacheKey, { expiresAt: Date.now() + WORKFLOW_GET_CACHE_MS, value: normalized })
        return normalized
      })
      .finally(() => {
        workflowGetPending.delete(cacheKey)
      })
    workflowGetPending.set(cacheKey, promise)
    return promise
  },

  async saveProjectWorkflow(projectId: string, draft: Partial<WorkflowState>, options: { episodeId?: string } = {}): Promise<WorkflowState | null> {
    const params = options.episodeId ? `?${new URLSearchParams({ episodeId: options.episodeId }).toString()}` : ''
    const workflow = await request<any>(`/api/workflows/projects/${encodeURIComponent(projectId)}/workflow${params}`, {
      method: 'PUT',
      body: { ...draft, ...(options.episodeId ? { episodeId: options.episodeId } : {}) },
    })
    const normalized = workflow ? normalizeWorkflowState(workflow) : null
    workflowGetCache.delete(`${projectId}:${options.episodeId ?? ''}`)
    workflowGetCache.delete(`${projectId}:`)
    return normalized
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
}
