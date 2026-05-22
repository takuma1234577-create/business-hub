export interface ReviewOrder {
  amazonOrderId: string
  purchaseDate: string
  orderStatus: string
  orderTotal: { amount: string; currency: string } | null
  buyerEmail: string | null
  shippingAddress: {
    name: string
    city: string
    stateOrRegion: string
    postalCode: string
  } | null
  numberOfItemsShipped: number
  solicitationStatus: 'sent' | 'failed' | null
  solicitedAt: string | null
}

export interface SolicitationHistory {
  id: string
  amazonOrderId: string
  status: 'sent' | 'failed'
  sentAt: string
  errorMessage: string | null
}

export interface SolicitationStats {
  last30Days: { sent: number; failed: number }
  today: { sent: number }
}

export interface AutoConfig {
  enabled: boolean
  delayDays: number
  maxPerDay: number
}

export interface BulkResult {
  sent: string[]
  failed: { orderId: string; error: string }[]
  skipped: string[]
}

export interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}
