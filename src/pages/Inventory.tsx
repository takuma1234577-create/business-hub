import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Boxes, RefreshCw, Plus, Save, Send, Copy, AlertTriangle, CheckCircle, Trash2, ExternalLink,
} from 'lucide-react'
import { createApi } from '../lib/api'

const api = createApi('/api/inventory')

type RowStatus = 'now' | 'prepare' | 'ordered' | 'unknown' | 'no_snapshot' | 'ok' | 'discontinued'
interface Row {
  id: string; product: string; color: string; size: string; asin: string | null; seller_sku: string | null
  discontinued: boolean; active: boolean; note: string | null
  fulfillable: number | null; inbound: number | null; fetched_at: string | null
  units_90d: number | null; units_30d: number | null; daily: number | null; daily_src: string | null
  amazon_days: number | null; ordered: number; inspecting: number; ready: number; shipping: number
  pipeline: number; total: number; total_days: number | null; stockout_date: string | null
  status: RowStatus; recommended: number; material_state: 'ok' | 'low' | 'short' | 'unknown'; warnings: string[]
}
interface Material {
  id: string; product: string; name: string; unit: string; per_unit: number; quantity: number | null
  updated_at: string | null; updated_by: string | null; note: string | null
  pipeline_need: number; buffer: number; need_total: number; shortage: number | null; state: 'ok' | 'low' | 'short' | 'unknown'
}
interface Lot {
  id: string; lot_code: string | null; product_id: string; qty: number; status: string; ordered_at: string | null
  status_updated_at: string | null; updated_by: string | null; tracking: string | null; note: string | null
  inventory_products?: { product: string; color: string; size: string; asin: string | null }
}
interface Settings {
  lead_time_days: number; safety_days: number; coverage_days: number; prepare_days: number; lot_size: number; min_qty: number
  material_buffer_units: number; color_standard_lots: Record<string, number>; partner_key: string | null; partner_name: string | null
  chatwork_room_id: string | null; chatwork_template: string | null; last_inventory_sync: string | null; last_sales_sync_date: string | null
}
interface Dashboard { rows: Row[]; materials: Material[]; settings: Settings; status_labels: Record<string, string> }
type Run = (fn: () => Promise<unknown>, ok: string) => Promise<void>

