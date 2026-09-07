import { useState, useEffect, useCallback } from 'react'
import { Bot, Save, ToggleLeft, ToggleRight, RefreshCw, Users, Clock } from 'lucide-react'
import { creashotBotApi, tagApi } from './api'
import type { CreashotBotSettings, CreashotProfile, CreashotStats, CreashotQueueItem } from './api'
import type { Tag } from './types'

const INTENT_LABEL: Record<string, string> = {
  ready: '予約したい',
  considering: '検討中',
  unknown: '未判定',
  declined: '見送り',
}

const INTEREST_LABEL: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

const QUEUE_STATUS_LABEL: Record<string, string> = {
  pending: '送信待ち',
  sent: '送信済み',
  skipped: '送信せず',
  error: 'エラー',
}

const CREATINE_LABEL: Record<string, string> = {
  drinking: '飲んでいる',
  quit: '買ったけどやめた',
  never: '飲んだことがない',
}

export default function CreashotBot() {
  const [settings, setSettings] = useState<CreashotBotSettings | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [profiles, setProfiles] = useState<CreashotProfile[]>([])
  const [stats, setStats] = useState<CreashotStats | null>(null)
  const [queue, setQueue] = useState<CreashotQueueItem[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [sub, setSub] = useState<'settings' | 'queue' | 'profiles'>('settings')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [s, t, p, st, q] = await Promise.all([
        creashotBotApi.getSettings(),
        tagApi.list(),
        creashotBotApi.listProfiles(),
        creashotBotApi.stats(),
        creashotBotApi.queue(),
      ])
      setSettings(s)
      setTags(t)
      setProfiles(p)
      setStats(st)
      setQueue(q)
    } catch (err) {
      console.error('Failed to fetch creashot bot data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    try {
      const updated = await creashotBotApi.updateSettings({
        enabled: settings.enabled,
        tag_id: settings.tag_id,
        high_intent_tag_id: settings.high_intent_tag_id,
        knowledge: settings.knowledge,
        extra_instructions: settings.extra_instructions,
        auto_tagging: settings.auto_tagging,
        persona: settings.persona,
        opening_message: settings.opening_message,
        reply_delay_minutes: settings.reply_delay_minutes,
        opening_delay_minutes: settings.opening_delay_minutes,
      })
      setSettings(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('Failed to save creashot bot settings:', err)
    } finally {
      setSaving(false)
    }
  }

  const set = <K extends keyof CreashotBotSettings>(key: K, value: CreashotBotSettings[K]) => {
    if (!settings) return
    setSettings({ ...settings, [key]: value })
  }

  const targetTagName = tags.find(t => t.id === settings?.tag_id)?.name || '未設定'
  const pendingCount = queue.filter(q => q.status === 'pending').length

  const inputCls =
    'w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500'
  const labelCls = 'block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5'
  const subTabCls = (active: boolean) =>
    `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
      active
        ? 'bg-emerald-600 text-white'
        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
    }`

  if (loading && !settings) {
    return <div className="p-8 text-center text-sm text-slate-500">読み込み中...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-emerald-600" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">クレアショット専用AI</h2>
        </div>
        <button
          onClick={fetchAll}
          className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          title="再読み込み"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-sm text-emerald-900 dark:text-emerald-100">
        「{targetTagName}」タグが付いた友だちには、FITPEAK代表Takuとして振る舞うこのAIだけが対応します。
        通常のAIチャット（FITPEAK AI）は、このタグが付いた人には即時返信・12時間後の遅延返信ともに一切動きません。
        即レスにならないよう、タグが付いてから一定時間後に初回メッセージを送り、返信も一定時間空けてから送ります。
        会話から聞き取った情報は自動で保存され、「収集データ」タブで確認できます。
      </div>

      <div className="flex items-center gap-2">
        <button onClick={() => setSub('settings')} className={subTabCls(sub === 'settings')}>
          設定
        </button>
        <button onClick={() => setSub('queue')} className={subTabCls(sub === 'queue')}>
          送信キュー{pendingCount > 0 ? `（${pendingCount}件待ち）` : ''}
        </button>
        <button onClick={() => setSub('profiles')} className={subTabCls(sub === 'profiles')}>
          収集データ{stats ? `（${stats.total}人）` : ''}
        </button>
      </div>

      {sub === 'settings' && settings && (
        <div className="space-y-5">
          <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-700">
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-slate-100">自動返信</div>
              <div className="text-xs text-slate-500 mt-0.5">
                オフにすると、初回メッセージも返信も送りません（通常AIにも流れず、担当者の手動対応になります）。
              </div>
            </div>
            <button onClick={() => set('enabled', !settings.enabled)}>
              {settings.enabled ? (
                <ToggleRight className="w-10 h-10 text-emerald-600" />
              ) : (
                <ToggleLeft className="w-10 h-10 text-slate-400" />
              )}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>対象タグ</label>
              <select
                className={inputCls}
                value={settings.tag_id || ''}
                onChange={e => set('tag_id', e.target.value || null)}
              >
                <option value="">（未設定・ボットは動きません）</option>
                {tags.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>購入意向タグ（自動付与）</label>
              <select
                className={inputCls}
                value={settings.high_intent_tag_id || ''}
                onChange={e => set('high_intent_tag_id', e.target.value || null)}
              >
                <option value="">（付与しない）</option>
                {tags.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-700">
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-slate-100">会話内容からの自動タグ付け</div>
              <div className="text-xs text-slate-500 mt-0.5">
                クレアチンの状況（飲んでいる／やめた／未経験）と購入意向を、会話から判定してタグを付けます。
                タグ連動の遅延配信は発火しません。
              </div>
            </div>
            <button onClick={() => set('auto_tagging', !settings.auto_tagging)}>
              {settings.auto_tagging ? (
                <ToggleRight className="w-10 h-10 text-emerald-600" />
              ) : (
                <ToggleLeft className="w-10 h-10 text-slate-400" />
              )}
            </button>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
              <Clock className="w-4 h-4 text-emerald-600" />
              送信タイミング
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>初回メッセージ（タグが付いてから）</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    className={inputCls}
                    value={settings.opening_delay_minutes ?? 120}
                    onChange={e => set('opening_delay_minutes', Number(e.target.value))}
                  />
                  <span className="text-sm text-slate-500 shrink-0">分後</span>
                </div>
              </div>
              <div>
                <label className={labelCls}>返信（メッセージを受け取ってから）</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    className={inputCls}
                    value={settings.reply_delay_minutes ?? 120}
                    onChange={e => set('reply_delay_minutes', Number(e.target.value))}
                  />
                  <span className="text-sm text-slate-500 shrink-0">分後</span>
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              送信は10分間隔のcronで処理されるため、実際の送信は設定値から最大10分ほど後ろにずれます。
              待っている間にお客様から追加のメッセージが来た場合は、まとめて1通で返します。
              担当者が先に手動で返信した場合、予約されていた自動返信は送られません。
            </p>
          </div>

          <div>
            <label className={labelCls}>初回メッセージ</label>
            <textarea
              className={inputCls}
              rows={3}
              value={settings.opening_message || ''}
              onChange={e => set('opening_message', e.target.value)}
            />
            <p className="text-xs text-slate-500 mt-1">
              {'{name}'} がLINEの表示名に置き換わります。すでに会話が始まっている人には送りません。
            </p>
          </div>

          <div>
            <label className={labelCls}>人格（Takuとしてどう振る舞うか）</label>
            <textarea
              className={`${inputCls} leading-relaxed`}
              rows={10}
              value={settings.persona || ''}
              onChange={e => set('persona', e.target.value)}
            />
          </div>

          <div>
            <label className={labelCls}>商品ナレッジ（商品について聞かれたときだけ使う。ここに無いことは答えません）</label>
            <textarea
              className={`${inputCls} font-mono leading-relaxed`}
              rows={22}
              value={settings.knowledge || ''}
              onChange={e => set('knowledge', e.target.value)}
            />
          </div>

          <div>
            <label className={labelCls}>追加の指示（任意）</label>
            <textarea
              className={inputCls}
              rows={5}
              value={settings.extra_instructions || ''}
              onChange={e => set('extra_instructions', e.target.value)}
              placeholder="例: 予約開始が近づいたら、初回の返信で先行案内が届くことに触れる。"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? '保存中...' : '保存'}
            </button>
            {saved && <span className="text-sm text-emerald-600">保存しました</span>}
          </div>
        </div>
      )}

      {sub === 'queue' && (
        <div className="space-y-4">
          {queue.length === 0 ? (
            <div className="p-8 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-center text-sm text-slate-500">
              <Clock className="w-6 h-6 mx-auto mb-2 opacity-50" />
              送信予定はまだありません。対象タグが付くか、対象の友だちからメッセージが届くとここに並びます。
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">友だち</th>
                    <th className="px-3 py-2 text-left font-medium">種類</th>
                    <th className="px-3 py-2 text-left font-medium">状態</th>
                    <th className="px-3 py-2 text-left font-medium">送信予定</th>
                    <th className="px-3 py-2 text-left font-medium">内容</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {queue.map(q => (
                    <tr key={q.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 align-top">
                      <td className="px-3 py-2 text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {q.friend?.display_name || '(不明)'}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {q.kind === 'opening' ? '初回' : '返信'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs ${
                            q.status === 'pending'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                              : q.status === 'sent'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                              : q.status === 'error'
                              ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                        >
                          {QUEUE_STATUS_LABEL[q.status] || q.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {new Date(q.sent_at || q.scheduled_at).toLocaleString('ja-JP', {
                          month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400 max-w-md">
                        {q.reply_text || q.error || (q.trigger_text ? `受信: ${q.trigger_text}` : '-')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {sub === 'profiles' && (
        <div className="space-y-5">
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(stats.intent).map(([k, v]) => (
                <div key={k} className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                  <div className="text-xs text-slate-500">{INTENT_LABEL[k] || k}</div>
                  <div className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{v}</div>
                </div>
              ))}
            </div>
          )}

          {stats && stats.total > 0 && (
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
              <div className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-3">
                ヒアリング項目の取得率
              </div>
              <div className="space-y-2">
                {Object.entries(stats.fields).map(([key, f]) => {
                  const pct = Math.round((f.filled / stats.total) * 100)
                  return (
                    <div key={key} className="flex items-center gap-3">
                      <div className="w-56 shrink-0 text-xs text-slate-600 dark:text-slate-400 truncate" title={f.label}>
                        {f.label}
                      </div>
                      <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="w-16 shrink-0 text-right text-xs text-slate-500">
                        {f.filled}/{stats.total}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {profiles.length === 0 ? (
            <div className="p-8 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-center text-sm text-slate-500">
              <Users className="w-6 h-6 mx-auto mb-2 opacity-50" />
              まだ会話データがありません。対象タグの友だちがメッセージを送ると、ここに溜まります。
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">友だち</th>
                    <th className="px-3 py-2 text-left font-medium">意向</th>
                    <th className="px-3 py-2 text-left font-medium">関心</th>
                    <th className="px-3 py-2 text-left font-medium">クレアチン</th>
                    <th className="px-3 py-2 text-left font-medium">頻度</th>
                    <th className="px-3 py-2 text-left font-medium">目的</th>
                    <th className="px-3 py-2 text-left font-medium">外出</th>
                    <th className="px-3 py-2 text-left font-medium">困りごと</th>
                    <th className="px-3 py-2 text-right font-medium">往復</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {profiles.map(p => (
                    <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-2 text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {p.friend?.display_name || '(不明)'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs ${
                            p.purchase_intent === 'ready'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                              : p.purchase_intent === 'considering'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                        >
                          {INTENT_LABEL[p.purchase_intent || 'unknown'] || p.purchase_intent}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                        {p.interest_level ? INTEREST_LABEL[p.interest_level] || p.interest_level : '-'}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {p.creatine_status ? CREATINE_LABEL[p.creatine_status] || p.creatine_status : '-'}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{p.training_frequency || '-'}</td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{p.goal || '-'}</td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{p.outing_frequency || '-'}</td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400 max-w-xs truncate" title={p.creatine_pain || ''}>
                        {p.creatine_pain || '-'}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500">{p.turn_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
