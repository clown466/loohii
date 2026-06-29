/**
 * Base HTTP infrastructure: fetch wrapper, token management, error handling.
 */

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

interface ApiEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

export interface ApiRequestOptions {
  method?: HttpMethod
  body?: unknown
  token?: string | null
  signal?: AbortSignal
  cache?: RequestCache
}

const API_TOKEN_KEY = 'loohii-api-token'
export const API_AUTH_EXPIRED_EVENT = 'loohii:auth-expired'

export function getApiBaseUrl(): string {
  const value = import.meta.env.VITE_API_URL as string | undefined
  if (!value?.trim()) return ''
  return value.replace(/\/+$/, '')
}

export function getToken(): string | null {
  return localStorage.getItem(API_TOKEN_KEY)
}

export function setToken(token?: string | null) {
  if (token) {
    localStorage.setItem(API_TOKEN_KEY, token)
  } else {
    localStorage.removeItem(API_TOKEN_KEY)
  }
}

function isEnvelope<T>(value: unknown): value is ApiEnvelope<T> {
  return !!value && typeof value === 'object' && ('code' in value || 'data' in value || 'message' in value)
}

export async function request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
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

export function summarizeNonJsonResponse(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
}

export function formatHttpError(status: number, statusText: string, snippet = ''): string {
  if (status === 504) {
    return 'AI 请求超过网关等待时间（504）。后端可能还在处理，请稍后刷新；如果是生图任务，请减少提示词/参考图数量或降低分辨率后重试。'
  }
  if (status === 502) {
    return '后端服务暂时不可用（502），请稍后重试。'
  }
  const detail = snippet ? `：${snippet}` : ''
  return `接口请求失败（${status} ${statusText || 'Error'}）${detail}`
}

export function formatNetworkError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '')
  if (/failed to fetch|fetch failed|networkerror|load failed/i.test(message)) {
    return '网络请求没有连到后端（Failed to fetch）。请确认网络正常后重试；如果刚刚触发生图，可能是长请求被浏览器或网关中断。'
  }
  return message || '网络请求失败，请稍后重试。'
}

export async function tryRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T | null> {
  try {
    return await request<T>(path, options)
  } catch {
    return null
  }
}

export function numberId(id: string): number | null {
  const value = Number(id)
  return Number.isFinite(value) ? value : null
}

export function maskSecret(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  if (value.includes('*') || value.includes('•')) return value
  if (value.length <= 8) return '••••••••'
  return `${value.slice(0, 3)}••••${value.slice(-4)}`
}

export function normalizeOptionalNumber(value: unknown): number | undefined {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

export function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}
