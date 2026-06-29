/**
 * Canvas API: scene CRUD, episode sync, image/video generation, prompt tools.
 */
import { numberId, request, tryRequest } from './httpClient'
import { normalizeWorkflowState } from './normalizers'
import type {
  CanvasImageGenerationInput,
  CanvasPromptInspectionInput,
  CanvasPromptInspectionResponse,
  CanvasPromptOptimizationInput,
  CanvasPromptOptimizationResponse,
  CanvasPromptTranslationInput,
  CanvasPromptTranslationResponse,
  CanvasScene,
  CanvasVideoGenerationInput,
  CanvasVideoGenerationResponse,
  EpisodeCanvasSyncResponse,
  WorkflowAssetImageGenerationResponse,
} from './types'

export const canvasApi = {
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
}
