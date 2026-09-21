import { useEffect, useState, useCallback } from 'react'
import {
  RefreshCw, AlertTriangle, CheckCircle2, Loader2, Search, X,
  CalendarClock, Package, CreditCard, Ban, PauseCircle, PlayCircle, Truck,
} from 'lucide-react'
import ToolLayout from '../components/ToolLayout'
import { createApi } from '../lib/api'

const api = createApi('/api/subscription')

type Tab = 'dashboard' | 'contracts' | 'plans' | 'creashot' | 'analytics' | 'settings'

interface Health {
  service_role_key: boolean
  db: boolean
  db_error?: string
  shopify_store?: string | false
  shopify_error?: string
  shopify_scopes: string[]
  missing_scopes: string[]
  billing_cron_enabled: boolean | null
  ready: boolean
}

interface Stats {
  active_count: number
  pending_first_shipment: number
  awaiting_delivery: number
  past_due: number
  paused: number
  cancelled_total: number
  cancelled_this_month: number
  cancelled_this_week: number
  upcoming_30d_count: number
  upcoming_30d_amount: number
  mrr_estimate: number
}

interface Sub {
  id: string
  shopify_contract_id: string
  email: string
  status: string
  cycle_count: number
  amount: number | null
  next_billing_at: string | null
  next_delivery_at: string | null
  consecutive_skips: number
  origin: string
  created_at: string
  subscription_plans?: { name: string; display_name: string | null; interval_days: number } | null
  cancel_reasons?: { label: string } | null
}

interface Cycle {
  id: string
  cycle_no: number
  status: string
  scheduled_at: string
  billed_at: string | null
  shipped_at: string | null
  delivered_at: string | null
  amount: number | null
  failure_reason: string | null
  retry_count: number
}

interface EventRow {
  id: string
  event_type: string
  actor: string
  created_at: string
  payload: Record<string, unknown> | null
}

interface Plan {
  id: string
  name: string
  display_name: string | null
  description: string | null
  shopify_product_id: string | null
  shopify_selling_plan_group_id: string | null
  shopify_selling_plan_id: string | null
  interval_days: number
  lead_days: number
  delivery_fallback_days: number
  discount_percent: number
  max_consecutive_skips: number
  is_preorder: boolean
  preorder_first_ship_date: string | null
  preorder_note: string | null
  is_active: boolean
}

const STATUS_LABEL: Record<string, string> = {
  pending_first_shipment: '初回発送待ち',
  awaiting_delivery: '配達待ち',
  active: '稼働中',
  past_due: '課金失敗',
  paused: '一時停止',
  cancelled: '解約済み',
}

const STATUS_COLOR: Record<string, string> = {
  pending_first_shipment: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  awaiting_delivery: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  past_due: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  paused: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  cancelled: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
}

