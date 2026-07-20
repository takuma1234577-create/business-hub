import { useState } from 'react'
import axios from 'axios'
import { Plus, Trash2, Copy, Check, CheckCircle2, Ban, MessageCircle } from 'lucide-react'
import type { LineAccount } from './types'
import { useLineAccounts } from './useLineAccounts'

const api = axios.create({ baseURL: '/api/line-crm' })
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export default function LineAccounts() {
  const { accounts, loading, reload } = useLineAccounts()
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [channelSecret, setChannelSecret] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const resetForm = () => {
    setDisplayName('')
    setAccessToken('')
    setChannelSecret('')
    setError('')
  }

  const handleCreate = async () => {
    if (!displayName.trim() || !accessToken.trim() || !channelSecret.trim()) {
      setError('表示名・チャンネルアクセストークン・チャンネルシークレットは必須です')
      return
    }
    setSaving(true)
    setError('')
    try {
      await api.post<LineAccount>('/accounts', {
        display_name: displayName.trim(),
        channel_access_token: accessToken.trim(),
        channel_secret: channelSecret.trim(),
      })
      resetForm()
      setShowForm(false)
      reload()
    } catch (err) {
      setError(axios.isAxiosError(err) ? err.response?.data?.error || err.message : '追加に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (account: LineAccount) => {
    try {
      await api.put(`/accounts/${account.id}`, { is_active: !account.is_active })
      reload()
    } catch (err) {
      alert(axios.isAxiosError(err) ? err.response?.data?.error || err.message : '更新に失敗しました')
    }
  }

  const handleDelete = async (account: LineAccount) => {
    if (!confirm(`「${account.display_name}」を削除しますか？`)) return
    try {
      await api.delete(`/accounts/${account.id}`)
      reload()
    } catch (err) {
      alert(axios.isAxiosError(err) ? err.response?.data?.error || err.message : '削除に失敗しました')
    }
  }

  const handleCopy = (url: string, id: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1500)
    })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            LINEアカウント管理
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            複数の公式LINEアカウントを追加・管理できます。友だち・チャット・テンプレート等はアカウントごとに分離されます。
          </p>
        </div>
        <button
          onClick={() => { setShowForm((v) => !v); resetForm() }}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#06C755] text-white text-sm font-medium hover:bg-[#05a648] transition cursor-pointer"
        >
          <Plus size={16} />
          アカウント追加
        </button>
      </div>

      {showForm && (
        <div className="mb-4 p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">表示名 *</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="例: FITPEAK 2号アカウント"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">チャンネルアクセストークン *</label>
            <input
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="チャネル基本設定 → チャネルアクセストークンで発行"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">チャンネルシークレット *</label>
            <input
              type="password"
              value={channelSecret}
              onChange={(e) => setChannelSecret(e.target.value)}
              placeholder="チャネル基本設定に記載"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-slate-400">LINE Developers Console → 対象チャネル → チャネル基本設定 で取得できます</p>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleCreate}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium hover:bg-slate-800 dark:hover:bg-slate-100 transition disabled:opacity-50 cursor-pointer"
            >
              {saving ? '接続確認中...' : '追加する'}
            </button>
            <button
              onClick={() => { setShowForm(false); resetForm() }}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-950 transition cursor-pointer"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => (
            <div key={account.id} className="flex items-start gap-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
              <div className="w-10 h-10 rounded-full bg-[#06C755]/10 flex items-center justify-center overflow-hidden flex-shrink-0">
                {account.bot_picture_url ? (
                  <img src={account.bot_picture_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <MessageCircle size={18} className="text-[#06C755]" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-medium text-slate-900 dark:text-white">{account.display_name}</h3>
                  {account.is_default && (
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                      既存アカウント
                    </span>
                  )}
                  {account.is_active ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/50 px-2 py-0.5 rounded-full">
                      <CheckCircle2 size={12} /> 有効
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                      <Ban size={12} /> 無効
                    </span>
                  )}
                </div>
                {(account.bot_display_name || account.bot_basic_id) && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {account.bot_display_name}{account.bot_basic_id ? ` (${account.bot_basic_id})` : ''}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-1.5">
                  <code className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 px-2 py-1 rounded-lg truncate max-w-md">
                    {account.webhook_url}
                  </code>
                  <button
                    onClick={() => handleCopy(account.webhook_url, account.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition cursor-pointer"
                    title="Webhook URLをコピー"
                  >
                    {copiedId === account.id ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                  </button>
                </div>
                {!account.is_default && (
                  <p className="text-xs text-slate-400 mt-1">
                    このURLをLINE Developers Console → 対象チャネル → Messaging API設定 の Webhook URL に設定してください
                  </p>
                )}
              </div>
              <button
                onClick={() => handleToggleActive(account)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer whitespace-nowrap"
              >
                {account.is_active ? '無効化' : '有効化'}
              </button>
              {!account.is_default && (
                <button
                  onClick={() => handleDelete(account)}
                  className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-950/50 transition cursor-pointer"
                  title="削除"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
