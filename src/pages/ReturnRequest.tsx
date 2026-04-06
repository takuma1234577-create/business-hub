import { useState, useRef } from 'react'
import ToolLayout from '../components/ToolLayout'
import {
  Upload,
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  ImageIcon,
} from 'lucide-react'

type RequestType = 'return' | 'exchange'
type ReasonCode = 'defective' | 'wrong_item' | 'size_color_mismatch' | 'other'

interface ReviewResult {
  result: 'approved' | 'denied'
  requestType: string
  aiConfidence: number
  aiReason: string
  shopifyResult: string
  lineNotified: boolean
}

const REASON_OPTIONS: { value: ReasonCode; label: string }[] = [
  { value: 'defective', label: '商品の初期不良（破損・傷など）' },
  { value: 'wrong_item', label: '届いた商品が注文と異なる（誤送品）' },
  { value: 'size_color_mismatch', label: 'サイズ・カラーが違う' },
  { value: 'other', label: 'その他' },
]

type Step = 'form' | 'reviewing' | 'result'

export default function ReturnRequest() {
  const [step, setStep] = useState<Step>('form')
  const [orderId, setOrderId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [requestType, setRequestType] = useState<RequestType>('return')
  const [reason, setReason] = useState<ReasonCode>('defective')
  const [reasonDetail, setReasonDetail] = useState('')
  const [shippingAddress, setShippingAddress] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImageAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    const remaining = 5 - images.length
    const filesToProcess = Array.from(files).slice(0, remaining)

    filesToProcess.forEach((file) => {
      if (!file.type.match(/^image\/(jpeg|png)$/)) {
        setError('JPEG または PNG ファイルのみアップロード可能です')
        return
      }
      if (file.size > 10 * 1024 * 1024) {
        setError('ファイルサイズは10MB以下にしてください')
        return
      }

      const reader = new FileReader()
      reader.onload = () => {
        const base64 = reader.result as string
        setImages((prev) => [...prev, base64])
        setImagePreviews((prev) => [...prev, base64])
      }
      reader.readAsDataURL(file)
    })

    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index))
    setImagePreviews((prev) => prev.filter((_, i) => i !== index))
  }

  const validate = (): string | null => {
    if (!orderId.trim()) return '注文番号を入力してください'
    if (!customerName.trim()) return 'お名前を入力してください'
    if (reason === 'other' && !reasonDetail.trim())
      return '「その他」を選択した場合、補足説明が必要です'
    if (requestType === 'exchange' && !shippingAddress.trim())
      return '交換の場合、返品先住所を入力してください'
    if (images.length === 0) return '証拠写真を1枚以上アップロードしてください'
    return null
  }

  const handleSubmit = async () => {
    setError('')
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setStep('reviewing')

    // Minimum 3 seconds display for reviewing screen
    const minWait = new Promise((resolve) => setTimeout(resolve, 3000))

    try {
      const [response] = await Promise.all([
        fetch('/api/return-review/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: orderId.trim(),
            customerName: customerName.trim(),
            requestType,
            reason,
            reasonDetail: reasonDetail.trim() || undefined,
            shippingAddress:
              requestType === 'exchange' ? shippingAddress.trim() : undefined,
            images,
          }),
        }),
        minWait,
      ])

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.error || `エラーが発生しました (${response.status})`)
      }

      const result = await response.json()
      setReviewResult(result)
      setStep('result')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '審査中にエラーが発生しました')
      setStep('form')
    }
  }

  const handleReset = () => {
    setStep('form')
    setOrderId('')
    setCustomerName('')
    setRequestType('return')
    setReason('defective')
    setReasonDetail('')
    setShippingAddress('')
    setImages([])
    setImagePreviews([])
    setReviewResult(null)
    setError('')
  }

  // ── Reviewing screen ──
  if (step === 'reviewing') {
    return (
      <ToolLayout title="返品・交換審査システム">
        <div className="flex flex-col items-center justify-center py-24">
          <Loader2 size={48} className="animate-spin text-blue-500 mb-6" />
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
            審査中...
          </h2>
          <p className="text-slate-500 dark:text-slate-400">
            AI が証拠写真と申請内容を審査しています
          </p>
        </div>
      </ToolLayout>
    )
  }

  // ── Result screen ──
  if (step === 'result' && reviewResult) {
    const approved = reviewResult.result === 'approved'
    return (
      <ToolLayout title="返品・交換審査システム">
        <div className="max-w-lg mx-auto">
          <div
            className={`rounded-xl border-2 p-8 text-center ${
              approved
                ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30'
                : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30'
            }`}
          >
            {approved ? (
              <CheckCircle2 size={56} className="mx-auto text-green-500 mb-4" />
            ) : (
              <XCircle size={56} className="mx-auto text-red-500 mb-4" />
            )}

            <h2
              className={`text-2xl font-bold mb-2 ${
                approved
                  ? 'text-green-700 dark:text-green-400'
                  : 'text-red-700 dark:text-red-400'
              }`}
            >
              {approved ? '承認されました' : '承認されませんでした'}
            </h2>

            <p className="text-slate-600 dark:text-slate-300 mb-6">
              {reviewResult.aiReason}
            </p>

            <div className="space-y-2 text-sm text-left bg-white dark:bg-slate-900 rounded-lg p-4">
              <div className="flex justify-between">
                <span className="text-slate-500">申請タイプ</span>
                <span className="font-medium text-slate-900 dark:text-white">
                  {reviewResult.requestType === 'return' ? '返品・返金' : '交換'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">AI確信度</span>
                <span className="font-medium text-slate-900 dark:text-white">
                  {(reviewResult.aiConfidence * 100).toFixed(0)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Shopify処理</span>
                <span className="font-medium text-slate-900 dark:text-white">
                  {reviewResult.shopifyResult === 'success'
                    ? '完了'
                    : reviewResult.shopifyResult === 'skipped'
                      ? 'スキップ'
                      : 'エラー'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">LINE通知</span>
                <span className="font-medium text-slate-900 dark:text-white">
                  {reviewResult.lineNotified ? '送信済み' : '未送信'}
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={handleReset}
            className="mt-6 w-full py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition font-medium"
          >
            新しい申請を作成
          </button>
        </div>
      </ToolLayout>
    )
  }

  // ── Form screen ──
  return (
    <ToolLayout title="返品・交換審査システム">
      <div className="max-w-lg mx-auto space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
            返品・交換申請フォーム
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            必要事項を入力して申請してください。AIが自動で審査します。
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Order ID */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            注文番号 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            placeholder="#1001"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Customer Name */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            お名前 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="山田太郎"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Request Type */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            申請タイプ <span className="text-red-500">*</span>
          </label>
          <div className="flex gap-4">
            {(['return', 'exchange'] as const).map((type) => (
              <label
                key={type}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border cursor-pointer transition ${
                  requestType === type
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <input
                  type="radio"
                  name="requestType"
                  value={type}
                  checked={requestType === type}
                  onChange={() => setRequestType(type)}
                  className="sr-only"
                />
                {type === 'return' ? '返品・返金' : '交換'}
              </label>
            ))}
          </div>
        </div>

        {/* Reason */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            返品・交換理由 <span className="text-red-500">*</span>
          </label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as ReasonCode)}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {REASON_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Reason Detail */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            補足説明 {reason === 'other' && <span className="text-red-500">*</span>}
          </label>
          <textarea
            value={reasonDetail}
            onChange={(e) => setReasonDetail(e.target.value)}
            rows={3}
            placeholder="詳細を記入してください..."
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        {/* Shipping Address (exchange only) */}
        {requestType === 'exchange' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              返品先住所 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={shippingAddress}
              onChange={(e) => setShippingAddress(e.target.value)}
              placeholder="東京都渋谷区..."
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        {/* Image Upload */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            証拠写真 <span className="text-red-500">*</span>
            <span className="font-normal text-slate-400 ml-1">
              （最大5枚、JPEG/PNG）
            </span>
          </label>

          {imagePreviews.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              {imagePreviews.map((src, i) => (
                <div key={i} className="relative group">
                  <img
                    src={src}
                    alt={`証拠写真 ${i + 1}`}
                    className="w-full h-24 object-cover rounded-lg border border-slate-200 dark:border-slate-700"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 transition cursor-pointer"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {images.length < 5 && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-6 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-lg flex flex-col items-center gap-2 text-slate-500 dark:text-slate-400 hover:border-blue-400 hover:text-blue-500 transition cursor-pointer"
            >
              {images.length === 0 ? (
                <Upload size={24} />
              ) : (
                <ImageIcon size={24} />
              )}
              <span className="text-sm">
                {images.length === 0
                  ? '写真をアップロード'
                  : `追加（残り${5 - images.length}枚）`}
              </span>
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png"
            multiple
            onChange={handleImageAdd}
            className="hidden"
          />
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          className="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition cursor-pointer"
        >
          申請を送信する
        </button>
      </div>
    </ToolLayout>
  )
}
