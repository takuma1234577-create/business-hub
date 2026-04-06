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

  uploadToDrive: (id: string) =>
    api.post<AccountingDocument>(`/documents/${id}/upload-to-drive`).then(r => r.data),
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

// =====================
// 金融口座・取引
// =====================

import type { FinancialAccount, FinancialTransaction } from './types'

export interface InstitutionSearchResult {
  id: string
  code: string
  name: string
  nameKana: string | null
  institutionType: string
}

export interface BranchSearchResult {
  id: string
  code: string
  name: string
  nameKana: string | null
}

export const institutionApi = {
  search: (q: string, type?: string) =>
    api.get<InstitutionSearchResult[]>('/institutions/search', { params: { q, type } }).then(r => r.data),
  searchBranches: (institutionId: string, q: string) =>
    api.get<BranchSearchResult[]>(`/institutions/${institutionId}/branches/search`, { params: { q } }).then(r => r.data),
}

export const financialAccountApi = {
  list: () => api.get<FinancialAccount[]>('/financial-accounts').then(r => r.data),
  get: (id: string) => api.get<FinancialAccount>(`/financial-accounts/${id}`).then(r => r.data),
  create: (data: Partial<FinancialAccount>) =>
    api.post<FinancialAccount>('/financial-accounts', data).then(r => r.data),
  update: (id: string, data: Partial<FinancialAccount>) =>
    api.put<FinancialAccount>(`/financial-accounts/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/financial-accounts/${id}`).then(r => r.data),
}

