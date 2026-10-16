import { useEffect, useRef, useState } from 'react'
import { CheckCircle, Upload, XCircle, Loader2, Gift } from 'lucide-react'
import { apiFetch } from '../lib/api'
import { BackToMyPage, Card, ErrorText, PillButton, Spinner, SurveyShell, trackStep } from './ui'

/**
 * Amazonレビュー投稿特典：リストラップ無料プレゼント（旧 /survey/review-gift）
 * 旧アプリは ?sid= / ?line= だけで他人の回答者情報を復元できたが、ここではログインした本人の申請だけを扱う。
 * スクショは非公開の場所に保存し、確認と発行はサーバーが行う。
 */

type Claim = { status: 'pending' | 'verified' | 'rejected' | 'issued'; productName: string | null; invoiceUrl: string | null; reason: string | null }
type Result = { status: string; invoiceUrl?: string; productName?: string; reason?: string; message?: string; error?: string }

// スマホのスクショは大きいので、送る前に縮める（長辺1600px・JPEG）
async function shrink(file: File): Promise<{ contentType: string; data: string }> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = url
    })
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    return { contentType: 'image/jpeg', data: dataUrl.split(',')[1] }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function UploadSlot({ label, hint, fileId, preview, busy, onPick }: {
  label: string; hint: string; fileId: string; preview: string; busy: boolean; onPick: (f: File) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="rounded-[16px] border border-[#e6e6e6] p-4">
      <p className="text-[14px] font-bold text-[#111]">{label}</p>
      <p className="text-[12px] text-[#6b6b6b] mt-0.5">{hint}</p>
      {preview && <img src={preview} alt="" className="mt-3 max-h-48 rounded-[10px] border border-[#eee]" />}
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = '' }} />
      <button type="button" onClick={() => ref.current?.click()} disabled={busy}
        className="mt-3 inline-flex items-center gap-2 px-4 h-10 rounded-full border border-[#111] text-[13px] font-bold text-[#111] disabled:opacity-40">
        {busy ? <Loader2 size={15} className="animate-spin" /> : fileId ? <CheckCircle size={15} /> : <Upload size={15} />}
        {busy ? 'アップロード中...' : fileId ? 'アップロード済み（選び直す）' : 'スクリーンショットを選ぶ'}
      </button>
    </div>
  )
}

