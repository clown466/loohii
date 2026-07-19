import { create } from 'zustand'
import {
  remakeApi,
  type CreateRemakeJobInput,
  type RemakeBreakdown,
  type RemakeGate,
  type RemakeJob,
  type RemakeScript,
} from '../lib/api/remakeApi'

interface RemakeStore {
  jobs: RemakeJob[]
  currentJob: RemakeJob | null
  loading: boolean
  detailLoading: boolean
  error: string | null
  loadJobs: () => Promise<void>
  loadJob: (jobId: string) => Promise<RemakeJob | null>
  createJob: (input: CreateRemakeJobInput) => Promise<RemakeJob>
  updateBreakdown: (jobId: string, breakdown: RemakeBreakdown) => Promise<RemakeJob>
  updateScript: (jobId: string, remakeScript: RemakeScript) => Promise<RemakeJob>
  approveGate: (jobId: string, gate: RemakeGate) => Promise<RemakeJob>
  rejectGate: (jobId: string, gate: RemakeGate) => Promise<RemakeJob>
  retryFailedShots: (jobId: string) => Promise<RemakeJob>
  clearCurrentJob: () => void
}

function upsertJob(jobs: RemakeJob[], job: RemakeJob): RemakeJob[] {
  const next = jobs.filter((item) => item.id !== job.id)
  return [job, ...next]
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请稍后重试'
}

export const useRemakeStore = create<RemakeStore>((set) => ({
  jobs: [],
  currentJob: null,
  loading: false,
  detailLoading: false,
  error: null,

  loadJobs: async () => {
    set({ loading: true, error: null })
    try {
      const jobs = await remakeApi.listJobs()
      set({ jobs, loading: false })
    } catch (error) {
      set({ loading: false, error: formatError(error) })
    }
  },

  loadJob: async (jobId) => {
    set({ detailLoading: true, error: null })
    try {
      const job = await remakeApi.getJob(jobId)
      set((state) => ({
        currentJob: job,
        jobs: upsertJob(state.jobs, job),
        detailLoading: false,
      }))
      return job
    } catch (error) {
      set({ detailLoading: false, error: formatError(error) })
      return null
    }
  },

  createJob: async (input) => {
    set({ loading: true, error: null })
    try {
      const job = await remakeApi.createJob(input)
      set((state) => ({
        jobs: upsertJob(state.jobs, job),
        currentJob: job,
        loading: false,
      }))
      return job
    } catch (error) {
      set({ loading: false, error: formatError(error) })
      throw error
    }
  },

  updateBreakdown: async (jobId, breakdown) => {
    const job = await remakeApi.updateBreakdown(jobId, breakdown)
    set((state) => ({
      currentJob: state.currentJob?.id === jobId ? job : state.currentJob,
      jobs: upsertJob(state.jobs, job),
    }))
    return job
  },

  updateScript: async (jobId, remakeScript) => {
    const job = await remakeApi.updateScript(jobId, remakeScript)
    set((state) => ({
      currentJob: state.currentJob?.id === jobId ? job : state.currentJob,
      jobs: upsertJob(state.jobs, job),
    }))
    return job
  },

  approveGate: async (jobId, gate) => {
    const job = await remakeApi.approveGate(jobId, gate)
    set((state) => ({
      currentJob: state.currentJob?.id === jobId ? job : state.currentJob,
      jobs: upsertJob(state.jobs, job),
    }))
    return job
  },

  rejectGate: async (jobId, gate) => {
    const job = await remakeApi.rejectGate(jobId, gate)
    set((state) => ({
      currentJob: state.currentJob?.id === jobId ? job : state.currentJob,
      jobs: upsertJob(state.jobs, job),
    }))
    return job
  },

  retryFailedShots: async (jobId) => {
    const job = await remakeApi.retryFailedShots(jobId)
    set((state) => ({
      currentJob: state.currentJob?.id === jobId ? job : state.currentJob,
      jobs: upsertJob(state.jobs, job),
    }))
    return job
  },

  clearCurrentJob: () => {
    set({ currentJob: null, error: null })
  },
}))
