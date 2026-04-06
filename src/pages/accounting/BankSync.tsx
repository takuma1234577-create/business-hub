import { useState, useEffect, useCallback } from 'react'
import { bankSyncApi, financialAccountApi } from './api'
import type { BankCredential, ScrapingJob, SupportedInstitution, FinancialAccount } from './types'
import { SYNC_STATUS_LABELS } from './types'
import {
  RefreshCw, Plus, Trash2, Power, PowerOff, Eye, EyeOff,
  CheckCircle, AlertCircle, Clock, Loader2, Shield, Building2, CreditCard,
} from 'lucide-react'

const formatDate = (d: string | null) => {
  if (!d) return '-'
  return new Date(d).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function BankSync() {
  const [institutions, setInstitutions] = useState<SupportedInstitution[]>([])
  const [credentials, setCredentials] = useState<BankCredential[]>([])
  const [accounts, setAccounts] = useState<FinancialAccount[]>([])
  const [jobs, setJobs] = useState<ScrapingJob[]>([])
  const [loading, setLoading] = useState(true)

  // 追加フォーム
  const [showAddForm, setShowAddForm] = useState(false)
  const [formAccountId, setFormAccountId] = useState('')
  const [formInstitutionCode, setFormInstitutionCode] = useState('')
  const [formLoginId, setFormLoginId] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [adding, setAdding] = useState(false)

  // 同期中の追跡
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set())

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [inst, creds, accs, jbs] = await Promise.all([
        bankSyncApi.listInstitutions(),
        bankSyncApi.listCredentials(),
        financialAccountApi.list(),
        bankSyncApi.listJobs(20),
      ])
      setInstitutions(inst)
      setCredentials(creds)
      setAccounts(accs)
      setJobs(jbs)
    } catch (err) {
      console.error('Failed to load bank sync data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // （同期実行のため個別ポーリング不要 - handleSync内でリアルタイム更新）

  const handleAdd = async () => {
    if (!formAccountId || !formInstitutionCode || !formLoginId || !formPassword) {
      return alert('全項目を入力してください')
    }
    setAdding(true)
    try {
      await bankSyncApi.addCredential({
        accountId: formAccountId,
        institutionCode: formInstitutionCode,
        loginId: formLoginId,
        password: formPassword,
      })
      setShowAddForm(false)
      setFormAccountId('')
      setFormInstitutionCode('')
      setFormLoginId('')
      setFormPassword('')
      fetchAll()
    } catch (err) {
      console.error(err)
      alert('追加に失敗しました')
    } finally {
      setAdding(false)
    }
  }

  // 同期中のステータスメッセージ
  const [syncMessage, setSyncMessage] = useState('')
  // 2FAモーダル
  const [twoFaJobId, setTwoFaJobId] = useState<string | null>(null)
  const [twoFaCode, setTwoFaCode] = useState('')
  const [twoFaSubmitting, setTwoFaSubmitting] = useState(false)

  const handleSync = async (credentialId: string) => {
    try {
      setSyncingIds(prev => new Set(prev).add(credentialId))
      setSyncMessage('銀行サイトに接続中...')

      const result = await bankSyncApi.triggerSync(credentialId)

      if (result.mode === 'railway') {
        // Railway非同期モード: ジョブIDでポーリング開始
        setSyncMessage('Railway経由で処理中... スマート認証が必要な場合はモーダルが表示されます')
        pollJobStatus(result.jobId!, credentialId)
        return
      }

      // 直接実行モード（Railway未設定時）
      setSyncMessage('')
      setSyncingIds(prev => { const s = new Set(prev); s.delete(credentialId); return s })
      fetchAll()

      if (result.imported && result.imported > 0) {
        alert(`同期完了: ${result.found}件取得 / ${result.imported}件登録 / ${result.skipped}件スキップ`)
      } else if (result.found === 0) {
        alert('同期完了: 新しい取引はありませんでした')
      }
    } catch (err: unknown) {
      console.error(err)
      setSyncMessage('')
      setSyncingIds(prev => { const s = new Set(prev); s.delete(credentialId); return s })
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || '同期に失敗しました'
      alert(msg)
      fetchAll()
    }
  }

  // Railway非同期ジョブのポーリング
  const pollJobStatus = (jobId: string, credentialId: string) => {
    const interval = setInterval(async () => {
      try {
        const [creds, jbs] = await Promise.all([
          bankSyncApi.listCredentials(),
          bankSyncApi.listJobs(5),
        ])
        setCredentials(creds)
        setJobs(jbs)

        const job = jbs.find((j: ScrapingJob) => j.id === jobId)
        if (!job) return

        if (job.status === 'waiting_2fa') {
          setSyncMessage('2FA認証が必要です')
          setTwoFaJobId(jobId)
        } else if (job.status === 'done') {
          clearInterval(interval)
          setSyncMessage('')
          setSyncingIds(prev => { const s = new Set(prev); s.delete(credentialId); return s })
          setTwoFaJobId(null)
          fetchAll()
          alert(`同期完了: ${job.transactionsImported}件登録`)
        } else if (job.status === 'error') {
          clearInterval(interval)
          setSyncMessage('')
          setSyncingIds(prev => { const s = new Set(prev); s.delete(credentialId); return s })
          setTwoFaJobId(null)
          fetchAll()
          alert(`同期エラー: ${job.errorMessage}`)
        } else {
          const cred = creds.find((c: BankCredential) => c.id === credentialId)
          if (cred?.syncError) setSyncMessage(cred.syncError)
        }
      } catch { /* ignore */ }
    }, 3000)
  }

  const handleSubmit2fa = async () => {
    if (!twoFaJobId || !twoFaCode) return
    setTwoFaSubmitting(true)
    try {
      await bankSyncApi.submit2fa(twoFaJobId, twoFaCode)
      setTwoFaCode('')
      setSyncMessage('2FAコードを送信しました。処理を再開中...')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || '送信失敗'
      alert(msg)
    } finally {
      setTwoFaSubmitting(false)
    }
  }

  const handleSyncAll = async () => {
    try {
      const ids = credentials.filter(c => c.isActive).map(c => c.id)
      setSyncingIds(new Set(ids))
      await bankSyncApi.triggerAll()
    } catch (err) {
      console.error(err)
      alert('一括同期の開始に失敗しました')
    }
  }

  const handleToggleActive = async (cred: BankCredential) => {
    try {
      await bankSyncApi.updateCredential(cred.id, { isActive: !cred.isActive })
      fetchAll()
    } catch (err) {
      console.error(err)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('この接続設定を削除しますか？')) return
    try {
      await bankSyncApi.deleteCredential(id)
      fetchAll()
    } catch (err) {
      console.error(err)
      alert('削除に失敗しました')
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle size={16} className="text-emerald-500" />
      case 'running': return <Loader2 size={16} className="text-blue-500 animate-spin" />
      case 'error': return <AlertCircle size={16} className="text-red-500" />
      case 'awaiting_2fa': return <Shield size={16} className="text-amber-500" />
      default: return <Clock size={16} className="text-gray-400" />
    }
  }

  const supportedInstitutions = institutions.filter(i => i.status === 'supported')
  const plannedInstitutions = institutions.filter(i => i.status === 'planned')

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-20 bg-gray-100 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-gray-700">自動取り込み設定</h3>
          <p className="text-xs text-gray-400 mt-0.5">銀行・カードのオンラインバンキングから取引を自動取得します</p>
        </div>
        <div className="flex gap-2">
          {credentials.length > 0 && (
            <button onClick={handleSyncAll} disabled={syncingIds.size > 0}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
              <RefreshCw size={14} className={syncingIds.size > 0 ? 'animate-spin' : ''} />
              全件同期
            </button>
          )}
          <button onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-700">
            <Plus size={14} /> 接続追加
          </button>
        </div>
      </div>

      {/* 追加フォーム */}
      {showAddForm && (
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <h4 className="text-sm font-medium text-gray-700 mb-3">新しい接続を追加</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">口座 *</label>
              <select value={formAccountId} onChange={e => setFormAccountId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="">口座を選択...</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.accountName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">金融機関 *</label>
              <select value={formInstitutionCode} onChange={e => setFormInstitutionCode(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="">金融機関を選択...</option>
                <optgroup label="対応済み">
                  {supportedInstitutions.map(i => (
                    <option key={i.code} value={i.code}>{i.name}</option>
                  ))}
                </optgroup>
                <optgroup label="対応予定">
                  {plannedInstitutions.map(i => (
                    <option key={i.code} value={i.code} disabled>{i.name}（準備中）</option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">ログインID *</label>
              <input value={formLoginId} onChange={e => setFormLoginId(e.target.value)}
                placeholder="オンラインバンキングのID" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">パスワード *</label>
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} value={formPassword}
                  onChange={e => setFormPassword(e.target.value)}
                  placeholder="ログインパスワード"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm" />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </div>
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
            認証情報はAES-256-GCMで暗号化して保存されます。平文での保存は行いません。
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={handleAdd} disabled={adding}
              className="px-4 py-2 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-700 disabled:opacity-50">
              {adding ? '追加中...' : '追加'}
            </button>
            <button onClick={() => setShowAddForm(false)}
              className="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300">キャンセル</button>
          </div>
        </div>
      )}

      {/* 同期中メッセージ */}
      {syncMessage && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center gap-3">
          <Loader2 size={20} className="text-blue-500 animate-spin shrink-0" />
          <div>
            <p className="text-sm font-medium text-blue-800">{syncMessage}</p>
            <p className="text-xs text-blue-600 mt-0.5">処理完了まで最大60秒かかる場合があります。このページを閉じないでください。</p>
          </div>
        </div>
      )}

      {/* 2FAモーダル */}
      {twoFaJobId && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-center gap-3 mb-3">
            <Shield size={20} className="text-amber-600" />
            <div>
              <p className="text-sm font-medium text-amber-800">二要素認証（2FA）が必要です</p>
              <p className="text-xs text-amber-600">銀行から届いたSMSコード、またはアプリの認証コードを入力してください</p>
            </div>
          </div>
          <div className="flex gap-2">
            <input value={twoFaCode} onChange={e => setTwoFaCode(e.target.value)}
              placeholder="認証コードを入力..."
              className="flex-1 border border-amber-300 rounded-lg px-3 py-2 text-sm bg-white"
              onKeyDown={e => e.key === 'Enter' && handleSubmit2fa()} />
            <button onClick={handleSubmit2fa} disabled={!twoFaCode || twoFaSubmitting}
              className="px-4 py-2 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700 disabled:opacity-50">
              {twoFaSubmitting ? '送信中...' : '送信'}
            </button>
          </div>
        </div>
      )}

      {/* 接続一覧 */}
      {credentials.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-400">
          <Building2 size={32} className="mx-auto mb-2" />
          <p>接続が設定されていません</p>
          <p className="text-xs mt-1">「接続追加」から銀行・カードのログイン情報を登録してください</p>
        </div>
      ) : (
        <div className="space-y-3">
          {credentials.map(cred => {
            const account = accounts.find(a => a.id === cred.accountId)
            const isSyncing = syncingIds.has(cred.id) || cred.syncStatus === 'running'
            return (
              <div key={cred.id} className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {getStatusIcon(cred.syncStatus)}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{cred.institutionName}</span>
                        {!cred.isActive && (
                          <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">無効</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">
                        {account?.accountName || '不明な口座'}
                        <span className="mx-1.5 text-gray-300">|</span>
                        最終同期: {formatDate(cred.lastSyncAt)}
                        <span className="mx-1.5 text-gray-300">|</span>
                        {SYNC_STATUS_LABELS[cred.syncStatus]}
                      </p>
                      {cred.syncError && cred.syncStatus === 'error' && (
                        <p className="text-xs text-red-500 mt-1">{cred.syncError}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleSync(cred.id)} disabled={isSyncing || !cred.isActive}
                      title="同期実行"
                      className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 text-blue-600">
                      <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} />
                    </button>
                    <button onClick={() => handleToggleActive(cred)}
                      title={cred.isActive ? '無効化' : '有効化'}
                      className={`p-2 rounded-lg hover:bg-gray-100 ${cred.isActive ? 'text-emerald-600' : 'text-gray-400'}`}>
                      {cred.isActive ? <Power size={16} /> : <PowerOff size={16} />}
                    </button>
                    <button onClick={() => handleDelete(cred.id)}
                      title="削除"
                      className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-red-500">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 同期ログ */}
      {jobs.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-medium text-gray-700">同期ログ</h3>
          </div>
          <div className="divide-y divide-gray-100">
            {jobs.map(job => {
              const cred = credentials.find(c => c.id === job.credentialId)
              return (
                <div key={job.id} className="px-5 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {getStatusIcon(job.status)}
                    <div>
                      <p className="text-sm text-gray-900">
                        {cred?.institutionName || '不明'}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatDate(job.startedAt)}
                        {job.status === 'success' && (
                          <span className="ml-2 text-emerald-600">
                            取得{job.transactionsFound}件 / 登録{job.transactionsImported}件 / スキップ{job.transactionsSkipped}件
                          </span>
                        )}
                        {job.errorMessage && (
                          <span className="ml-2 text-red-500">{job.errorMessage}</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    job.status === 'success' ? 'bg-emerald-100 text-emerald-700' :
                    job.status === 'error' ? 'bg-red-100 text-red-700' :
                    job.status === 'running' ? 'bg-blue-100 text-blue-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {job.status === 'success' ? '完了' : job.status === 'error' ? 'エラー' : job.status === 'running' ? '実行中' : job.status}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 対応状況 */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h3 className="text-sm font-medium text-gray-700 mb-3">対応金融機関</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {institutions.map(inst => (
            <div key={inst.code} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
              inst.status === 'supported' ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-50 text-gray-500'
            }`}>
              {inst.type === 'credit_card'
                ? <CreditCard size={14} />
                : <Building2 size={14} />
              }
              <span>{inst.name}</span>
              {inst.status === 'supported'
                ? <CheckCircle size={12} className="ml-auto text-emerald-500" />
                : <Clock size={12} className="ml-auto text-gray-400" />
              }
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
