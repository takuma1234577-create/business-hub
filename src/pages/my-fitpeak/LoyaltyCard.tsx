import { useEffect, useState } from 'react'
import { Gift, Flame, ChevronDown, ChevronUp } from 'lucide-react'
import { apiFetch } from './lib/api'

/**
 * 毎日のログインポイント＋クレアショットチャレンジ（仕様書 v1 第7項）
 * 画面を開いたら POST /loyalty/login を1回呼ぶ。付与数・連続日数・抽選結果はすべてサーバーが決める。
 */

interface Challenge { id: string; milestone: number; tier: 'first' | 'continuing'; expires_at: string }
interface Draw { id: string; milestone: number; result: 'win' | 'lose'; prize_status: string | null; drawn_at: string }
interface Status {
  balance: number
  streak: number
  best_streak: number
  next_points: number
  days_to_challenge: number
  boosted: boolean
  eligibility: 'active' | 'paused' | 'none'
  logged_in_today: boolean
  streak_alive: boolean
  points_expire_on: string | null
  open_challenges: Challenge[]
  recent_draws: Draw[]
}
interface Login { status: 'granted' | 'already' | 'paused' | 'not_eligible'; points: number; streak_reset: boolean }

const GOLD = '#c8a960'

function formatDate(s: string) {
  const d = new Date(s)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

export default function LoyaltyCard() {
  const [status, setStatus] = useState<Status | null>(null)
  const [login, setLogin] = useState<Login | null>(null)
  const [failed, setFailed] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [drawResult, setDrawResult] = useState<'win' | 'lose' | null>(null)
  const [drawError, setDrawError] = useState('')

  const [linkOpen, setLinkOpen] = useState(false)
  const [orderNumber, setOrderNumber] = useState('')
  const [orderEmail, setOrderEmail] = useState('')
  const [linkBusy, setLinkBusy] = useState(false)
  const [linkError, setLinkError] = useState('')

  // サーバーが今日のログインを記録して、付与結果と状態を返す（同じ日に何度呼んでも1回分だけ）
  const postLogin = (): Promise<{ login: Login; status: Status } | null> =>
    apiFetch('/api/my-fitpeak/loyalty/login', { method: 'POST' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)

  const apply = (data: { login: Login; status: Status } | null) => {
    if (!data) { setFailed(true); return }
    setLogin(data.login)
    setStatus(data.status)
  }

  const recordLogin = async () => apply(await postLogin())

  useEffect(() => {
    let cancelled = false
    postLogin().then((data) => { if (!cancelled) apply(data) })
    return () => { cancelled = true }
  }, [])

  const draw = async (id: string) => {
    setDrawError('')
    setDrawing(true)
    try {
      const res = await apiFetch(`/api/my-fitpeak/loyalty/challenges/${id}/draw`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setDrawError(data.error || '抽選できませんでした')
      } else {
        setDrawResult(data.result)
        const s = await apiFetch('/api/my-fitpeak/loyalty')
        if (s.ok) setStatus(await s.json())
      }
    } catch {
      setDrawError('通信に失敗しました。時間をおいてお試しください')
    }
    setDrawing(false)
  }

  const link = async () => {
    setLinkError('')
    setLinkBusy(true)
    try {
      const res = await apiFetch('/api/my-fitpeak/loyalty/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber, email: orderEmail }),
      })
      const data = await res.json()
      if (!res.ok) {
        setLinkError(data.error || '紐づけできませんでした')
      } else {
        setLinkOpen(false)
        setOrderNumber('')
        setOrderEmail('')
        await recordLogin()
      }
    } catch {
      setLinkError('通信に失敗しました。時間をおいてお試しください')
    }
    setLinkBusy(false)
  }

  if (failed || !status) return null

  // 定期購入と紐づいていない人：紐づけの入口だけ出す
  if (status.eligibility === 'none') {
    return (
      <section className="rounded-2xl bg-[#151515] border border-white/10 p-5">
        <div className="flex items-start gap-3">
          <Gift size={20} className="shrink-0 mt-0.5" style={{ color: GOLD }} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-white">毎日のログインポイント＋クレアショットチャレンジ</p>
            <p className="text-xs text-white/50 mt-1 leading-relaxed">
              クレアショット定期購入中の方は、毎日ここを開くと1pt（1pt＝1円）。28日続けると、クレアショット1袋が当たるチャレンジに参加できます。
            </p>
            {status.balance > 0 && (
              <p className="text-xs text-white/50 mt-2">保有ポイント {status.balance.toLocaleString()}pt</p>
            )}
            <button
              type="button"
              onClick={() => setLinkOpen((v) => !v)}
              className="mt-3 flex items-center gap-1 text-xs font-semibold"
              style={{ color: GOLD }}
            >
              定期購入中の方はこちらで紐づけ
              {linkOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>
        {linkOpen && (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-white/40">定期購入を申し込んだときの注文番号と、そのときのメールアドレスを入力してください。</p>
            <input
              type="text"
              inputMode="numeric"
              value={orderNumber}
              onChange={(e) => { setOrderNumber(e.target.value); setLinkError('') }}
              placeholder="注文番号（例: #1234）"
              className="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/20 text-sm focus:outline-none focus:border-[#c8a960]/50 transition"
            />
            <input
              type="email"
              value={orderEmail}
              onChange={(e) => { setOrderEmail(e.target.value); setLinkError('') }}
              onKeyDown={(e) => e.key === 'Enter' && link()}
              placeholder="注文時のメールアドレス"
              className="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/20 text-sm focus:outline-none focus:border-[#c8a960]/50 transition"
            />
            <button
              onClick={link}
              disabled={linkBusy || !orderNumber.trim() || !orderEmail.trim()}
              className="w-full py-3 rounded-lg bg-[#c8a960] hover:bg-[#b89a50] text-black text-sm font-semibold transition disabled:opacity-40"
            >
              {linkBusy ? '確認中' : '紐づける'}
            </button>
            {linkError && <p className="text-red-400 text-xs">{linkError}</p>}
          </div>
        )}
      </section>
    )
  }

  const inCycle = status.streak === 0 ? 0 : ((status.streak - 1) % 28) + 1
  const challenge = status.open_challenges[0]
  const lastDraw = status.recent_draws[0]

  return (
    <section className="rounded-2xl bg-[#151515] border border-white/10 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-white/50">毎日のログインポイント</p>
        {status.boosted && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#c8a960]/15" style={{ color: GOLD }}>
            <Flame size={12} />
            毎日2pt中
          </span>
        )}
      </div>

      {status.eligibility === 'paused' ? (
        <p className="text-sm text-white/70 mt-3">休会中はポイントもお休みです。連続日数はそのまま残っていて、再開したら続きから数えます。</p>
      ) : (
        <>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-white text-sm">連続</span>
            <span className="text-3xl font-bold text-white">{inCycle}</span>
            <span className="text-white/40 text-sm">/ 28日目</span>
            {status.streak > 28 && <span className="text-white/40 text-xs ml-auto">連続{status.streak}日</span>}
          </div>
          <div className="h-2 rounded-full bg-white/10 mt-3 overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${(inCycle / 28) * 100}%`, background: GOLD }} />
          </div>

          {login?.status === 'granted' && (
            <p className="text-sm mt-3" style={{ color: GOLD }}>今日 +{login.points}pt 獲得</p>
          )}
          {login?.status === 'granted' && login.streak_reset && (
            <p className="text-xs text-white/50 mt-1">連続がリセットされました。今日から1日目です。</p>
          )}
          {status.streak === 28 && (
            <p className="text-xs text-white/60 mt-1">28日達成。明日から毎日2ptになります。</p>
          )}
          {!challenge && inCycle < 28 && (
            <p className="text-xs text-white/50 mt-1">クレアショットチャレンジまで、あと{status.days_to_challenge}日</p>
          )}
        </>
      )}

      {challenge && (
        <div className="mt-4 rounded-xl border border-[#c8a960]/40 p-4">
          <p className="text-sm font-bold text-white">クレアショットチャレンジ</p>
          <p className="text-xs text-white/50 mt-1">
            当たるとクレアショット1袋をお届けします（当選率{challenge.tier === 'first' ? '1' : '2'}%）。
            {formatDate(challenge.expires_at)}まで
          </p>
          <button
            onClick={() => draw(challenge.id)}
            disabled={drawing}
            className="w-full mt-3 py-3 rounded-lg bg-[#c8a960] hover:bg-[#b89a50] text-black text-sm font-bold transition disabled:opacity-40"
          >
            {drawing ? '抽選中' : 'チャレンジする'}
          </button>
          {drawError && <p className="text-red-400 text-xs mt-2">{drawError}</p>}
        </div>
      )}

      {drawResult && (
        <div className="mt-4 rounded-xl bg-white/5 p-4 text-center">
          {drawResult === 'win' ? (
            <>
              <p className="text-lg font-bold" style={{ color: GOLD }}>当たり</p>
              <p className="text-xs text-white/60 mt-1">クレアショット1袋を、来月1日に定期購入のお届け先へ無料でお送りします。</p>
            </>
          ) : (
            <>
              <p className="text-lg font-bold text-white">ハズレ</p>
              <p className="text-xs text-white/60 mt-1">次の28日でまたチャレンジできます。続けるほど当選率は2%に上がります。</p>
            </>
          )}
        </div>
      )}
      {!drawResult && lastDraw?.result === 'win' && lastDraw.prize_status !== 'shipped' && (
        <p className="text-xs mt-3" style={{ color: GOLD }}>当選したクレアショット1袋は、来月1日に発送します。</p>
      )}

      <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/10">
        <span className="text-xs text-white/50">保有ポイント</span>
        <span className="text-base font-bold text-white">{status.balance.toLocaleString()}pt</span>
      </div>
      {status.points_expire_on && status.balance > 0 && (
        <p className="text-[11px] text-white/30 mt-1 text-right">有効期限 {formatDate(status.points_expire_on)}（ポイントを獲得するたびに延長）</p>
      )}
    </section>
  )
}
