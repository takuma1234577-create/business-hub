import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { Sparkles, Save, ToggleLeft, ToggleRight, Eye, X } from 'lucide-react'

const api = axios.create({ baseURL: '/api/line-crm' })

interface Template {
  id: string
  name: string
  folder: string | null
  content: { messages: Array<Record<string, unknown>> }
}

interface Settings {
  id: string
  display_name: string | null
  greeting_template_id: string | null
  greeting_enabled: boolean
}

const extractTextPreview = (msg: Record<string, unknown>): string => {
  if (msg.type === 'text' && typeof msg.text === 'string') return msg.text
  if (msg.type === 'image') return '🖼️ 画像'
  if (msg.type === 'video') return '🎥 動画'
  if (msg.type === 'audio') return '🎵 音声'
  if (msg.type === 'template') {
    const tmpl = msg.template as { type?: string } | undefined
    if (tmpl?.type === 'carousel') return '🎠 カルーセル'
    if (tmpl?.type === 'buttons') return '📋 パネル'
  }
  return String(msg.type)
}

export default function GreetingSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [s, t] = await Promise.all([
        api.get<Settings | null>('/greeting-settings'),
        api.get<Template[]>('/message-templates'),
      ])
      setSettings(s.data)
      setTemplates(t.data)
    } catch (err) {
      console.error('fetch failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    try {
      await api.put('/greeting-settings', {
        greeting_template_id: settings.greeting_template_id,
        greeting_enabled: settings.greeting_enabled,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      alert('保存失敗: ' + (axios.isAxiosError(err) ? err.response?.data?.error || err.message : ''))
    } finally {
      setSaving(false)
    }
  }

  if (loading || !settings) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const selectedTemplate = templates.find(t => t.id === settings.greeting_template_id)

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-[#06C755]/10 flex items-center justify-center">
          <Sparkles size={20} className="text-[#06C755]" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">挨拶メッセージ</h2>
          <p className="text-sm text-slate-500">友だち追加時に自動送信されるメッセージ</p>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 space-y-5 max-w-2xl">
        <div>
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-white">挨拶メッセージを有効化</p>
              <p className="text-xs text-slate-500 mt-0.5">オフの場合、友だち追加時は何も送信されません</p>
            </div>
            <button
              onClick={() => setSettings(s => s ? { ...s, greeting_enabled: !s.greeting_enabled } : s)}
              className="cursor-pointer"
            >
              {settings.greeting_enabled ? (
                <ToggleRight size={32} className="text-[#06C755]" />
              ) : (
                <ToggleLeft size={32} className="text-slate-300 dark:text-slate-600" />
              )}
            </button>
          </label>
        </div>

        <div className={settings.greeting_enabled ? '' : 'opacity-50 pointer-events-none'}>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            送信するテンプレート
          </label>
          <select
            value={settings.greeting_template_id || ''}
            onChange={e => setSettings(s => s ? { ...s, greeting_template_id: e.target.value || null } : s)}
            className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755]"
          >
            <option value="">（未設定）</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>
                {t.folder ? `[${t.folder}] ` : ''}{t.name}（{t.content?.messages?.length || 0}件）
              </option>
            ))}
          </select>
          {templates.length === 0 && (
            <p className="text-xs text-amber-600 mt-2">
              テンプレートがまだありません。「テンプレート」タブで作成してください。
            </p>
          )}
        </div>

        {selectedTemplate && (
          <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Eye size={14} className="text-slate-400" />
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">送信内容プレビュー</p>
            </div>
            <ul className="space-y-1.5">
              {(selectedTemplate.content?.messages || []).map((m, i) => (
                <li key={i} className="text-sm text-slate-700 dark:text-slate-300 flex items-start gap-2">
                  <span className="text-xs font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 rounded flex-shrink-0">#{i + 1}</span>
                  <span className="truncate">{extractTextPreview(m)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center gap-3 pt-2 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-medium disabled:opacity-40 cursor-pointer"
          >
            {saved ? <X size={15} className="rotate-45" /> : <Save size={15} />}
            {saved ? '保存しました' : saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
