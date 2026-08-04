import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

// インフルエンサー向けの公開フォーム。認証不要・素のaxios。
const api = axios.create({ baseURL: '/api/public/gifting' })

interface Variation {
  sellerSku: string
  label: string
  stock: number
}
interface Ctx {
  candidate: { handle: string; full_name: string | null }
  product_name: string
  from_name: string
  amazon_url: string | null
  variations: Variation[]
  already_submitted: boolean
}

function useToken() {
  return new URLSearchParams(window.location.search).get('t') || ''
}

export default function GiftAddressForm() {
  const token = useToken()
  const [ctx, setCtx] = useState<Ctx | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [recipientName, setRecipientName] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [prefecture, setPrefecture] = useState('')
  const [city, setCity] = useState('')
  const [line1, setLine1] = useState('')
  const [line2, setLine2] = useState('')
  const [selectedSku, setSelectedSku] = useState('')

  const load = useCallback(async () => {
    if (!token) { setNotFound(true); setLoading(false); return }
    try {
      const r = await api.get('/context', { params: { t: token } })
      setCtx(r.data)
      if (r.data.candidate?.full_name) setRecipientName(r.data.candidate.full_name)
      if (r.data.already_submitted) setDone(true)
    } catch {
      setNotFound(true)
    }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  // 郵便番号が7桁になったら都道府県・市区町村を自動入力
  const onPostalChange = (v: string) => {
    setPostalCode(v)
    const zip = v.replace(/[^0-9]/g, '')
    if (zip.length === 7) {
      api.get('/postal', { params: { zip } }).then((r) => {
        if (r.data?.prefecture) setPrefecture((p) => p || r.data.prefecture)
        if (r.data?.city || r.data?.town) setCity((c) => c || `${r.data.city || ''}${r.data.town || ''}`)
      }).catch(() => { /* noop */ })
    }
  }

  const submit = async () => {
    setErr(null)
    if (!recipientName.trim() || !postalCode.trim() || !line1.trim() || !prefecture.trim()) {
      setErr('お名前・郵便番号・都道府県・住所（番地）は必須です')
      return
    }
    if (ctx && ctx.variations && ctx.variations.length > 0 && !selectedSku) {
      setErr('サイズ・カラーをお選びください')
      return
    }
    setSubmitting(true)
    try {
      await api.post('/address', {
        recipient_name: recipientName,
        postal_code: postalCode,
        state_or_region: prefecture,
        city,
        address_line1: line1,
        address_line2: line2,
        sku: selectedSku || undefined,
      }, { params: { t: token } })
      setDone(true)
    } catch (e) {
      const ax = e as { response?: { data?: { error?: string } } }
      setErr(ax.response?.data?.error || '送信に失敗しました。時間をおいて再度お試しください。')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-800">リンクが無効です</p>
          <p className="text-sm text-gray-500 mt-2">お手数ですが、担当者までご連絡ください。</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 text-pink-600 font-bold text-xl">FITPEAK</div>
          <h1 className="text-lg font-bold text-gray-900 mt-3">商品お届け先のご入力</h1>
          <p className="text-sm text-gray-500 mt-1">
            {ctx?.candidate?.handle && <span>@{ctx.candidate.handle} 様</span>}
          </p>
        </div>

        {ctx?.amazon_url && (
          <a
            href={ctx.amazon_url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 w-full mb-4 py-3 rounded-xl bg-amber-400 hover:bg-amber-500 text-gray-900 font-semibold text-sm transition"
          >
            Amazon商品ページを見る
            <span aria-hidden>↗</span>
          </a>
        )}

        {done ? (
          <div className="bg-white rounded-2xl p-8 shadow-sm text-center">
            <div className="w-14 h-14 mx-auto rounded-full bg-green-100 flex items-center justify-center text-green-600 text-2xl">✓</div>
            <p className="text-base font-semibold text-gray-900 mt-4">ご入力ありがとうございます</p>
            <p className="text-sm text-gray-500 mt-2">
              お届け先を受け付けました。<br />{ctx?.product_name} の発送準備を進めます。<br />到着まで今しばらくお待ちください。
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl p-6 shadow-sm space-y-4">
            <p className="text-sm text-gray-600 leading-relaxed">
              このたびは {ctx?.product_name} のギフトをお受け取りいただきありがとうございます。<br />
              {ctx?.variations && ctx.variations.length > 0 ? 'ご希望のサイズ・カラーを選び、発送先をご入力ください。' : '下記に発送先をご入力ください。'}ご返信は不要です。
            </p>

            {ctx?.variations && ctx.variations.length > 0 && (
              <div>
                <label className="text-xs font-medium text-gray-600">サイズ・カラー<span className="text-pink-500 ml-0.5">*</span></label>
                <select
                  value={selectedSku}
                  onChange={(e) => setSelectedSku(e.target.value)}
                  className="mt-1 w-full px-3 py-2.5 text-sm rounded-lg border border-gray-300 bg-white focus:border-pink-400 focus:ring-1 focus:ring-pink-400 outline-none"
                >
                  <option value="">選択してください</option>
                  {ctx.variations.map((v) => (
                    <option key={v.sellerSku} value={v.sellerSku}>{v.label}</option>
                  ))}
                </select>
              </div>
            )}

            <Field label="お名前" required value={recipientName} onChange={setRecipientName} placeholder="山田 太郎" />
            <Field label="郵便番号（入力で住所が自動表示）" required value={postalCode} onChange={onPostalChange} placeholder="150-0001" inputMode="numeric" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="都道府県" required value={prefecture} onChange={setPrefecture} placeholder="東京都" />
              <Field label="市区町村" value={city} onChange={setCity} placeholder="渋谷区神宮前" />
            </div>
            <Field label="番地" required value={line1} onChange={setLine1} placeholder="1-2-3" />
            <Field label="建物名・部屋番号" value={line2} onChange={setLine2} placeholder="◯◯マンション 101" />

            {err && <p className="text-sm text-red-600">{err}</p>}

            <button
              disabled={submitting}
              onClick={submit}
              className="w-full py-3 rounded-xl bg-pink-500 text-white font-semibold hover:bg-pink-600 disabled:opacity-50 transition"
            >
              {submitting ? '送信中...' : '送信する'}
            </button>
            <p className="text-[11px] text-gray-400 text-center">入力いただいた住所は商品発送のみに使用します。</p>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, required, inputMode }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean; inputMode?: 'numeric' | 'text'
}) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-600">
        {label}{required && <span className="text-pink-500 ml-0.5">*</span>}
      </label>
      <input
        value={value}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full px-3 py-2.5 text-sm rounded-lg border border-gray-300 focus:border-pink-400 focus:ring-1 focus:ring-pink-400 outline-none"
      />
    </div>
  )
}
