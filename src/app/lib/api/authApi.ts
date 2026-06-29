/**
 * Auth-related API: sign-in, sign-up, profile.
 */
import { request, setToken, tryRequest } from './httpClient'
import { normalizeUser } from './normalizers'
import type { ApiUser } from './types'

export const authApi = {
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
}
