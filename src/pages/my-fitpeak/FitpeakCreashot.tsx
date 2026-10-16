import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Zap, CalendarClock, PauseCircle, PlayCircle, Bell, Repeat, ChevronRight, Check, AlertCircle,
  Loader2, MessageCircle, ExternalLink, Package, CreditCard, Link2,
} from 'lucide-react'
import {
  creashotApi, subscriptionApi,
  type CreashotOverview, type CreashotSubscription, type CreashotPlan, type CreashotReminder, type CancelOffer,
} from './lib/subscription-api'

const LIME = '#B8CE0C'
const GREEN = '#3F9403'

function fmt(d: string | null | undefined) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${y}年${Number(m)}月${Number(day)}日`
}
function yen(v: number | null | undefined) {
  return v === null || v === undefined ? '—' : `¥${Number(v).toLocaleString('ja-JP')}`
}
const DOW = ['月', '火', '水', '木', '金', '土', '日']

export default function FitpeakCreashot() {
  const [data, setData] = useState<CreashotOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      setData(await creashotApi.overview())
    } catch (e) {
      setError((e as Error).message || '読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // LINEの「飲んだ！を記録」から来た場合は、その場で記録する
  useEffect(() => {
    if (searchParams.get('intake') !== '1') return
    creashotApi.intake().then(() => {
      setToast('今日の1本を記録しました')
      searchParams.delete('intake')
      setSearchParams(searchParams, { replace: true })
      load()
    }).catch(() => {})
  }, [searchParams, setSearchParams, load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 4000)
    return () => clearTimeout(t)
  }, [toast])

  if (loading) {
    return (
      <div className="py-20 flex justify-center">
        <div className="w-8 h-8 border-2 border-[#111] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const subs = data?.subscriptions || []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#111] flex items-center gap-2">
          <Zap size={22} style={{ color: LIME }} /> クレアショット
        </h1>
        <p className="mt-1 text-sm text-[#6b6b6b]">お届け日の調整・休会・プラン変更・毎日の通知は、すべてここから。</p>
      </div>

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 rounded-full bg-white border border-[#e6e6e6] px-4 py-2 text-sm text-[#111] shadow-xl flex items-center gap-2">
          <Check size={15} className="text-[#047d3b]" /> {toast}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-[#c8102e] flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {data && !data.line_linked && (
        <LineNudge url={data.line_add_url} />
      )}

      {data && subs.length === 0 && !error && <EmptyCard onLinked={load} />}

      {data && subs.map((sub) => (
        <SubscriptionCard key={sub.id} sub={sub} data={data} onChanged={load} onToast={setToast} />
      ))}

      {data && subs.length > 0 && (
        <ReminderCard data={data} onChanged={load} onToast={setToast} />
      )}
    </div>
  )
}

/* ─────────────────────────── LINE連携の案内 ─────────────────────────── */

function LineNudge({ url }: { url: string }) {
  return (
    <div className="rounded-xl border border-[#06C755]/30 bg-[#06C755]/10 p-4 flex items-start gap-3">
      <MessageCircle size={20} className="text-[#06C755] shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-[#111]">公式LINEと連携すると、毎日の「飲むタイミング通知」が使えます</p>
        <p className="mt-1 text-xs text-[#6b6b6b]">友だち追加 → メニューの「会員登録」で、ご注文時のメールアドレスを入力してください。</p>
        <a href={url} target="_blank" rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#06C755] text-white text-sm font-semibold hover:opacity-90 transition">
          FITPEAK公式LINEを友だち追加 <ExternalLink size={14} />
        </a>
      </div>
    </div>
  )
}

/* ─────────────────────────── 契約がないとき ─────────────────────────── */

function EmptyCard({ onLinked }: { onLinked: () => void }) {
  const [orderNumber, setOrderNumber] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  async function submit() {
    if (!orderNumber.trim()) return
    setBusy(true); setErr(''); setMsg('')
    try {
      const { linked } = await subscriptionApi.claim(orderNumber)
      setMsg(`${linked}件の定期購入を紐づけました`)
      onLinked()
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div className="rounded-xl border border-[#e6e6e6] bg-white p-6 text-center">
      <Package size={28} className="mx-auto text-[#9a9a9a]" />
      <p className="mt-3 text-[#444]">クレアショットの定期購入がまだ見つかりません</p>
      <p className="mt-1 text-sm text-[#9a9a9a]">
        ご購入時のメールアドレスがログイン中のものと異なる場合は、注文番号で紐づけできます。
      </p>
      <div className="mt-5 flex gap-2 max-w-sm mx-auto">
        <input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="注文番号（例: 1234）"
          className="flex-1 min-w-0 w-full px-3 py-2.5 rounded-lg bg-[#f5f5f7] border border-[#e6e6e6] text-sm text-[#111] placeholder:text-[#9a9a9a]" />
        <button onClick={submit} disabled={busy}
          className="shrink-0 whitespace-nowrap px-4 py-2.5 rounded-lg bg-[#ececec] text-[#111] text-sm hover:bg-[#e0e0e0] transition disabled:opacity-50 flex items-center gap-2">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />} 紐づける
        </button>
      </div>
      {msg && <p className="mt-3 text-sm text-[#047d3b]">{msg}</p>}
      {err && <p className="mt-3 text-sm text-[#c8102e]">{err}</p>}
      <a href="https://fitpeak.co/products/持ち運びクレアチン-creashot" className="mt-5 inline-flex items-center gap-1 text-xs text-[#111] hover:underline">
        クレアショットの定期購入はこちら <ChevronRight size={12} />
      </a>
    </div>
  )
}

/* ─────────────────────────── 契約カード ─────────────────────────── */

type Modal = null | 'reschedule' | 'pause' | 'plan' | 'cancel'

function SubscriptionCard({ sub, data, onChanged, onToast }: {
  sub: CreashotSubscription
  data: CreashotOverview
  onChanged: () => void
  onToast: (s: string) => void
}) {
  const [modal, setModal] = useState<Modal>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')

  const statusTone =
    sub.status === 'past_due' ? 'bg-red-500/15 text-[#c8102e]'
      : sub.status === 'cancelled' ? 'bg-[#f5f5f7] text-[#6b6b6b]'
        : sub.status === 'paused' ? 'bg-amber-500/15 text-[#a15c00]'
          : sub.status === 'active' ? 'bg-emerald-500/15 text-[#047d3b]'
            : 'bg-[#f3f3f3] text-[#111]'

  const rem = sub.remaining
  const pct = rem ? Math.max(0, Math.min(100, Math.round((rem.remaining_sticks / rem.total_sticks) * 100))) : null

  async function intake() {
    setBusy('intake'); setErr('')
    try { await creashotApi.intake(); onToast('今日の1本を記録しました'); onChanged() }
    catch (e) { setErr((e as Error).message) }
    finally { setBusy('') }
  }

  async function resume() {
    setBusy('resume'); setErr('')
    try {
      const r = await creashotApi.resume(sub.id)
      onToast(`再開しました。次回お届け予定：${fmt(r.next_delivery_date)}`)
      onChanged()
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy('') }
  }

  return (
    <div className="rounded-xl border border-[#e6e6e6] bg-white overflow-hidden">
      {/* ヘッダー */}
      <div className="p-5" style={{ background: `linear-gradient(135deg, ${GREEN}22, transparent 60%)` }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[#111] font-semibold">{sub.plan_name}</h2>
              <span className={`px-2 py-0.5 rounded-full text-xs ${statusTone}`}>{sub.status_label}</span>
              {sub.is_preorder && <span className="px-2 py-0.5 rounded-full text-xs bg-violet-500/15 text-violet-300">予約</span>}
            </div>
            <p className="mt-1 text-sm text-[#6b6b6b]">
              1日{sub.sticks_per_day}本 ／ 1回 {sub.bags_per_cycle}袋（{sub.bags_per_cycle * 28}本） ／ {yen(sub.price ?? sub.amount)}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-[#f5f5f7] p-3">
            <p className="text-xs text-[#6b6b6b]">次回お届け予定</p>
            <p className="mt-1 text-[#111] font-medium">
              {sub.status === 'paused'
                ? (sub.paused_until ? `${fmt(sub.paused_until)} に再開` : '休会中')
                : sub.schedule_pending ? (sub.preorder_note || '初回お届け後に確定') : fmt(sub.next_delivery_date)}
            </p>
          </div>
          <div className="rounded-lg bg-[#f5f5f7] p-3">
            <p className="text-xs text-[#6b6b6b]">次回お支払い</p>
            <p className="mt-1 text-[#111] font-medium">
              {sub.status === 'paused' ? '休会中（課金なし）' : sub.schedule_pending ? '初回お届け後に確定' : fmt(sub.next_billing_date)}
            </p>
          </div>
        </div>

        {sub.schedule_pending && sub.status === 'pending_first_shipment' && (
          <p className="mt-3 text-xs text-[#6b6b6b]">
            初回のお届けが完了した時点で、次回のお届け日が自動的に決まります。
            {sub.preorder_first_ship_date && `（初回発送予定: ${fmt(sub.preorder_first_ship_date)}）`}
          </p>
        )}

        {sub.status === 'past_due' && (
          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-[#c8102e] flex items-center justify-between gap-2">
            <span>お支払いを確認できませんでした。</span>
            <button onClick={() => subscriptionApi.paymentUpdate(sub.id).then(() => onToast('更新リンクをメールでお送りしました')).catch((e) => setErr(e.message))}
              className="shrink-0 inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-[#ececec] hover:bg-[#e0e0e0] text-[#111]">
              <CreditCard size={13} /> お支払い方法を更新
            </button>
          </div>
        )}
      </div>

      {/* 残量 */}
      {rem && sub.status !== 'cancelled' && (
        <div className="px-5 pb-5">
          <div className="rounded-xl border border-[#e6e6e6] bg-white p-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs text-[#6b6b6b]">手元の残り（目安）</p>
                <p className="mt-0.5 text-2xl font-bold text-[#111]">
                  {rem.remaining_sticks}<span className="text-sm font-normal text-[#6b6b6b] ml-1">本 ／ {rem.total_sticks}本</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-[#6b6b6b]">飲み切る日</p>
                <p className="text-sm text-[#111] font-medium">{fmt(rem.runs_out_on)}</p>
              </div>
            </div>
            <div className="mt-3 h-2 rounded-full bg-[#ececec] overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${GREEN}, ${LIME})` }} />
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="text-xs text-[#9a9a9a]">
                前回お届けから1日{sub.sticks_per_day}本で計算しています。ずれていたら「残りの本数を入力」で合わせられます。
              </p>
              <button onClick={intake} disabled={!!busy}
                className="shrink-0 inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg text-black font-semibold disabled:opacity-50"
                style={{ background: LIME }}>
                {busy === 'intake' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} 今日飲んだ
              </button>
            </div>
          </div>
        </div>
      )}

      {err && (
        <p className="px-5 pb-3 text-sm text-[#c8102e] flex items-start gap-2"><AlertCircle size={15} className="mt-0.5 shrink-0" /> {err}</p>
      )}

      {/* 操作 */}
      {sub.status !== 'cancelled' && (
        <div className="px-5 pb-5 grid grid-cols-2 gap-2">
          {sub.can_reschedule && (
            <ActionButton icon={<CalendarClock size={16} />} title="残りの本数を入力" sub="飲み切る日に次を届ける" onClick={() => setModal('reschedule')} primary />
          )}
          {sub.can_pause && (
            <ActionButton icon={<PauseCircle size={16} />} title="休会する" sub="再開まで課金を止める" onClick={() => setModal('pause')} />
          )}
          {sub.can_resume && (
            <ActionButton icon={busy === 'resume' ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />} title="再開する" sub="最短でお届け" onClick={resume} primary />
          )}
          {sub.can_change_plan && (
            <ActionButton icon={<Repeat size={16} />} title="プランを変更" sub="本数・お届け周期" onClick={() => setModal('plan')} />
          )}
          {sub.can_cancel && (
            <ActionButton icon={<ChevronRight size={16} />} title="解約する" sub="理由をお聞かせください" onClick={() => setModal('cancel')} muted />
          )}
        </div>
      )}

      {modal === 'reschedule' && (
        <RescheduleModal sub={sub} onClose={() => setModal(null)} onDone={(m) => { setModal(null); onToast(m); onChanged() }} />
      )}
      {modal === 'pause' && (
        <PauseModal sub={sub} today={data.today} onClose={() => setModal(null)} onDone={(m) => { setModal(null); onToast(m); onChanged() }} />
      )}
      {modal === 'plan' && (
        <PlanModal sub={sub} plans={data.plans} onClose={() => setModal(null)} onDone={(m) => { setModal(null); onToast(m); onChanged() }} />
      )}
      {modal === 'cancel' && (
        <CancelFlowModal sub={sub} data={data} onClose={() => setModal(null)}
          onDone={(m) => { setModal(null); onToast(m); onChanged() }} />
      )}
    </div>
  )
}

