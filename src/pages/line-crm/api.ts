import axios from 'axios'
import type {
  Friend,
  Tag,
  ChatMessage,
  AutoResponse,
  Broadcast,
  StepSequence,
  AiSettings,
  KnowledgeBase,
  PaginatedResponse,
  FriendListParams,
} from './types'
import { getChannelId } from './lineAccount'

const api = axios.create({
  baseURL: '/api/line-crm',
  headers: { 'Content-Type': 'application/json' },
})
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  config.params = { ...config.params, channel_id: getChannelId() }
  return config
})
// Friends API
export const friendApi = {
  list: (params?: FriendListParams) =>
    api.get<PaginatedResponse<Friend>>('/friends', { params }).then(r => r.data),

  getById: (id: string) =>
    api.get<Friend>(`/friends/${id}`).then(r => r.data),

  updateTags: (friendId: string, tagIds: string[]) =>
    api.put<Friend>(`/friends/${friendId}/tags`, { tag_ids: tagIds }).then(r => r.data),
}

// Tags API
export const tagApi = {
  list: () =>
    api.get<Tag[]>('/tags').then(r => r.data),

  create: (data: { name: string; color: string }) =>
    api.post<Tag>('/tags', data).then(r => r.data),

  delete: (id: string) =>
    api.delete(`/tags/${id}`).then(r => r.data),
}

// Chat API
export const chatApi = {
  getMessages: (friendId: string) =>
    api.get<ChatMessage[]>(`/chat/${friendId}/messages`).then(r => r.data),

  send: (friendId: string, content: string) =>
    api.post<ChatMessage>(`/chat/${friendId}/send`, { content }).then(r => r.data),

  upload: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post<{ url: string; type: 'image' | 'video'; fileName: string }>('/chat/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  sendMedia: (friendId: string, url: string, type: 'image' | 'video', previewUrl?: string) =>
    api.post<ChatMessage>(`/chat/${friendId}/send-media`, { url, type, previewUrl }).then(r => r.data),

  markAsRead: (friendId: string) =>
    api.post(`/friends/${friendId}/read`).then(r => r.data),

  listThreads: (search?: string) =>
    api
      .get<{
        friend: {
          id: string
          line_user_id: string
          display_name: string
          picture_url: string | null
          status: 'active' | 'blocked' | 'unfollowed'
          unread_count?: number
        }
        last_message: {
          friend_id: string
          content: unknown
          direction: 'incoming' | 'outgoing'
          message_type: string
          created_at: string
        } | null
      }[]>('/chat-threads', { params: search ? { search } : undefined })
      .then(r => r.data),
}

// Auto Response API
export const autoResponseApi = {
  list: () =>
    api.get<AutoResponse[]>('/auto-responses').then(r => r.data),

  create: (data: Omit<AutoResponse, 'id' | 'created_at' | 'updated_at'>) =>
    api.post<AutoResponse>('/auto-responses', data).then(r => r.data),

  update: (id: string, data: Partial<AutoResponse>) =>
    api.put<AutoResponse>(`/auto-responses/${id}`, data).then(r => r.data),

  delete: (id: string) =>
    api.delete(`/auto-responses/${id}`).then(r => r.data),

  toggleActive: (id: string, isActive: boolean) =>
    api.patch<AutoResponse>(`/auto-responses/${id}/toggle`, { is_active: isActive }).then(r => r.data),
}

// Broadcast API
export const broadcastApi = {
  list: () =>
    api.get<Broadcast[]>('/broadcasts').then(r => r.data),

  create: (data: { name: string; message_content: string; messages?: Array<Record<string, unknown>>; target_tags: string[] | null; target_filters: Record<string, unknown> | null; scheduled_at: string | null }) =>
    api.post<Broadcast>('/broadcasts', data).then(r => r.data),

  send: (id: string) =>
    api.post<Broadcast>(`/broadcasts/${id}/send`).then(r => r.data),

  previewCount: (filters: { include_tags?: string[]; exclude_tags?: string[]; tag_logic?: string; registered_from?: string; registered_to?: string }) =>
    api.post<{ count: number }>('/broadcasts/preview-count', filters).then(r => r.data),
}

// Step Sequence API
export const stepSequenceApi = {
  list: () =>
    api.get<StepSequence[]>('/step-sequences').then(r => r.data),

  create: (data: Omit<StepSequence, 'id' | 'created_at' | 'updated_at'>) =>
    api.post<StepSequence>('/step-sequences', data).then(r => r.data),

  update: (id: string, data: Partial<StepSequence>) =>
    api.put<StepSequence>(`/step-sequences/${id}`, data).then(r => r.data),
}

// AI Settings API
export const aiSettingsApi = {
  get: () =>
    api.get<AiSettings>('/ai-settings').then(r => r.data),

  update: (data: Partial<AiSettings>) =>
    api.put<AiSettings>('/ai-settings', data).then(r => r.data),
}

// Knowledge Base API
export const knowledgeBaseApi = {
  list: () =>
    api.get<KnowledgeBase[]>('/knowledge-base').then(r => r.data),

  create: (data: { title: string; content: string; category: string }) =>
    api.post<KnowledgeBase>('/knowledge-base', data).then(r => r.data),

  update: (id: string, data: Partial<KnowledgeBase>) =>
    api.put<KnowledgeBase>(`/knowledge-base/${id}`, data).then(r => r.data),

  delete: (id: string) =>
    api.delete(`/knowledge-base/${id}`).then(r => r.data),
}
