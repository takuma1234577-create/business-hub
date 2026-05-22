import axios from 'axios';
import type { Client, EmailTemplate, Schedule, HistoryItem, SenderSettings, AmazonAccount, FeeRule, CalculatedFees } from './types';

const api = axios.create({ baseURL: '/api/invoice' });
api.interceptors.request.use((config) => { const token = localStorage.getItem('auth_token'); if (token) config.headers.Authorization = `Bearer ${token}`; return config })
export const authApi = {
  status: () => api.get('/auth/status').then(r => r.data),
  login: () => api.get('/auth/login').then(r => r.data),
};

export const clientApi = {
  list: () => api.get<Client[]>('/clients').then(r => r.data),
  create: (data: Omit<Client, 'id'>) => api.post<Client>('/clients', data).then(r => r.data),
  update: (id: string, data: Partial<Client>) => api.put<Client>(`/clients/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/clients/${id}`).then(r => r.data),
};

export const templateApi = {
  list: () => api.get<{ templates: EmailTemplate[] }>('/templates').then(r => r.data.templates),
  create: (data: Omit<EmailTemplate, 'id'>) => api.post<EmailTemplate>('/templates', data).then(r => r.data),
  update: (id: string, data: Partial<EmailTemplate>) => api.put<EmailTemplate>(`/templates/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/templates/${id}`).then(r => r.data),
};

export const gmailApi = {
  createDraft: (data: { to: string; subject: string; body: string; pdfBase64?: string; pdfFilename?: string; invoiceNumber?: string }) =>
    api.post('/gmail/draft', data).then(r => r.data),
  send: (data: { to: string; subject: string; body: string; pdfBase64?: string; pdfFilename?: string; invoiceNumber?: string }) =>
    api.post('/gmail/send', data).then(r => r.data),
};

export const historyApi = {
  list: () => api.get<HistoryItem[]>('/history').then(r => r.data),
  delete: (id: string) => api.delete(`/history/${id}`).then(r => r.data),
};

export const scheduleApi = {
  list: () => api.get<Schedule[]>('/schedules').then(r => r.data),
  create: (data: Omit<Schedule, 'id'>) => api.post<Schedule>('/schedules', data).then(r => r.data),
  update: (id: string, data: Partial<Schedule>) => api.put<Schedule>(`/schedules/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/schedules/${id}`).then(r => r.data),
};

export const invoiceApi = {
  getNextNumber: () => api.get<{ number: string }>('/invoice-number').then(r => r.data.number),
};

export const settingsApi = {
  get: () => api.get<SenderSettings>('/settings').then(r => r.data),
  update: (data: Partial<SenderSettings>) => api.put<SenderSettings>('/settings', data).then(r => r.data),
};

export const amazonApi = {
  listAccounts: (clientId: string) =>
    api.get<AmazonAccount[]>(`/clients/${clientId}/amazon-accounts`).then(r => r.data),
  addAccount: (clientId: string, data: Omit<AmazonAccount, 'id' | 'clientId'>) =>
    api.post<AmazonAccount>(`/clients/${clientId}/amazon-accounts`, data).then(r => r.data),
  updateAccount: (id: string, data: Partial<AmazonAccount>) => api.put(`/amazon-accounts/${id}`, data).then(r => r.data),
  deleteAccount: (id: string) => api.delete(`/amazon-accounts/${id}`).then(r => r.data),
  testConnection: (id: string) => api.post(`/amazon-accounts/${id}/test`).then(r => r.data),
  fetchSales: (accountId: string, yearMonth: string) =>
    api.post(`/amazon-accounts/${accountId}/fetch-sales`, { yearMonth }).then(r => r.data),
  updateAdSpend: (accountId: string, yearMonth: string, totalAdSpend: number) =>
    api.put(`/amazon-monthly-data/${accountId}/${yearMonth}`, { totalAdSpend }).then(r => r.data),
};

export const feeRuleApi = {
  list: (clientId: string) => api.get<FeeRule[]>(`/clients/${clientId}/fee-rules`).then(r => r.data),
  create: (clientId: string, data: Omit<FeeRule, 'id' | 'clientId'>) =>
    api.post<FeeRule>(`/clients/${clientId}/fee-rules`, data).then(r => r.data),
  update: (id: string, data: Partial<FeeRule>) =>
    api.put<FeeRule>(`/fee-rules/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/fee-rules/${id}`).then(r => r.data),
  calculate: (clientId: string, yearMonth: string) =>
    api.get<CalculatedFees>(`/clients/${clientId}/calculate-fees?yearMonth=${yearMonth}`).then(r => r.data),
};
