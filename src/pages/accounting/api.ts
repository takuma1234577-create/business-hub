import axios from 'axios'
import type {
  AccountingDocument,
  AccountingSource,
  AccountingFetchLog,
  DashboardStats,
} from './types'

const api = axios.create({ baseURL: '/api/accounting' })

export const documentApi = {
  list: (params?: {
    status?: string
    type?: string
    search?: string
    page?: number
    limit?: number
  }) => api.get<{ documents: AccountingDocument[]; total: number }>('/documents', { params }).then(r => r.data),

  get: (id: string) => api.get<AccountingDocument>(`/documents/${id}`).then(r => r.data),

  create: (data: Partial<AccountingDocument>) =>
    api.post<AccountingDocument>('/documents', data).then(r => r.data),

  update: (id: string, data: Partial<AccountingDocument>) =>
    api.put<AccountingDocument>(`/documents/${id}`, data).then(r => r.data),

  delete: (id: string) => api.delete(`/documents/${id}`).then(r => r.data),

  upload: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post<AccountingDocument>('/documents/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  analyze: (id: string) =>
    api.post<AccountingDocument>(`/documents/${id}/analyze`).then(r => r.data),

  bulkUpdateStatus: (ids: string[], status: string) =>
    api.put('/documents/bulk-status', { ids, status }).then(r => r.data),
}

export const dashboardApi = {
  stats: () => api.get<DashboardStats>('/dashboard/stats').then(r => r.data),
}

export const sourceApi = {
  list: () => api.get<AccountingSource[]>('/sources').then(r => r.data),
  create: (data: Partial<AccountingSource>) =>
    api.post<AccountingSource>('/sources', data).then(r => r.data),
  update: (id: string, data: Partial<AccountingSource>) =>
    api.put<AccountingSource>(`/sources/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/sources/${id}`).then(r => r.data),
}

export const fetchLogApi = {
  list: (limit?: number) =>
    api.get<AccountingFetchLog[]>('/fetch-logs', { params: { limit } }).then(r => r.data),
}

export const gmailFetchApi = {
  scan: () => api.post<{ found: number; saved: number }>('/gmail/scan').then(r => r.data),
}
