import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { Boxes, RefreshCw, Save, Plus, CheckCircle, AlertTriangle } from 'lucide-react'

// たお太郎 担当者向けの公開ページ（キー付きURL・認証不要・素のaxios）
const api = axios.create({ baseURL: '/api/public/inventory' })

interface Product { id: string; product: string; color: string; size: string; discontinued: boolean }
interface Lot {
  id: string; lot_code: string | null; product_id: string; qty: number; status: string; ordered_at: string | null
  status_updated_at: string | null; updated_by: string | null; tracking: string | null; note: string | null
  product: string; color: string; size: string
}
interface Material {
  id: string; product: string; name: string; unit: string; quantity: number | null; updated_at: string | null
  updated_by: string | null; note: string | null; pipeline_need: number; need_total: number; state: 'ok' | 'low' | 'short' | 'unknown'
}
interface Ctx { partner_name: string; products: Product[]; lots: Lot[]; materials: Material[]; status_labels: Record<string, string> }

const LOT_STATUSES = ['ordered', 'inspecting', 'ready', 'shipping', 'received', 'cancelled']
const STATUS_CLS: Record<string, string> = {
  ordered: 'bg-orange-50 dark:bg-orange-950/40', inspecting: 'bg-amber-50 dark:bg-amber-950/40', ready: 'bg-emerald-50 dark:bg-emerald-950/40',
  shipping: 'bg-blue-50 dark:bg-blue-950/40', received: 'bg-gray-100 dark:bg-gray-800', cancelled: 'bg-gray-100 dark:bg-gray-800',
}
const MAT_UI = {
  ok: { label: 'OK', cls: 'text-emerald-700' }, low: { label: '要補充', cls: 'text-amber-700' },
  short: { label: '不足', cls: 'text-red-700 font-semibold' }, unknown: { label: '未入力', cls: 'text-gray-500' },
}
const INP = 'px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm'
const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

