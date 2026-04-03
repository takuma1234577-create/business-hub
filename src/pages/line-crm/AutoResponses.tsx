import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, Zap, X, ToggleLeft, ToggleRight } from 'lucide-react'
import { autoResponseApi } from './api'
import type { AutoResponse } from './types'

type FormData = {
  keyword: string
  match_type: 'exact' | 'contains' | 'regex'
  response_type: 'text' | 'image' | 'template'
  response_content: string
  is_active: boolean
}

const emptyForm: FormData = {
  keyword: '',
  match_type: 'contains',
  response_type: 'text',
  response_content: '',
  is_active: true,
}

export default function AutoResponses() {
  const [responses, setResponses] = useState<AutoResponse[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormData>(emptyForm)

  const fetchResponses = useCallback(async () => {
    setLoading(true)
    try {
      const res = await autoResponseApi.list()
      setResponses(res)
    } catch (err) {
      console.error('Failed to fetch auto responses:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchResponses()
  }, [fetchResponses])

  const openCreate = () => {
    setForm(emptyForm)
    setEditingId(null)
    setShowForm(true)
  }

  const openEdit = (resp: AutoResponse) => {
    setForm({
      keyword: resp.keyword,
      match_type: resp.match_type,
      response_type: resp.response_type,
      response_content: resp.response_content,
      is_active: resp.is_active,
    })
    setEditingId(resp.id)
    setShowForm(true)
  }

  const handleSave = async () => {
    try {
      if (editingId) {
        await autoResponseApi.update(editingId, form)
      } else {
        await autoResponseApi.create(form)
      }
      setShowForm(false)
      fetchResponses()
    } catch (err) {
      console.error('Failed to save auto response:', err)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('この自動応答を削除しますか？')) return
    try {
      await autoResponseApi.delete(id)
      fetchResponses()
    } catch (err) {
      console.error('Failed to delete auto response:', err)
    }
  }

  const handleToggle = async (resp: AutoResponse) => {
    try {
      await autoResponseApi.toggleActive(resp.id, !resp.is_active)
      setResponses(prev =>
        prev.map(r => r.id === resp.id ? { ...r, is_active: !r.is_active } : r)
      )
    } catch (err) {
      console.error('Failed to toggle auto response:', err)
    }
  }

  const matchTypeLabel = (t: string) => {
    switch (t) {
      case 'exact': return '完全一致'
      case 'contains': return '部分一致'
      case 'regex': return '正規表現'
      default: return t
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#06C755]/10 flex items-center justify-center">
            <Zap size={20} className="text-[#06C755]" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">自動応答</h2>
            <p className="text-sm text-slate-500">{responses.length} 件の自動応答ルール</p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-medium transition-colors cursor-pointer"
        >
          <Plus size={16} />
          新規作成
        </button>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : responses.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <Zap size={40} className="mx-auto mb-3 opacity-50" />
            <p>自動応答ルールがありません</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                <th className="text-left px-5 py-3 font-medium text-slate-500 dark:text-slate-400">キーワード</th>
                <th className="text-left px-5 py-3 font-medium text-slate-500 dark:text-slate-400">マッチタイプ</th>
                <th className="text-left px-5 py-3 font-medium text-slate-500 dark:text-slate-400">応答内容</th>
                <th className="text-center px-5 py-3 font-medium text-slate-500 dark:text-slate-400">有効</th>
                <th className="text-right px-5 py-3 font-medium text-slate-500 dark:text-slate-400">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {responses.map(resp => (
                <tr key={resp.id} className={`hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors ${!resp.is_active ? 'opacity-50' : ''}`}>
                  <td className="px-5 py-3">
                    <code className="text-xs bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded font-mono text-slate-700 dark:text-slate-300">
                      {resp.keyword}
                    </code>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-xs px-2 py-1 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium">
                      {matchTypeLabel(resp.match_type)}
                    </span>
                  </td>
                  <td className="px-5 py-3 max-w-[240px]">
                    <p className="text-slate-700 dark:text-slate-300 truncate">{resp.response_content}</p>
                  </td>
                  <td className="px-5 py-3 text-center">
                    <button
                      onClick={() => handleToggle(resp)}
                      className="cursor-pointer inline-flex items-center"
                    >
                      {resp.is_active ? (
                        <ToggleRight size={28} className="text-[#06C755]" />
                      ) : (
                        <ToggleLeft size={28} className="text-slate-300 dark:text-slate-600" />
                      )}
                    </button>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(resp)}
                        className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => handleDelete(resp.id)}
                        className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal Form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="font-semibold text-slate-900 dark:text-white">
                {editingId ? '自動応答を編集' : '自動応答を作成'}
              </h3>
              <button
                onClick={() => setShowForm(false)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">キーワード</label>
                <input
                  type="text"
                  value={form.keyword}
                  onChange={e => setForm(f => ({ ...f, keyword: e.target.value }))}
                  placeholder="例: こんにちは"
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">マッチタイプ</label>
                <select
                  value={form.match_type}
                  onChange={e => setForm(f => ({ ...f, match_type: e.target.value as FormData['match_type'] }))}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] text-sm"
                >
                  <option value="contains">部分一致</option>
                  <option value="exact">完全一致</option>
                  <option value="regex">正規表現</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">応答タイプ</label>
                <select
                  value={form.response_type}
                  onChange={e => setForm(f => ({ ...f, response_type: e.target.value as FormData['response_type'] }))}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] text-sm"
                >
                  <option value="text">テキスト</option>
                  <option value="image">画像</option>
                  <option value="template">テンプレート</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">応答内容</label>
                <textarea
                  value={form.response_content}
                  onChange={e => setForm(f => ({ ...f, response_content: e.target.value }))}
                  placeholder="応答メッセージを入力..."
                  rows={4}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755] text-sm resize-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-medium transition-colors cursor-pointer"
              >
                キャンセル
              </button>
              <button
                onClick={handleSave}
                disabled={!form.keyword.trim() || !form.response_content.trim()}
                className="px-5 py-2.5 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {editingId ? '更新' : '作成'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
