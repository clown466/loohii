/**
 * Auth API：登录/注册统一走 aijiekou 平台（前端直连，契约 §2.1），
 * loohii 服务端只认平台 JWT（/api/auth/me 用于换取本地影子用户档案）。
 */
import { request, setToken, tryRequest } from './httpClient'
import { normalizeUser } from './normalizers'
import type { ApiUser } from './types'

export function getAijiekouApiBase(): string {
  const value = import.meta.env.VITE_AIJIEKOU_API_BASE as string | undefined
  return (value?.trim() || 'https://api.aijiekou.online').replace(/\/+$/, '')
}

interface PlatformLoginResponse {
  token: string
  user: { id: number; email: string; points: number }
}

async function platformLogin(path: string, email: string, password: string): Promise<string> {
  const base = getAijiekouApiBase()
  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    })
  } catch {
    throw new Error('无法连接 aijiekou 平台，请检查网络后重试')
  }
  const body = (await response.json().catch(() => null)) as (PlatformLoginResponse & { detail?: string }) | null
  if (!response.ok || !body?.token) {
    // 平台未回 detail 时按状态码给用户可懂的文案，而不是裸的 "平台登录失败（401）"
    const fallback = response.status === 401 || response.status === 403
      ? '邮箱或密码错误，请核对后重试'
      : response.status >= 500
        ? 'aijiekou 平台暂时不可用，请稍后重试'
        : `平台登录失败（${response.status}）`
    throw new Error(body?.detail || fallback)
  }
  return body.token
}

/** 拿平台 token 换 loohii 本地影子用户档案（首次访问自动建影子用户） */
async function fetchLocalProfile(token: string, emailFallback: string): Promise<ApiUser> {
  const me = await request<any>('/api/auth/me', { token })
  const user = normalizeUser(me.user ?? me, emailFallback)
  // 余额以平台 points 为准（本地 creditBalance 已废弃，仅历史审计保留）
  if (me.platform && Number.isFinite(Number(me.platform.points))) {
    user.credits = Number(me.platform.points)
  }
  return user
}

export const authApi = {
  /** 平台账号登录（与拆剧助手同一套账号密码）；注册请前往 aijiekou 平台，loohii 无本地注册通道 */
  async signIn(email: string, password: string): Promise<ApiUser> {
    const token = await platformLogin('/v1/auth/login', email, password)
    setToken(token)
    return fetchLocalProfile(token, email)
  },

  async updateProfile(data: Partial<ApiUser>): Promise<ApiUser | null> {
    const user = await tryRequest<any>('/api/auth/me', {
      method: 'PATCH',
      body: data,
    })
    return user ? normalizeUser(user.user ?? user) : null
  },
}