export default function SurveyReviewGift() {
  const [loading, setLoading] = useState(true)
  const [claim, setClaim] = useState<Claim | null>(null)
  const [compose, setCompose] = useState({ fileId: '', preview: '' })
  const [posted, setPosted] = useState({ fileId: '', preview: '' })
  const [busySlot, setBusySlot] = useState<0 | 1 | 2>(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => {
    trackStep('review_gift_offer')
    apiFetch('/api/my-fitpeak/review-gift/status')
      .then((r) => r.json())
      .then((d) => setClaim(d.claim || null))
      .catch(() => { /* 未申請として表示 */ })
      .finally(() => setLoading(false))
  }, [])

  const upload = async (slot: 1 | 2, file: File) => {
    setError('')
    setBusySlot(slot)
    try {
      const body = await shrink(file)
      const r = await apiFetch('/api/my-fitpeak/review-gift/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'アップロードに失敗しました')
      const v = { fileId: d.fileId as string, preview: URL.createObjectURL(file) }
      if (slot === 1) setCompose(v); else setPosted(v)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'アップロードに失敗しました')
    }
    setBusySlot(0)
  }

  const submit = async () => {
    setSubmitting(true)
    setError('')
    const resubmit = claim?.status === 'rejected'
    try {
      const r = await apiFetch(`/api/my-fitpeak/review-gift/${resubmit ? 'resubmit' : 'submit'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productChoice: 'wrist_wrap', proofFileId: posted.fileId, proofFileId2: compose.fileId || undefined }),
      })
      const d: Result = await r.json().catch(() => ({ status: 'error' }))
      if (!r.ok) { setError(d.error || '申請に失敗しました'); setSubmitting(false); return }
      trackStep('review_gift_submitted')
      setResult(d)
      if (d.status === 'issued') setClaim({ status: 'issued', productName: d.productName || 'リストラップ', invoiceUrl: d.invoiceUrl || null, reason: null })
      else if (d.status === 'rejected') setClaim({ status: 'rejected', productName: 'リストラップ', invoiceUrl: null, reason: d.reason || null })
      else setClaim({ status: 'pending', productName: 'リストラップ', invoiceUrl: null, reason: null })
      setCompose({ fileId: '', preview: '' })
      setPosted({ fileId: '', preview: '' })
    } catch {
      setError('通信に失敗しました。もう一度お試しください。')
    }
    setSubmitting(false)
  }

  if (loading) return <SurveyShell><Spinner /></SurveyShell>

  if (claim?.status === 'issued') {
    return (
      <SurveyShell>
        <Card className="text-center">
          <Gift size={40} className="mx-auto text-[#111]" />
          <h1 className="mt-3 text-[20px] font-bold text-[#111]">プレゼントが確定しました</h1>
          <p className="mt-2 text-[14px] text-[#6b6b6b] leading-relaxed">
            {claim.productName || 'リストラップ'}を、商品代金・送料すべて無料（¥0）でお届けします。<br />下のボタンからお届け先を入力してください。
          </p>
          {claim.invoiceUrl && (
            <a href={claim.invoiceUrl} className="mt-5 flex items-center justify-center w-full min-h-[52px] rounded-full bg-[#111] text-white text-[15px] font-bold hover:bg-[#333]">
              お届け先を入力して受け取る
            </a>
          )}
        </Card>
        <BackToMyPage />
      </SurveyShell>
    )
  }

  if (claim && (claim.status === 'pending' || claim.status === 'verified')) {
    return (
      <SurveyShell>
        <Card className="text-center">
          <Loader2 size={36} className="mx-auto text-[#111] animate-spin" />
          <h1 className="mt-3 text-[18px] font-bold text-[#111]">確認しています</h1>
          <p className="mt-2 text-[14px] text-[#6b6b6b] leading-relaxed">
            {result?.message || '担当者が確認しています。確定したら公式LINEとこの画面でお知らせします。'}
          </p>
        </Card>
        <BackToMyPage />
      </SurveyShell>
    )
  }

  return (
    <SurveyShell>
      <Card>
        {claim?.status === 'rejected' ? (
          <div className="rounded-[16px] bg-[#c8102e]/5 p-4 mb-5 flex gap-3">
            <XCircle size={20} className="text-[#c8102e] shrink-0 mt-0.5" />
            <div>
              <p className="text-[14px] font-bold text-[#111]">レビュー投稿を確認できませんでした</p>
              {claim.reason && <p className="text-[13px] text-[#6b6b6b] mt-1">{claim.reason}</p>}
              <p className="text-[13px] text-[#6b6b6b] mt-1">スクリーンショットを選び直して、もう一度お試しください。</p>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[12px] font-bold tracking-[0.12em] text-[#6b6b6b] text-center">AMAZONレビュー投稿特典</p>
            <h1 className="mt-1 text-[22px] font-bold text-[#111] text-center leading-snug">リストラップを<br />無料でプレゼント</h1>
            <img src="/my-fitpeak/wrist-wrap.png" alt="リストラップ" className="mt-4 mx-auto max-h-44 object-contain"
              onError={(e) => { e.currentTarget.style.display = 'none' }} />
            <p className="mt-3 text-[14px] text-[#6b6b6b] text-center leading-relaxed">
              Amazonにレビューを投稿してスクリーンショットを送ると、<br />100%OFF＋送料無料（¥0）でお届けします。お一人様1回限り。
            </p>
          </>
        )}

        <div className="mt-5 space-y-3">
          <UploadSlot label="① レビュー作成画面" hint="★・タイトル・本文を入力した「レビューを書く」画面（任意）"
            fileId={compose.fileId} preview={compose.preview} busy={busySlot === 1} onPick={(f) => upload(1, f)} />
          <UploadSlot label="② 投稿後の画面" hint="投稿が完了し、レビューが表示されている画面（必須）"
            fileId={posted.fileId} preview={posted.preview} busy={busySlot === 2} onPick={(f) => upload(2, f)} />
        </div>
        <ErrorText>{error}</ErrorText>
        <div className="mt-5">
          <PillButton onClick={submit} disabled={!posted.fileId || submitting || busySlot !== 0}>
            {submitting ? '確認中...（30秒ほどかかります）' : claim?.status === 'rejected' ? 'もう一度確認する' : '無料プレゼントを受け取る'}
          </PillButton>
        </div>
        <p className="mt-3 text-[11px] text-[#9a9a9a] text-center leading-relaxed">
          スクリーンショットは確認のためだけに使い、公開しません。
        </p>
      </Card>
      <BackToMyPage />
    </SurveyShell>
  )
}
