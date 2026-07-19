import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { API_AUTH_EXPIRED_EVENT, apiClient } from '../lib/apiClient'

interface User {
  id: string
  name: string
  email: string
  avatar: string
  credits: number
}

interface AuthStore {
  user: User | null
  isAuthenticated: boolean
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  signOut: () => void
  clearExpiredSession: () => void
  updateProfile: (data: Partial<User>) => void
}

function isAuthMockMode() {
  return import.meta.env.VITE_AUTH_MOCK_MODE === 'true'
}

function demoUser(name: string, email: string): User {
  return {
    id: crypto.randomUUID(),
    name,
    email,
    avatar: "", // 默认头像走 UserAvatar 渐变首字方案（P5-D），不再用 dicebear
    credits: 1250,
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : '认证请求失败'
}

function hasUsableAuthSession() {
  return isAuthMockMode() || Boolean(apiClient.getToken())
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,

      // 全站只认 aijiekou 平台账号（契约 §2）；无 loohii 本地注册/登录通道
      signIn: async (email: string, password: string) => {
        if (password.length < 6) {
          return { success: false, error: '密码至少6位' }
        }

        try {
          const apiUser = await apiClient.signIn(email, password)
          set({ user: apiUser, isAuthenticated: true })
          return { success: true }
        } catch (error) {
          if (!isAuthMockMode()) {
            return { success: false, error: errorMessage(error) }
          }
        }

        const name = email.split('@')[0]
        const user = demoUser(name, email)

        set({ user, isAuthenticated: true })
        return { success: true }
      },

      signOut: () => {
        apiClient.setToken(null)
        set({ user: null, isAuthenticated: false })
      },

      clearExpiredSession: () => {
        apiClient.setToken(null)
        set({ user: null, isAuthenticated: false })
      },

      updateProfile: (data: Partial<User>) => {
        set((state) => ({
          user: state.user ? { ...state.user, ...data } : null,
        }))
        apiClient.updateProfile(data).then((user) => {
          if (user) {
            set({ user })
          }
        })
      },
    }),
    {
      name: 'loohii-auth',
      onRehydrateStorage: () => (state) => {
        if (state?.isAuthenticated && !hasUsableAuthSession()) {
          state.clearExpiredSession()
        }
      },
    }
  )
)

if (typeof window !== 'undefined') {
  window.addEventListener(API_AUTH_EXPIRED_EVENT, () => {
    useAuthStore.getState().clearExpiredSession()
  })
}
