/**
 * Project CRUD and project-scoped resources (characters, scenes).
 */
import type { Project } from '../../stores/useProjectStore'
import { numberId, request, tryRequest } from './httpClient'
import { normalizeProject, toLegacyProject } from './normalizers'
import type {
  AgentConversation,
  AgentHistoryMessage,
  AgentSendMessageRequest,
  AgentSendMessageResponse,
  ProjectCharacterRecord,
  ProjectSceneRecord,
} from './types'

const projectCharactersPending = new Map<string, Promise<ProjectCharacterRecord[]>>()
const projectScenesPending = new Map<string, Promise<ProjectSceneRecord[]>>()
const projectCharactersCache = new Map<string, ProjectCharacterRecord[]>()
const projectScenesCache = new Map<string, ProjectSceneRecord[]>()

export const projectApi = {
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
    const cached = projectCharactersCache.get(projectId)
    if (cached) return cached
    const pending = projectCharactersPending.get(projectId)
    if (pending) return pending
    const promise = request<any[]>(`/api/projects/${encodeURIComponent(projectId)}/characters`).then((result) => {
      const characters = Array.isArray(result) ? result.map((item: any) => ({
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
      projectCharactersCache.set(projectId, characters)
      return characters
    }).finally(() => {
      projectCharactersPending.delete(projectId)
    })
    projectCharactersPending.set(projectId, promise)
    return promise
  },

  async listProjectScenes(projectId: string): Promise<ProjectSceneRecord[]> {
    const cached = projectScenesCache.get(projectId)
    if (cached) return cached
    const pending = projectScenesPending.get(projectId)
    if (pending) return pending
    const promise = request<any[]>(`/api/projects/${encodeURIComponent(projectId)}/scenes`).then((result) => {
      const scenes = Array.isArray(result) ? result.map((item: any) => ({
      id: String(item?.id ?? ''),
      title: String(item?.title ?? '').trim(),
      summary: item?.summary ? String(item.summary) : undefined,
      prompt: item?.prompt ? String(item.prompt) : undefined,
      metadata: item?.metadata && typeof item.metadata === 'object' ? item.metadata : {},
      })).filter((item) => item.id && item.title) : []
      projectScenesCache.set(projectId, scenes)
      return scenes
    }).finally(() => {
      projectScenesPending.delete(projectId)
    })
    projectScenesPending.set(projectId, promise)
    return promise
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
}