function jst(v: string | null | undefined) {
  if (!v) return '—'
  return new Date(v).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function jstDay(v: string | null | undefined) {
  if (!v) return '—'
  return new Date(v).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' })
}
function yen(v: number | null | undefined) {
  if (v === null || v === undefined) return '—'
  return `¥${Number(v).toLocaleString('ja-JP')}`
}
function pct(v: number | null | undefined) {
  if (v === null || v === undefined) return '—'
  return `${(v * 100).toFixed(1)}%`
}
function errMsg(e: unknown, fallback: string) {
  const err = e as { response?: { data?: { error?: string } } }
  return err.response?.data?.error || fallback
}

export default function Subscription() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [health, setHealth] = useState<Health | null>(null)

  const loadHealth = useCallback(async () => {
    try {
      const { data } = await api.get('/health')
      setHealth(data)
    } catch { /* 表示だけなので握りつぶす */ }
  }, [])

  useEffect(() => { loadHealth() }, [loadHealth])

  return (
    <ToolLayout title="定期購入（サブスクリプション）">
      {health && !health.ready && <SetupBanner health={health} onRefresh={loadHealth} />}

      <div className="flex gap-1 mb-6 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
        {([
          ['dashboard', 'ダッシュボード'],
          ['contracts', '契約'],
          ['plans', 'プラン'],
          ['creashot', 'クレアショット'],
          ['analytics', '分析'],
          ['settings', '設定'],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap cursor-pointer transition ${
              tab === key
                ? 'border-slate-900 dark:border-white text-slate-900 dark:text-white'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <Dashboard />}
      {tab === 'contracts' && <Contracts />}
      {tab === 'plans' && <Plans onChanged={loadHealth} />}
      {tab === 'creashot' && <CreashotTab />}
      {tab === 'analytics' && <Analytics />}
      {tab === 'settings' && <SettingsTab health={health} onRefresh={loadHealth} />}
    </ToolLayout>
  )
}

// ── 準備状況バナー（稼働に足りないものを名指しする） ──
function SetupBanner({ health, onRefresh }: { health: Health; onRefresh: () => void }) {
  const items: { ok: boolean; label: string; hint?: string }[] = [
    {
      ok: health.service_role_key,
      label: 'Supabase サービスロールキー',
      hint: 'Vercelの環境変数 SUPABASE_SERVICE_ROLE_KEY を設定してください（未設定だとRLSで全データが読めません）',
    },
    {
      ok: health.missing_scopes.length === 0,
      label: 'Shopify のスコープ',
      hint: health.missing_scopes.length ? `不足: ${health.missing_scopes.join(', ')} → API設定からShopifyを再連携` : undefined,
    },
    { ok: health.db, label: 'データベース', hint: health.db_error },
  ]
  return (
    <div className="mb-6 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" size={20} />
        <div className="flex-1">
          <h3 className="font-semibold text-amber-900 dark:text-amber-200">稼働前に必要な設定が残っています</h3>
          <ul className="mt-3 space-y-2">
            {items.map((it) => (
              <li key={it.label} className="text-sm flex items-start gap-2">
                {it.ok
                  ? <CheckCircle2 size={16} className="text-emerald-600 mt-0.5 shrink-0" />
                  : <X size={16} className="text-red-500 mt-0.5 shrink-0" />}
                <span className={it.ok ? 'text-slate-600 dark:text-slate-400' : 'text-slate-800 dark:text-slate-200'}>
                  {it.label}
                  {!it.ok && it.hint && <span className="block text-xs text-slate-500 mt-0.5">{it.hint}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <button onClick={onRefresh} className="p-2 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900 text-amber-700 cursor-pointer">
          <RefreshCw size={16} />
        </button>
      </div>
    </div>
  )
}

function Card({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${tone || 'text-slate-900 dark:text-white'}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  )
}

function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/stats')
      setStats(data)
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function runCron() {
    setRunning(true); setResult('')
    try {
      const { data } = await api.get('/cron')
      const b = data.billing?.skipped ? '課金cronは無効（設定でON）' : `課金 ${data.billing?.processed ?? 0}件`
      setResult(`${b} / リトライ ${data.retry?.processed ?? 0}件 / 配達確定 ${data.fallback?.processed ?? 0}件`)
      load()
    } catch (e) { setResult(errMsg(e, '実行に失敗しました')) }
    finally { setRunning(false) }
  }

  if (loading) return <div className="py-12 text-center"><Loader2 className="animate-spin inline text-slate-400" /></div>
  if (!stats) return null

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card label="稼働中の契約" value={String(stats.active_count)} sub={`初回発送待ち ${stats.pending_first_shipment} / 配達待ち ${stats.awaiting_delivery}`} />
        <Card label="今後30日の課金予定" value={String(stats.upcoming_30d_count)} sub={yen(stats.upcoming_30d_amount)} />
        <Card label="課金失敗中" value={String(stats.past_due)} tone={stats.past_due ? 'text-red-600' : undefined} sub={`一時停止 ${stats.paused}`} />
        <Card label="今週の解約" value={String(stats.cancelled_this_week)} sub={`今月 ${stats.cancelled_this_month} / 累計 ${stats.cancelled_total}`} />
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-white">課金エンジンを手動実行</h3>
            <p className="mt-1 text-sm text-slate-500">
              通常は10分ごとの自動実行に含まれます。課金予定・失敗リトライ・配達完了フォールバックをまとめて1回走らせます。
            </p>
          </div>
          <button
            onClick={runCron}
            disabled={running}
            className="shrink-0 px-4 py-2.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium hover:opacity-90 disabled:opacity-50 cursor-pointer flex items-center gap-2"
          >
            {running ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            実行
          </button>
        </div>
        {result && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{result}</p>}
      </div>
    </div>
  )
}

function Contracts() {
  const [subs, setSubs] = useState<Sub[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('all')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/list', { params: { status, q: q || undefined } })
      setSubs(data.subscriptions || [])
    } finally { setLoading(false) }
  }, [status, q])
  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="メールアドレス / 契約ID"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
        >
          <option value="all">すべて</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button onClick={load} className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer">
          <RefreshCw size={16} className="text-slate-500" />
        </button>
      </div>

      {loading ? (
        <div className="py-12 text-center"><Loader2 className="animate-spin inline text-slate-400" /></div>
      ) : subs.length === 0 ? (
        <div className="py-16 text-center text-slate-400 text-sm">契約はまだありません</div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-4 py-3 font-medium">顧客</th>
                <th className="text-left px-4 py-3 font-medium">状態</th>
                <th className="text-right px-4 py-3 font-medium">回数</th>
                <th className="text-left px-4 py-3 font-medium">次回お届け</th>
                <th className="text-left px-4 py-3 font-medium">次回課金</th>
                <th className="text-right px-4 py-3 font-medium">金額</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                  className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <p className="text-slate-900 dark:text-white">{s.email || '（メール未取得）'}</p>
                    <p className="text-xs text-slate-400">
                      {s.subscription_plans?.display_name || s.subscription_plans?.name || 'プラン未紐づけ'}
                      {s.origin === 'preorder' && <span className="ml-2 px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300">予約</span>}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLOR[s.status] || ''}`}>
                      {STATUS_LABEL[s.status] || s.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">{s.cycle_count}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{jstDay(s.next_delivery_at)}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{jstDay(s.next_billing_at)}</td>
                  <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">{yen(s.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <DetailDrawer id={selected} onClose={() => { setSelected(null); load() }} />}
    </div>
  )
}

function DetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [sub, setSub] = useState<Sub | null>(null)
  const [cycles, setCycles] = useState<Cycle[]>([])
  const [events, setEvents] = useState<EventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get(`/detail/${id}`)
      setSub(data.subscription); setCycles(data.cycles); setEvents(data.events)
    } finally { setLoading(false) }
  }, [id])
  useEffect(() => { load() }, [load])

  async function act(name: string, path: string, body?: Record<string, unknown>) {
    setBusy(name); setMsg('')
    try {
      await api.post(`/${id}/${path}`, body || {})
      setMsg('反映しました')
      load()
    } catch (e) { setMsg(errMsg(e, '失敗しました')) }
    finally { setBusy('') }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="w-full max-w-xl h-full overflow-y-auto bg-white dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 px-6 py-4 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900 dark:text-white">契約の詳細</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
            <X size={18} className="text-slate-500" />
          </button>
        </div>

        {loading || !sub ? (
          <div className="py-20 text-center"><Loader2 className="animate-spin inline text-slate-400" /></div>
        ) : (
          <div className="p-6 space-y-6">
            <div>
              <p className="text-slate-900 dark:text-white font-medium">{sub.email}</p>
              <p className="text-xs text-slate-400 mt-1">契約ID {sub.shopify_contract_id}</p>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-slate-500">状態</p><p className="mt-0.5">{STATUS_LABEL[sub.status] || sub.status}</p></div>
                <div><p className="text-xs text-slate-500">課金回数</p><p className="mt-0.5">{sub.cycle_count}</p></div>
                <div><p className="text-xs text-slate-500">次回お届け予定</p><p className="mt-0.5">{jstDay(sub.next_delivery_at)}</p></div>
                <div><p className="text-xs text-slate-500">次回課金</p><p className="mt-0.5">{jst(sub.next_billing_at)}</p></div>
                <div><p className="text-xs text-slate-500">連続スキップ</p><p className="mt-0.5">{sub.consecutive_skips}</p></div>
                <div><p className="text-xs text-slate-500">金額</p><p className="mt-0.5">{yen(sub.amount)}</p></div>
              </div>
              {sub.cancel_reasons?.label && (
                <p className="mt-3 text-sm text-slate-500">解約理由: {sub.cancel_reasons.label}</p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <ActionBtn icon={<CalendarClock size={14} />} label="1週間スキップ" busy={busy === 'skip'} onClick={() => act('skip', 'skip')} />
              <ActionBtn icon={<Truck size={14} />} label="到着を記録" busy={busy === 'delivered'} onClick={() => act('delivered', 'mark-delivered')} />
              <ActionBtn icon={<CreditCard size={14} />} label="今すぐ課金" busy={busy === 'bill'} onClick={() => act('bill', 'bill-now')} />
              <ActionBtn icon={<CreditCard size={14} />} label="支払方法の更新メール" busy={busy === 'pay'} onClick={() => act('pay', 'payment-update-email')} />
              {sub.status === 'paused'
                ? <ActionBtn icon={<PlayCircle size={14} />} label="再開" busy={busy === 'resume'} onClick={() => act('resume', 'resume')} />
                : <ActionBtn icon={<PauseCircle size={14} />} label="一時停止" busy={busy === 'pause'} onClick={() => act('pause', 'pause')} />}
              <ActionBtn icon={<RefreshCw size={14} />} label="Shopifyと同期" busy={busy === 'sync'} onClick={() => act('sync', 'sync')} />
              <ActionBtn
                icon={<Ban size={14} />} label="解約" danger busy={busy === 'cancel'}
                onClick={() => { if (confirm('この定期購入を解約します。よろしいですか？')) act('cancel', 'cancel', { note: '管理画面から解約' }) }}
              />
            </div>
            {msg && <p className="text-sm text-slate-600 dark:text-slate-300">{msg}</p>}

            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2 flex items-center gap-2">
                <Package size={14} /> お届け履歴
              </h3>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                {cycles.length === 0 && <p className="p-4 text-sm text-slate-400">まだありません</p>}
                {cycles.map((c) => (
                  <div key={c.id} className="p-3 text-sm flex items-center justify-between gap-3">
                    <div>
                      <p className="text-slate-900 dark:text-white">{c.cycle_no}回目 <span className="text-xs text-slate-400 ml-1">{c.status}</span></p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        課金 {jstDay(c.billed_at)} / 発送 {jstDay(c.shipped_at)} / 到着 {jstDay(c.delivered_at)}
                      </p>
                      {c.failure_reason && <p className="text-xs text-red-500 mt-0.5">{c.failure_reason}（リトライ {c.retry_count}）</p>}
                    </div>
                    <span className="text-slate-500">{yen(c.amount)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">イベントログ</h3>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 max-h-72 overflow-y-auto">
                {events.map((e) => (
                  <div key={e.id} className="p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-900 dark:text-white font-medium">{e.event_type}</span>
                      <span className="text-slate-400">{jst(e.created_at)}</span>
                    </div>
                    <p className="text-slate-400 mt-0.5">{e.actor}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ActionBtn({ icon, label, onClick, busy, danger }: { icon: React.ReactNode; label: string; onClick: () => void; busy?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`px-3 py-2 rounded-lg border text-xs font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition ${
        danger
          ? 'border-red-200 dark:border-red-900 text-red-600 hover:bg-red-50 dark:hover:bg-red-950'
          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900'
      }`}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : icon}
      {label}
    </button>
  )
}

// ── プラン ──
interface ShopifyProduct { id: string; title: string; image: string | null; variants: { id: string; title: string; price: string }[] }

const EMPTY_PLAN: Partial<Plan> = {
  name: '', display_name: '', description: '', shopify_product_id: '',
  interval_days: 28, lead_days: 3, delivery_fallback_days: 2,
  discount_percent: 10, max_consecutive_skips: 4,
  is_preorder: false, preorder_first_ship_date: null, preorder_note: '', is_active: true,
}

function Plans({ onChanged }: { onChanged: () => void }) {
  const [plans, setPlans] = useState<Plan[]>([])
  const [products, setProducts] = useState<ShopifyProduct[]>([])
  const [productError, setProductError] = useState('')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<Plan> | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/plans')
      setPlans(data.plans || [])
    } finally { setLoading(false) }
    try {
      const { data } = await api.get('/shopify-products')
      setProducts(data.products || [])
      setProductError('')
    } catch (e) { setProductError(errMsg(e, 'Shopify商品を取得できませんでした（スコープ不足の可能性）')) }
  }, [])
  useEffect(() => { load() }, [load])

  async function save() {
    if (!editing?.name) { setMsg('プラン名を入力してください'); return }
    setBusy(true); setMsg('')
    try {
      const body = { ...editing }
      if (editing.id) await api.put(`/plans/${editing.id}`, body)
      else await api.post('/plans', body)
      setEditing(null); load(); onChanged()
    } catch (e) { setMsg(errMsg(e, '保存に失敗しました')) }
    finally { setBusy(false) }
  }

  async function syncShopify(plan: Plan) {
    setBusy(true); setMsg('')
    try {
      const { data } = await api.post(`/plans/${plan.id}/sync-shopify`)
      setMsg(`Shopifyに同期しました（Selling Plan ${data.sellingPlanId}）`)
      load()
    } catch (e) { setMsg(errMsg(e, 'Shopifyへの同期に失敗しました')) }
    finally { setBusy(false) }
  }

  if (loading) return <div className="py-12 text-center"><Loader2 className="animate-spin inline text-slate-400" /></div>

  return (
    <div className="space-y-4">
      {productError && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-3 text-sm text-amber-800 dark:text-amber-200">
          {productError}
        </div>
      )}

      {!editing && (
        <button
          onClick={() => setEditing({ ...EMPTY_PLAN })}
          className="px-4 py-2.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium cursor-pointer"
        >
          プランを追加
        </button>
      )}

      {editing && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="プラン名（管理用）">
              <input className={inputCls} value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="クレアショット 28日ごと" />
            </Field>
            <Field label="表示名（顧客向け）">
              <input className={inputCls} value={editing.display_name || ''} onChange={(e) => setEditing({ ...editing, display_name: e.target.value })} placeholder="定期購入（28日ごと）" />
            </Field>
            <Field label="対象商品">
              <select className={inputCls} value={editing.shopify_product_id || ''} onChange={(e) => setEditing({ ...editing, shopify_product_id: e.target.value })}>
                <option value="">選択してください</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </Field>
            <Field label="割引率（%）">
              <input type="number" className={inputCls} value={editing.discount_percent ?? 10} onChange={(e) => setEditing({ ...editing, discount_percent: Number(e.target.value) })} />
            </Field>
            <Field label="お届け周期（日）">
              <input type="number" className={inputCls} value={editing.interval_days ?? 28} onChange={(e) => setEditing({ ...editing, interval_days: Number(e.target.value) })} />
            </Field>
            <Field label="リード日数（課金→到着）">
              <input type="number" className={inputCls} value={editing.lead_days ?? 3} onChange={(e) => setEditing({ ...editing, lead_days: Number(e.target.value) })} />
            </Field>
            <Field label="配達フォールバック日数">
              <input type="number" className={inputCls} value={editing.delivery_fallback_days ?? 2} onChange={(e) => setEditing({ ...editing, delivery_fallback_days: Number(e.target.value) })} />
            </Field>
            <Field label="連続スキップ上限">
              <input type="number" className={inputCls} value={editing.max_consecutive_skips ?? 4} onChange={(e) => setEditing({ ...editing, max_consecutive_skips: Number(e.target.value) })} />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
            <input type="checkbox" checked={!!editing.is_preorder} onChange={(e) => setEditing({ ...editing, is_preorder: e.target.checked })} />
            予約販売（初回発送が先の商品）
          </label>

          {editing.is_preorder && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="初回発送予定日">
                <input type="date" className={inputCls} value={editing.preorder_first_ship_date || ''} onChange={(e) => setEditing({ ...editing, preorder_first_ship_date: e.target.value })} />
              </Field>
              <Field label="顧客向け表示文言">
                <input className={inputCls} value={editing.preorder_note || ''} onChange={(e) => setEditing({ ...editing, preorder_note: e.target.value })} placeholder="10月下旬発送予定" />
              </Field>
            </div>
          )}

          <div className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-900 rounded-lg p-3">
            次回のお届けは「到着日 + {editing.interval_days ?? 28}日」。課金はその{editing.lead_days ?? 3}日前に行われます。
          </div>

          <div className="flex gap-2">
            <button onClick={save} disabled={busy} className="px-4 py-2.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium cursor-pointer disabled:opacity-50">
              {busy ? '保存中…' : '保存'}
            </button>
            <button onClick={() => { setEditing(null); setMsg('') }} className="px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm cursor-pointer">
              キャンセル
            </button>
          </div>
        </div>
      )}

      {msg && <p className="text-sm text-slate-600 dark:text-slate-300">{msg}</p>}

      <div className="space-y-3">
        {plans.map((p) => (
          <div key={p.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium text-slate-900 dark:text-white">
                  {p.name}
                  {p.is_preorder && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300">予約販売</span>}
                  {!p.is_active && <span className="ml-2 text-xs text-slate-400">停止中</span>}
                </p>
                <p className="text-sm text-slate-500 mt-1">
                  {p.interval_days}日ごと / {p.discount_percent}%OFF / リード{p.lead_days}日 / スキップ上限{p.max_consecutive_skips}回
                </p>
                <p className="text-xs mt-1">
                  {p.shopify_selling_plan_id
                    ? <span className="text-emerald-600">Shopify同期済み（Selling Plan {p.shopify_selling_plan_id}）</span>
                    : <span className="text-amber-600">Shopify未同期（商品ページに定期購入が出ません）</span>}
                </p>
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                <button onClick={() => setEditing(p)} className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs cursor-pointer">編集</button>
                <button onClick={() => syncShopify(p)} disabled={busy} className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs cursor-pointer disabled:opacity-50">
                  Shopifyに同期
                </button>
              </div>
            </div>
          </div>
        ))}
        {plans.length === 0 && !editing && <p className="py-12 text-center text-sm text-slate-400">プランがまだありません</p>}
      </div>
    </div>
  )
}

const inputCls = 'w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-slate-500 mb-1.5">{label}</label>
      {children}
    </div>
  )
}

// ── 分析 ──
interface AnalyticsData {
  first_to_second_rate: number | null
  first_billers: number
  second_billers: number
  active_count: number
  cancelled_count: number
  cancel_rate: number
  avg_cycles_at_cancel: number
  skip_rate: number
  billing_failure_rate: number
  cancel_breakdown: Record<string, number>
  cohorts: { month: string; total: number; reached: Record<string, number> }[]
  by_origin: { origin: string; total: number; active: number; avg_cycles: number; cancel_rate: number }[]
}

function Analytics() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/analytics').then(({ data }) => setData(data)).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="py-12 text-center"><Loader2 className="animate-spin inline text-slate-400" /></div>
  if (!data) return null

  const maxCycle = Math.max(1, ...data.cohorts.flatMap((c) => Object.keys(c.reached).map(Number)))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card
          label="初回→2回目 継続率"
          value={pct(data.first_to_second_rate)}
          sub={`${data.second_billers} / ${data.first_billers}人`}
          tone="text-emerald-600"
        />
        <Card label="解約率" value={pct(data.cancel_rate)} sub={`解約 ${data.cancelled_count}件`} />
        <Card label="平均継続回数（解約者）" value={data.avg_cycles_at_cancel.toFixed(1)} />
        <Card label="課金失敗率" value={pct(data.billing_failure_rate)} sub={`スキップ率 ${pct(data.skip_rate)}`} />
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5">
        <h3 className="font-semibold text-slate-900 dark:text-white mb-3">解約理由の内訳</h3>
        {Object.keys(data.cancel_breakdown).length === 0 ? (
          <p className="text-sm text-slate-400">まだデータがありません</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(data.cancel_breakdown).sort((a, b) => b[1] - a[1]).map(([label, count]) => {
              const total = Object.values(data.cancel_breakdown).reduce((a, b) => a + b, 0)
              return (
                <div key={label} className="flex items-center gap-3 text-sm">
                  <span className="w-40 shrink-0 text-slate-600 dark:text-slate-300">{label}</span>
                  <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div className="h-full bg-slate-900 dark:bg-white" style={{ width: `${(count / total) * 100}%` }} />
                  </div>
                  <span className="w-16 text-right text-slate-500">{count}件</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5 overflow-x-auto">
        <h3 className="font-semibold text-slate-900 dark:text-white mb-3">コホート継続率（初回契約月別）</h3>
        {data.cohorts.length === 0 ? (
          <p className="text-sm text-slate-400">まだデータがありません</p>
        ) : (
          <table className="text-sm min-w-full">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="text-left px-3 py-2 font-medium">月</th>
                <th className="text-right px-3 py-2 font-medium">人数</th>
                {Array.from({ length: maxCycle }, (_, i) => (
                  <th key={i} className="text-right px-3 py-2 font-medium">{i + 1}回目</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.cohorts.map((c) => (
                <tr key={c.month} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2 text-slate-900 dark:text-white">{c.month}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{c.total}</td>
                  {Array.from({ length: maxCycle }, (_, i) => {
                    const n = c.reached[String(i + 1)] || 0
                    return <td key={i} className="px-3 py-2 text-right text-slate-600 dark:text-slate-300">{c.total ? `${Math.round((n / c.total) * 100)}%` : '—'}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5">
        <h3 className="font-semibold text-slate-900 dark:text-white mb-3">予約組 vs 通常組</h3>
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500">
            <tr><th className="text-left py-2">区分</th><th className="text-right py-2">契約数</th><th className="text-right py-2">継続中</th><th className="text-right py-2">平均回数</th><th className="text-right py-2">解約率</th></tr>
          </thead>
          <tbody>
            {data.by_origin.map((o) => (
              <tr key={o.origin} className="border-t border-slate-100 dark:border-slate-800">
                <td className="py-2 text-slate-900 dark:text-white">{o.origin === 'preorder' ? '予約販売' : '通常'}</td>
                <td className="py-2 text-right text-slate-600 dark:text-slate-300">{o.total}</td>
                <td className="py-2 text-right text-slate-600 dark:text-slate-300">{o.active}</td>
                <td className="py-2 text-right text-slate-600 dark:text-slate-300">{o.avg_cycles.toFixed(1)}</td>
                <td className="py-2 text-right text-slate-600 dark:text-slate-300">{pct(o.cancel_rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── 設定 ──
interface SettingsShape {
  billing: { cron_enabled: boolean; billing_hour_jst: number; retry_offsets_days: number[]; max_retries: number; after_max_retries: string }
  delivery: { delivery_fallback_days: number; delivered_wait_days: number }
  skip: { enabled: boolean; skip_days: number; cutoff_hours_before: number }
  cancel_flow: { offer_skip_first: boolean; retention_message: string }
}

function SettingsTab({ health, onRefresh }: { health: Health | null; onRefresh: () => void }) {
  const [s, setS] = useState<SettingsShape | null>(null)
  const [reasons, setReasons] = useState<{ id: string; label: string; sort_order: number; is_active: boolean }[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [webhookResult, setWebhookResult] = useState<{ topic: string; status: string; error?: string }[] | null>(null)

  const load = useCallback(async () => {
    const [{ data: settings }, { data: r }] = await Promise.all([api.get('/settings'), api.get('/cancel-reasons')])
    setS(settings); setReasons(r.reasons || [])
  }, [])
  useEffect(() => { load() }, [load])

  async function save() {
    if (!s) return
    setBusy(true); setMsg('')
    try {
      await api.put('/settings', s)
      setMsg('保存しました'); onRefresh()
    } catch (e) { setMsg(errMsg(e, '保存に失敗しました')) }
    finally { setBusy(false) }
  }

  async function setupWebhooks() {
    setBusy(true); setMsg(''); setWebhookResult(null)
    try {
      const { data } = await api.post('/setup-webhooks')
      setWebhookResult(data.results)
    } catch (e) { setMsg(errMsg(e, 'webhook登録に失敗しました')) }
    finally { setBusy(false) }
  }

  if (!s) return <div className="py-12 text-center"><Loader2 className="animate-spin inline text-slate-400" /></div>

  return (
    <div className="space-y-6">
      <div className={`rounded-xl border p-5 ${s.billing.cron_enabled ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950'}`}>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1"
            checked={s.billing.cron_enabled}
            onChange={(e) => setS({ ...s, billing: { ...s.billing, cron_enabled: e.target.checked } })}
          />
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">課金エンジンを稼働させる</p>
            <p className="text-sm text-slate-500 mt-1">
              オフの間、cronは課金を一切行いません（契約の同期・配達の記録は続きます）。
              テストが済むまではオフのままにしてください。
            </p>
          </div>
        </label>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5 space-y-4">
        <h3 className="font-semibold text-slate-900 dark:text-white">課金・配送</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="課金する時刻（JST）">
            <input type="number" min={0} max={23} className={inputCls} value={s.billing.billing_hour_jst}
              onChange={(e) => setS({ ...s, billing: { ...s.billing, billing_hour_jst: Number(e.target.value) } })} />
          </Field>
          <Field label="リトライ間隔（日・カンマ区切り）">
            <input className={inputCls} value={s.billing.retry_offsets_days.join(',')}
              onChange={(e) => setS({ ...s, billing: { ...s.billing, retry_offsets_days: e.target.value.split(',').map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n)) } })} />
          </Field>
          <Field label="リトライ上限後">
            <select className={inputCls} value={s.billing.after_max_retries}
              onChange={(e) => setS({ ...s, billing: { ...s.billing, after_max_retries: e.target.value } })}>
              <option value="paused">一時停止</option>
              <option value="cancelled">解約</option>
            </select>
          </Field>
          <Field label="配達フォールバック日数">
            <input type="number" className={inputCls} value={s.delivery.delivery_fallback_days}
              onChange={(e) => setS({ ...s, delivery: { ...s.delivery, delivery_fallback_days: Number(e.target.value) } })} />
          </Field>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5 space-y-4">
        <h3 className="font-semibold text-slate-900 dark:text-white">スキップ・解約フロー</h3>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
          <input type="checkbox" checked={s.skip.enabled} onChange={(e) => setS({ ...s, skip: { ...s.skip, enabled: e.target.checked } })} />
          顧客によるスキップを受け付ける
        </label>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="スキップ日数">
            <input type="number" className={inputCls} value={s.skip.skip_days}
              onChange={(e) => setS({ ...s, skip: { ...s.skip, skip_days: Number(e.target.value) } })} />
          </Field>
          <Field label="受付終了（課金の何時間前）">
            <input type="number" className={inputCls} value={s.skip.cutoff_hours_before}
              onChange={(e) => setS({ ...s, skip: { ...s.skip, cutoff_hours_before: Number(e.target.value) } })} />
          </Field>
        </div>
        <Field label="解約前の引き止め文言">
          <input className={inputCls} value={s.cancel_flow.retention_message}
            onChange={(e) => setS({ ...s, cancel_flow: { ...s.cancel_flow, retention_message: e.target.value } })} />
        </Field>
        <div>
          <p className="text-xs text-slate-500 mb-2">解約理由の選択肢</p>
          <div className="flex flex-wrap gap-2">
            {reasons.map((r) => (
              <span key={r.id} className={`px-2.5 py-1 rounded-full text-xs ${r.is_active ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300' : 'bg-slate-50 dark:bg-slate-900 text-slate-400 line-through'}`}>
                {r.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={busy} className="px-4 py-2.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium cursor-pointer disabled:opacity-50">
          {busy ? '保存中…' : '設定を保存'}
        </button>
        {msg && <span className="text-sm text-slate-600 dark:text-slate-300">{msg}</span>}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5">
        <h3 className="font-semibold text-slate-900 dark:text-white">Shopify Webhook</h3>
        <p className="text-sm text-slate-500 mt-1">
          契約の作成・課金結果・発送・配達完了を受け取るためのwebhookを登録します（登録済みのものはそのまま）。
        </p>
        {health?.shopify_scopes?.length ? (
          <p className="text-xs text-slate-400 mt-2">連携中: {health.shopify_store} / スコープ {health.shopify_scopes.length}件</p>
        ) : null}
        <button onClick={setupWebhooks} disabled={busy} className="mt-3 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm cursor-pointer disabled:opacity-50">
          webhookを登録する
        </button>
        {webhookResult && (
          <ul className="mt-3 space-y-1 text-xs">
            {webhookResult.map((r) => (
              <li key={r.topic} className="flex items-center gap-2">
                {r.status === 'error'
                  ? <X size={12} className="text-red-500" />
                  : <CheckCircle2 size={12} className="text-emerald-600" />}
                <span className="text-slate-600 dark:text-slate-300">{r.topic}</span>
                <span className="text-slate-400">{r.status === 'exists' ? '登録済み' : r.status === 'created' ? '登録しました' : r.error}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}


// ── クレアショット（6プラン・予約表示・リマインダー・オンボーディング） ──
interface CreashotPlanRow {
  id: string
  plan_code: string
  display_name: string
  sticks_per_day: number
  bags_per_cycle: number
  interval_label: string
  price: number
  price_per_bag: number
  shopify_variant_id: string
  shopify_selling_plan_id: string | null
}
interface CreashotSettings {
  product_id: string
  lp_url: string
  line_add_url: string
  preorder_note: string
  preorder_first_ship_date: string | null
  reminder_default_time: string
  reminder_default_message: string
  onboarding_email_enabled: boolean
  onboarding_line_enabled: boolean
}

function CreashotTab() {
  const [plans, setPlans] = useState<CreashotPlanRow[]>([])
  const [settings, setSettings] = useState<CreashotSettings | null>(null)
  const [reminders, setReminders] = useState<Record<string, unknown>[]>([])
  const [onboarding, setOnboarding] = useState<Record<string, unknown>[]>([])
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    try {
      const [{ data: p }, { data: st }, { data: r }, { data: o }] = await Promise.all([
        api.get('/creashot/plans'), api.get('/creashot/settings'), api.get('/creashot/reminders'), api.get('/creashot/onboarding'),
      ])
      setPlans(p.plans || []); setSettings(st); setReminders(r.reminders || []); setOnboarding(o.onboarding || [])
    } catch (e) { setMsg(errMsg(e, '読み込みに失敗しました')) }
  }, [])
  useEffect(() => { load() }, [load])

  async function setup() {
    setBusy('setup'); setMsg('')
    try {
      const { data } = await api.post('/creashot/setup')
      setMsg(`Shopifyの定期プランを設定しました：${(data.groups || []).map((g: { code: string; selling_plan_id: string }) => `${g.code}=${g.selling_plan_id}`).join(' / ')}`)
      await load()
    } catch (e) { setMsg(errMsg(e, 'セットアップに失敗しました')) }
    finally { setBusy('') }
  }

  async function saveSettings() {
    if (!settings) return
    setBusy('settings'); setMsg('')
    try {
      const { data } = await api.put('/creashot/settings', settings)
      setSettings(data); setMsg('設定を保存しました')
    } catch (e) { setMsg(errMsg(e, '保存に失敗しました')) }
    finally { setBusy('') }
  }

  const ready = plans.length === 6 && plans.every((p) => p.shopify_selling_plan_id)

  return (
    <div className="space-y-6">
      <div className={`rounded-xl border p-4 ${ready ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20' : 'border-amber-300 bg-amber-50 dark:bg-amber-900/20'}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">{ready ? 'Shopifyの定期プラン（1・3・12ヶ月ごと）は設定済みです' : 'Shopifyの定期プランがまだ紐づいていません'}</p>
            <p className="text-xs text-slate-500 mt-1">
              6バリエーション（1日1本／1日2本 × 1・3・12ヶ月ごと）に、3つの Selling Plan Group を紐づけます。何度押しても同じ結果になります。
            </p>
          </div>
          <button onClick={setup} disabled={!!busy}
            className="shrink-0 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm hover:bg-slate-700 disabled:opacity-50 flex items-center gap-2">
            {busy === 'setup' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Shopifyに定期プランを作成／同期
          </button>
        </div>
        {msg && <p className="mt-3 text-sm">{msg}</p>}
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900 text-xs text-slate-500">
            <tr><th className="text-left p-3">プラン</th><th className="text-right p-3">価格</th><th className="text-right p-3">1袋あたり</th><th className="text-left p-3">Variant</th><th className="text-left p-3">Selling Plan</th></tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="p-3">{p.display_name}<span className="ml-2 text-xs text-slate-400">{p.plan_code}</span></td>
                <td className="p-3 text-right">{yen(p.price)}</td>
                <td className="p-3 text-right">{yen(p.price_per_bag)}</td>
                <td className="p-3 text-xs text-slate-500">{p.shopify_variant_id}</td>
                <td className="p-3 text-xs">{p.shopify_selling_plan_id ? <span className="text-emerald-600">{p.shopify_selling_plan_id}</span> : <span className="text-amber-600">未設定</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {settings && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <h3 className="font-semibold">表示・導線の設定</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="予約表示（My FITPEAK・LINE案内に使用）">
              <input value={settings.preorder_note || ''} onChange={(e) => setSettings({ ...settings, preorder_note: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-sm" />
            </Field>
            <Field label="初回発送予定日">
              <input type="date" value={settings.preorder_first_ship_date || ''} onChange={(e) => setSettings({ ...settings, preorder_first_ship_date: e.target.value || null })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-sm" />
            </Field>
            <Field label="リマインダー既定時刻（JST）">
              <input value={settings.reminder_default_time || ''} onChange={(e) => setSettings({ ...settings, reminder_default_time: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-sm" />
            </Field>
            <Field label="公式LINE 友だち追加URL">
              <input value={settings.line_add_url || ''} onChange={(e) => setSettings({ ...settings, line_add_url: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-sm" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="リマインダー既定メッセージ">
                <input value={settings.reminder_default_message || ''} onChange={(e) => setSettings({ ...settings, reminder_default_message: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-sm" />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!settings.onboarding_line_enabled} onChange={(e) => setSettings({ ...settings, onboarding_line_enabled: e.target.checked })} /> 購入後にLINEで案内（連携済みの人）</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!settings.onboarding_email_enabled} onChange={(e) => setSettings({ ...settings, onboarding_email_enabled: e.target.checked })} /> 購入後にメールで案内（未連携の人）</label>
          </div>
          <button onClick={saveSettings} disabled={!!busy} className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm hover:bg-slate-700 disabled:opacity-50">
            {busy === 'settings' ? '保存中…' : '保存'}
          </button>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-5">
          <h3 className="font-semibold mb-2">LINEリマインダー（{reminders.filter((r) => r.enabled).length}件 有効）</h3>
          <div className="space-y-1 max-h-64 overflow-auto text-xs">
            {reminders.map((r) => (
              <div key={String(r.id)} className="flex justify-between gap-2 py-1 border-b border-slate-100 dark:border-slate-800">
                <span className="truncate">{String(r.email)}</span>
                <span className="shrink-0">{r.enabled ? `${r.time_jst} / 最終 ${r.last_sent_date || '—'}` : 'オフ'}</span>
              </div>
            ))}
            {reminders.length === 0 && <p className="text-slate-400">まだ設定した顧客はいません</p>}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-5">
          <h3 className="font-semibold mb-2">購入後オンボーディング（{onboarding.length}件）</h3>
          <div className="space-y-1 max-h-64 overflow-auto text-xs">
            {onboarding.map((o) => (
              <div key={String(o.id)} className="flex justify-between gap-2 py-1 border-b border-slate-100 dark:border-slate-800">
                <span className="truncate">{String(o.email)}</span>
                <span className="shrink-0">
                  {o.line_linked_at ? 'LINE済' : 'LINE未'} / {o.myfitpeak_logged_in_at ? 'MyF済' : 'MyF未'} / {o.line_notified_at ? 'LINE送' : o.email_notified_at ? 'メール送' : '未送'}
                </span>
              </div>
            ))}
            {onboarding.length === 0 && <p className="text-slate-400">まだ契約はありません</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