export const transactionApi = {
  list: (params?: {
    accountId?: string
    dateFrom?: string
    dateTo?: string
    search?: string
    isMatched?: string
    page?: number
    limit?: number
  }) => api.get<{ transactions: FinancialTransaction[]; total: number }>('/transactions', { params }).then(r => r.data),

  get: (id: string) => api.get<FinancialTransaction>(`/transactions/${id}`).then(r => r.data),

  create: (data: Partial<FinancialTransaction>) =>
    api.post<FinancialTransaction>('/transactions', data).then(r => r.data),

  update: (id: string, data: Partial<FinancialTransaction>) =>
    api.put<FinancialTransaction>(`/transactions/${id}`, data).then(r => r.data),

  delete: (id: string) => api.delete(`/transactions/${id}`).then(r => r.data),

  importCsv: (accountId: string, file: File, mappingPreset: string) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('accountId', accountId)
    formData.append('mappingPreset', mappingPreset)
    return api.post<{ imported: number; skipped: number }>('/transactions/import-csv', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  classifyAi: (accountId: string, transactionIds?: string[]) =>
    api.post<{ classified: number; results: Array<{ id: string; accountTitleId: string; accountTitleName: string; counterAccountTitleId: string; counterAccountTitleName: string; confidence: number }> }>(
      '/transactions/classify-ai', { accountId, transactionIds }, { timeout: 120000 }
    ).then(r => r.data),

  autoJournal: (accountId: string, transactionIds: string[], classificationResults: Array<{ id: string; accountTitleId: string; accountTitleName: string; counterAccountTitleId: string; counterAccountTitleName: string; confidence: number }>) =>
    api.post<{ created: number; errors: number }>(
      '/transactions/auto-journal', { accountId, transactionIds, classificationResults }
    ).then(r => r.data),
}

// =====================
// 会計コア（仕訳・B/S・P/L）
// =====================

const coreApi = axios.create({ baseURL: '/api/accounting/core' })

export const accountTitleApi = {
  list: (category?: string) =>
    coreApi.get('/account-titles', { params: { category } }).then(r => r.data),
}

export const fiscalPeriodApi = {
  list: () => coreApi.get('/fiscal-periods').then(r => r.data),
  create: (data: { name: string; startDate: string; endDate: string }) =>
    coreApi.post('/fiscal-periods', data).then(r => r.data),
}

export interface JournalEntryLine {
  id?: string
  accountTitleId: string
  debitAmount: number
  creditAmount: number
  // snake_case variants from Supabase raw response
  debit_amount?: number
  credit_amount?: number
  account_title_id?: string
  description?: string
  account_titles?: { id: string; code: string; name: string; category: string }
}

export interface JournalEntry {
  id: string
  entry_date: string
  description: string | null
  reference_number: string | null
  source: string
  is_approved: boolean
  journal_entry_lines: (JournalEntryLine & { account_titles: { id: string; code: string; name: string; category: string } })[]
  created_at: string
}

export const journalEntryApi = {
  list: (params?: { periodId?: string; dateFrom?: string; dateTo?: string; search?: string; page?: number; limit?: number }) =>
    coreApi.get<{ entries: JournalEntry[]; total: number }>('/journal-entries', { params }).then(r => r.data),

  create: (data: {
    entryDate: string; description?: string; referenceNumber?: string; source?: string; fiscalPeriodId?: string;
    lines: { accountTitleId: string; debitAmount: number; creditAmount: number; description?: string }[]
  }) => coreApi.post<JournalEntry>('/journal-entries', data).then(r => r.data),

  delete: (id: string) => coreApi.delete(`/journal-entries/${id}`).then(r => r.data),
}

export const balanceSheetApi = {
  get: (asOfDate: string) =>
    coreApi.get('/balance-sheet', { params: { asOfDate } }).then(r => r.data),
}

export const profitLossApi = {
  get: (dateFrom: string, dateTo: string) =>
    coreApi.get('/profit-loss', { params: { dateFrom, dateTo } }).then(r => r.data),
}

export const importStatementApi = {
  upload: (file: File, statementType: string, fiscalPeriodId?: string) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('statementType', statementType)
    if (fiscalPeriodId) formData.append('fiscalPeriodId', fiscalPeriodId)
    return coreApi.post<{ created: number; skipped: number; total: number }>('/import-financial-statement', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },
}

// =====================
// 事業年度分析
// =====================

const fiscalApi = axios.create({ baseURL: '/api/accounting/fiscal' })

export interface FiscalYear { id: string; year_label: string; start_date: string; end_date: string; is_current: boolean; notes: string | null }
export interface FiscalDocument { id: string; fiscal_year_id: string; document_type: string; document_subtype: string | null; original_filename: string; ai_status: string; ai_extracted: Record<string, unknown> | null; ai_summary: string | null; ai_error: string | null; created_at: string }
export interface FiscalMetric { id: string; fiscal_year_id: string; category: string; metric_key: string; metric_label: string; metric_value: number | null; metric_text: string | null }
export interface DocumentType { id: string; label: string; category: string }

export const fiscalYearApi = {
  listDocumentTypes: () => fiscalApi.get<DocumentType[]>('/document-types').then(r => r.data),
  listYears: () => fiscalApi.get<FiscalYear[]>('/years').then(r => r.data),
  createYear: (data: { yearLabel: string; startDate: string; endDate: string; notes?: string }) =>
    fiscalApi.post<FiscalYear>('/years', data).then(r => r.data),
  deleteYear: (id: string) => fiscalApi.delete(`/years/${id}`).then(r => r.data),

  listDocuments: (fiscalYearId?: string) =>
    fiscalApi.get<FiscalDocument[]>('/documents', { params: { fiscalYearId } }).then(r => r.data),
  uploadDocument: (file: File, fiscalYearId: string, documentType: string, documentSubtype?: string) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('fiscalYearId', fiscalYearId)
    fd.append('documentType', documentType)
    if (documentSubtype) fd.append('documentSubtype', documentSubtype)
    return fiscalApi.post<FiscalDocument>('/documents/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
  },
  deleteDocument: (id: string) => fiscalApi.delete(`/documents/${id}`).then(r => r.data),

  listMetrics: (fiscalYearId?: string) =>
    fiscalApi.get<FiscalMetric[]>('/metrics', { params: { fiscalYearId } }).then(r => r.data),
  getComparison: () => fiscalApi.get('/comparison').then(r => r.data),
}
