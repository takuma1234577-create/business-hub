// === Enums ===

export type Channel = 'SHOPIFY' | 'TIKTOK'

export type OrderStatus =
  | 'PENDING'
  | 'SUBMITTED'
  | 'SHIPPED'
  | 'TRACKING_UPDATED'
  | 'CANCELLED'
  | 'ERROR'
  | 'NEEDS_REVIEW'

export type ShippingSpeed = 'STANDARD' | 'EXPEDITED' | 'PRIORITY'

// === Models ===

export interface OrderItem {
  id: string
  orderId: string
  channelSku: string
  amazonSku: string
  quantity: number
  title?: string | null
}

export interface FulfillmentLog {
  id: string
  orderId: string
  event: string
  message?: string | null
  payload?: string | null
  createdAt: string
}

export interface Order {
  id: string
  channel: Channel
  channelOrderId: string
  mcfOrderId?: string | null
  status: OrderStatus
  shippingSpeed: ShippingSpeed
  recipientName: string
  addressLine1: string
  addressLine2?: string | null
  city: string
  stateOrRegion?: string | null
  postalCode: string
  countryCode: string
  trackingNumber?: string | null
  carrier?: string | null
  shippedAt?: string | null
  trackingUpdatedAt?: string | null
  retryCount: number
  errorMessage?: string | null
  createdAt: string
  updatedAt: string
  orderedAt?: string | null
  totalAmount?: number | null
  currency?: string | null
  items: OrderItem[]
  logs?: FulfillmentLog[]
}

export interface SkuMapping {
  id: string
  channel: Channel
  channelSku: string
  amazonSku: string
  isActive: boolean
  createdAt: string
}

export interface InventorySummary {
  sellerSku: string
  asin: string
  fnSku: string
  totalQuantity: number
  fulfillableQuantity: number
  inboundWorkingQuantity: number
  inboundShippedQuantity: number
  inboundReceivingQuantity: number
}

// === API Response Types ===

export interface PaginationInfo {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface OrderListResponse {
  data: Order[]
  pagination: PaginationInfo
}

export interface InventoryResponse {
  data: InventorySummary[]
}
