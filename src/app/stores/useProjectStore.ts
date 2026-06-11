import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { apiClient } from '../lib/apiClient'

export interface Project {
  id: string
  title: string
  ratio: string
  style: string
  cover: string
  description?: string
  globalPrompt?: string
  negativePrompt?: string
  setupSettings?: {
    customStyleName?: string
    customStylePrompt?: string
    generationStrategy?: string
    projectTone?: string
    directorNotes?: string
    characterIdentityRules?: string
    globalPrompt?: string
    scriptRules?: Record<string, string>
  }
  createdAt: string
  scenes: number
  completedScenes: number
}

interface ProjectStore {
  projects: Project[]
  loadProjects: () => Promise<void>
  addProject: (project: Omit<Project, 'id' | 'createdAt'>) => Promise<string>
  updateProject: (id: string, data: Partial<Project>) => Promise<Project | null>
  deleteProject: (id: string) => void
  getProject: (id: string) => Project | undefined
}

const defaultProjects: Project[] = []
const STORE_VERSION = 2

function isLegacyDemoProject(project: Project): boolean {
  return /^proj-\d+$/i.test(project.id)
}

function sanitizeProjects(projects: Project[]): Project[] {
  return projects.filter((project) => !isLegacyDemoProject(project))
}

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      projects: defaultProjects,

      loadProjects: async () => {
        const projects = await apiClient.listProjects()
        set({ projects: projects ? sanitizeProjects(projects) : [] })
      },

      addProject: async (project) => {
        const created = await apiClient.createProject(project)
        if (!created) {
          throw new Error('项目创建失败，请检查后端服务或登录状态后重试')
        }
        set((state) => ({
          projects: [created, ...state.projects.filter((item) => item.id !== created.id)],
        }))
        return created.id
      },

      updateProject: async (id, data) => {
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, ...data } : p
          ),
        }))
        const updated = await apiClient.updateProject(id, data)
        if (updated) {
          set((state) => ({
            projects: state.projects.map((p) =>
              p.id === id || p.id === updated.id ? updated : p
            ),
          }))
          return updated
        }
        return null
      },

      deleteProject: (id) => {
        const previousProjects = get().projects
        set((state) => ({
          projects: state.projects.filter((p) => p.id !== id),
        }))
        void apiClient.deleteProject(id).catch((error) => {
          console.error(`[project-store] deleteProject failed for ${id}:`, error)
          set({ projects: previousProjects })
        })
      },

      getProject: (id) => {
        return get().projects.find((p) => p.id === id)
      },
    }),
    {
      name: 'loohii-projects',
      version: STORE_VERSION,
      migrate: (persistedState: unknown) => {
        if (!persistedState || typeof persistedState !== 'object') return persistedState
        const state = persistedState as Partial<ProjectStore>
        return {
          ...state,
          projects: Array.isArray(state.projects) ? sanitizeProjects(state.projects) : [],
        }
      },
    }
  )
)

if (apiClient.configured) {
  void useProjectStore.getState().loadProjects()
}
