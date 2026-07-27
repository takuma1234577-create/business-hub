import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

// 顧客向けフォームは認証不要。トークンなしの素のaxiosを使う。
const api = axios.create({ baseURL: '/api/public/review-submission' })

interface Submission {
  token: string
  product_name: string | null
  order_number: string | null
  status: 'awaiting_draft' | 'draft_received' | 'approved' | 'verified' | 'rejected'
  draft_title: string | null
  draft_body: string | null
  draft_image_url: string | null
  proof_image_url: string | null
  verify_status: string | null
  verify_reason: string | null
  review_date: string | null
}

function formatJpDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()]
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${w}）`
}

function useToken() {
  const params = new URLSearchParams(window.location.search)
  return params.get('t') || ''
}

export default function ReviewForm() {
  const token = useToken()
  const [sub, setSub] = useState<Submission | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // draft inputs
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [draftImage, setDraftImage] = useState<File | null>(null)
  const [proofImage, setProofImage] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [flash, setFlash] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(async () => {
    if (!token) { setNotFound(true); setLoading(false); return }
    setLoading(true)
    try {
      const r = await api.get('/context', { params: { t: token } })
      setSub(r.data.submission)
      setTitle(r.data.submission.draft_title || '')
      setBody(r.data.submission.draft_body || '')
    } catch {
      setNotFound(true)
    }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const submitDraft = async () => {
    if (!title.trim() || !body.trim()) { setFlash({ type: 'err', text: 'タイトルと本文を入力してください' }); return }
    setSubmitting(true); setFlash(null)
    try {
      const fd = new FormData()
      fd.append('t', token)
      fd.append('title', title)
      fd.append('body', body)
      if (draftImage) fd.append('image', draftImage)
      await api.post('/draft', fd)
      setFlash({ type: 'ok', text: 'レビュー下書きを送信しました。ありがとうございます。' })
      await load()
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } } }
      setFlash({ type: 'err', text: err.response?.data?.error || '送信に失敗しました。時間をおいて再度お試しください。' })
    }
    setSubmitting(false)
  }

  const submitProof = async () => {
    if (!proofImage) { setFlash({ type: 'err', text: 'レビュー投稿後の画面のスクリーンショットを選択してください' }); return }
    setSubmitting(true); setFlash(null)
    try {
      const fd = new FormData()
      fd.append('t', token)
      fd.append('image', proofImage)
      const r = await api.post('/proof', fd)
      if (r.data.verify_status === 'verified') {
        setFlash({ type: 'ok', text: 'レビューの確認が完了しました。ご協力ありがとうございました。' })
      } else {
        setFlash({ type: 'err', text: '投稿内容を確認できませんでした。下書きどおりに投稿されたレビュー画面のスクショを、もう一度お送りください。' })
      }
      await load()
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } } }
      setFlash({ type: 'err', text: err.response?.data?.error || '送信に失敗しました。時間をおいて再度お試しください。' })
    }
    setSubmitting(false)
  }

  const card = 'w-full max-w-lg mx-auto bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-6'
  const label = 'block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5'
  const input = 'w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 text-[15px] focus:outline-none focus:ring-2 focus:ring-emerald-500'
  const btn = 'w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-[15px] disabled:opacity-50 transition'

  if (loading) {
    return <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-slate-300 border-t-emerald-600 rounded-full animate-spin" />
    </div>
  }
  if (notFound || !sub) {
    return <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
      <div className={card}>
        <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">リンクが無効です</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">お手数ですが、公式LINEからお送りした最新のリンクをご利用ください。</p>
      </div>
    </div>
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-8 px-4">
      <div className="w-full max-w-lg mx-auto mb-4 text-center">
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">レビュー提出</h1>
        {sub.product_name && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{sub.product_name}</p>}
        {sub.order_number && <p className="text-xs text-slate-400">注文番号: {sub.order_number}</p>}
      </div>

      {flash && (
        <div className={`w-full max-w-lg mx-auto mb-4 px-4 py-3 rounded-xl text-sm ${flash.type === 'ok' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300'}`}>
          {flash.text}
        </div>
      )}

      {/* 完了 */}
      {sub.status === 'verified' && (
        <div className={card}>
          <div className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-600"><path d="M20 6L9 17l-5-5" /></svg>
            </div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">レビュー確認が完了しました</h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">ご協力ありがとうございました。特典のご案内は公式LINEにてお送りします。</p>
          </div>
        </div>
      )}

      {sub.status === 'rejected' && (
        <div className={card}>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">受付を終了しました</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">ご不明な点は公式LINEにてお問い合わせください。</p>
        </div>
      )}

      {/* ステップ1: 下書き提出 */}
      {sub.status === 'awaiting_draft' && (
        <div className={card}>
          <div className="mb-4">
            <span className="text-xs font-semibold text-emerald-600">ステップ 1 / 2</span>
            <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 mt-0.5">レビュー下書きの提出</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">投稿予定のレビュー内容をご記入ください。担当が確認後、投稿のご案内をします。</p>
          </div>
          <div className="space-y-4">
            <div>
              <label className={label}>レビュータイトル</label>
              <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 使いやすくて満足です" />
            </div>
            <div>
              <label className={label}>レビュー本文</label>
              <textarea className={input} rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder="商品の感想をご記入ください" />
            </div>
            <div>
              <label className={label}>レビュー画像（任意）</label>
              <input type="file" accept="image/*" onChange={(e) => setDraftImage(e.target.files?.[0] || null)} className="block w-full text-sm text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-slate-100 dark:file:bg-slate-800 file:text-slate-700 dark:file:text-slate-200" />
            </div>
            <button className={btn} onClick={submitDraft} disabled={submitting}>{submitting ? '送信中...' : 'この内容で提出する'}</button>
          </div>
        </div>
      )}

      {/* 下書き受領・承認待ち */}
      {sub.status === 'draft_received' && (
        <div className={card}>
          <div className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center mb-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-600"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            </div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">下書きを受け付けました</h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">担当者が内容を確認しています。承認後、レビュー投稿日を公式LINEにてお知らせします。今しばらくお待ちください。</p>
          </div>
          <div className="mt-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
            <p className="text-xs text-slate-400 mb-1">提出済みの下書き</p>
            {sub.draft_title && <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{sub.draft_title}</p>}
            {sub.draft_body && <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 whitespace-pre-wrap">{sub.draft_body}</p>}
          </div>
        </div>
      )}

      {/* ステップ2: 投稿後の確認スクショ（承認後のみ） */}
      {sub.status === 'approved' && (
        <div className={card}>
          <div className="mb-4">
            <span className="text-xs font-semibold text-emerald-600">ステップ 2 / 2</span>
            <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 mt-0.5">投稿後の確認スクショ</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">下書きどおりにAmazonへレビューを投稿し、投稿が反映された画面のスクリーンショットをアップロードしてください。</p>
          </div>

          {sub.review_date && (
            <div className="mb-4 p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center">
              <p className="text-xs text-emerald-700 dark:text-emerald-300">レビュー投稿日</p>
              <p className="text-lg font-bold text-emerald-700 dark:text-emerald-200 mt-0.5">{formatJpDate(sub.review_date)}</p>
              <p className="text-[11px] text-emerald-600/80 dark:text-emerald-300/80 mt-1">この日になりましたら投稿し、スクショをお送りください</p>
            </div>
          )}

          {/* 提出済み下書きの表示 */}
          <div className="mb-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
            <p className="text-xs text-slate-400 mb-1">提出済みの下書き</p>
            {sub.draft_title && <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{sub.draft_title}</p>}
            {sub.draft_body && <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 whitespace-pre-wrap">{sub.draft_body}</p>}
          </div>

          {sub.verify_status && sub.verify_status !== 'verified' && (
            <div className="mb-3 text-xs text-amber-600">前回の確認結果: {sub.verify_reason || '一致しませんでした'}。もう一度お送りください。</div>
          )}

          <div className="space-y-4">
            <div>
              <label className={label}>投稿後の確認スクリーンショット</label>
              <input type="file" accept="image/*" onChange={(e) => setProofImage(e.target.files?.[0] || null)} className="block w-full text-sm text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-slate-100 dark:file:bg-slate-800 file:text-slate-700 dark:file:text-slate-200" />
            </div>
            <button className={btn} onClick={submitProof} disabled={submitting}>{submitting ? '確認中...' : 'スクショを送信して確認する'}</button>
          </div>
        </div>
      )}

      <p className="w-full max-w-lg mx-auto mt-4 text-center text-[11px] text-slate-400">FITPEAK 在宅ワーク案件ナビ</p>
    </div>
  )
}
