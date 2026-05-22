import { createApi } from '../../lib/api'
import type { SnsAsset, SnsScript, SnsVideo } from './types'

const api = createApi('/api/fitpeak-sns')

export async function fetchAssets(): Promise<SnsAsset[]> {
  const { data } = await api.get('/assets')
  return data
}

export async function uploadAsset(file: File, category: string, productKey?: string): Promise<SnsAsset> {
  const form = new FormData()
  form.append('file', file)
  form.append('category', category)
  if (productKey) form.append('product_key', productKey)
  const { data } = await api.post('/assets/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function deleteAsset(id: string) {
  await api.delete(`/assets/${id}`)
}

export async function fetchScripts(): Promise<SnsScript[]> {
  const { data } = await api.get('/scripts')
  return data
}

export async function createScript(script: Omit<SnsScript, 'id' | 'created_at' | 'updated_at'>): Promise<SnsScript> {
  const { data } = await api.post('/scripts', script)
  return data
}

export async function updateScript(id: string, script: Partial<SnsScript>): Promise<SnsScript> {
  const { data } = await api.put(`/scripts/${id}`, script)
  return data
}

export async function deleteScript(id: string) {
  await api.delete(`/scripts/${id}`)
}

export async function fetchVideos(): Promise<SnsVideo[]> {
  const { data } = await api.get('/videos')
  return data
}

export async function renderVideo(scriptId: string): Promise<{ video_id: string; project: string }> {
  const { data } = await api.post('/videos/render', { script_id: scriptId })
  return data
}

export async function pollVideo(videoId: string): Promise<SnsVideo> {
  const { data } = await api.get(`/videos/${videoId}/poll`)
  return data
}

export async function deleteVideo(id: string) {
  await api.delete(`/videos/${id}`)
}
