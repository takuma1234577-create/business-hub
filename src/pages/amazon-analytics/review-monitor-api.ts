import axios from 'axios'
import type { MonitoredProduct, BuyerOutreach, ReviewSnapshot, ReviewMonitorStats } from './review-monitor-types'
import type { Pagination } from './types'

const api = axios.create({ baseURL: '/api/amazon-review-monitor' })
api.interceptors.request.use((config) => { const token = localStorage.getItem('auth_token'); if (token) config.headers.Authorization = `Bearer ${token}`; return config })
export const reviewMonitorApi = {
  // Products
  getProducts: () =>
    api.get<MonitoredProduct[]>('/products'),

  addProduct: (asin: string) =>
    api.post<MonitoredProduct>('/products', { asin }),

  removeProduct: (asin: string) =>
    api.delete(`/products/${asin}`),

  scanOrders: (asin: string) =>
    api.post<{ asin: string; scanned: number; matched: number; new: number }>(`/products/${asin}/scan`),

  checkReviews: (asin: string) =>
    api.post<{ asin: string; ratingCount: number; averageRating: number; ratingDropped: boolean }>(`/products/${asin}/check-reviews`),

  // Outreach
  getOutreach: (params: { asin?: string; status?: string; page?: number; pageSize?: number }) =>
    api.get<{ data: BuyerOutreach[]; pagination: Pagination }>('/outreach', { params }),

  generateMessage: (id: string) =>
    api.post<{ message: string }>(`/outreach/${id}/generate-message`),

  sendMessage: (id: string, message: string) =>
    api.post<{ success: boolean; messageSent: boolean; sendMethod: string; note: string }>(`/outreach/${id}/send`, { message }),

  updateStatus: (id: string, status: string, notes?: string) =>
    api.post(`/outreach/${id}/status`, { status, notes }),

  // Snapshots
  getSnapshots: (asin: string) =>
    api.get<ReviewSnapshot[]>(`/snapshots/${asin}`),

  // Stats
  getStats: () =>
    api.get<ReviewMonitorStats>('/stats'),
}
