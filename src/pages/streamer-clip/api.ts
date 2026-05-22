import type { StreamerProfile, StreamerJob, StreamerCandidate, ProfileStats } from './types'

const BASE = '/api/streamer-clip'

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || res.statusText)
  }
  return res.json()
}

// Profiles
export const fetchProfiles = () => api<StreamerProfile[]>('/profiles')
export const fetchProfile = (id: string) => api<StreamerProfile>(`/profiles/${id}`)
export const createProfile = (body: { id: string; display_name: string; config: Record<string, unknown> }) =>
  api<StreamerProfile>('/profiles', { method: 'POST', body: JSON.stringify(body) })
export const updateProfile = (id: string, body: { display_name?: string; config?: Record<string, unknown> }) =>
  api<StreamerProfile>(`/profiles/${id}`, { method: 'PUT', body: JSON.stringify(body) })
export const deleteProfile = (id: string) =>
  api<{ ok: boolean }>(`/profiles/${id}`, { method: 'DELETE' })

// Jobs
export const fetchJobs = (profileId?: string) =>
  api<StreamerJob[]>(`/jobs${profileId ? `?profile_id=${profileId}` : ''}`)
export const fetchJob = (id: string) => api<StreamerJob>(`/jobs/${id}`)
export const createJob = (body: { profile_id: string; video_filename: string; video_url?: string }) =>
  api<StreamerJob>('/jobs', { method: 'POST', body: JSON.stringify(body) })
export const processJob = (id: string, transcript: string) =>
  api<{ candidates: StreamerCandidate[]; cost_usd: number }>(`/jobs/${id}/process`, {
    method: 'POST',
    body: JSON.stringify({ transcript }),
  })
export const deleteJob = (id: string) =>
  api<{ ok: boolean }>(`/jobs/${id}`, { method: 'DELETE' })

// ファイルアップロード → 文字起こし → 候補抽出（ワンストップ）
export async function uploadAndProcess(profileId: string, file: File) {
  const formData = new FormData()
  formData.append('profile_id', profileId)
  formData.append('file', file)
  const res = await fetch(`${BASE}/jobs/upload-and-process`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || res.statusText)
  }
  return res.json() as Promise<{
    job_id: string
    transcript_length: number
    duration_seconds: number
    candidates: StreamerCandidate[]
    cost: { whisper: number; claude: number; total: number }
  }>
}

// URL → 音声取得 → 文字起こし → 候補抽出
export async function processUrl(profileId: string, url: string) {
  return api<{
    job_id: string
    title: string
    duration_seconds: number
    transcript_length: number
    candidates: StreamerCandidate[]
    cost: { whisper: number; claude: number; total: number }
  }>('/jobs/process-url', {
    method: 'POST',
    body: JSON.stringify({ profile_id: profileId, url }),
  })
}

// Candidates
export const fetchCandidates = (params?: { job_id?: string; profile_id?: string; status?: string }) => {
  const q = new URLSearchParams()
  if (params?.job_id) q.set('job_id', params.job_id)
  if (params?.profile_id) q.set('profile_id', params.profile_id)
  if (params?.status) q.set('status', params.status)
  return api<StreamerCandidate[]>(`/candidates?${q}`)
}
export const updateCandidate = (id: string, status: string) =>
  api<StreamerCandidate>(`/candidates/${id}`, { method: 'PUT', body: JSON.stringify({ status }) })
export const publishCandidate = (id: string, youtubeVideoId: string) =>
  api<StreamerCandidate>(`/candidates/${id}/publish`, { method: 'PUT', body: JSON.stringify({ youtube_video_id: youtubeVideoId }) })

// Stats
export const fetchStats = () => api<ProfileStats[]>('/stats')
export const fetchProfileStats = (profileId: string) => api<ProfileStats>(`/stats/${profileId}`)
