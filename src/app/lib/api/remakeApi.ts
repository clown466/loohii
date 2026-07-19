/**
 * Remake job CRUD and gate actions.
 */
import { request } from './httpClient'

export type RemakeJobStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'WAITING_GATE'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELED'

export type RemakeStage =
  | 'INGEST'
  | 'ANALYZE'
  | 'ADAPT'
  | 'GENERATE'
  | 'ASSEMBLE'
  | 'DELIVER'

export type RemakeGate = 'a' | 'b' | 'c'

export interface RemakeGates {
  a: boolean
  b: boolean
  c: boolean
}

export interface RemakeProgress {
  percent?: number
  message?: string
  shotIndex?: number
  shotTotal?: number
}

export interface RemakeShotBreakdown {
  index: number
  startMs: number
  endMs: number
  transcript: string
  visualSummary: string
  shotType: string
  subjects: string[]
  hookRole: string
  keyframeUrls: string[]
}

export interface RemakeBreakdown {
  language: string
  fullTranscript: string
  shots: RemakeShotBreakdown[]
  charactersDraft: string[]
  scenesDraft: string[]
  analysisConfidence: number
}

export interface RemakeScript {
  styleLock: string
  shots: Array<{
    index: number
    prompt: string
    durationMs: number
    dialogue: string
    refShotId: number
  }>
}

export interface RemakeSourceAsset {
  id: string
  platform: string
  videoKey: string
  coverKey?: string | null
  sourceUrl?: string | null
  durationMs?: number | null
}

export interface RemakeShotClip {
  id: string
  shotIndex: number
  status: string
  prompt?: string | null
  durationMs?: number | null
  resultUrl?: string | null
  errorMessage?: string | null
  retryCount: number
}

export interface RemakeJob {
  id: string
  userId: string
  status: RemakeJobStatus
  stage: RemakeStage
  sourceUrl?: string | null
  title?: string | null
  gatesEnabled: RemakeGates
  breakdown?: RemakeBreakdown | null
  remakeScript?: RemakeScript | null
  progress?: RemakeProgress | null
  errorMessage?: string | null
  finalVideoKey?: string | null
  finalVideoUrl?: string | null
  createdAt: string
  updatedAt: string
  source?: RemakeSourceAsset | null
  shots: RemakeShotClip[]
}

export interface CreateRemakeJobInput {
  sourceUrl?: string
  videoKey?: string
  coverKey?: string
  gates?: Partial<RemakeGates>
}

function normalizeGates(value: unknown): RemakeGates {
  const gates = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    a: gates.a !== false,
    b: gates.b !== false,
    c: gates.c !== false,
  }
}

function normalizeJob(raw: unknown): RemakeJob {
  const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return {
    id: String(item.id ?? ''),
    userId: String(item.userId ?? ''),
    status: String(item.status ?? 'PENDING') as RemakeJobStatus,
    stage: String(item.stage ?? 'INGEST') as RemakeStage,
    sourceUrl: item.sourceUrl ? String(item.sourceUrl) : null,
    title: item.title ? String(item.title) : null,
    gatesEnabled: normalizeGates(item.gatesEnabled),
    breakdown: item.breakdown && typeof item.breakdown === 'object'
      ? item.breakdown as RemakeBreakdown
      : null,
    remakeScript: item.remakeScript && typeof item.remakeScript === 'object'
      ? item.remakeScript as RemakeScript
      : null,
    progress: item.progress && typeof item.progress === 'object'
      ? item.progress as RemakeProgress
      : null,
    errorMessage: item.errorMessage ? String(item.errorMessage) : null,
    finalVideoKey: item.finalVideoKey ? String(item.finalVideoKey) : null,
    finalVideoUrl: item.finalVideoUrl ? String(item.finalVideoUrl) : null,
    createdAt: String(item.createdAt ?? ''),
    updatedAt: String(item.updatedAt ?? ''),
    source: item.source && typeof item.source === 'object'
      ? {
          id: String((item.source as Record<string, unknown>).id ?? ''),
          platform: String((item.source as Record<string, unknown>).platform ?? ''),
          videoKey: String((item.source as Record<string, unknown>).videoKey ?? ''),
          coverKey: (item.source as Record<string, unknown>).coverKey
            ? String((item.source as Record<string, unknown>).coverKey)
            : null,
          sourceUrl: (item.source as Record<string, unknown>).sourceUrl
            ? String((item.source as Record<string, unknown>).sourceUrl)
            : null,
          durationMs: typeof (item.source as Record<string, unknown>).durationMs === 'number'
            ? (item.source as Record<string, unknown>).durationMs as number
            : null,
        }
      : null,
    shots: Array.isArray(item.shots)
      ? item.shots.map((shot) => {
          const row = shot && typeof shot === 'object' ? shot as Record<string, unknown> : {}
          return {
            id: String(row.id ?? ''),
            shotIndex: Number(row.shotIndex ?? 0),
            status: String(row.status ?? 'pending'),
            prompt: row.prompt ? String(row.prompt) : null,
            durationMs: typeof row.durationMs === 'number' ? row.durationMs : null,
            resultUrl: row.resultUrl ? String(row.resultUrl) : null,
            errorMessage: row.errorMessage ? String(row.errorMessage) : null,
            retryCount: Number(row.retryCount ?? 0),
          }
        })
      : [],
  }
}

export const remakeApi = {
  async listJobs(limit = 50): Promise<RemakeJob[]> {
    const result = await request<unknown[]>(`/api/remake/jobs?limit=${limit}`)
    return Array.isArray(result) ? result.map(normalizeJob).filter((job) => job.id) : []
  },

  async getJob(jobId: string): Promise<RemakeJob> {
    const result = await request<unknown>(`/api/remake/jobs/${encodeURIComponent(jobId)}`)
    return normalizeJob(result)
  },

  async createJob(input: CreateRemakeJobInput): Promise<RemakeJob> {
    const result = await request<unknown>('/api/remake/jobs', {
      method: 'POST',
      body: input,
    })
    return normalizeJob(result)
  },

  async updateBreakdown(jobId: string, breakdown: RemakeBreakdown): Promise<RemakeJob> {
    const result = await request<unknown>(`/api/remake/jobs/${encodeURIComponent(jobId)}/breakdown`, {
      method: 'PATCH',
      body: { breakdown },
    })
    return normalizeJob(result)
  },

  async updateScript(jobId: string, remakeScript: RemakeScript): Promise<RemakeJob> {
    const result = await request<unknown>(`/api/remake/jobs/${encodeURIComponent(jobId)}/script`, {
      method: 'PATCH',
      body: { remakeScript },
    })
    return normalizeJob(result)
  },

  async approveGate(jobId: string, gate: RemakeGate): Promise<RemakeJob> {
    const result = await request<unknown>(
      `/api/remake/jobs/${encodeURIComponent(jobId)}/gates/${gate}/approve`,
      { method: 'POST' },
    )
    return normalizeJob(result)
  },

  async rejectGate(jobId: string, gate: RemakeGate): Promise<RemakeJob> {
    const result = await request<unknown>(
      `/api/remake/jobs/${encodeURIComponent(jobId)}/gates/${gate}/reject`,
      { method: 'POST' },
    )
    return normalizeJob(result)
  },

  async retryFailedShots(jobId: string): Promise<RemakeJob> {
    const result = await request<unknown>(
      `/api/remake/jobs/${encodeURIComponent(jobId)}/retry-failed-shots`,
      { method: 'POST' },
    )
    return normalizeJob(result)
  },
}