export default function InventoryPartner() {
  const key = new URLSearchParams(window.location.search).get('k') || ''
  const [ctx, setCtx] = useState<Ctx | null>(null)
  const [loading, setLoading] = useState(true)
  const [invalid, setInvalid] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [who, setWho] = useState(() => localStorage.getItem('inv_partner_name') || '')
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [form, setForm] = useState({ product_id: '', qty: '', lot_code: '', status: 'inspecting', tracking: '', note: '' })

  const load = useCallback(async () => {
    if (!key) { setInvalid(true); setLoading(false); return }
    setLoading(true)
    try { const r = await api.get<Ctx>(`/${key}/context`); setCtx(r.data) }
    catch (e) { const ax = e as { response?: { status?: number } }; if (ax.response?.status === 403) setInvalid(true); else setMsg({ type: 'err', text: '読み込みに失敗しました。再読込してください。' }) }
    setLoading(false)
  }, [key])
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])

  const notify = (type: 'ok' | 'err', text: string) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 5000) }
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    if (!who.trim()) { notify('err', '先に「更新者のお名前」を入力してください'); return }
    localStorage.setItem('inv_partner_name', who)
    try { await fn(); notify('ok', ok); await load() }
    catch (e) { const ax = e as { response?: { data?: { error?: string } }; message?: string }; notify('err', ax.response?.data?.error || ax.message || '失敗しました') }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-500">読み込み中…</div>
  if (invalid) return <div className="min-h-screen flex items-center justify-center text-gray-600 px-6 text-center">このリンクは無効です。FITPEAK（宇良）に新しいリンクをご確認ください。</div>
  if (!ctx) return <div className="min-h-screen flex items-center justify-center text-gray-500 px-6">{msg?.text || '読み込めませんでした'}</div>

  const labels = ctx.status_labels
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-lg bg-teal-50 dark:bg-teal-950/50 text-teal-600 dark:text-teal-400"><Boxes size={26} /></div>
          <div>
            <h1 className="text-xl font-bold">FITPEAK 在庫更新（{ctx.partner_name} 様用）</h1>
            <p className="text-sm text-gray-500">ロットのステータスと資材の残数を更新してください。更新するとFITPEAK側にすぐ反映されます。</p>
          </div>
          <button onClick={load} className="ml-auto flex items-center gap-1 px-3 py-2 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"><RefreshCw size={14} /> 再読込</button>
        </div>

        <div className="mt-4 flex items-center gap-2 text-sm">
          <span className="text-gray-600 dark:text-gray-400">更新者のお名前</span>
          <input className={`${INP} w-40`} value={who} onChange={e => setWho(e.target.value)} placeholder="例：山田" />
        </div>

        {msg && (
          <div className={`mt-4 flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${msg.type === 'ok' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300'}`}>
            {msg.type === 'ok' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />} {msg.text}
          </div>
        )}

        {/* ロット */}
        <h2 className="mt-8 mb-2 text-base font-semibold">1. 在庫の流れ（ロット）</h2>
        <p className="text-xs text-gray-500 mb-3">発注中（生産中）→ 検品・梱包中 → 準備完了在庫 → 輸送中（Amazon倉庫へ国際輸送中）→ Amazon納品済み。作業が進んだらステータスを変えてください。数量が分かれた場合は「ロットを追加」で分けてください。</p>
        <div className="space-y-2">
          {ctx.lots.map(l => (
            <div key={l.id} className={`rounded-lg p-3 border border-gray-200 dark:border-gray-800 ${STATUS_CLS[l.status] || ''}`}>
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-medium min-w-48">{l.product} {l.color} {l.size}</div>
                <div className="text-sm">{l.qty} 個</div>
                {l.lot_code && <div className="text-xs text-gray-500">ロット {l.lot_code}</div>}
                <select className={`${INP} ml-auto`} value={l.status} onChange={e => run(() => api.patch(`/${key}/lots/${l.id}`, { status: e.target.value, updated_by: who }), 'ステータスを更新しました')}>
                  {LOT_STATUSES.map(st => <option key={st} value={st}>{labels[st]}</option>)}
                </select>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span>発注日 {l.ordered_at || '—'}</span><span>更新 {fmtDate(l.status_updated_at)} {l.updated_by || ''}</span>
                <input className={`${INP} flex-1 min-w-48 text-xs`} placeholder="追跡番号・備考" value={edits[l.id] ?? (l.tracking || '')} onChange={e => setEdits({ ...edits, [l.id]: e.target.value })} />
                {edits[l.id] !== undefined && edits[l.id] !== (l.tracking || '') && (
                  <button onClick={() => run(async () => { await api.patch(`/${key}/lots/${l.id}`, { tracking: edits[l.id], updated_by: who }); setEdits(x => { const n = { ...x }; delete n[l.id]; return n }) }, '保存しました')} className="px-2 py-1 rounded bg-teal-600 text-white text-xs"><Save size={12} /></button>
                )}
              </div>
            </div>
          ))}
          {ctx.lots.length === 0 && <div className="text-sm text-gray-500">進行中のロットはありません</div>}
        </div>
        <div className="mt-3 bg-white dark:bg-gray-900 rounded-lg p-3 border border-gray-200 dark:border-gray-800">
          <div className="text-sm font-medium mb-2 flex items-center gap-1"><Plus size={14} /> ロットを追加（分納・別便になった場合）</div>
          <div className="flex flex-wrap gap-2">
            <select className={INP} value={form.product_id} onChange={e => setForm({ ...form, product_id: e.target.value })}>
              <option value="">商品を選択</option>
              {ctx.products.filter(p => !p.discontinued).map(p => <option key={p.id} value={p.id}>{p.product} {p.color} {p.size}</option>)}
            </select>
            <input className={`${INP} w-24`} type="number" placeholder="数量" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} />
            <input className={`${INP} w-28`} placeholder="ロットID" value={form.lot_code} onChange={e => setForm({ ...form, lot_code: e.target.value })} />
            <select className={INP} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
              {LOT_STATUSES.map(st => <option key={st} value={st}>{labels[st]}</option>)}
            </select>
            <input className={`${INP} flex-1 min-w-40`} placeholder="備考" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
            <button onClick={() => run(async () => { await api.post(`/${key}/lots`, { ...form, updated_by: who }); setForm({ ...form, qty: '', lot_code: '', note: '' }) }, 'ロットを追加しました')} className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-sm">追加</button>
          </div>
        </div>

        {/* 資材 */}
        <h2 className="mt-8 mb-2 text-base font-semibold">2. 資材の残数</h2>
        <p className="text-xs text-gray-500 mb-3">梱包で使ったら減らし、新しい資材が届いたら増やしてください。「これから使う数」は今の発注分（生産中・検品中）で使う予定の数です。</p>
        <div className="overflow-x-auto bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/60 text-xs text-gray-500">
              <tr>{['対象商品', '資材', '現在の残数', '状態', 'これから使う数', '最終更新', ''].map(h => <th key={h} className="px-2 py-2 text-left font-medium whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody>
              {ctx.materials.map(m => (
                <tr key={m.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-2 py-2 whitespace-nowrap">{m.product}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{m.name}</td>
                  <td className="px-2 py-2 whitespace-nowrap"><input className={`${INP} w-24 text-right`} type="number" value={edits[`m:${m.id}`] ?? (m.quantity ?? '')} onChange={e => setEdits({ ...edits, [`m:${m.id}`]: e.target.value })} /> {m.unit}</td>
                  <td className={`px-2 py-2 whitespace-nowrap ${MAT_UI[m.state].cls}`}>{MAT_UI[m.state].label}</td>
                  <td className="px-2 py-2 text-right">{m.pipeline_need}</td>
                  <td className="px-2 py-2 text-xs text-gray-500 whitespace-nowrap">{fmtDate(m.updated_at)} {m.updated_by || ''}</td>
                  <td className="px-2 py-2">
                    {edits[`m:${m.id}`] !== undefined && edits[`m:${m.id}`] !== String(m.quantity ?? '') && (
                      <button onClick={() => run(async () => { await api.patch(`/${key}/materials/${m.id}`, { quantity: edits[`m:${m.id}`], updated_by: who }); setEdits(x => { const n = { ...x }; delete n[`m:${m.id}`]; return n }) }, '残数を保存しました')} className="flex items-center gap-1 px-2 py-1 rounded bg-teal-600 text-white text-xs"><Save size={12} /> 保存</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-6 text-xs text-gray-400">FITPEAK（合同会社SVPコーポレーション）在庫管理システム</p>
      </div>
    </div>
  )
}
