import axios from 'axios'
import type { ReviewOrder, SolicitationHistory, SolicitationStats, AutoConfig, BulkResult, Pagination } from './types'

const api = axios.create({ baseURL: '/api/amazon-analytics' })
api.interceptors.request.use((config) => { const token = localStorage.getItem('auth_token'); if (token) config.headers.Authorization = `Bearer ${token}`; return config })
export const reviewApi = {
  getOrders: (params: { page?: number; pageSize?: number; filter?: string }) =>
    api.get<{ data: ReviewOrder[]; pagination: Pagination }>('/orders', { params }),

  sendSolicitation: (amazonOrderId: string) =>
    api.post<{ success: boolean; amazonOrderId: string }>('/solicitations/send', { amazonOrderId }),

  sendBulk: (amazonOrderIds: string[]) =>
    api.post<BulkResult>('/solicitations/send-bulk', { amazonOrderIds }),

  getHistory: (params: { page?: number; pageSize?: number; status?: string }) =>
    api.get<{ data: SolicitationHistory[]; pagination: Pagination }>('/solicitations/history', { params }),

  getStats: () =>
    api.get<SolicitationStats>('/solicitations/stats'),

  getAutoConfig: () =>
    api.get<AutoConfig>('/solicitations/auto-config'),

  updateAutoConfig: (config: Partial<AutoConfig>) =>
    api.post<AutoConfig>('/solicitations/auto-config', config),
}
