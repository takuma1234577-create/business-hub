import { useEffect, useState } from 'react'
import { Gift, Copy, Check, Search } from 'lucide-react'
import { apiFetch, isLineAccount } from './lib/api'
import { useFitpeakAuth } from './lib/auth'

/**
 * 友だち紹介（旧 my.fitpeak.co/referral）
 * 紹介コードの持ち主・紐づけ先はサーバーがログインから決める（画面からメールやLINE IDは送らない）
 */
export default function FitpeakReferral() {
  const { user } = useFitpeakAuth()
  const [info, setInfo] = useState<{ code: string; shareUrl: string } | null>(null)
  const [counts, setCounts] = useState({ confirmed: 0, pending: 0 })
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [secretPass, setSecretPass] = useState('')
  const [orderNumber, setOrderNumber] = useState('')
  const [buyerName, setBuyerName] = useState('')
  const [binding, setBinding] = useState(false)
  const [bindResult, setBindResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const r = await apiFetch('/api/my-fitpeak/referral/issue-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        const d = await r.json()
        if (active && d.code) setInfo({ code: d.code, shareUrl: d.shareUrl || '' })
      } catch { /* 下で失敗表示 */ }
      try {
        const r = await apiFetch('/api/my-fitpeak/referral')
        const d = await r.json()
        if (active) setCounts({ confirmed: d.confirmedCount || 0, pending: d.pendingCount || 0 })
      } catch { /* ignore */ }
      if (active) setLoading(false)
    })()
    return () => { active = false }
  }, [])

  const shareText = info ? `FITPEAKを紹介します。この専用URLから3,000円以上ご購入で、あなたも私もAmazonギフト券500円がもらえます。\n${info.shareUrl}` : ''

  const copy = async () => {
    if (!info) return
    try { await navigator.clipboard.writeText(info.shareUrl); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* ignore */ }
  }

  const bind = async () => {
    setBindResult(null)
    setBinding(true)
    try {
      const r = await apiFetch('/api/my-fitpeak/referral/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secretPass: secretPass.trim() || undefined,
          orderNumber: orderNumber.trim() || undefined,
          name: buyerName.trim() || undefined,
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok && d.success) setBindResult({ ok: true, message: '紹介の登録が完了しました。特典のAmazonギフト券500円は公式LINEにお送りします。' })
      else setBindResult({ ok: false, message: d.error || '登録に失敗しました。' })
    } catch {
      setBindResult({ ok: false, message: '通信エラーが発生しました。' })
    }
    setBinding(false)
  }

  const input = 'w-full h-12 rounded-[12px] border border-[#e0e0e0] bg-white px-3 text-[15px] text-[#111] placeholder-[#9a9a9a] focus:outline-none focus:border-[#111]'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-bold text-[#111] flex items-center gap-2"><Gift size={22} /> 友だち紹介</h1>
        <p className="mt-2 text-[14px] text-[#6b6b6b] leading-relaxed">
          専用URLから友だちが3,000円以上購入すると、<span className="font-bold text-[#111]">あなたも友だちもAmazonギフト券500円</span>がもらえます。
        </p>
      </div>

      {!loading && !isLineAccount(user) && (
        <section className="rounded-[20px] bg-white border border-[#e6e6e6] p-5 text-[14px] text-[#444] leading-relaxed">
          特典のAmazonギフト券は公式LINEでお届けします。まだの方は公式LINEを友だち追加し、My FITPEAKの「アカウント」からLINEと連携してください。
          <a href="https://line.me/R/ti/p/@956iyppc" className="block mt-2 font-bold text-[#047d3b] underline underline-offset-2">公式LINEを友だち追加</a>
        </section>
      )}

      <section className="rounded-[20px] bg-white border border-[#e6e6e6] p-5">
        <h2 className="text-[17px] font-bold text-[#111] mb-3">あなたの専用URL</h2>
        {loading ? (
          <p className="text-[14px] text-[#9a9a9a]">読み込み中...</p>
        ) : info ? (
          <>
            <div className="flex items-center gap-2">
              <input readOnly value={info.shareUrl} className={`${input} truncate`} />
              <button onClick={copy} aria-label="コピー" className="shrink-0 w-12 h-12 rounded-full border border-[#d6d6d6] flex items-center justify-center text-[#111]">
                {copied ? <Check size={18} /> : <Copy size={18} />}
              </button>
            </div>
            <a href={`https://line.me/R/share?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer"
              className="mt-3 flex items-center justify-center w-full min-h-[52px] rounded-full bg-[#06C755] text-white text-[15px] font-bold hover:bg-[#05b34c]">
              LINEで友だちに送る
            </a>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div className="rounded-[16px] bg-[#f5f5f7] p-3 text-center">
                <div className="text-[24px] font-bold text-[#111]">{counts.confirmed}</div>
                <div className="text-[12px] text-[#6b6b6b]">成立した紹介</div>
              </div>
              <div className="rounded-[16px] bg-[#f5f5f7] p-3 text-center">
                <div className="text-[24px] font-bold text-[#111]">{counts.pending}</div>
                <div className="text-[12px] text-[#6b6b6b]">確認待ち</div>
              </div>
            </div>
          </>
        ) : (
          <p className="text-[14px] text-[#6b6b6b]">専用URLの発行に失敗しました。時間をおいて再度お試しください。</p>
        )}
      </section>

      <section className="rounded-[20px] bg-white border border-[#e6e6e6] p-5">
        <h2 className="text-[17px] font-bold text-[#111] flex items-center gap-2"><Search size={16} /> 紹介された方はこちら</h2>
        <p className="mt-1 mb-4 text-[13px] text-[#6b6b6b] leading-relaxed">
          お知らせしたシークレットパスを入力してください。お持ちでない場合は、注文番号とご注文時のお名前（フルネーム）で登録できます。
        </p>
        <label className="block text-[12px] font-bold text-[#444] mb-1">シークレットパス</label>
        <input value={secretPass} onChange={(e) => setSecretPass(e.target.value)} placeholder="例: A1B2C3" className={`${input} uppercase`} />
        <p className="my-3 text-[12px] text-[#9a9a9a]">または</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] font-bold text-[#444] mb-1">注文番号</label>
            <input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="#1001" className={input} />
          </div>
          <div>
            <label className="block text-[12px] font-bold text-[#444] mb-1">お名前</label>
            <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="山田 太郎" className={input} />
          </div>
        </div>
        <button onClick={bind} disabled={binding || (!secretPass.trim() && !(orderNumber.trim() && buyerName.trim()))}
          className="mt-4 w-full min-h-[52px] rounded-full bg-[#111] text-white text-[15px] font-bold hover:bg-[#333] disabled:opacity-40">
          {binding ? '登録中...' : '紹介を登録する'}
        </button>
        {bindResult && (
          <p className={`mt-3 text-[14px] rounded-[12px] px-3 py-2.5 ${bindResult.ok ? 'bg-[#06c755]/10 text-[#067a3a]' : 'bg-[#c8102e]/5 text-[#c8102e]'}`}>
            {bindResult.message}
          </p>
        )}
      </section>
    </div>
  )
}
