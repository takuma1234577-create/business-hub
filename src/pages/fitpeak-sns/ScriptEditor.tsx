import { useState, useEffect } from 'react'
import { Plus, Trash2, Play, Save, ChevronDown, ChevronUp } from 'lucide-react'
import { fetchScripts, createScript, updateScript, deleteScript, renderVideo } from './api'
import { PART_ORDER, PART_LABELS, PRODUCT_OPTIONS } from './types'
import type { SnsScript, ScriptPart } from './types'

function emptyParts(): Record<string, ScriptPart> {
  const parts: Record<string, ScriptPart> = {}
  for (const key of PART_ORDER) {
    parts[key] = { narration: '', subtitle: ['', ''] }
  }
  return parts
}

export default function ScriptEditor() {
  const [scripts, setScripts] = useState<SnsScript[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<SnsScript | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [rendering, setRendering] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try { setScripts(await fetchScripts()) } catch { /* */ }
    setLoading(false)
  }

  function handleNew() {
    const nextNum = String(scripts.length + 1).padStart(3, '0')
    setEditing({
      id: '',
      script_number: nextNum,
      theme: '',
      product: 'wristwrap',
      parts: emptyParts(),
      caption: '',
      hashtags: [],
      created_at: '',
      updated_at: '',
    })
    setExpanded(null)
  }

  async function handleSave() {
    if (!editing) return
    setSaving(true)
    try {
      if (editing.id) {
        const updated = await updateScript(editing.id, editing)
        setScripts(prev => prev.map(s => s.id === updated.id ? updated : s))
      } else {
        const created = await createScript(editing)
        setScripts(prev => [...prev, created])
      }
      setEditing(null)
    } catch (err: any) {
      alert('保存エラー: ' + err.message)
    }
    setSaving(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('この台本を削除しますか？')) return
    try {
      await deleteScript(id)
      setScripts(prev => prev.filter(s => s.id !== id))
    } catch (err: any) {
      alert('削除エラー: ' + err.message)
    }
  }

  async function handleRender(script: SnsScript) {
    if (!confirm(`「${script.theme}」の動画を生成しますか？`)) return
    setRendering(script.id)
    try {
      await renderVideo(script.id)
      alert('レンダリングを開始しました。動画一覧タブで進捗を確認してください。')
    } catch (err: any) {
      alert('レンダリングエラー: ' + err.message)
    }
    setRendering(null)
  }

  function updatePart(key: string, field: 'narration' | 'subtitle', value: any) {
    if (!editing) return
    setEditing({
      ...editing,
      parts: {
        ...editing.parts,
        [key]: { ...editing.parts[key], [field]: value },
      },
    })
  }

  if (loading) return <p className="text-sm text-slate-500">読み込み中...</p>

  // 編集モード
  if (editing) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            {editing.id ? '台本を編集' : '新規台本'}
          </h3>
          <div className="flex gap-2">
            <button onClick={() => setEditing(null)} className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700 cursor-pointer">
              キャンセル
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !editing.theme || !editing.product}
              className="flex items-center gap-1 px-4 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
            >
              <Save size={14} /> {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">番号</label>
            <input
              value={editing.script_number}
              onChange={e => setEditing({ ...editing, script_number: e.target.value })}
              className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">テーマ</label>
            <input
              value={editing.theme}
              onChange={e => setEditing({ ...editing, theme: e.target.value })}
              placeholder="リストラップの正しい巻き方"
              className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">商品</label>
            <select
              value={editing.product}
              onChange={e => setEditing({ ...editing, product: e.target.value })}
              className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
            >
              {Object.entries(PRODUCT_OPTIONS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        </div>

        {/* パート編集 */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">パート構成</h4>
          {PART_ORDER.map(key => (
            <div key={key} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
              <p className="text-xs font-semibold text-slate-500 mb-2">{PART_LABELS[key]}</p>
              <div className="space-y-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-0.5">ナレーション</label>
                  <textarea
                    value={editing.parts[key]?.narration || ''}
                    onChange={e => updatePart(key, 'narration', e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white resize-none"
                    placeholder="読み上げるテキスト"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-400 mb-0.5">テロップ1行目</label>
                    <input
                      value={editing.parts[key]?.subtitle?.[0] || ''}
                      onChange={e => {
                        const sub = [...(editing.parts[key]?.subtitle || ['', ''])]
                        sub[0] = e.target.value
                        updatePart(key, 'subtitle', sub)
                      }}
                      className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-0.5">テロップ2行目</label>
                    <input
                      value={editing.parts[key]?.subtitle?.[1] || ''}
                      onChange={e => {
                        const sub = [...(editing.parts[key]?.subtitle || ['', ''])]
                        sub[1] = e.target.value
                        updatePart(key, 'subtitle', sub)
                      }}
                      className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* キャプション */}
        <div>
          <label className="block text-xs text-slate-500 mb-1">投稿キャプション</label>
          <textarea
            value={editing.caption}
            onChange={e => setEditing({ ...editing, caption: e.target.value })}
            rows={5}
            className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white resize-none"
          />
        </div>

        {/* ハッシュタグ */}
        <div>
          <label className="block text-xs text-slate-500 mb-1">ハッシュタグ（カンマ区切り）</label>
          <input
            value={(editing.hashtags || []).join(', ')}
            onChange={e => setEditing({ ...editing, hashtags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })}
            placeholder="#筋トレ, #ジム, #FITPEAK"
            className="w-full px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
          />
        </div>
      </div>
    )
  }

  // 一覧モード
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">台本一覧</h3>
        <button
          onClick={handleNew}
          className="flex items-center gap-1 px-4 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 cursor-pointer"
        >
          <Plus size={14} /> 新規作成
        </button>
      </div>

      {scripts.length === 0 ? (
        <p className="text-sm text-slate-400">台本がありません。新規作成してください。</p>
      ) : (
        <div className="space-y-2">
          {scripts.map(script => (
            <div key={script.id} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
              <div
                className="flex items-center justify-between p-4 cursor-pointer"
                onClick={() => setExpanded(expanded === script.id ? null : script.id)}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-slate-400">#{script.script_number}</span>
                  <span className="text-sm font-medium text-slate-900 dark:text-white">{script.theme}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">
                    {PRODUCT_OPTIONS[script.product] || script.product}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={e => { e.stopPropagation(); handleRender(script) }}
                    disabled={rendering === script.id}
                    className="flex items-center gap-1 px-3 py-1 rounded-md bg-green-600 text-white text-xs font-medium hover:bg-green-700 disabled:opacity-50 cursor-pointer"
                  >
                    <Play size={12} /> {rendering === script.id ? '生成中...' : '動画生成'}
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); setEditing(script) }}
                    className="px-3 py-1 rounded-md text-xs text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950 cursor-pointer"
                  >
                    編集
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(script.id) }}
                    className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950 text-slate-400 hover:text-red-500 cursor-pointer"
                  >
                    <Trash2 size={14} />
                  </button>
                  {expanded === script.id ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                </div>
              </div>
              {expanded === script.id && (
                <div className="px-4 pb-4 border-t border-slate-100 dark:border-slate-800 pt-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {PART_ORDER.map(key => {
                      const part = script.parts[key]
                      if (!part) return null
                      return (
                        <div key={key} className="p-2 rounded bg-slate-50 dark:bg-slate-900">
                          <p className="text-xs font-semibold text-slate-500 mb-1">{PART_LABELS[key]}</p>
                          <p className="text-xs text-slate-700 dark:text-slate-300">{part.narration}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{(part.subtitle || []).join(' / ')}</p>
                        </div>
                      )
                    })}
                  </div>
                  {script.caption && (
                    <div className="mt-2 p-2 rounded bg-slate-50 dark:bg-slate-900">
                      <p className="text-xs font-semibold text-slate-500 mb-1">キャプション</p>
                      <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{script.caption}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
