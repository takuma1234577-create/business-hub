import { useCallback, useEffect, useState } from 'react'
import { Repeat, CalendarClock, CreditCard, ChevronDown, ChevronUp, Loader2, Check, AlertCircle, Link2 } from 'lucide-react'
import {
  subscriptionApi,
  type PortalSubscription,
  type PortalHistory,
  type PortalSettings,
} from './lib/subscription-api'

const CYCLE_LABEL: Record<string, string> = {
  scheduled: 'お届け予定',
  billed: 'お支払い済み',
  shipped: '発送済み',
  delivered: 'お届け済み',
  skipped: 'スキップ',
  failed: 'お支払い確認中',
  retrying: 'お支払い確認中',
  cancelled: 'キャンセル',
}

function fmt(d: string | null) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${y}年${Number(m)}月${Number(day)}日`
}
function yen(v: number | null) {
  return v === null || v === undefined ? '—' : `¥${Number(v).toLocaleString('ja-JP')}`
}

export default function FitpeakSubscriptions() {
  const [subs, setSubs] = useState<PortalSubscription[]>([])
  const [settings, setSettings] = useState<PortalSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [{ subscriptions }, s] = await Promise.all([subscriptionApi.list(), subscriptionApi.settings()])
      setSubs(subscriptions)
      setSettings(s)
    } catch (e) {
      setError((e as Error).message || '読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="py-20 flex justify-center">
        <div className="w-8 h-8 border-2 border-[#111] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#111] flex items-center gap-2">
          <Repeat size={22} className="text-[#111]" /> 定期購入
        </h1>
        <p className="mt-1 text-sm text-[#6b6b6b]">お届け予定の確認、1週間のスキップ、解約はこちらから。</p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-[#c8102e] flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {subs.length === 0 && !error && <ClaimCard onLinked={load} />}

      {subs.map((sub) => (
        <SubscriptionCard
          key={sub.id}
          sub={sub}
          settings={settings}
          expanded={expanded === sub.id}
          onToggle={() => setExpanded(expanded === sub.id ? null : sub.id)}
          onChanged={load}
        />
      ))}
    </div>
  )
}

function SubscriptionCard({
  sub, settings, expanded, onToggle, onChanged,
}: {
  sub: PortalSubscription
  settings: PortalSettings | null
  expanded: boolean
  onToggle: () => void
  onChanged: () => void
}) {
  const [history, setHistory] = useState<PortalHistory[]>([])
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [showCancel, setShowCancel] = useState(false)

  useEffect(() => {
    if (!expanded) return
    subscriptionApi.detail(sub.id).then(({ history }) => setHistory(history)).catch(() => {})
  }, [expanded, sub.id])

  async function skip() {
    setBusy('skip'); setMsg(''); setErr('')
    try {
      const { subscription } = await subscriptionApi.skip(sub.id)
      setMsg(`次回のお届けを${fmt(subscription.next_delivery_date)}に変更しました`)
      onChanged()
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy('') }
  }

  async function paymentUpdate() {
    setBusy('pay'); setMsg(''); setErr('')
    try {
      const { sent_to } = await subscriptionApi.paymentUpdate(sub.id)
      setMsg(`${sent_to} にお支払い方法の更新リンクをお送りしました`)
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy('') }
  }

  const statusTone =
    sub.status === 'past_due' ? 'bg-red-500/15 text-[#c8102e]'
      : sub.status === 'cancelled' ? 'bg-[#f5f5f7] text-[#6b6b6b]'
        : sub.status === 'active' ? 'bg-emerald-500/15 text-emerald-300'
          : 'bg-[#f3f3f3] text-[#111]'

  return (
    <div className="rounded-xl border border-[#e6e6e6] bg-white overflow-hidden">
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[#111] font-semibold">{sub.plan_name}</h2>
              <span className={`px-2 py-0.5 rounded-full text-xs ${statusTone}`}>{sub.status_label}</span>
              {sub.is_preorder && <span className="px-2 py-0.5 rounded-full text-xs bg-violet-500/15 text-violet-300">予約</span>}
            </div>
            <p className="mt-1 text-sm text-[#6b6b6b]">{sub.interval_days}日ごとにお届け / {yen(sub.amount)}</p>
          </div>
          <button onClick={onToggle} className="p-2 rounded-lg text-[#6b6b6b] hover:text-[#111] hover:bg-[#f5f5f7] transition shrink-0">
            {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-[#f5f5f7] p-3">
            <p className="text-xs text-[#6b6b6b]">次回お届け予定</p>
            <p className="mt-1 text-[#111] font-medium">
              {sub.schedule_pending
                ? (sub.preorder_note || '初回お届け後に確定します')
                : fmt(sub.next_delivery_date)}
            </p>
          </div>
          <div className="rounded-lg bg-[#f5f5f7] p-3">
            <p className="text-xs text-[#6b6b6b]">次回お支払い</p>
            <p className="mt-1 text-[#111] font-medium">
              {sub.schedule_pending ? '初回お届け後に確定' : fmt(sub.next_billing_date)}
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
          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-[#c8102e]">
            お支払いを確認できませんでした。お支払い方法をご確認ください。
          </div>
        )}

        {(msg || err) && (
          <p className={`mt-3 text-sm flex items-start gap-2 ${err ? 'text-[#c8102e]' : 'text-emerald-300'}`}>
            {err ? <AlertCircle size={15} className="mt-0.5 shrink-0" /> : <Check size={15} className="mt-0.5 shrink-0" />}
            {err || msg}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {sub.can_skip && (
            <button
              onClick={skip}
              disabled={!!busy}
              className="px-4 py-2.5 rounded-lg bg-[#ececec] text-[#111] text-sm font-medium hover:bg-[#e0e0e0] transition disabled:opacity-50 flex items-center gap-2"
            >
              {busy === 'skip' ? <Loader2 size={15} className="animate-spin" /> : <CalendarClock size={15} />}
              {settings?.skip.days ?? 7}日スキップ
            </button>
          )}
          {sub.status !== 'cancelled' && (
            <button
              onClick={paymentUpdate}
              disabled={!!busy}
              className="px-4 py-2.5 rounded-lg border border-[#e6e6e6] text-[#444] text-sm hover:bg-[#f5f5f7] transition disabled:opacity-50 flex items-center gap-2"
            >
              {busy === 'pay' ? <Loader2 size={15} className="animate-spin" /> : <CreditCard size={15} />}
              お支払い方法を更新
            </button>
          )}
          {sub.can_cancel && (
            <button
              onClick={() => setShowCancel(true)}
              className="px-4 py-2.5 rounded-lg text-[#6b6b6b] text-sm hover:text-[#444] transition"
            >
              解約する
            </button>
          )}
        </div>

        {sub.consecutive_skips > 0 && (
          <p className="mt-3 text-xs text-[#9a9a9a]">
            連続スキップ {sub.consecutive_skips} / {sub.max_consecutive_skips} 回
          </p>
        )}
      </div>

      {expanded && (
        <div className="border-t border-[#e6e6e6] p-5">
          <h3 className="text-sm font-medium text-[#444] mb-3">お届け履歴</h3>
          <div className="space-y-2">
            {history.length === 0 && <p className="text-sm text-[#9a9a9a]">まだ履歴がありません</p>}
            {history.map((h) => (
              <div key={h.cycle_no} className="flex items-center justify-between text-sm py-2 border-b border-[#e6e6e6] last:border-0">
                <div>
                  <p className="text-[#444]">{h.cycle_no}回目</p>
                  <p className="text-xs text-[#9a9a9a] mt-0.5">
                    {h.delivered_date ? `お届け ${fmt(h.delivered_date)}` : h.shipped_date ? `発送 ${fmt(h.shipped_date)}` : h.billed_date ? `お支払い ${fmt(h.billed_date)}` : `予定 ${fmt(h.scheduled_date)}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[#444]">{yen(h.amount)}</p>
                  <p className="text-xs text-[#9a9a9a] mt-0.5">{CYCLE_LABEL[h.status] || h.status}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCancel && settings && (
        <CancelModal
          sub={sub}
          settings={settings}
          onClose={() => setShowCancel(false)}
          onSkipInstead={() => { setShowCancel(false); skip() }}
          onDone={() => { setShowCancel(false); onChanged() }}
        />
      )}
    </div>
  )
}

