import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Target, RefreshCw, Send, SkipForward, Sparkles, Settings as SettingsIcon,
  Tag, Ticket, ExternalLink, CheckCircle, AlertCircle, PenLine, Save,
} from 'lucide-react'

interface Proposal {
  id: string
  friend_id: string
  line_user_id: string
  display_name: string | null
  segment: string | null
  objective: string | null
  recommended_product: string | null
  message: string
  link_type: 'amazon' | 'shopify' | 'my_fitpeak' | 'none'
  link_url: string | null
  coupon_amount: number
  coupon_code: string | null
  confidence: number | null
  reasoning: string | null
  status: 'pending' | 'sent' | 'skipped' | 'rejected' | 'failed'
  error: string | null
  created_at: string
  sent_at: string | null
}

interface Settings {
  enabled: boolean
  mode: 'proposal' | 'auto'
  cooldown_days: number
  daily_limit: number
  max_coupon_amount: number
  amazon_url: string
  shopify_url: string
  extra_instructions: string
}

type TabId = 'queue' | 'history' | 'settings'

const LINK_LABEL: Record<string, string> = {
  amazon: 'Amazon', shopify: '公式サイト', my_fitpeak: 'My FITPEAK', none: 'リンクなし',
}

export default function SalesAgent() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<TabId>('queue')
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [history, setHistory] = useState<Proposal[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editCoupon, setEditCoupon] = useState(0)
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const fetchProposals = useCallback(async () => {
    setLoading(true)
    try {
      const [pRes, hRes] = await Promise.all([
        fetch('/api/sales-agent/proposals?status=pending'),
        fetch('/api/sales-agent/proposals?status=sent'),
      ])
      if (pRes.ok) setProposals(await pRes.json())
      if (hRes.ok) setHistory(await hRes.json())
    } catch {
      setBanner({ type: 'error', msg: '提案の取得に失敗しました' })
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/sales-agent/settings')
      if (res.ok) setSettings(await res.json())
    } catch { /* noop */ }
  }, [])

  useEffect(() => { fetchProposals(); fetchSettings() }, [fetchProposals, fetchSettings])

  const flash = (type: 'success' | 'error', msg: string) => {
    setBanner({ type, msg })
    setTimeout(() => setBanner(null), 4000)
  }

  const handleGenerate = async () => {
    setGenerating(true)
    setBanner(null)
    try {
      const res = await fetch('/api/sales-agent/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (res.ok) {
        flash('success', `${data.scanned}人を分析し、${data.generated}件の提案を生成しました`)
        await fetchProposals()
      } else {
        flash('error', data.error || '生成に失敗しました')
      }
    } catch {
      flash('error', '生成処理でエラーが発生しました')
    } finally {
      setGenerating(false)
    }
  }

  const handleSend = async (p: Proposal) => {
    const couponNote = p.coupon_amount > 0 ? `\n・${p.coupon_amount}円OFFクーポンを発行します` : ''
    if (!confirm(`${p.display_name || 'このお客様'} にLINEメッセージを送信します。${couponNote}\n\n送信しますか？`)) return
    setBusyId(p.id)
    try {
      const res = await fetch(`/api/sales-agent/proposals/${p.id}/send`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        flash('success', `${p.display_name || 'お客様'} に送信しました`)
        await fetchProposals()
      } else {
        flash('error', data.error || '送信に失敗しました')
      }
    } catch {
      flash('error', '送信処理でエラーが発生しました')
    } finally {
      setBusyId(null)
    }
  }

  const handleSkip = async (p: Proposal) => {
    setBusyId(p.id)
    try {
      await fetch(`/api/sales-agent/proposals/${p.id}/skip`, { method: 'POST' })
      await fetchProposals()
    } catch { /* noop */ } finally {
      setBusyId(null)
    }
  }

  const startEdit = (p: Proposal) => {
    setEditId(p.id)
    setEditText(p.message)
    setEditCoupon(p.coupon_amount)
  }

  const saveEdit = async (id: string) => {
    setBusyId(id)
    try {
      const res = await fetch(`/api/sales-agent/proposals/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: editText, coupon_amount: editCoupon }),
      })
      if (res.ok) {
        setEditId(null)
        await fetchProposals()
      } else {
        flash('error', '保存に失敗しました')
      }
    } catch {
      flash('error', '保存に失敗しました')
    } finally {
      setBusyId(null)
    }
  }

  const saveSettings = async (patch: Partial<Settings>) => {
    if (!settings) return
    const next = { ...settings, ...patch }
    setSettings(next)
    try {
      await fetch('/api/sales-agent/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
    } catch {
      flash('error', '設定の保存に失敗しました')
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 cursor-pointer">
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-3 flex-1">
            <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center">
              <Target size={16} className="text-white" />
            </div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">営業エージェント</h1>
          </div>
          <button onClick={fetchProposals} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 cursor-pointer">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex gap-1 -mb-px">
            {([['queue', `提案キュー${proposals.length ? ` (${proposals.length})` : ''}`], ['history', '送信履歴'], ['settings', '設定']] as [TabId, string][]).map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer ${tab === id ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              >{label}</button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6">
        {banner && (
          <div className={`mb-4 px-4 py-3 rounded-xl text-sm border ${
            banner.type === 'error'
              ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
              : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
          }`}>{banner.msg}</div>
        )}

        {/* Queue tab */}
        {tab === 'queue' && (
          <div>
            <div className="mb-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl px-4 py-3 flex items-center gap-3">
              <p className="text-xs text-indigo-700 dark:text-indigo-400 flex-1">
                AIが友だち一人ひとりを分析し、購入につながる「次の一手」を提案します。内容を確認・編集して、ワンタップで送信できます。送信前に承認が必要なので、勝手に送られることはありません。
              </p>
              <button onClick={handleGenerate} disabled={generating}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium disabled:opacity-50 cursor-pointer whitespace-nowrap">
                {generating ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {generating ? '分析中...' : '提案を生成'}
              </button>
            </div>

            {proposals.length === 0 ? (
              <div className="text-center py-16 text-slate-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl">
                <Target size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">提案キューは空です</p>
                <p className="text-xs mt-1">「提案を生成」を押すと、AIが友だちを分析して提案を作成します</p>
              </div>
            ) : (
              <div className="space-y-3">
                {proposals.map(p => (
                  <div key={p.id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-slate-900 dark:text-white">{p.display_name || '（名前なし）'}</span>
                          {p.segment && <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">{p.segment}</span>}
                          {p.objective && <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500">{p.objective}</span>}
                          {p.confidence != null && <span className="text-[10px] text-slate-400">確度 {Math.round(p.confidence * 100)}%</span>}
                        </div>
                      </div>
                    </div>

                    {editId === p.id ? (
                      <div className="space-y-2 mb-3">
                        <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={6}
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 resize-y leading-relaxed" />
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-slate-500 flex items-center gap-1">
                            <Ticket size={12} /> クーポン:
                            <input type="number" value={editCoupon} min={0} step={100}
                              onChange={e => setEditCoupon(Number(e.target.value))}
                              className="w-20 ml-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />円
                          </label>
                          <button onClick={() => saveEdit(p.id)} disabled={busyId === p.id}
                            className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-500 text-white text-xs cursor-pointer disabled:opacity-50">
                            <Save size={12} /> 保存
                          </button>
                          <button onClick={() => setEditId(null)} className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-500 cursor-pointer">キャンセル</button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap bg-slate-50 dark:bg-slate-900/50 rounded-lg px-3 py-3 leading-relaxed mb-3">
                        {p.message}
                      </div>
                    )}

                    <div className="flex items-center gap-3 flex-wrap text-xs text-slate-500 mb-3">
                      {p.recommended_product && <span className="flex items-center gap-1"><Tag size={12} />{p.recommended_product}</span>}
                      <span className="flex items-center gap-1"><ExternalLink size={12} />{LINK_LABEL[p.link_type]}</span>
                      {p.coupon_amount > 0 && <span className="flex items-center gap-1 text-rose-500"><Ticket size={12} />{p.coupon_amount}円OFF</span>}
                    </div>

                    {p.reasoning && (
                      <p className="text-[11px] text-slate-400 mb-3 border-l-2 border-slate-200 dark:border-slate-700 pl-2">AI判断: {p.reasoning}</p>
                    )}

                    <div className="flex items-center gap-2 pt-3 border-t border-slate-100 dark:border-slate-700">
                      <button onClick={() => startEdit(p)} disabled={editId === p.id}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer disabled:opacity-40">
                        <PenLine size={13} /> 編集
                      </button>
                      <button onClick={() => handleSkip(p)} disabled={busyId === p.id}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer disabled:opacity-40">
                        <SkipForward size={13} /> スキップ
                      </button>
                      <button onClick={() => handleSend(p)} disabled={busyId === p.id}
                        className="ml-auto flex items-center gap-1.5 px-5 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium disabled:opacity-50 cursor-pointer">
                        {busyId === p.id ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                        承認して送信
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* History tab */}
        {tab === 'history' && (
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
            {history.length === 0 ? (
              <div className="text-center py-16 text-slate-400">
                <Send size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">送信履歴はまだありません</p>
              </div>
            ) : history.map(h => (
              <div key={h.id} className="px-4 py-3 border-b border-slate-100 dark:border-slate-700/50">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle size={13} className="text-green-500" />
                  <span className="text-sm font-medium text-slate-900 dark:text-white">{h.display_name || '（名前なし）'}</span>
                  {h.segment && <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500">{h.segment}</span>}
                  {h.coupon_code && <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-900/30 text-rose-500">{h.coupon_code}</span>}
                  <span className="ml-auto text-xs text-slate-400">{h.sent_at ? new Date(h.sent_at).toLocaleString('ja-JP') : ''}</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 whitespace-pre-wrap">{h.message}</p>
              </div>
            ))}
          </div>
        )}

        {/* Settings tab */}
        {tab === 'settings' && settings && (
          <div className="space-y-5 max-w-2xl">
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
              <h3 className="font-medium text-slate-900 dark:text-white mb-4 flex items-center gap-2"><SettingsIcon size={16} className="text-indigo-500" /> 動作モード</h3>

              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm text-slate-900 dark:text-white">日次の自動分析</p>
                  <p className="text-xs text-slate-500">毎日のcronで提案を自動生成します（送信は下記モードに従う）</p>
                </div>
                <button onClick={() => saveSettings({ enabled: !settings.enabled })}
                  className={`relative w-11 h-6 rounded-full transition cursor-pointer ${settings.enabled ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition ${settings.enabled ? 'translate-x-5' : ''}`} />
                </button>
              </div>

              <div className="py-3 border-t border-slate-100 dark:border-slate-700">
                <p className="text-sm text-slate-900 dark:text-white mb-2">送信モード</p>
                <div className="flex gap-2">
                  <button onClick={() => saveSettings({ mode: 'proposal' })}
                    className={`flex-1 px-3 py-2.5 rounded-lg text-xs font-medium border cursor-pointer ${settings.mode === 'proposal' ? 'bg-indigo-500 text-white border-indigo-500' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'}`}>
                    承認制（推奨）<br /><span className="font-normal opacity-80">人がワンタップで送信</span>
                  </button>
                  <button onClick={() => { if (settings.mode !== 'auto' && !confirm('自動送信モードでは、生成された提案がcronで自動的にお客様へ送信されます。\n本当に有効にしますか？')) return; saveSettings({ mode: 'auto' }) }}
                    className={`flex-1 px-3 py-2.5 rounded-lg text-xs font-medium border cursor-pointer ${settings.mode === 'auto' ? 'bg-rose-500 text-white border-rose-500' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'}`}>
                    自動送信<br /><span className="font-normal opacity-80">承認なしで自動配信</span>
                  </button>
                </div>
                {settings.mode === 'auto' && (
                  <p className="mt-2 text-xs text-rose-500 flex items-center gap-1"><AlertCircle size={12} /> 自動送信が有効です。実際のお客様に承認なしで送信されます。</p>
                )}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-4">
              <h3 className="font-medium text-slate-900 dark:text-white flex items-center gap-2"><SettingsIcon size={16} className="text-indigo-500" /> パラメータ</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {([
                  ['cooldown_days', '再アプローチ間隔（日）'],
                  ['daily_limit', '1回の生成上限（件）'],
                  ['max_coupon_amount', 'クーポン上限（円）'],
                ] as [keyof Settings, string][]).map(([key, label]) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">{label}</label>
                    <input type="number" value={settings[key] as number}
                      onChange={e => setSettings({ ...settings, [key]: Number(e.target.value) })}
                      onBlur={e => saveSettings({ [key]: Number(e.target.value) } as Partial<Settings>)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white" />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Amazon購入リンク</label>
                  <input type="text" value={settings.amazon_url}
                    onChange={e => setSettings({ ...settings, amazon_url: e.target.value })}
                    onBlur={e => saveSettings({ amazon_url: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">公式サイト購入リンク</label>
                  <input type="text" value={settings.shopify_url}
                    onChange={e => setSettings({ ...settings, shopify_url: e.target.value })}
                    onBlur={e => saveSettings({ shopify_url: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">営業方針の追加指示（任意）</label>
                <textarea value={settings.extra_instructions || ''} rows={3}
                  placeholder="例: 今月はニースリーブを重点的に。リピーターにはまとめ買いを提案。"
                  onChange={e => setSettings({ ...settings, extra_instructions: e.target.value })}
                  onBlur={e => saveSettings({ extra_instructions: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white resize-y" />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
