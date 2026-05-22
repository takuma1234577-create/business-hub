import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import { fetchProfiles, createProfile, updateProfile, deleteProfile } from './api'
import type { StreamerProfile } from './types'

const PLUGIN_LABELS: Record<string, string> = {
  english_learning: '英語学習',
  entertainment: 'エンタメ翻訳',
  slang_focus: 'スラング解説',
}

const DEFAULT_CONFIG = {
  source: { platform: 'twitch', language: 'en', speech_pace: 'fast', content_type: 'irl_chat' },
  concept: { channel_concept: 'english_learning', target_audience: '', tone: '', differentiation: '' },
  extraction: { min_clip_duration_seconds: 30, max_clip_duration_seconds: 60, max_candidates_per_video: 5, min_score_threshold: 6, plugin: 'english_learning' },
  plugin_config: {},
  video_style: { layout: 'split_with_panel', resolution: '1080x1920' },
  title_templates: [],
}

export default function ProfileManager() {
  const [profiles, setProfiles] = useState<StreamerProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; profile?: StreamerProfile } | null>(null)
  const [formId, setFormId] = useState('')
  const [formName, setFormName] = useState('')
  const [formConfig, setFormConfig] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = () => {
    setLoading(true)
    fetchProfiles().then(setProfiles).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const openCreate = () => {
    setFormId('')
    setFormName('')
    setFormConfig(JSON.stringify(DEFAULT_CONFIG, null, 2))
    setError('')
    setModal({ mode: 'create' })
  }

  const openEdit = (p: StreamerProfile) => {
    setFormId(p.id)
    setFormName(p.display_name)
    setFormConfig(JSON.stringify(p.config, null, 2))
    setError('')
    setModal({ mode: 'edit', profile: p })
  }

  const handleSave = async () => {
    setError('')
    let config: Record<string, unknown>
    try {
      config = JSON.parse(formConfig)
    } catch {
      setError('設定JSONの形式が不正です')
      return
    }
    setSaving(true)
    try {
      if (modal?.mode === 'create') {
        if (!formId.trim() || !formName.trim()) { setError('IDと名前は必須です'); setSaving(false); return }
        await createProfile({ id: formId.trim(), display_name: formName.trim(), config })
      } else if (modal?.profile) {
        await updateProfile(modal.profile.id, { display_name: formName.trim(), config })
      }
      setModal(null)
      load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(`プロファイル「${id}」を削除しますか？関連するジョブも全て削除されます。`)) return
    try {
      await deleteProfile(id)
      load()
    } catch {}
  }

  if (loading) return <p className="text-slate-500 dark:text-slate-400">読み込み中...</p>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">プロファイル管理</h2>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition cursor-pointer">
          <Plus size={16} /> 新規作成
        </button>
      </div>

      {profiles.length === 0 ? (
        <p className="text-slate-500 dark:text-slate-400">プロファイルがありません。「新規作成」から追加してください。</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {profiles.map(p => {
            const concept = p.config?.concept?.channel_concept || ''
            const plugin = p.config?.extraction?.plugin || ''
            const audience = p.config?.concept?.target_audience || ''
            return (
              <div key={p.id} className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-slate-900 dark:text-white">{p.display_name}</h3>
                    <p className="text-xs text-slate-400 dark:text-slate-500">ID: {p.id}</p>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(p)} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 cursor-pointer"><Pencil size={14} /></button>
                    <button onClick={() => handleDelete(p.id)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950 text-red-400 cursor-pointer"><Trash2 size={14} /></button>
                  </div>
                </div>
                <div className="space-y-1 text-sm">
                  {concept && <p className="text-slate-600 dark:text-slate-300">コンセプト: {concept}</p>}
                  {plugin && <p className="text-slate-600 dark:text-slate-300">プラグイン: {PLUGIN_LABELS[plugin] || plugin}</p>}
                  {audience && <p className="text-slate-500 dark:text-slate-400">ターゲット: {audience}</p>}
                  <p className="text-slate-400 dark:text-slate-500">v{p.version} ・ {new Date(p.updated_at).toLocaleDateString('ja-JP')}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl bg-white dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                {modal.mode === 'create' ? 'プロファイル作成' : 'プロファイル編集'}
              </h3>
              <button onClick={() => setModal(null)} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 cursor-pointer"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              {error && <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 px-3 py-2 rounded-lg">{error}</p>}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">プロファイルID</label>
                <input
                  value={formId}
                  onChange={e => setFormId(e.target.value)}
                  disabled={modal.mode === 'edit'}
                  placeholder="例: marlon"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">表示名</label>
                <input
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="例: Marlon"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">設定JSON</label>
                <textarea
                  value={formConfig}
                  onChange={e => setFormConfig(e.target.value)}
                  rows={16}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm font-mono"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-slate-200 dark:border-slate-800">
              <button onClick={() => setModal(null)} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">キャンセル</button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
