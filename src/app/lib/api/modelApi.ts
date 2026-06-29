/**
 * Model configuration API: providers, model configs, testing.
 */
import { request, tryRequest } from './httpClient'
import {
  normalizeModelConfig,
  normalizeModelConfigs,
  normalizeModelProvider,
  normalizeProviderTestResult,
} from './normalizers'
import type {
  DraftModelTestInput,
  ModelConfig,
  ModelConfigInput,
  ModelConfigsResponse,
  ModelProviderConfig,
  ProviderConfigInput,
  ProviderTestResult,
} from './types'

export const modelApi = {
  async listModelConfigs(): Promise<ModelConfigsResponse> {
    const modern = await tryRequest<any>('/api/model-configs', { cache: 'no-store' })
    if (modern !== null) return normalizeModelConfigs(modern)

    const models = await request<any>('/api/models')
    return normalizeModelConfigs(Array.isArray(models) ? { models } : models)
  },

  async createModelProvider(data: ProviderConfigInput): Promise<ModelProviderConfig> {
    const created = await request<any>('/api/model-configs/providers', {
      method: 'POST',
      body: data,
    })
    return normalizeModelProvider(created?.provider ?? created)
  },

  async updateModelProvider(id: string, data: Partial<ProviderConfigInput>): Promise<ModelProviderConfig> {
    const updated = await request<any>(`/api/model-configs/providers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: data,
    })
    return normalizeModelProvider(updated?.provider ?? updated)
  },

  async disableModelProvider(id: string): Promise<boolean> {
    await request<unknown>(`/api/model-configs/providers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    return true
  },

  async testModelProvider(id: string): Promise<ProviderTestResult> {
    const result = await request<any>(`/api/model-configs/providers/${encodeURIComponent(id)}/test`, {
      method: 'POST',
    })
    return normalizeProviderTestResult(result)
  },

  async testModelConfig(id: string): Promise<ProviderTestResult> {
    const result = await request<any>(`/api/model-configs/${encodeURIComponent(id)}/test`, {
      method: 'POST',
    })
    return normalizeProviderTestResult(result)
  },

  async testDraftModelConfig(data: DraftModelTestInput): Promise<ProviderTestResult> {
    const result = await request<any>('/api/model-configs/test-draft', {
      method: 'POST',
      body: data,
    })
    return normalizeProviderTestResult(result)
  },

  async upsertModelConfig(data: ModelConfigInput): Promise<ModelConfig> {
    const saved = await request<any>('/api/model-configs', {
      method: 'POST',
      body: data,
    })
    return normalizeModelConfig(saved?.model ?? saved)
  },

  async updateModelConfig(id: string, data: Partial<ModelConfigInput>): Promise<ModelConfig> {
    const updated = await request<any>(`/api/model-configs/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: data,
    })
    return normalizeModelConfig(updated?.model ?? updated)
  },

  async disableModelConfig(id: string): Promise<boolean> {
    await request<unknown>(`/api/model-configs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    return true
  },
}
