export interface MonitoredProduct {
  id: string
  asin: string
  title: string
  imageUrl: string | null
  isActive: boolean
  averageRating: number | null
  ratingCount: number
  previousRating: number | null
  previousCount: number
  lastCheckedAt: string | null
  createdAt: string
  outreach: { pending: number; sent: number; resolved: number }
}

export interface BuyerOutreach {
  id: string
  amazonOrderId: string
  asin: string
  buyerName: string | null
  orderDate: string | null
  deliveryDate: string | null
  outreachStatus: 'pending' | 'sent' | 'resolved' | 'skipped'
  messageSent: string | null
  sentAt: string | null
  notes: string | null
  createdAt: string
}

export interface ReviewSnapshot {
  id: string
  asin: string
  ratingCount: number
  averageRating: number | null
  star1: number
  star2: number
  star3: number
  star4: number
  star5: number
  checkedAt: string
}

export interface ReviewMonitorStats {
  monitoredProducts: number
  pendingOutreach: number
  sentOutreach: number
  resolvedOutreach: number
  ratingDroppedProducts: number
}
