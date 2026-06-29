/**
 * Upload API: presigned URLs, local image/file upload, image download.
 */
import {
  formatHttpError,
  getApiBaseUrl,
  getToken,
  request,
  summarizeNonJsonResponse,
} from './httpClient'
import type { LocalImageUploadResponse, PresignedUploadResponse } from './types'

interface ApiEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

function isEnvelope<T>(value: unknown): value is ApiEnvelope<T> {
  return !!value && typeof value === 'object' && ('code' in value || 'data' in value || 'message' in value)
}

export const uploadApi = {
  async createUploadPresign(input: { key: string; contentType: string }): Promise<PresignedUploadResponse> {
    return request<PresignedUploadResponse>('/api/uploads/presign', {
      method: 'POST',
      body: input,
    })
  },

  async uploadLocalImage(input: { key: string; imageDataUrl: string; contentType?: string }): Promise<LocalImageUploadResponse> {
    return request<LocalImageUploadResponse>('/api/uploads/local-image', {
      method: 'POST',
      body: input,
    })
  },

  async uploadLocalFile(input: { key: string; file: File; contentType?: string }): Promise<LocalImageUploadResponse> {
    const baseUrl = getApiBaseUrl()
    const response = await fetch(`${baseUrl}/api/uploads/local-file?${new URLSearchParams({ key: input.key }).toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': input.contentType || input.file.type || 'application/octet-stream',
        ...(getToken() ? { Authorization: getToken() ?? '' } : {}),
      },
      body: input.file,
    })

    const text = await response.text()
    let payload: unknown = null
    if (text) {
      try {
        payload = JSON.parse(text)
      } catch {
        if (!response.ok) throw new Error(formatHttpError(response.status, response.statusText, summarizeNonJsonResponse(text)))
        throw new Error(`接口返回了非 JSON 内容：${summarizeNonJsonResponse(text) || response.statusText || 'empty response'}`)
      }
    }

    if (!response.ok) {
      const message = isEnvelope(payload) ? payload.message : response.statusText
      throw new Error(message || formatHttpError(response.status, response.statusText))
    }

    return isEnvelope<LocalImageUploadResponse>(payload) ? payload.data as LocalImageUploadResponse : payload as LocalImageUploadResponse
  },

  async downloadImageBlob(input: { url: string; filename: string }): Promise<Blob> {
    const baseUrl = getApiBaseUrl()
    const response = await fetch(`${baseUrl}/api/uploads/download-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(getToken() ? { Authorization: getToken() ?? '' } : {}),
      },
      body: JSON.stringify(input),
    })

    if (!response.ok) {
      const text = await response.text()
      let message = response.statusText
      try {
        const payload = JSON.parse(text)
        message = payload?.message || payload?.data?.message || message
      } catch {
        message = summarizeNonJsonResponse(text) || message
      }
      throw new Error(message || `下载失败：${response.status}`)
    }

    return response.blob()
  },
}