function CancelModal({
  sub, settings, onClose, onSkipInstead, onDone,
}: {
  sub: PortalSubscription
  settings: PortalSettings
  onClose: () => void
  onSkipInstead: () => void
  onDone: () => void
}) {
  const [reasonId, setReasonId] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    if (!reasonId) { setErr('解約の理由をお選びください'); return }
    setBusy(true); setErr('')
    try {
      await subscriptionApi.cancel(sub.id, reasonId, note)
      onDone()
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-[#e6e6e6] bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[#111] font-semibold">定期購入を解約しますか？</h3>

        {settings.cancel_flow.offer_skip_first && sub.can_skip && (
          <div className="mt-4 rounded-xl border border-[#d6d6d6] bg-[#f3f3f3] p-4">
            <p className="text-sm text-[#444]">{settings.cancel_flow.retention_message}</p>
            <button
              onClick={onSkipInstead}
              className="mt-3 w-full px-4 py-2.5 rounded-lg bg-[#111] text-white text-sm font-medium hover:opacity-90 transition"
            >
              {settings.skip.days}日スキップして続ける
            </button>
          </div>
        )}

        <div className="mt-5">
          <p className="text-xs text-[#6b6b6b] mb-2">解約の理由を教えてください（必須）</p>
          <div className="space-y-2">
            {settings.cancel_reasons.map((r) => (
              <label key={r.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[#f5f5f7] cursor-pointer hover:bg-[#ececec] transition">
                <input type="radio" name="reason" value={r.id} checked={reasonId === r.id} onChange={() => setReasonId(r.id)} />
                <span className="text-sm text-[#444]">{r.label}</span>
              </label>
            ))}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="もしよろしければ、詳しくお聞かせください（任意）"
            rows={3}
            className="mt-3 w-full px-3 py-2.5 rounded-lg bg-[#f5f5f7] border border-[#e6e6e6] text-sm text-[#111] placeholder:text-[#9a9a9a]"
          />
        </div>

        {err && <p className="mt-3 text-sm text-[#c8102e]">{err}</p>}

        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg border border-[#e6e6e6] text-[#444] text-sm hover:bg-[#f5f5f7] transition">
            やめる
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="flex-1 px-4 py-2.5 rounded-lg bg-red-500/20 text-[#c8102e] text-sm font-medium hover:bg-red-500/30 transition disabled:opacity-50"
          >
            {busy ? '処理中…' : '解約する'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 購入時のメールとログインのメールが違う場合に、注文番号で紐づける */
function ClaimCard({ onLinked }: { onLinked: () => void }) {
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
      <Repeat size={28} className="mx-auto text-[#9a9a9a]" />
      <p className="mt-3 text-[#444]">現在ご利用中の定期購入はありません</p>
      <p className="mt-1 text-sm text-[#9a9a9a]">
        ご購入時のメールアドレスがログイン中のものと異なる場合は、注文番号で紐づけできます。
      </p>
      <div className="mt-5 flex gap-2 max-w-sm mx-auto">
        <input
          value={orderNumber}
          onChange={(e) => setOrderNumber(e.target.value)}
          placeholder="注文番号（例: 1234）"
          className="flex-1 px-3 py-2.5 rounded-lg bg-[#f5f5f7] border border-[#e6e6e6] text-sm text-[#111] placeholder:text-[#9a9a9a]"
        />
        <button
          onClick={submit}
          disabled={busy}
          className="shrink-0 whitespace-nowrap px-4 py-2.5 rounded-lg bg-[#ececec] text-[#111] text-sm hover:bg-[#e0e0e0] transition disabled:opacity-50 flex items-center gap-2"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}
          紐づける
        </button>
      </div>
      {msg && <p className="mt-3 text-sm text-emerald-300">{msg}</p>}
      {err && <p className="mt-3 text-sm text-[#c8102e]">{err}</p>}
    </div>
  )
}
