import type {
  Channel,
  OrderStatus,
  Order,
  OrderListResponse,
  SkuMapping,
  InventorySummary,
} from './types'

const BASE_URL = '/api/amazon'

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Request failed: ${res.status}`)
  }
  return res.json()
}

// === Orders API ===

export const orderApi = {
  list(params: {
    page?: number
    channel?: Channel
    status?: OrderStatus
  }): Promise<OrderListResponse> {
    const query = new URLSearchParams()
    if (params.page) query.set('page', String(params.page))
    if (params.channel) query.set('channel', params.channel)
    if (params.status) query.set('status', params.status)
    const qs = query.toString()
    return request<OrderListResponse>(`${BASE_URL}/orders${qs ? `?${qs}` : ''}`)
  },

  getById(id: string): Promise<Order> {
    return request<Order>(`${BASE_URL}/orders/${id}`)
  },

  retry(id: string): Promise<{ ok: boolean; message: string }> {
    return request(`${BASE_URL}/orders/${id}/retry`, { method: 'POST' })
  },
}

// === SKU Mapping API ===

export const skuMappingApi = {
  list(): Promise<SkuMapping[]> {
    return request<SkuMapping[]>(`${BASE_URL}/sku-mappings`)
  },

  create(data: {
    channel: Channel
    channelSku: string
    amazonSku: string
  }): Promise<SkuMapping> {
    return request<SkuMapping>(`${BASE_URL}/sku-mappings`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  delete(id: string): Promise<{ ok: boolean }> {
    return request(`${BASE_URL}/sku-mappings/${id}`, { method: 'DELETE' })
  },
}

// === Inventory API ===

export const inventoryApi = {
  check(skus: string[]): Promise<InventorySummary[]> {
    const query = new URLSearchParams({ skus: skus.join(',') })
    return request<{ data: InventorySummary[] }>(
      `${BASE_URL}/inventory?${query.toString()}`
    ).then((res) => res.data)
  },
}
