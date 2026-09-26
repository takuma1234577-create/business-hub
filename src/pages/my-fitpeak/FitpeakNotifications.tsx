import { useEffect, useState } from 'react'
import { MessageCircle, Mail, CheckCircle } from 'lucide-react'
import { apiFetch } from './lib/api'

/**
 * 通知の設定（2026-09-26）
 * LINEで受け取るのは「セール・新商品のお知らせ」だけ。
 * 価格アラート・大会の続報・記録のリマインドはメールで受け取る（希望者のみ）。
 * LINEの配信はお金がかかり、送りすぎるとブロックも増えるため、頻度の高い通知はメールに寄せている。
 */

interface Prefs {
  campaign: boolean
  email_price_alert: boolean
  email_contest: boolean
  email_reminder: boolean
  notify_email: string
}

const EMAIL_ITEMS: { key: keyof Prefs; title: string; note: string }[] = [
  { key: 'email_price_alert', title: '価格アラート', note: 'プロテインやサプリが、決めた価格を切ったときにお知らせします。商品と価格の指定は準備中です。ONにしておくと、始まったときに最初にご案内します。' },
  { key: 'email_contest', title: '大会の続報', note: 'KINNIKU TIMESで、大会の結果記事が出たときにお知らせします。' },
  { key: 'email_reminder', title: '記録のリマインド', note: 'FITPEAK LABで測った記録を、1か月後に測り直すお知らせです（記録機能は準備中）。' },
]

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative shrink-0 w-12 h-7 rounded-full transition ${on ? 'bg-[#c8a960]' : 'bg-white/15'}`}
    >
      <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : ''}`} />
    </button>
  )
}

export default function FitpeakNotifications() {
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    apiFetch('/api/my-fitpeak/notification-prefs')
      .then(async (r) => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || '読み込みに失敗しました')
        setPrefs(j)
      })
      .catch((e) => setMessage({ ok: false, text: e.message }))
      .finally(() => setLoading(false))
  }, [])

  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    setPrefs((p) => (p ? { ...p, [k]: v } : p))
    setMessage(null)
  }

  const save = async () => {
    if (!prefs) return
    setSaving(true)
    setMessage(null)
    try {
      const r = await apiFetch('/api/my-fitpeak/notification-prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || '保存に失敗しました')
      setMessage({ ok: true, text: '保存しました' })
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : '保存に失敗しました' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-[#c8a960] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!prefs) {
    return <p className="text-sm text-white/60">{message?.text || '通知の設定を読み込めませんでした。'}</p>
  }

  const wantsEmail = prefs.email_price_alert || prefs.email_contest || prefs.email_reminder

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-base font-bold text-white">通知の設定</h1>
        <p className="text-xs text-white/40 mt-1 leading-relaxed">
          LINEに届くのは、セール・新商品のお知らせだけです。<br />
          価格アラートや大会の続報は、メールで受け取れます。
        </p>
      </div>

      {/* LINE */}
      <section className="rounded-2xl bg-[#151515] border border-white/10 p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <MessageCircle size={16} className="text-[#06C755]" />
          <h2 className="text-sm font-medium text-white">LINEで受け取る</h2>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-white">セール・新商品のお知らせ</p>
            <p className="text-xs text-white/40 mt-1 leading-relaxed">FITPEAKのセールや新商品の発売を、公式LINEでお知らせします。</p>
          </div>
          <Toggle on={prefs.campaign} onChange={(v) => set('campaign', v)} label="セール・新商品のお知らせ" />
        </div>
      </section>

      {/* メール */}
      <section className="rounded-2xl bg-[#151515] border border-white/10 p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <Mail size={16} className="text-[#c8a960]" />
          <h2 className="text-sm font-medium text-white">メールで受け取る</h2>
        </div>

        <div className="divide-y divide-white/5">
          {EMAIL_ITEMS.map((it) => (
            <div key={it.key} className="flex items-start justify-between gap-4 py-4 first:pt-0">
              <div>
                <p className="text-sm font-semibold text-white">{it.title}</p>
                <p className="text-xs text-white/40 mt-1 leading-relaxed">{it.note}</p>
              </div>
              <Toggle on={prefs[it.key] as boolean} onChange={(v) => set(it.key, v as never)} label={it.title} />
            </div>
          ))}
        </div>

        <label className="block mt-4">
          <span className="text-xs text-white/60">通知を受け取るメールアドレス{wantsEmail ? '（必須）' : ''}</span>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={prefs.notify_email}
            onChange={(e) => set('notify_email', e.target.value)}
            placeholder="you@example.com"
            className="mt-1.5 w-full rounded-lg bg-black/40 border border-white/10 focus:border-[#c8a960] px-3.5 py-3 text-sm text-white placeholder-white/25 outline-none"
          />
        </label>
      </section>

      <button
        onClick={save}
        disabled={saving}
        className="w-full py-3.5 rounded-lg bg-[#c8a960] hover:bg-[#b89950] text-black text-sm font-bold transition disabled:opacity-50"
      >
        {saving ? '保存中…' : '保存する'}
      </button>

      {message && (
        <p className={`flex items-center justify-center gap-1.5 text-sm ${message.ok ? 'text-[#06C755]' : 'text-red-400'}`}>
          {message.ok && <CheckCircle size={16} />}
          {message.text}
        </p>
      )}
    </div>
  )
}
