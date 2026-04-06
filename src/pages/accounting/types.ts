export type DocumentType = 'invoice' | 'receipt' | 'sales' | 'import_permit' | 'other'
export type DocumentSource = 'gmail' | 'website' | 'manual'
export type DocumentStatus = 'pending' | 'confirmed' | 'journalized'
export type SourceType = 'gmail' | 'website'
export type FetchLogStatus = 'running' | 'success' | 'partial' | 'error'

export interface AccountingDocument {
  id: string
  documentType: DocumentType
  source: DocumentSource
  status: DocumentStatus
  documentDate: string | null
  dueDate: string | null
  vendorName: string | null
  vendorAddress: string | null
  amountExcludingTax: number | null
  taxAmount: number | null
  amountIncludingTax: number | null
  currency: string
  documentNumber: string | null
  accountTitle: string | null
  aiConfidence: number | null
  aiRawResponse: Record<string, unknown> | null
  originalFilename: string | null
  fileHash: string | null
  googleDriveFileId: string | null
  googleDriveUrl: string | null
  supabaseStoragePath: string | null
  sourceEmailId: string | null
  sourceUrl: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface AccountingSource {
  id: string
  sourceType: SourceType
  name: string
  url: string | null
  searchKeywords: string[]
  isActive: boolean
  lastFetchedAt: string | null
  createdAt: string
}

export interface AccountingFetchLog {
  id: string
  sourceId: string | null
  startedAt: string
  completedAt: string | null
  status: FetchLogStatus
  documentsFound: number
  documentsSaved: number
  documentsSkipped: number
  errors: Record<string, unknown> | null
  createdAt: string
}

export interface DashboardStats {
  totalDocuments: number
  pendingCount: number
  confirmedCount: number
  journalizedCount: number
  thisMonthTotal: number
  thisYearTotal: number
  byType: Record<DocumentType, number>
}

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  invoice: '請求書',
  receipt: '領収書',
  sales: '売上明細',
  import_permit: '輸入許可証',
  other: 'その他',
}

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  pending: '未確認',
  confirmed: '確認済み',
  journalized: '仕訳済み',
}

export const DOCUMENT_SOURCE_LABELS: Record<DocumentSource, string> = {
  gmail: 'Gmail',
  website: 'Webサイト',
  manual: '手動追加',
}

export const COMMON_ACCOUNT_TITLES = [
  '仕入高', '外注費', '通信費', '消耗品費', '旅費交通費',
  '接待交際費', '広告宣伝費', '支払手数料', '水道光熱費',
  '地代家賃', '保険料', '租税公課', '減価償却費', '雑費',
  '売上高', '受取利息', '雑収入',
]

// =====================
// 金融口座・取引関連
// =====================

export type AccountType = 'bank' | 'credit_card'
export type TransactionSource = 'csv_import' | 'manual' | 'api'

export interface FinancialAccount {
  id: string
  accountType: AccountType
  accountName: string
  institutionName: string
  accountNumberMasked: string | null
  branchName: string | null
  balance: number
  currency: string
  isActive: boolean
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface FinancialTransaction {
  id: string
  accountId: string
  transactionDate: string
  description: string
  amount: number
  balanceAfter: number | null
  category: string | null
  accountTitle: string | null
  counterparty: string | null
  isMatched: boolean
  matchedDocumentId: string | null
  memo: string | null
  source: TransactionSource
  rawData: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  bank: '銀行口座',
  credit_card: 'クレジットカード',
}

export const TRANSACTION_SOURCE_LABELS: Record<TransactionSource, string> = {
  csv_import: 'CSV取り込み',
  manual: '手動入力',
  api: 'API連携',
}

// =====================
// 銀行スクレイピング関連
// =====================

export type SyncStatus = 'idle' | 'running' | 'success' | 'error' | 'awaiting_2fa'

export interface BankCredential {
  id: string
  accountId: string
  institutionCode: string
  institutionName: string
  lastSyncAt: string | null
  syncStatus: SyncStatus
  syncError: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface ScrapingJob {
  id: string
  credentialId: string
  accountId: string
  status: string
  startedAt: string | null
  completedAt: string | null
  transactionsFound: number
  transactionsImported: number
  transactionsSkipped: number
  errorMessage: string | null
  createdAt: string
}

export interface SupportedInstitution {
  code: string
  name: string
  type: 'bank' | 'credit_card'
  status: 'supported' | 'planned'
}

export const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
  idle: '未実行',
  running: '同期中',
  success: '成功',
  error: 'エラー',
  awaiting_2fa: '2FA待ち',
}
