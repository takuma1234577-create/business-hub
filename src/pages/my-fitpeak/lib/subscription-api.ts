import { apiFetch } from './api'

// 定期購入・クレアショットの顧客ポータルAPI（server/subscription.cjs の publicRouter。Supabase JWT で本人確認）
// 旧 my-fitpeak の src/lib/subscription-api.ts を移植。同じアプリ内なので apiFetch でログイン中のトークンを付けて送る
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`/api/public/subscription${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(json.error || '通信に失敗しました') as Error & { status: number; body: unknown }
    err.status = res.status
    err.body = json
    throw err
  }
  return json as T
}

export interface PortalSubscription {
  id: string
  status: string
  status_label: string
  plan_name: string
  interval_days: number
  amount: number | null
  currency: string
  cycle_count: number
  next_delivery_date: string | null
  next_billing_date: string | null
  first_delivered_date: string | null
  consecutive_skips: number
  max_consecutive_skips: number
  can_skip: boolean
  can_cancel: boolean
  is_preorder: boolean
  preorder_note: string | null
  preorder_first_ship_date: string | null
  schedule_pending: boolean
}

export interface PortalHistory {
  cycle_no: number
  status: string
  billed_date: string | null
  shipped_date: string | null
  delivered_date: string | null
  scheduled_date: string | null
  amount: number | null
}

export interface PortalSettings {
  skip: { enabled: boolean; days: number }
  cancel_flow: { offer_skip_first: boolean; retention_message: string }
  cancel_reasons: { id: string; label: string }[]
}

export const subscriptionApi = {
  settings: () => request<PortalSettings>('/portal/settings'),
  list: () => request<{ subscriptions: PortalSubscription[] }>('/portal/list'),
  detail: (id: string) => request<{ subscription: PortalSubscription; history: PortalHistory[] }>(`/portal/detail/${id}`),
  skip: (id: string) => request<{ subscription: PortalSubscription }>(`/portal/${id}/skip`, { method: 'POST' }),
  cancel: (id: string, reasonId: string, note: string) =>
    request<{ subscription: PortalSubscription }>(`/portal/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason_id: reasonId, note }),
    }),
  paymentUpdate: (id: string) => request<{ ok: boolean; sent_to: string }>(`/portal/${id}/payment-update`, { method: 'POST' }),
  claim: (orderNumber: string) =>
    request<{ ok: boolean; linked: number }>('/portal/claim', {
      method: 'POST',
      body: JSON.stringify({ order_number: orderNumber }),
    }),
}

// ===========================================================================
// クレアショット専用（business-hub: /api/public/subscription/portal/creashot/*）
// ===========================================================================

export interface CreashotPlan {
  id: string
  plan_code: string
  display_name: string
  sticks_per_day: number
  bags_per_cycle: number
  interval_days: number
  interval_label: string
  price: number
  price_per_bag: number
  free_bags: number
}

export interface CreashotRemaining {
  total_sticks: number
  consumed_sticks: number
  remaining_sticks: number
  remaining_days: number
  runs_out_on: string
  logged_days: number
}

export interface CreashotSubscription extends PortalSubscription {
  plan_code: string | null
  sticks_per_day: number
  bags_per_cycle: number
  price: number | null
  paused_until: string | null
  can_reschedule: boolean
  can_pause: boolean
  can_resume: boolean
  can_change_plan: boolean
  remaining: CreashotRemaining | null
}

export interface CreashotReminder {
  enabled: boolean
  time_jst: string
  days_of_week: number[]
  message: string | null
}

export interface CreashotCancelReason {
  id: string
  label: string
  retention_action: 'pause' | 'cheaper' | 'downgrade' | 'none'
  retention_message: string | null
}

export interface CreashotOverview {
  subscriptions: CreashotSubscription[]
  plans: CreashotPlan[]
  line_linked: boolean
  line_add_url: string
  reminder: CreashotReminder
  reminder_default_message: string
  cancel_reasons: CreashotCancelReason[]
  cancel_flow: { offer_skip_first: boolean; retention_message: string }
  today: string
}

export interface CancelOffer {
  type: 'reschedule' | 'pause' | 'change_plan'
  title: string
  message: string | null
  plan_code?: string
  plan?: CreashotPlan
}

export const creashotApi = {
  overview: () => request<CreashotOverview>('/portal/creashot'),
  reschedule: (id: string, remainingSticks: number) =>
    request<{ ok: boolean; next_delivery_date: string; next_billing_date: string }>(`/portal/creashot/${id}/reschedule`, {
      method: 'POST',
      body: JSON.stringify({ remaining_sticks: remainingSticks }),
    }),
  pause: (id: string, resumeDate?: string, reason?: string) =>
    request<{ ok: boolean; paused_until: string | null }>(`/portal/creashot/${id}/pause`, {
      method: 'POST',
      body: JSON.stringify({ resume_date: resumeDate || null, reason: reason || null }),
    }),
  resume: (id: string) =>
    request<{ ok: boolean; next_delivery_date: string; next_billing_date: string }>(`/portal/creashot/${id}/resume`, { method: 'POST' }),
  changePlan: (id: string, planCode: string) =>
    request<{ ok: boolean; plan: CreashotPlan }>(`/portal/creashot/${id}/change-plan`, {
      method: 'POST',
      body: JSON.stringify({ plan_code: planCode }),
    }),
  cancelOptions: (id: string, reasonId: string) =>
    request<{ reason: { id: string; label: string }; offers: CancelOffer[]; contact_required: boolean }>(
      `/portal/creashot/${id}/cancel-options`,
      { method: 'POST', body: JSON.stringify({ reason_id: reasonId }) },
    ),
  saveReminder: (r: CreashotReminder) =>
    request<{ ok: boolean; reminder: CreashotReminder }>('/portal/creashot/reminder', {
      method: 'PUT',
      body: JSON.stringify(r),
    }),
  intake: (date?: string) =>
    request<{ ok: boolean; date: string }>('/portal/creashot/intake', {
      method: 'POST',
      body: JSON.stringify({ date: date || undefined }),
    }),
}
