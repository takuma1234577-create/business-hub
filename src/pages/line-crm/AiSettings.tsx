import { useState, useEffect, useCallback } from 'react'
import { Bot, Save, Plus, Pencil, Trash2, X, BookOpen, ToggleLeft, ToggleRight } from 'lucide-react'
import { aiSettingsApi, knowledgeBaseApi } from './api'
import type { AiSettings as AiSettingsType, KnowledgeBase } from './types'

export default function AiSettings() {
  const [settings, setSettings] = useState<AiSettingsType | null>(null)
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBase[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Knowledge Base form
  const [showKbForm, setShowKbForm] = useState(false)
  const [editingKbId, setEditingKbId] = useState<string | null>(null)
  const [kbForm, setKbForm] = useState({ title: '', content: '', category: '' })

  const fetchSettings = useCallback(async () => {
    setLoading(true)
    try {
      const [aiRes, kbRes] = await Promise.all([
        aiSettingsApi.get(),
        knowledgeBaseApi.list(),
      ])
      setSettings(aiRes)
      setKnowledgeBase(kbRes)
    } catch (err) {
      console.error('Failed to fetch AI settings:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    try {
      const updated = await aiSettingsApi.update({
        is_active: settings.is_active,
        persona: settings.persona,
        system_instructions: settings.system_instructions,
        model: settings.model,
        temperature: settings.temperature,
      })
      setSettings(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('Failed to save AI settings:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = () => {
    if (!settings) return
    setSettings({ ...settings, is_active: !settings.is_active })
  }

  // Knowledge Base handlers
  const openCreateKb = () => {
    setKbForm({ title: '', content: '', category: '' })
    setEditingKbId(null)
    setShowKbForm(true)
  }

  const openEditKb = (kb: KnowledgeBase) => {
    setKbForm({ title: kb.title, content: kb.content, category: kb.category })
    setEditingKbId(kb.id)
    setShowKbForm(true)
  }

  const handleSaveKb = async () => {
    try {
      if (editingKbId) {
        await knowledgeBaseApi.update(editingKbId, kbForm)
      } else {
        await knowledgeBaseApi.create(kbForm)
      }
      setShowKbForm(false)
      const kbRes = await knowledgeBaseApi.list()
      setKnowledgeBase(kbRes)
    } catch (err) {
      console.error('Failed to save knowledge base:', err)
    }
  }

  const handleDeleteKb = async (id: string) => {
    if (!confirm('このナレッジベースを削除しますか？')) return
    try {
      await knowledgeBaseApi.delete(id)
      setKnowledgeBase(prev => prev.filter(kb => kb.id !== id))
    } catch (err) {
      console.error('Failed to delete knowledge base:', err)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="text-center py-20 text-slate-400">
        <Bot size={40} className="mx-auto mb-3 opacity-50" />
        <p>AI設定を読み込めませんでした</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* AI Settings Section */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#06C755]/10 flex items-center justify-center">
              <Bot size={20} className="text-[#06C755]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">AI自動応答設定</h2>
              <p className="text-sm text-slate-500">AIによる自動返信の設定を管理</p>
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${
              saved
                ? 'bg-green-100 text-green-700'
                : 'bg-[#06C755] hover:bg-[#05b34c] text-white'
            } disabled:opacity-50`}
          >
            <Save size={16} />
            {saved ? '保存しました' : saving ? '保存中...' : '保存'}
          </button>
        </div>

        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 space-y-6">
          {/* Active Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-slate-900 dark:text-white">AI自動応答</h3>
              <p className="text-sm text-slate-500 mt-0.5">有効にすると、AIが自動でメッセージに返信します</p>
            </div>
            <button
              onClick={handleToggleActive}
              className="cursor-pointer"
            >
              {settings.is_active ? (
                <ToggleRight size={36} className="text-[#06C755]" />
              ) : (
                <ToggleLeft size={36} className="text-slate-300 dark:text-slate-600" />
              )}
            </button>
          </div>

          <hr className="border-slate-200 dark:border-slate-700" />

          {/* Persona */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">ペルソナ</label>
            <input
              type="text"
              value={settings.persona}
              onChange={e => setSettings({ ...settings, persona: e.target.value })}
              placeholder="例: フレンドリーなカスタマーサポート担当"
              className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] text-sm"
            />
          </div>

          {/* System Instructions */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">システム指示</label>
            <textarea
              value={settings.system_instructions}
              onChange={e => setSettings({ ...settings, system_instructions: e.target.value })}
              placeholder="AIの振る舞いを指定するプロンプト..."
              rows={6}
              className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] text-sm resize-none font-mono"
            />
          </div>

          {/* Model & Temperature */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">モデル</label>
              <select
                value={settings.model}
                onChange={e => setSettings({ ...settings, model: e.target.value })}
                className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] text-sm"
              >
                <option value="gpt-4o">GPT-4o</option>
                <option value="gpt-4o-mini">GPT-4o mini</option>
                <option value="gpt-4-turbo">GPT-4 Turbo</option>
                <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                <option value="claude-3-opus">Claude 3 Opus</option>
                <option value="claude-3-sonnet">Claude 3 Sonnet</option>
                <option value="claude-3-haiku">Claude 3 Haiku</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Temperature: {(settings.temperature ?? 0.7).toFixed(2)}
              </label>
              <div className="pt-2">
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.05"
                  value={settings.temperature ?? 0.7}
                  onChange={e => setSettings({ ...settings, temperature: parseFloat(e.target.value) })}
                  className="w-full h-2 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, #06C755 ${((settings.temperature ?? 0.7) / 2) * 100}%, #e2e8f0 ${((settings.temperature ?? 0.7) / 2) * 100}%)`,
                  }}
                />
                <div className="flex justify-between text-xs text-slate-400 mt-1">
                  <span>正確</span>
                  <span>創造的</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Knowledge Base Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
              <BookOpen size={20} className="text-blue-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">ナレッジベース</h2>
              <p className="text-sm text-slate-500">AIが参照する知識データ</p>
            </div>
          </div>
          <button
            onClick={openCreateKb}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-colors cursor-pointer"
          >
            <Plus size={16} />
            追加
          </button>
        </div>

        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
          {knowledgeBase.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <BookOpen size={36} className="mx-auto mb-3 opacity-50" />
              <p>ナレッジベースが空です</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {knowledgeBase.map(kb => (
                <div key={kb.id} className="px-5 py-4 flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium text-slate-900 dark:text-white">{kb.title}</h4>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium">
                        {kb.category}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-2">{kb.content}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => openEditKb(kb)}
                      className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => handleDeleteKb(kb.id)}
                      className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Knowledge Base Modal */}
      {showKbForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="font-semibold text-slate-900 dark:text-white">
                {editingKbId ? 'ナレッジベースを編集' : 'ナレッジベースを追加'}
              </h3>
              <button
                onClick={() => setShowKbForm(false)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">タイトル</label>
                <input
                  type="text"
                  value={kbForm.title}
                  onChange={e => setKbForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="例: 商品FAQ"
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">カテゴリ</label>
                <input
                  type="text"
                  value={kbForm.category}
                  onChange={e => setKbForm(f => ({ ...f, category: e.target.value }))}
                  placeholder="例: FAQ, 商品情報, ポリシー"
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">内容</label>
                <textarea
                  value={kbForm.content}
                  onChange={e => setKbForm(f => ({ ...f, content: e.target.value }))}
                  placeholder="AIが参照する知識内容を入力..."
                  rows={8}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] text-sm resize-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
              <button
                onClick={() => setShowKbForm(false)}
                className="px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-medium transition-colors cursor-pointer"
              >
                キャンセル
              </button>
              <button
                onClick={handleSaveKb}
                disabled={!kbForm.title.trim() || !kbForm.content.trim()}
                className="px-5 py-2.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {editingKbId ? '更新' : '追加'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
