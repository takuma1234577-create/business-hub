export interface Client {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  postalCode: string;
  address: string;
  defaultItems?: InvoiceItem[];
}

export type InvoiceItemType = 'fixed' | 'performance' | 'adspend';

export interface InvoiceItem {
  id: string;
  description: string;
  unitPrice: number;
  quantity: number;
  itemType: InvoiceItemType;
  baseAmount?: number; // 先月売上 or 先月広告費（将来はAmazon APIから自動取得）
  rate?: number;       // 料率（%） — 単一料率の場合
  useTiered?: boolean; // 段階制料率を使用するか
  tiers?: FeeTier[];   // 段階制料率
}

export interface InvoiceData {
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  client: Client;
  sender: SenderSettings;
  items: InvoiceItem[];
  notes: string;
}

export interface ReceiptData {
  receiptNumber: string;
  issueDate: string;
  client: Client;
  sender: SenderSettings;
  amount: number;        // 領収金額（税込）
  taxRate: number;       // 消費税率（%）10 / 8 / 0
  subject: string;       // 但し書き（例：コンサルティング費用）
  paymentMethod: string; // お支払方法（銀行振込 / 現金 / クレジットカード 等）
  notes: string;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
}

export interface HistoryItem {
  id: string;
  type: 'draft' | 'sent';
  to: string;
  subject: string;
  draftId?: string;
  invoiceNumber?: string;
  createdAt?: string;
  sentAt?: string;
}

export interface ScheduleFeeRule {
  ruleType: 'sales_performance' | 'adspend_percentage';
  description: string;
  tiers: FeeTier[];
}

export interface Schedule {
  id: string;
  clientId: string;
  dayOfMonth: number;
  templateId: string;
  active: boolean;
  description: string;
  fixedItems: InvoiceItem[];
  notes: string;
  autoFetchAmazon: boolean;
  sendMode: 'draft' | 'send';
  feeRulesConfig: ScheduleFeeRule[];
}

export interface AmazonAccount {
  id: string;
  clientId: string;
  accountName: string;
  sellerId: string;
  marketplaceId: string;
  refreshToken: string;
  spApiClientId: string;
  spApiClientSecret: string;
}

export interface FeeTier {
  min: number;
  max: number | null;
  rate: number;
}

export interface FeeRule {
  id: string;
  clientId: string;
  ruleType: 'sales_performance' | 'adspend_percentage';
  description: string;
  tiers: FeeTier[];
  active: boolean;
}

export interface CalculatedFeeItem {
  description: string;
  ruleType: string;
  baseAmount: number;
  fee: number;
  tiers: FeeTier[];
}

export interface CalculatedFees {
  yearMonth: string;
  totalSales: number;
  totalAdSpend: number;
  accountDetails: { accountName: string; sales: number; adSpend: number }[];
  feeItems: CalculatedFeeItem[];
}

export interface SenderSettings {
  senderName: string;
  senderCompany: string;
  senderPostalCode: string;
  senderAddress: string;
  senderPhone: string;
  senderEmail: string;
  bankName: string;
  bankBranch: string;
  bankAccount: string;
  bankAccountName: string;
  bankSwift: string;
  currency: string;
}
