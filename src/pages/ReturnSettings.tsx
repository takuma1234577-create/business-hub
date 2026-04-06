import { useState, useEffect } from 'react'
import ToolLayout from '../components/ToolLayout'
import { Save, Loader2, CheckCircle2 } from 'lucide-react'

interface Settings {
  return_period_days: number
  extension_rule: string
  extension_custom_days: number
  allowed_reasons: string[]
  ai_strictness: number
  shopify_store_url: string
  shopify_admin_token: string
  line_channel_token: string
  line_crm_api_url: string
  approve_template: string
  deny_template: string
}

const DEFAULT_SETTINGS: Settings = {
  return_period_days: 30,
  extension_rule: 'none',
  extension_custom_days: 0,
  allowed_reasons: ['defective', 'wrong_item', 'size_color_mismatch'],
  ai_strictness: 50,
  shopify_store_url: '',
  shopify_admin_token: '',
  line_channel_token: '',
  line_crm_api_url: '',
  approve_template:
    '{customerName}様\n\nご注文番号 {orderId} の{requestType}申請が承認されました。\n\n理由: {reason}',
  deny_template:
    '{customerName}様\n\nご注文番号 {orderId} の{requestType}申請は承認されませんでした。\n\n理由: {reason}',
}

const REASON_OPTIONS = [
  { value: 'defective', label: '商品の初期不良' },
  { value: 'wrong_item', label: '誤送品' },
  { value: 'size_color_mismatch', label: 'サイズ・カラー不一致' },
  { value: 'changed_mind', label: '気が変わった' },
  { value: 'other', label: 'その他' },
]

const EXTENSION_OPTIONS = [
  { value: 'none', label: '延長なし' },
  { value: 'scratch_90', label: 'スクラッチ当選：90日' },
  { value: 'custom', label: 'カスタム日数入力' },
]

function getStrictnessLabel(v: number) {
  if (v === 0) return '画像審査なし（自動承認）'
  if (v <= 25) return '低（confidence 50%以上）'
  if (v <= 50) return '標準（confidence 65%以上）'
  if (v <= 75) return '高（confidence 80%以上）'
  return '最高厳格（confidence 90%以上）'
}

export default function ReturnSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/return-review/settings')
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) {
          setSettings({ ...DEFAULT_SETTINGS, ...data })
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setSaved(false)

    try {
      const resp = await fetch('/api/return-review/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || '保存に失敗しました')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const toggleReason = (reason: string) => {
    setSettings((prev) => ({
      ...prev,
      allowed_reasons: prev.allowed_reasons.includes(reason)
        ? prev.allowed_reasons.filter((r) => r !== reason)
        : [...prev.allowed_reasons, reason],
    }))
  }

  if (loading) {
    return (
      <ToolLayout title="審査ルール設定">
        <div className="flex justify-center py-16">
          <Loader2 size={32} className="animate-spin text-slate-400" />
        </div>
      </ToolLayout>
    )
  }

  return (
    <ToolLayout title="審査ルール設定">
      <div className="max-w-2xl mx-auto space-y-8">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Return Period */}
        <section className="bg-white dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 p-6">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4">
            返品期間設定
          </h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                標準返品期間（日数）
              </label>
              <input
                type="number"
                min={1}
                max={365}
                value={settings.return_period_days}
                onChange={(e) =>
                  setSettings((p) => ({
                    ...p,
                    return_period_days: parseInt(e.target.value) || 30,
                  }))
                }
                className="w-32 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                キャンペーン延長ルール
              </label>
              <select
                value={settings.extension_rule}
                onChange={(e) =>
                  setSettings((p) => ({ ...p, extension_rule: e.target.value }))
                }
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {EXTENSION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {settings.extension_rule === 'custom' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  カスタム延長日数
                </label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={settings.extension_custom_days}
                  onChange={(e) =>
                    setSettings((p) => ({
                      ...p,
                      extension_custom_days: parseInt(e.target.value) || 0,
                    }))
                  }
                  className="w-32 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
          </div>
        </section>

        {/* Allowed Reasons */}
        <section className="bg-white dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 p-6">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4">
            承認する返品理由
          </h3>
          <div className="space-y-3">
            {REASON_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-3 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={settings.allowed_reasons.includes(opt.value)}
                  onChange={() => toggleReason(opt.value)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-slate-700 dark:text-slate-300">
                  {opt.label}
                </span>
              </label>
            ))}
          </div>
        </section>

        {/* AI Strictness */}
        <section className="bg-white dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 p-6">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4">
            AI審査厳格度
          </h3>
          <div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={settings.ai_strictness}
              onChange={(e) =>
                setSettings((p) => ({
                  ...p,
                  ai_strictness: parseInt(e.target.value),
                }))
              }
              className="w-full accent-blue-600"
            />
            <div className="flex justify-between mt-1">
              <span className="text-xs text-slate-400">0（自動承認）</span>
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {settings.ai_strictness} — {getStrictnessLabel(settings.ai_strictness)}
              </span>
              <span className="text-xs text-slate-400">100（最高厳格）</span>
            </div>
          </div>
        </section>

        {/* Shopify Settings */}
        <section className="bg-white dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 p-6">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4">
            Shopify連携設定
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Shopify Store URL
              </label>
              <input
                type="text"
                value={settings.shopify_store_url}
                onChange={(e) =>
                  setSettings((p) => ({ ...p, shopify_store_url: e.target.value }))
                }
                placeholder="https://your-store.myshopify.com"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Admin API Access Token
              </label>
              <input
                type="password"
                value={settings.shopify_admin_token}
                onChange={(e) =>
                  setSettings((p) => ({ ...p, shopify_admin_token: e.target.value }))
                }
                placeholder="shpat_xxxx"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </section>

        {/* LINE CRM Settings */}
        <section className="bg-white dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 p-6">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4">
            LINE CRM連携設定
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                LINE Bot Channel Access Token
              </label>
              <input
                type="password"
                value={settings.line_channel_token}
                onChange={(e) =>
                  setSettings((p) => ({ ...p, line_channel_token: e.target.value }))
                }
                placeholder="Channel Access Token"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                LINE CRM API URL
              </label>
              <input
                type="text"
                value={settings.line_crm_api_url}
                onChange={(e) =>
                  setSettings((p) => ({ ...p, line_crm_api_url: e.target.value }))
                }
                placeholder="https://your-line-crm.vercel.app/api"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </section>

        {/* Message Templates */}
        <section className="bg-white dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 p-6">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-2">
            メッセージテンプレート
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
            使用可能な変数: {'{customerName}'} {'{orderId}'} {'{requestType}'} {'{reason}'}
          </p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                承認メッセージテンプレート
              </label>
              <textarea
                value={settings.approve_template}
                onChange={(e) =>
                  setSettings((p) => ({ ...p, approve_template: e.target.value }))
                }
                rows={4}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                否認メッセージテンプレート
              </label>
              <textarea
                value={settings.deny_template}
                onChange={(e) =>
                  setSettings((p) => ({ ...p, deny_template: e.target.value }))
                }
                rows={4}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-sm font-mono"
              />
            </div>
          </div>
        </section>

        {/* Save Button */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium transition cursor-pointer"
          >
            {saving ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Save size={18} />
            )}
            {saving ? '保存中...' : '設定を保存'}
          </button>
          {saved && (
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400 text-sm">
              <CheckCircle2 size={16} /> 保存しました
            </span>
          )}
        </div>
      </div>
    </ToolLayout>
  )
}
