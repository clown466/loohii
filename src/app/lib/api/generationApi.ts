/**
 * Generation records API: list, retry, delete generation records.
 */
import { request } from './httpClient'
import type { GenerationRecord, GenerationRecordAsset } from './types'

export const generationApi = {
  async listGenerationRecords(projectId?: string, options: { limit?: number; compact?: boolean } = {}): Promise<GenerationRecord[]> {
    const searchParams = new URLSearchParams()
    if (projectId && projectId !== 'local') searchParams.set('projectId', projectId)
    if (Number.isFinite(options.limit)) searchParams.set('limit', String(Math.max(1, Math.min(300, Math.floor(options.limit as number)))))
    if (options.compact) searchParams.set('compact', '1')
    const params = searchParams.toString() ? `?${searchParams.toString()}` : ''
    const records = await request<any[]>(`/api/generation-records${params}`, { cache: 'no-store' })
    return Array.isArray(records) ? records.map((item) => ({
      id: String(item.id ?? ''),
      projectId: item.projectId ? String(item.projectId) : undefined,
      aiModelId: item.aiModelId ? String(item.aiModelId) : undefined,
      prompt: String(item.prompt ?? ''),
      negativePrompt: item.negativePrompt ? String(item.negativePrompt) : undefined,
      input: item.input,
      parameters: item.parameters,
      status: String(item.status ?? ''),
      errorMessage: item.errorMessage ? String(item.errorMessage) : undefined,
      creditCost: Number.isFinite(Number(item.creditCost)) ? Number(item.creditCost) : undefined,
      queuedAt: item.queuedAt ? String(item.queuedAt) : undefined,
      startedAt: item.startedAt ? String(item.startedAt) : undefined,
      completedAt: item.completedAt ? String(item.completedAt) : undefined,
      createdAt: item.createdAt ? String(item.createdAt) : undefined,
      updatedAt: item.updatedAt ? String(item.updatedAt) : undefined,
      assets: Array.isArray(item.assets) ? item.assets.map((asset: any) => ({
        id: String(asset.id ?? ''),
        type: asset.type ? String(asset.type) : undefined,
        title: asset.title ? String(asset.title) : undefined,
        url: asset.url ? String(asset.url) : undefined,
        mimeType: asset.mimeType ? String(asset.mimeType) : undefined,
        metadata: asset.metadata,
        createdAt: asset.createdAt ? String(asset.createdAt) : undefined,
      })).filter((asset: GenerationRecordAsset) => asset.id) : [],
      aiModel: item.aiModel ? {
        id: item.aiModel.id ? String(item.aiModel.id) : undefined,
        provider: item.aiModel.provider ? String(item.aiModel.provider) : undefined,
        model: item.aiModel.model ? String(item.aiModel.model) : undefined,
        displayName: item.aiModel.displayName ? String(item.aiModel.displayName) : undefined,
        modality: item.aiModel.modality ? String(item.aiModel.modality) : undefined,
        costCredits: Number.isFinite(Number(item.aiModel.costCredits)) ? Number(item.aiModel.costCredits) : undefined,
        providerConfig: item.aiModel.providerConfig ? {
          displayName: item.aiModel.providerConfig.displayName ? String(item.aiModel.providerConfig.displayName) : undefined,
          providerType: item.aiModel.providerConfig.providerType ? String(item.aiModel.providerConfig.providerType) : undefined,
        } : null,
      } : null,
    })).filter((item) => item.id) : []
  },

  async retryGenerationRecord(generationId: string): Promise<GenerationRecord> {
    return request<GenerationRecord>(`/api/generation-records/${encodeURIComponent(generationId)}/retry`, { method: 'POST' })
  },

  async deleteGenerationRecord(generationId: string): Promise<void> {
    await request(`/api/generation-records/${encodeURIComponent(generationId)}`, { method: 'DELETE' })
  },
}
