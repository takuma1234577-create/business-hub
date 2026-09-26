import axios from 'axios'

export const saApi = axios.create({
  baseURL: '/api/site-analytics',
  headers: { 'Content-Type': 'application/json' },
})

export type Preset = 'today' | 'yesterday' | '7d' | '30d' | '90d'
export type Device = 'all' | 'mobile' | 'desktop'

export interface NamedCount { name: string; users?: number; sessions?: number; count?: number }

export interface Kpis {
  users: number
  new_users: number
  sessions: number
  pageviews: number
  entries: number
  bounce_rate: number
  exit_rate: number
  avg_time_on_page_sec: number
  avg_session_sec: number
  engaged_rate: number
  pages_per_session: number
  avg_scroll: number
  cart_adds: number
  checkouts: number
}

export interface PageRow {
  path: string
  title: string | null
  pageviews: number
  users: number
  avg_time_sec: number
  avg_scroll: number
  entries: number
  exit_rate: number
  cart_adds: number
}

export interface Overview {
  from: string
  to: string
  cached_at?: string
  granularity: 'hour' | 'day'
  kpis: Kpis
  prev_kpis: Kpis
  timeseries: { t: string; users: number; sessions: number; pageviews: number }[]
  pages: PageRow[]
  channels: NamedCount[]
  referrers: NamedCount[]
  campaigns: NamedCount[]
  devices: NamedCount[]
  browsers: NamedCount[]
  os: NamedCount[]
  countries: NamedCount[]
  cities: NamedCount[]
  user_type: { new: number; returning: number }
  entry_pages: NamedCount[]
  exit_pages: NamedCount[]
  prev_pages: NamedCount[]
  next_pages: NamedCount[]
  scroll_reach: { depth: number; pct: number }[]
  week_hour: { dow: number; hour: number; pageviews: number }[]
  funnel: { step: string; sessions: number }[]
  top_clicks: { label: string; count: number; rage: number }[]
}

export interface Realtime {
  now: string
  active_users: number
  users_30m: number
  pageviews_30m: number
  cart_adds_30m: number
  per_minute: { t: string; pageviews: number; users: number }[]
  active_pages: { path: string; title: string | null; users: number }[]
  active_sessions: {
    session_id: string; path: string; title: string | null; device: string | null
    country: string | null; city: string | null; last_seen: string; started: string | null
    pageviews: number | null; channel: string | null; ref_host: string | null; cart: boolean | null
  }[]
  active_channels: NamedCount[]
  active_devices: NamedCount[]
  feed: {
    at: string; type: string; path: string; title: string | null; label: string | null
    device: string | null; city: string | null; country: string | null; channel: string | null; session_id: string
  }[]
}

export interface Heatmap {
  path: string
  device: 'mobile' | 'desktop'
  page_url: string
  screenshot_url: string | null
  pageviews: number
  sessions: number
  doc_h: number | null
  doc_w: number | null
  clicks: [number, number, number, number][] // [x(0-200), y(0-2000), 件数, レイジ件数]
  click_total: number
  rage_total: number
  scroll_reach: { depth: number; pct: number }[]
  attention: { band: number; ms: number }[]
  top_elements: { label: string; selector: string | null; count: number; rage: number; href: string | null }[]
}

export function rangeParams(preset: Preset) {
  return { preset }
}

// ---------------------------------------------------------------------------
// 登録（公式LINE・My FITPEAK）
// ---------------------------------------------------------------------------
export interface SignupKpis {
  sessions: number
  line_clicks: number
  line_signups: number
  line_existing: number
  myfp_clicks: number
  myfp_signups: number
  ad_line_clicks: number
  ad_line_signups: number
  include_ads: boolean
}

export interface SignupPageRow {
  path: string
  title: string | null
  pageviews: number
  sessions: number
  line_clicks: number
  line_signups: number
  line_existing: number
  myfp_clicks: number
  myfp_signups: number
}

export interface SignupRecent {
  at: string
  kind: 'line' | 'myfitpeak'
  is_new: boolean
  name: string | null
  method: 'email' | 'line' | null
  path: string
  title: string | null
  place: string | null
  source: string | null
  entry_path: string | null
  channel: string | null
  device: string | null
  session_id: string | null
  pages_before: number
  sec_to_signup: number | null
}

export interface Signups {
  from: string
  to: string
  granularity: 'hour' | 'day'
  kpis: SignupKpis
  prev_kpis: SignupKpis | null
  timeseries: { t: string; line: number; myfp: number }[]
  pages: SignupPageRow[]
  places: { kind: 'line' | 'myfitpeak'; name: string; clicks: number; signups: number }[]
  channels: { name: string; line: number; myfp: number; count: number }[]
  entry_pages: { name: string; count: number }[]
  devices: { name: string; count: number }[]
  sources: { name: string; clicks: number; signups: number }[]
  recent: SignupRecent[]
}

export interface JourneyEvent {
  at: string
  type: string
  path: string
  title: string | null
  label: string | null
  href: string | null
  channel: string | null
  ref_host: string | null
}