const STATUS_UI: Record<RowStatus, { label: string; cls: string }> = {
  now: { label: '🔴 今すぐ発注', cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
  prepare: { label: '🟡 発注準備', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  ordered: { label: '🔵 発注済み（追加発注不可）', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300' },
  ok: { label: '🟢 余裕あり', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  unknown: { label: '⚪ 日販不明', cls: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  no_snapshot: { label: '⚪ 在庫未取得', cls: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  discontinued: { label: '⚫ 廃止（売り切り）', cls: 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
}
const MAT_UI = {
  ok: { label: 'OK', cls: 'text-emerald-700 dark:text-emerald-400' },
  low: { label: '要補充', cls: 'text-amber-700 dark:text-amber-400' },
  short: { label: '資材不足', cls: 'text-red-700 dark:text-red-400 font-semibold' },
  unknown: { label: '未入力', cls: 'text-gray-500' },
}
const LOT_STATUSES = ['ordered', 'inspecting', 'ready', 'shipping', 'received', 'cancelled']
const INP = 'px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm'

const fmt = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? '—' : n.toLocaleString('ja-JP', { maximumFractionDigits: d, minimumFractionDigits: d }))
const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
const errText = (e: unknown) => { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax.response?.data?.error || ax.message || String(e) }

export default function Inventory() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'dashboard' | 'lots' | 'materials' | 'products' | 'settings'>('dashboard')
  const [data, setData] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [product, setProduct] = useState<string>('すべて')
  const [color, setColor] = useState<string>('すべて')

  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await api.get<Dashboard>('/dashboard'); setData(r.data) }
    catch (e) { setMsg({ type: 'err', text: errText(e) }) }
    setLoading(false)
  }, [])
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])

  const products = useMemo(() => Array.from(new Set((data?.rows || []).filter(r => r.active).map(r => r.product))), [data])
  const colors = useMemo(() => Array.from(new Set((data?.rows || []).filter(r => r.active && (product === 'すべて' || r.product === product)).map(r => r.color))), [data, product])
  const rows = useMemo(() => (data?.rows || []).filter(r => r.active && (product === 'すべて' || r.product === product) && (color === 'すべて' || r.color === color)), [data, product, color])

  const notify = (type: 'ok' | 'err', text: string) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 6000) }
  const run: Run = async (fn, okText) => {
    try { await fn(); notify('ok', okText); await load() }
    catch (e) { notify('err', errText(e)) }
  }

  const tabs = [
    { id: 'dashboard', label: '在庫ダッシュボード' },
    { id: 'lots', label: '在庫フロー（ロット）' },
    { id: 'materials', label: '資材' },
    { id: 'products', label: '商品マスター' },
    { id: 'settings', label: '設定' },
  ] as const

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <button onClick={() => navigate('/')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 mb-4">
          <ArrowLeft size={16} /> ホーム
        </button>
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-lg bg-teal-50 dark:bg-teal-950/50 text-teal-600 dark:text-teal-400"><Boxes size={26} /></div>
          <div>
            <h1 className="text-xl font-bold">商品在庫管理</h1>
            <p className="text-sm text-gray-500">Amazon FBA在庫 × たお太郎パイプライン × 資材を一元管理。発注タイミングと二重発注を自動判定</p>
          </div>
        </div>

        <div className="flex gap-1 mt-5 border-b border-gray-200 dark:border-gray-800 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${tab === t.id ? 'border-teal-600 text-teal-700 dark:text-teal-300 font-semibold' : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}>
              {t.label}
            </button>
          ))}
          <button onClick={load} className="ml-auto flex items-center gap-1 px-3 py-2 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 再読込
          </button>
        </div>

        {msg && (
          <div className={`mt-4 flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${msg.type === 'ok' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300'}`}>
            {msg.type === 'ok' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />} {msg.text}
          </div>
        )}

        {!data && !loading && <p className="mt-6 text-sm text-gray-500">読み込めませんでした。再読込してください。</p>}
        {data && tab === 'dashboard' && (
          <DashboardTab data={data} rows={rows} products={products} colors={colors} product={product} color={color}
            setProduct={p => { setProduct(p); setColor('すべて') }} setColor={setColor} run={run} />
        )}
        {data && tab === 'lots' && <LotsTab data={data} run={run} />}
        {data && tab === 'materials' && <MaterialsTab data={data} run={run} />}
        {data && tab === 'products' && <ProductsTab data={data} run={run} />}
        {data && tab === 'settings' && <SettingsTab data={data} run={run} notify={notify} />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- ダッシュボード
function DashboardTab({ data, rows, products, colors, product, color, setProduct, setColor, run }: {
  data: Dashboard; rows: Row[]; products: string[]; colors: string[]; product: string; color: string
  setProduct: (p: string) => void; setColor: (c: string) => void; run: Run
}) {
  const s = data.settings
  const counts = { now: 0, prepare: 0, ordered: 0, short: 0 }
  for (const r of data.rows.filter(r => r.active)) {
    if (r.status === 'now') counts.now++
    if (r.status === 'prepare') counts.prepare++
    if (r.status === 'ordered') counts.ordered++
    if (r.material_state === 'short') counts.short++
  }
  return (
    <div className="mt-5 space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: '今すぐ発注', v: counts.now, cls: 'text-red-600' },
          { label: '発注準備', v: counts.prepare, cls: 'text-amber-600' },
          { label: '発注済み（進行中）', v: counts.ordered, cls: 'text-blue-600' },
          { label: '資材不足の商品', v: counts.short, cls: 'text-red-600' },
        ].map(k => (
          <div key={k.label} className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
            <div className="text-xs text-gray-500">{k.label}</div>
            <div className={`text-2xl font-bold ${k.cls}`}>{k.v}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className={INP} value={product} onChange={e => setProduct(e.target.value)}>
          <option>すべて</option>{products.map(p => <option key={p}>{p}</option>)}
        </select>
        <select className={INP} value={color} onChange={e => setColor(e.target.value)}>
          <option>すべて</option>{colors.map(c => <option key={c || '(なし)'} value={c}>{c || '（色なし）'}</option>)}
        </select>
        <div className="ml-auto flex flex-wrap gap-2 text-sm">
          <button onClick={() => run(() => api.post('/sync/amazon-inventory'), 'Amazon在庫を取得しました')} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700">
            <RefreshCw size={14} /> Amazon在庫を今すぐ取得
          </button>
          <button onClick={() => run(async () => { await api.post('/sync/sales'); await api.post('/sync/process-reports') }, '販売レポートを要求しました（数分後に反映）')} className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800">
            販売数を再取得
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-500">
        Amazon在庫の取得：{fmtDate(s.last_inventory_sync)}／販売数の集計終了日：{s.last_sales_sync_date || '未取得'}。
        判定：総在庫日数 ≤ {s.lead_time_days + s.safety_days}日 → 今すぐ発注、≤ {s.lead_time_days + s.safety_days + s.prepare_days}日 → 発注準備。推奨発注数＝日販×{s.lead_time_days + s.coverage_days + s.safety_days}日 − 総在庫（{s.lot_size}個単位・最低{s.min_qty}個）。
      </p>

      <div className="overflow-x-auto bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/60 text-xs text-gray-500">
            <tr>
              {['判定', '商品', '色', 'サイズ', 'Amazon在庫', '入庫予定', '日販', 'Amazon日数', '輸送中', '準備完了', '検品中', '生産中', '総在庫', '総日数', '在庫切れ予定', '推奨発注', '資材'].map(h => (
                <th key={h} className="px-2 py-2 text-left font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className={`border-t border-gray-100 dark:border-gray-800 ${r.discontinued ? 'text-gray-400' : ''}`}>
                <td className="px-2 py-2 whitespace-nowrap">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_UI[r.status].cls}`}>{STATUS_UI[r.status].label}</span>
                  {r.warnings.length > 0 && (
                    <div className="mt-1 space-y-0.5">{r.warnings.map((w, i) => <div key={i} className="text-[11px] text-amber-700 dark:text-amber-400 whitespace-normal max-w-xs">⚠ {w}</div>)}</div>
                  )}
                </td>
                <td className="px-2 py-2 whitespace-nowrap">{r.product}</td>
                <td className="px-2 py-2 whitespace-nowrap">{r.color}</td>
                <td className="px-2 py-2 whitespace-nowrap">{r.size}</td>
                <td className={`px-2 py-2 text-right ${r.amazon_days !== null && r.amazon_days < s.lead_time_days && !r.discontinued ? 'text-red-600 font-semibold' : ''}`}>{fmt(r.fulfillable)}</td>
                <td className="px-2 py-2 text-right">{fmt(r.inbound)}</td>
                <td className="px-2 py-2 text-right">{fmt(r.daily, 1)}</td>
                <td className="px-2 py-2 text-right">{fmt(r.amazon_days)}</td>
                <td className="px-2 py-2 text-right">{r.shipping || '—'}</td>
                <td className="px-2 py-2 text-right">{r.ready || '—'}</td>
                <td className="px-2 py-2 text-right">{r.inspecting || '—'}</td>
                <td className="px-2 py-2 text-right">{r.ordered || '—'}</td>
                <td className="px-2 py-2 text-right font-medium">{fmt(r.total)}</td>
                <td className="px-2 py-2 text-right">{fmt(r.total_days)}</td>
                <td className="px-2 py-2 whitespace-nowrap">{r.stockout_date || '—'}</td>
                <td className="px-2 py-2 text-right font-semibold">{r.recommended ? fmt(r.recommended) : '—'}</td>
                <td className={`px-2 py-2 whitespace-nowrap ${MAT_UI[r.material_state].cls}`}>{MAT_UI[r.material_state].label}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={17} className="px-3 py-6 text-center text-gray-500">該当する商品がありません</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">
        Amazon日数＝(Amazon在庫＋入庫予定)÷日販。リードタイム（{s.lead_time_days}日）未満は赤字。総在庫＝Amazon在庫＋入庫予定＋たお太郎側（生産中〜輸送中）。
        🔵 は在庫フローに未完了ロット（生産中・検品中・準備完了）があり、追加発注しない。
      </p>
    </div>
  )
}

// ---------------------------------------------------------------- 在庫フロー
function LotsTab({ data, run }: { data: Dashboard; run: Run }) {
  const [lots, setLots] = useState<Lot[]>([])
  const [showDone, setShowDone] = useState(false)
  const [form, setForm] = useState({ product_id: '', qty: '', lot_code: '', ordered_at: new Date().toISOString().slice(0, 10), status: 'ordered', note: '' })
  const loadLots = useCallback(async () => { const r = await api.get<{ lots: Lot[] }>('/lots'); setLots(r.data.lots) }, [])
  useEffect(() => { const t = setTimeout(loadLots, 0); return () => clearTimeout(t) }, [loadLots])
  const labels = data.status_labels
  const visible = lots.filter(l => showDone || !['received', 'cancelled'].includes(l.status))
  const productRows = data.rows.filter(r => r.active && !r.discontinued)
  return (
    <div className="mt-5 space-y-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800">
        <h3 className="text-sm font-semibold mb-2">ロットを追加（発注確定時に必ず登録 → 二重発注ガードが効く）</h3>
        <div className="flex flex-wrap gap-2 items-end">
          <select className={INP} value={form.product_id} onChange={e => setForm({ ...form, product_id: e.target.value })}>
            <option value="">商品を選択</option>
            {productRows.map(r => <option key={r.id} value={r.id}>{r.product} {r.color} {r.size}</option>)}
          </select>
          <input className={`${INP} w-24`} type="number" placeholder="数量" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} />
          <input className={`${INP} w-28`} placeholder="ロットID" value={form.lot_code} onChange={e => setForm({ ...form, lot_code: e.target.value })} />
          <input className={INP} type="date" value={form.ordered_at} onChange={e => setForm({ ...form, ordered_at: e.target.value })} />
          <select className={INP} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            {LOT_STATUSES.map(st => <option key={st} value={st}>{labels[st]}</option>)}
          </select>
          <input className={`${INP} flex-1 min-w-40`} placeholder="備考" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
          <button onClick={() => run(async () => { await api.post('/lots', form); setForm({ ...form, qty: '', lot_code: '', note: '' }); await loadLots() }, 'ロットを追加しました')}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-sm hover:bg-teal-700"><Plus size={14} /> 追加</button>
        </div>
      </div>

      <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> 納品済み・キャンセルも表示</label>
      <div className="overflow-x-auto bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/60 text-xs text-gray-500">
            <tr>{['ロットID', '商品', '数量', 'ステータス', '発注日', '更新日', '更新者', '追跡番号／備考', ''].map(h => <th key={h} className="px-2 py-2 text-left font-medium whitespace-nowrap">{h}</th>)}</tr>
          </thead>
          <tbody>
            {visible.map(l => (
              <tr key={l.id} className="border-t border-gray-100 dark:border-gray-800">
                <td className="px-2 py-2">{l.lot_code || '—'}</td>
                <td className="px-2 py-2 whitespace-nowrap">{l.inventory_products?.product} {l.inventory_products?.color} {l.inventory_products?.size}</td>
                <td className="px-2 py-2 text-right">{l.qty}</td>
                <td className="px-2 py-2">
                  <select className={INP} value={l.status} onChange={e => run(async () => { await api.patch(`/lots/${l.id}`, { status: e.target.value }); await loadLots() }, 'ステータスを更新しました')}>
                    {LOT_STATUSES.map(st => <option key={st} value={st}>{labels[st]}</option>)}
                  </select>
                </td>
                <td className="px-2 py-2 whitespace-nowrap">{l.ordered_at || '—'}</td>
                <td className="px-2 py-2 whitespace-nowrap">{fmtDate(l.status_updated_at)}</td>
                <td className="px-2 py-2 whitespace-nowrap">{l.updated_by || '—'}</td>
                <td className="px-2 py-2 text-xs text-gray-500 max-w-xs">{[l.tracking, l.note].filter(Boolean).join(' / ') || '—'}</td>
                <td className="px-2 py-2"><button title="削除" onClick={() => { if (confirm('このロットを削除しますか？')) run(async () => { await api.delete(`/lots/${l.id}`); await loadLots() }, '削除しました') }} className="text-gray-400 hover:text-red-600"><Trash2 size={14} /></button></td>
              </tr>
            ))}
            {visible.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-500">進行中のロットはありません</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">流れ：発注中（生産中）→ 検品・梱包中 → 準備完了在庫 → 輸送中 → Amazon納品済み。ステータス更新はたお太郎の担当者が専用リンクからも行えます（設定タブ）。</p>
    </div>
  )
}

// ---------------------------------------------------------------- 資材
function MaterialsTab({ data, run }: { data: Dashboard; run: Run }) {
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [rooms, setRooms] = useState<{ room_id: number; name: string }[]>([])
  const s = data.settings
  return (
    <div className="mt-5 space-y-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800 flex flex-wrap items-center gap-3">
        <div className="text-sm">
          <div className="font-semibold">Chatworkで残数を確認する</div>
          <div className="text-xs text-gray-500">定型文と専用リンクをたお太郎のルームに投稿します。返信内容はこの画面か専用リンクから数量に反映。</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!s.chatwork_room_id && (
            <>
              <button onClick={async () => { const r = await api.get('/chatwork/rooms'); setRooms(r.data.rooms) }} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700">ルーム一覧</button>
              {rooms.length > 0 && (
                <select className={INP} onChange={e => run(() => api.patch('/settings', { chatwork_room_id: e.target.value }), 'ルームを保存しました')}>
                  <option value="">ルームを選択</option>{rooms.map(r => <option key={r.room_id} value={r.room_id}>{r.name}</option>)}
                </select>
              )}
            </>
          )}
          <button disabled={!s.chatwork_room_id} onClick={() => { if (confirm('Chatworkに資材確認メッセージを投稿しますか？')) run(() => api.post('/chatwork/ask-materials'), 'Chatworkに投稿しました') }}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-sm hover:bg-teal-700 disabled:opacity-40"><Send size={14} /> 残数を質問する</button>
        </div>
      </div>
      <div className="overflow-x-auto bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/60 text-xs text-gray-500">
            <tr>{['対象商品', '資材', '現在数量', '状態', 'これから使う数', '必要合計（＋安全余裕）', '過不足', '最終更新', ''].map(h => <th key={h} className="px-2 py-2 text-left font-medium whitespace-nowrap">{h}</th>)}</tr>
          </thead>
          <tbody>
            {data.materials.map(m => (
              <tr key={m.id} className="border-t border-gray-100 dark:border-gray-800">
                <td className="px-2 py-2 whitespace-nowrap">{m.product}</td>
                <td className="px-2 py-2 whitespace-nowrap">{m.name}</td>
                <td className="px-2 py-2 whitespace-nowrap"><input className={`${INP} w-24 text-right`} type="number" value={edits[m.id] ?? (m.quantity ?? '')} onChange={e => setEdits({ ...edits, [m.id]: e.target.value })} /> {m.unit}</td>
                <td className={`px-2 py-2 whitespace-nowrap ${MAT_UI[m.state].cls}`}>{MAT_UI[m.state].label}</td>
                <td className="px-2 py-2 text-right">{fmt(m.pipeline_need)}</td>
                <td className="px-2 py-2 text-right">{fmt(m.need_total)}</td>
                <td className={`px-2 py-2 text-right ${m.shortage !== null && m.shortage < 0 ? 'text-red-600' : ''}`}>{m.shortage === null ? '—' : (m.shortage >= 0 ? '+' : '') + fmt(m.shortage)}</td>
                <td className="px-2 py-2 text-xs text-gray-500 whitespace-nowrap">{fmtDate(m.updated_at)} {m.updated_by || ''}</td>
                <td className="px-2 py-2">
                  {edits[m.id] !== undefined && edits[m.id] !== String(m.quantity ?? '') && (
                    <button onClick={() => run(async () => { await api.patch(`/materials/${m.id}`, { quantity: edits[m.id] }); setEdits(e => { const n = { ...e }; delete n[m.id]; return n }) }, '数量を保存しました')} className="flex items-center gap-1 px-2 py-1 rounded bg-teal-600 text-white text-xs"><Save size={12} /> 保存</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">これから使う数＝「発注中（生産中）」＋「検品・梱包中」の数量×1個あたり使用数。必要合計はそれに安全余裕（{s.material_buffer_units}個分）を足した数。共通資材は全商品分。</p>
    </div>
  )
}

// ---------------------------------------------------------------- 商品マスター
function ProductsTab({ data, run }: { data: Dashboard; run: Run }) {
  const [form, setForm] = useState({ product: '', color: '', size: '', asin: '' })
  const rows = [...data.rows].sort((a, b) => a.product.localeCompare(b.product) || a.color.localeCompare(b.color) || a.size.localeCompare(b.size))
  return (
    <div className="mt-5 space-y-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800 flex flex-wrap gap-2 items-end">
        <input className={INP} placeholder="商品名" value={form.product} onChange={e => setForm({ ...form, product: e.target.value })} />
        <input className={INP} placeholder="色" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} />
        <input className={INP} placeholder="サイズ" value={form.size} onChange={e => setForm({ ...form, size: e.target.value })} />
        <input className={INP} placeholder="子ASIN" value={form.asin} onChange={e => setForm({ ...form, asin: e.target.value })} />
        <button onClick={() => run(async () => { await api.post('/products', form); setForm({ product: '', color: '', size: '', asin: '' }) }, '追加しました')} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-sm"><Plus size={14} /> 追加</button>
      </div>
      <div className="overflow-x-auto bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/60 text-xs text-gray-500">
            <tr>{['商品', '色', 'サイズ', '子ASIN', 'SKU', '管理対象', '廃止', '備考', ''].map(h => <th key={h} className="px-2 py-2 text-left font-medium whitespace-nowrap">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map(r => <ProductRow key={r.id} r={r} run={run} />)}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">Amazon在庫の取得で見つかった未登録のFITPEAK商品は「未整理」として追加されます（管理対象オフ）。商品名・色・サイズを整えて管理対象をオンにしてください。</p>
    </div>
  )
}
function ProductRow({ r, run }: { r: Row; run: Run }) {
  const [e, setE] = useState({ product: r.product, color: r.color, size: r.size, asin: r.asin || '', seller_sku: r.seller_sku || '', note: r.note || '' })
  const dirty = e.product !== r.product || e.color !== r.color || e.size !== r.size || e.asin !== (r.asin || '') || e.seller_sku !== (r.seller_sku || '') || e.note !== (r.note || '')
  const inp = 'px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm w-full'
  return (
    <tr className="border-t border-gray-100 dark:border-gray-800">
      <td className="px-2 py-1"><input className={inp} value={e.product} onChange={x => setE({ ...e, product: x.target.value })} /></td>
      <td className="px-2 py-1"><input className={inp} value={e.color} onChange={x => setE({ ...e, color: x.target.value })} /></td>
      <td className="px-2 py-1"><input className={`${inp} w-24`} value={e.size} onChange={x => setE({ ...e, size: x.target.value })} /></td>
      <td className="px-2 py-1"><input className={`${inp} w-28`} value={e.asin} onChange={x => setE({ ...e, asin: x.target.value })} /></td>
      <td className="px-2 py-1"><input className={`${inp} w-32`} value={e.seller_sku} onChange={x => setE({ ...e, seller_sku: x.target.value })} /></td>
      <td className="px-2 py-1 text-center"><input type="checkbox" checked={r.active} onChange={x => run(() => api.patch(`/products/${r.id}`, { active: x.target.checked }), '更新しました')} /></td>
      <td className="px-2 py-1 text-center"><input type="checkbox" checked={r.discontinued} onChange={x => run(() => api.patch(`/products/${r.id}`, { discontinued: x.target.checked }), '更新しました')} /></td>
      <td className="px-2 py-1"><input className={inp} value={e.note} onChange={x => setE({ ...e, note: x.target.value })} /></td>
      <td className="px-2 py-1 whitespace-nowrap">
        {dirty && <button onClick={() => run(() => api.patch(`/products/${r.id}`, e), '保存しました')} className="px-2 py-1 rounded bg-teal-600 text-white text-xs mr-1">保存</button>}
        <button onClick={() => { if (confirm('削除しますか？（ロットがある商品は削除できません）')) run(() => api.delete(`/products/${r.id}`), '削除しました') }} className="text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------- 設定
function SettingsTab({ data, run, notify }: { data: Dashboard; run: Run; notify: (t: 'ok' | 'err', s: string) => void }) {
  const s = data.settings
  const [f, setF] = useState({ ...s, color_standard_lots: JSON.stringify(s.color_standard_lots || {}) })
  const [rooms, setRooms] = useState<{ room_id: number; name: string }[]>([])
  const inp = 'px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm w-full'
  const link = `${window.location.origin}/inventory-partner?k=${s.partner_key || ''}`
  const numKeys = ['lead_time_days', 'safety_days', 'coverage_days', 'prepare_days', 'lot_size', 'min_qty', 'material_buffer_units'] as const
  const num = (k: typeof numKeys[number], label: string, help: string) => (
    <label className="block text-sm"><span className="text-gray-600 dark:text-gray-400">{label}</span>
      <input className={inp} type="number" value={String(f[k] ?? '')} onChange={e => setF({ ...f, [k]: Number(e.target.value) })} />
      <span className="text-xs text-gray-500">{help}</span></label>
  )
  return (
    <div className="mt-5 grid md:grid-cols-2 gap-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800 space-y-3">
        <h3 className="text-sm font-semibold">判定パラメータ</h3>
        {num('lead_time_days', 'リードタイム（日）', '発注確定→FBA受領まで')}
        {num('safety_days', '安全在庫（日）', 'リードタイムのブレを吸収')}
        {num('coverage_days', '到着後にカバーする日数', '推奨発注数の基準')}
        {num('prepare_days', '発注準備の余裕（日）', '今すぐ発注のしきい値＋この日数まで「発注準備」')}
        {num('lot_size', '発注ロット（個）', '推奨数の丸め単位')}
        {num('min_qty', '最低発注数（個）', '')}
        {num('material_buffer_units', '資材の安全余裕（個分）', '')}
        <label className="block text-sm"><span className="text-gray-600 dark:text-gray-400">色単位の標準ロット（JSON）</span>
          <input className={inp} value={f.color_standard_lots} onChange={e => setF({ ...f, color_standard_lots: e.target.value })} />
          <span className="text-xs text-gray-500">例：{'{"リストラップ|ブラック":1000}'}（同色合計をこの数にそろえる。段階価格の条件）</span></label>
        <button onClick={() => run(async () => {
          let lots: unknown; try { lots = JSON.parse(f.color_standard_lots) } catch { throw new Error('標準ロットのJSONが不正です') }
          const body: Record<string, unknown> = { color_standard_lots: lots }
          for (const k of numKeys) body[k] = f[k]
          await api.patch('/settings', body)
        }, '設定を保存しました')} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-sm"><Save size={14} /> 保存</button>
      </div>
      <div className="space-y-4">
        <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800 space-y-2">
          <h3 className="text-sm font-semibold">たお太郎 担当者用の専用リンク</h3>
          <p className="text-xs text-gray-500">ログイン不要。ロットのステータス更新と資材数量の入力だけができ、原価・売上は表示されません。</p>
          <div className="flex gap-2">
            <input className={inp} readOnly value={link} />
            <button onClick={() => { navigator.clipboard.writeText(link); notify('ok', 'リンクをコピーしました') }} className="px-3 rounded-lg border border-gray-300 dark:border-gray-700"><Copy size={14} /></button>
            <a href={link} target="_blank" rel="noreferrer" className="px-3 flex items-center rounded-lg border border-gray-300 dark:border-gray-700"><ExternalLink size={14} /></a>
          </div>
          <label className="block text-sm"><span className="text-gray-600 dark:text-gray-400">担当者の表示名</span>
            <input className={inp} value={f.partner_name || ''} onChange={e => setF({ ...f, partner_name: e.target.value })} onBlur={() => run(() => api.patch('/settings', { partner_name: f.partner_name }), '保存しました')} /></label>
          <button onClick={() => { if (confirm('キーを再発行すると今のリンクは無効になります。よろしいですか？')) run(() => api.patch('/settings', { regenerate_key: true }), 'キーを再発行しました') }} className="text-xs text-red-600 hover:underline">キーを再発行（リンクを無効化）</button>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800 space-y-2">
          <h3 className="text-sm font-semibold">Chatwork</h3>
          <div className="flex gap-2 items-center">
            <input className={inp} placeholder="ルームID" value={f.chatwork_room_id || ''} onChange={e => setF({ ...f, chatwork_room_id: e.target.value })} />
            <button onClick={async () => { try { const r = await api.get('/chatwork/rooms'); setRooms(r.data.rooms) } catch (e) { notify('err', errText(e)) } }} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 whitespace-nowrap">一覧</button>
          </div>
          {rooms.length > 0 && (
            <select className={inp} onChange={e => setF({ ...f, chatwork_room_id: e.target.value })}>
              <option value="">ルームを選択</option>{rooms.map(r => <option key={r.room_id} value={r.room_id}>{r.name}</option>)}
            </select>
          )}
          <label className="block text-sm"><span className="text-gray-600 dark:text-gray-400">資材確認の定型文（末尾に専用リンクが付きます）</span>
            <textarea className={`${inp} h-32`} value={f.chatwork_template || ''} onChange={e => setF({ ...f, chatwork_template: e.target.value })} /></label>
          <button onClick={() => run(() => api.patch('/settings', { chatwork_room_id: f.chatwork_room_id, chatwork_template: f.chatwork_template }), 'Chatwork設定を保存しました')} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-sm"><Save size={14} /> 保存</button>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-800 text-xs text-gray-500 space-y-1">
          <div>Amazon在庫：1日1回自動取得（10分cron内）。販売数：売上・トラフィックレポートを30日／90日窓で1日1回取得。</div>
          <div>最終取得：在庫 {fmtDate(s.last_inventory_sync)}／販売 {s.last_sales_sync_date || '—'}</div>
        </div>
      </div>
    </div>
  )
}