function ActionButton({ icon, title, sub, onClick, primary, muted }: {
  icon: React.ReactNode; title: string; sub: string; onClick: () => void; primary?: boolean; muted?: boolean
}) {
  return (
    <button onClick={onClick}
      className={`text-left rounded-xl p-3.5 border transition ${
        primary ? 'border-[#B8CE0C]/40 bg-[#B8CE0C]/10 hover:bg-[#B8CE0C]/15'
          : muted ? 'border-[#e6e6e6] bg-transparent hover:bg-[#f5f5f7]'
            : 'border-[#e6e6e6] bg-[#f5f5f7] hover:bg-[#ececec]'}`}>
      <div className={`flex items-center gap-2 text-sm font-semibold ${muted ? 'text-[#6b6b6b]' : 'text-[#111]'}`}>
        <span style={{ color: primary ? LIME : undefined }}>{icon}</span>{title}
      </div>
      <p className="mt-1 text-xs text-[#6b6b6b]">{sub}</p>
    </button>
  )
}

/* ─────────────────────────── モーダル共通 ─────────────────────────── */

function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-2xl border border-[#e6e6e6] bg-white p-6" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

/* ─────────────────────────── 休会（残量から再設定） ─────────────────────────── */

function RescheduleModal({ sub, onClose, onDone }: { sub: CreashotSubscription; onClose: () => void; onDone: (msg: string) => void }) {
  const [sticks, setSticks] = useState<number>(sub.remaining?.remaining_sticks ?? 0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const days = Math.ceil(sticks / Math.max(1, sub.sticks_per_day))
  const eta = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() + Math.max(days, 3))
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
  }, [days])

  async function submit() {
    setBusy(true); setErr('')
    try {
      const r = await creashotApi.reschedule(sub.id, sticks)
      onDone(`次回お届けを${fmt(r.next_delivery_date)}に設定しました（お支払いは${fmt(r.next_billing_date)}）`)
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <Sheet onClose={onClose}>
      <h3 className="text-[#111] font-semibold text-lg">残りの本数を入力</h3>
      <p className="mt-1 text-sm text-[#6b6b6b]">手元に残っている本数に合わせて、飲み切る頃に次の袋が届くよう調整します。</p>
      <div className="mt-5 flex items-center justify-center gap-4">
        <button onClick={() => setSticks((s) => Math.max(0, s - 1))} className="w-11 h-11 rounded-full bg-[#ececec] text-[#111] text-xl">−</button>
        <input type="number" min={0} max={999} value={sticks} onChange={(e) => setSticks(Math.max(0, Number(e.target.value) || 0))}
          className="w-24 text-center text-3xl font-bold bg-transparent text-[#111] border-b border-[#e6e6e6] focus:outline-none" />
        <button onClick={() => setSticks((s) => Math.min(999, s + 1))} className="w-11 h-11 rounded-full bg-[#ececec] text-[#111] text-xl">＋</button>
      </div>
      <p className="mt-2 text-center text-xs text-[#6b6b6b]">本</p>
      <div className="mt-5 rounded-xl bg-[#f5f5f7] p-4 text-sm">
        <div className="flex justify-between"><span className="text-[#6b6b6b]">1日の本数</span><span className="text-[#111]">{sub.sticks_per_day}本</span></div>
        <div className="flex justify-between mt-1"><span className="text-[#6b6b6b]">飲み切るまで</span><span className="text-[#111]">約{days}日</span></div>
        <div className="flex justify-between mt-1"><span className="text-[#6b6b6b]">次回お届け（目安）</span><span className="text-[#111] font-medium">{eta}</span></div>
        <p className="mt-2 text-xs text-[#9a9a9a]">お支払いはお届け予定日の3日前に自動で行われます。それまでにいつでも変更できます。</p>
      </div>
      {err && <p className="mt-3 text-sm text-[#c8102e]">{err}</p>}
      <div className="mt-5 flex gap-2">
        <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg border border-[#e6e6e6] text-[#444] text-sm hover:bg-[#f5f5f7]">やめる</button>
        <button onClick={submit} disabled={busy} className="flex-1 px-4 py-2.5 rounded-lg text-black text-sm font-semibold disabled:opacity-50" style={{ background: LIME }}>
          {busy ? '設定中…' : 'この内容で設定する'}
        </button>
      </div>
    </Sheet>
  )
}

/* ─────────────────────────── 休会（再開日未定） ─────────────────────────── */

function PauseModal({ sub, today, onClose, onDone }: { sub: CreashotSubscription; today: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [resumeDate, setResumeDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    setBusy(true); setErr('')
    try {
      const r = await creashotApi.pause(sub.id, resumeDate || undefined)
      onDone(r.paused_until ? `休会にしました。${fmt(r.paused_until)}に自動で再開します` : '休会にしました。再開はいつでもこの画面から')
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <Sheet onClose={onClose}>
      <h3 className="text-[#111] font-semibold text-lg">休会する</h3>
      <p className="mt-1 text-sm text-[#6b6b6b]">休会中はお届けも課金もありません。再開日を決めておくと、その日に合わせて自動で再開します。</p>
      <label className="block mt-5 text-xs text-[#6b6b6b]">再開日（任意）</label>
      <input type="date" min={today} value={resumeDate} onChange={(e) => setResumeDate(e.target.value)}
        className="mt-1 w-full px-3 py-2.5 rounded-lg bg-[#f5f5f7] border border-[#e6e6e6] text-sm text-[#111]" />
      <p className="mt-2 text-xs text-[#9a9a9a]">空欄のままなら、再開するまで止まります。</p>
      {err && <p className="mt-3 text-sm text-[#c8102e]">{err}</p>}
      <div className="mt-5 flex gap-2">
        <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg border border-[#e6e6e6] text-[#444] text-sm hover:bg-[#f5f5f7]">やめる</button>
        <button onClick={submit} disabled={busy} className="flex-1 px-4 py-2.5 rounded-lg bg-amber-500/20 text-[#a15c00] text-sm font-semibold hover:bg-amber-500/30 disabled:opacity-50">
          {busy ? '処理中…' : '休会にする'}
        </button>
      </div>
    </Sheet>
  )
}

/* ─────────────────────────── プラン変更 ─────────────────────────── */

function PlanModal({ sub, plans, onClose, onDone }: { sub: CreashotSubscription; plans: CreashotPlan[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [sticks, setSticks] = useState<number>(sub.sticks_per_day || 1)
  const [code, setCode] = useState<string>(sub.plan_code || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const list = plans.filter((p) => p.sticks_per_day === sticks)

  async function submit() {
    if (!code || code === sub.plan_code) { onClose(); return }
    setBusy(true); setErr('')
    try {
      const r = await creashotApi.changePlan(sub.id, code)
      onDone(`プランを「${r.plan.display_name}」に変更しました。次回のお届けから適用されます`)
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <Sheet onClose={onClose}>
      <h3 className="text-[#111] font-semibold text-lg">プランを変更</h3>
      <p className="mt-1 text-sm text-[#6b6b6b]">次回のお届けから新しいプランになります。次回お届け日はそのままです。</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {[1, 2].map((n) => (
          <button key={n} onClick={() => { setSticks(n); setCode('') }}
            className={`rounded-lg px-3 py-2.5 text-sm font-semibold border ${sticks === n ? 'border-[#B8CE0C] text-black' : 'border-[#e6e6e6] text-[#444]'}`}
            style={sticks === n ? { background: LIME } : undefined}>
            1日{n}本
          </button>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        {list.map((p) => (
          <label key={p.plan_code} className={`flex items-center gap-3 px-3 py-3 rounded-xl border cursor-pointer ${code === p.plan_code ? 'border-[#B8CE0C]/60 bg-[#B8CE0C]/10' : 'border-[#e6e6e6] bg-[#f5f5f7]'}`}>
            <input type="radio" name="plan" checked={code === p.plan_code} onChange={() => setCode(p.plan_code)} />
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#111] font-semibold">{p.interval_label}（{p.bags_per_cycle}袋）</span>
                <span className="text-sm text-[#111]">{yen(p.price)}</span>
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-xs text-[#6b6b6b]">1袋あたり {yen(p.price_per_bag)}{p.free_bags ? `・${p.free_bags}袋無料` : ''}</span>
                {p.plan_code === sub.plan_code && <span className="text-xs text-[#111]">現在のプラン</span>}
              </div>
            </div>
          </label>
        ))}
      </div>
      {err && <p className="mt-3 text-sm text-[#c8102e]">{err}</p>}
      <div className="mt-5 flex gap-2">
        <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg border border-[#e6e6e6] text-[#444] text-sm hover:bg-[#f5f5f7]">やめる</button>
        <button onClick={submit} disabled={busy || !code || code === sub.plan_code}
          className="flex-1 px-4 py-2.5 rounded-lg text-black text-sm font-semibold disabled:opacity-40" style={{ background: LIME }}>
          {busy ? '変更中…' : 'このプランに変更'}
        </button>
      </div>
    </Sheet>
  )
}

/* ─────────────────────────── 解約フロー ─────────────────────────── */

function CancelFlowModal({ sub, data, onClose, onDone }: {
  sub: CreashotSubscription; data: CreashotOverview; onClose: () => void; onDone: (msg: string) => void
}) {
  const [step, setStep] = useState<'reason' | 'offer' | 'confirm' | 'reschedule' | 'pause' | 'plan'>('reason')
  const [reasonId, setReasonId] = useState('')
  const [note, setNote] = useState('')
  const [offers, setOffers] = useState<CancelOffer[]>([])
  const [contactRequired, setContactRequired] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function next() {
    if (!reasonId) { setErr('解約の理由をお選びください'); return }
    setBusy(true); setErr('')
    try {
      const r = await creashotApi.cancelOptions(sub.id, reasonId)
      setOffers(r.offers); setContactRequired(r.contact_required)
      setStep(r.offers.length ? 'offer' : 'confirm')
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  async function confirmCancel() {
    setBusy(true); setErr('')
    try {
      await subscriptionApi.cancel(sub.id, reasonId, note)
      onDone('解約を受け付けました。ご利用ありがとうございました')
    } catch (e) {
      const ex = e as Error & { body?: { contact_required?: boolean } }
      setErr(ex.message)
    } finally { setBusy(false) }
  }

  if (step === 'reschedule') return <RescheduleModal sub={sub} onClose={onClose} onDone={onDone} />
  if (step === 'pause') return <PauseModal sub={sub} today={data.today} onClose={onClose} onDone={onDone} />
  if (step === 'plan') return <PlanModal sub={sub} plans={data.plans} onClose={onClose} onDone={onDone} />

  return (
    <Sheet onClose={onClose}>
      {step === 'reason' && (
        <>
          <h3 className="text-[#111] font-semibold text-lg">解約の理由を教えてください</h3>
          <p className="mt-1 text-sm text-[#6b6b6b]">理由に合わせて、解約以外の選択肢もご案内します。</p>
          <div className="mt-4 space-y-2">
            {data.cancel_reasons.map((r) => (
              <label key={r.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[#f5f5f7] cursor-pointer hover:bg-[#ececec]">
                <input type="radio" name="reason" checked={reasonId === r.id} onChange={() => setReasonId(r.id)} />
                <span className="text-sm text-[#444]">{r.label}</span>
              </label>
            ))}
          </div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="もしよろしければ、詳しくお聞かせください（任意）"
            className="mt-3 w-full px-3 py-2.5 rounded-lg bg-[#f5f5f7] border border-[#e6e6e6] text-sm text-[#111] placeholder:text-[#9a9a9a]" />
          {err && <p className="mt-3 text-sm text-[#c8102e]">{err}</p>}
          <div className="mt-5 flex gap-2">
            <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg border border-[#e6e6e6] text-[#444] text-sm hover:bg-[#f5f5f7]">やめる</button>
            <button onClick={next} disabled={busy} className="flex-1 px-4 py-2.5 rounded-lg bg-[#ececec] text-[#111] text-sm font-semibold hover:bg-[#e0e0e0] disabled:opacity-50">
              {busy ? '確認中…' : '次へ'}
            </button>
          </div>
        </>
      )}

      {step === 'offer' && (
        <>
          <h3 className="text-[#111] font-semibold text-lg">解約の前に、こんな方法もあります</h3>
          <div className="mt-4 space-y-2">
            {offers.map((o, i) => (
              <button key={i}
                onClick={() => setStep(o.type === 'reschedule' ? 'reschedule' : o.type === 'pause' ? 'pause' : 'plan')}
                className="w-full text-left rounded-xl border border-[#B8CE0C]/40 bg-[#B8CE0C]/10 p-4 hover:bg-[#B8CE0C]/15">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-[#111]">{o.title}</span>
                  <ChevronRight size={16} style={{ color: LIME }} />
                </div>
                {o.message && <p className="mt-1 text-xs text-[#6b6b6b]">{o.message}</p>}
              </button>
            ))}
          </div>
          <div className="mt-5 flex gap-2">
            <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg border border-[#e6e6e6] text-[#444] text-sm hover:bg-[#f5f5f7]">続ける</button>
            <button onClick={() => setStep('confirm')} className="flex-1 px-4 py-2.5 rounded-lg text-[#6b6b6b] text-sm hover:text-[#444]">それでも解約する</button>
          </div>
        </>
      )}

      {step === 'confirm' && (
        <>
          <h3 className="text-[#111] font-semibold text-lg">本当に解約しますか？</h3>
          {contactRequired ? (
            <p className="mt-2 text-sm text-[#444]">
              初回お届け前の解約は個別対応となります。お手数ですが公式LINEまたはメールでご連絡ください。
            </p>
          ) : (
            <p className="mt-2 text-sm text-[#444]">
              解約すると次回以降のお届けと課金は停止します。お支払い済みの分は予定どおりお届けします。
            </p>
          )}
          {err && <p className="mt-3 text-sm text-[#c8102e]">{err}</p>}
          <div className="mt-5 flex gap-2">
            <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg border border-[#e6e6e6] text-[#444] text-sm hover:bg-[#f5f5f7]">やめる</button>
            {!contactRequired && (
              <button onClick={confirmCancel} disabled={busy} className="flex-1 px-4 py-2.5 rounded-lg bg-red-500/20 text-[#c8102e] text-sm font-semibold hover:bg-red-500/30 disabled:opacity-50">
                {busy ? '処理中…' : '解約する'}
              </button>
            )}
          </div>
        </>
      )}
    </Sheet>
  )
}

/* ─────────────────────────── 通知設定 ─────────────────────────── */

function ReminderCard({ data, onChanged, onToast }: { data: CreashotOverview; onChanged: () => void; onToast: (s: string) => void }) {
  const [r, setR] = useState<CreashotReminder>(data.reminder)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const dirty = JSON.stringify(r) !== JSON.stringify(data.reminder)

  async function save(next?: CreashotReminder) {
    const payload = next || r
    setBusy(true); setErr('')
    try {
      await creashotApi.saveReminder(payload)
      onToast(payload.enabled ? `毎日 ${payload.time_jst} にLINEでお知らせします` : '通知をオフにしました')
      onChanged()
    } catch (e) {
      const ex = e as Error & { body?: { line_required?: boolean } }
      setErr(ex.message)
      if (ex.body?.line_required) setR({ ...payload, enabled: false })
    } finally { setBusy(false) }
  }

  function toggleDay(d: number) {
    const set = new Set(r.days_of_week)
    if (set.has(d)) set.delete(d); else set.add(d)
    setR({ ...r, days_of_week: Array.from(set).sort() })
  }

  return (
    <div id="reminder" className="rounded-xl border border-[#e6e6e6] bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bell size={18} className="text-[#06C755]" />
          <div>
            <h2 className="text-[#111] font-semibold">毎日の「飲むタイミング」通知</h2>
            <p className="text-xs text-[#6b6b6b]">決めた時間に公式LINEでお知らせ。飲み忘れをなくします。</p>
          </div>
        </div>
        <button
          onClick={() => { const next = { ...r, enabled: !r.enabled }; setR(next); save(next) }}
          disabled={busy || (!r.enabled && !data.line_linked)}
          className={`relative w-12 h-7 rounded-full transition ${r.enabled ? 'bg-[#06C755]' : 'bg-[#e0e0e0]'} disabled:opacity-50`}>
          <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white transition ${r.enabled ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>

      {!data.line_linked && (
        <p className="mt-3 text-xs text-[#a15c00]">通知を使うには、先に公式LINEとの連携が必要です（上の案内から1分で完了します）。</p>
      )}

      <div className={`mt-4 space-y-4 ${r.enabled ? '' : 'opacity-50'}`}>
        <div>
          <label className="text-xs text-[#6b6b6b]">通知する時間（トレ前・朝など）</label>
          <input type="time" value={r.time_jst} onChange={(e) => setR({ ...r, time_jst: e.target.value })}
            className="mt-1 w-full px-3 py-2.5 rounded-lg bg-[#f5f5f7] border border-[#e6e6e6] text-[#111] text-lg font-semibold" />
        </div>
        <div>
          <label className="text-xs text-[#6b6b6b]">通知する曜日</label>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {DOW.map((label, i) => {
              const d = i + 1
              const on = r.days_of_week.includes(d)
              return (
                <button key={d} onClick={() => toggleDay(d)}
                  className={`py-2 rounded-lg text-sm font-semibold border ${on ? 'border-[#06C755] bg-[#06C755]/20 text-[#111]' : 'border-[#e6e6e6] text-[#6b6b6b]'}`}>
                  {label}
                </button>
              )
            })}
          </div>
        </div>
        <div>
          <label className="text-xs text-[#6b6b6b]">メッセージ（空欄なら既定文）</label>
          <input value={r.message || ''} onChange={(e) => setR({ ...r, message: e.target.value })} placeholder={data.reminder_default_message}
            className="mt-1 w-full px-3 py-2.5 rounded-lg bg-[#f5f5f7] border border-[#e6e6e6] text-sm text-[#111] placeholder:text-[#9a9a9a]" />
        </div>
        {err && <p className="text-sm text-[#c8102e]">{err}</p>}
        {dirty && (
          <button onClick={() => save()} disabled={busy}
            className="w-full px-4 py-2.5 rounded-lg bg-[#06C755] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} 設定を保存
          </button>
        )}
      </div>
    </div>
  )
}
