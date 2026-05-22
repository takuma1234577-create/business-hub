import { useState, useEffect, useCallback, useRef, type DragEvent } from 'react'
import axios from 'axios'
import { LayoutGrid, Plus, Pencil, Trash2, X, Upload, CheckCircle } from 'lucide-react'

const api = axios.create({ baseURL: '/api/line-crm' })
api.interceptors.request.use((config) => { const token = localStorage.getItem('auth_token'); if (token) config.headers.Authorization = `Bearer ${token}`; return config })
// ── LINE Rich Menu types ──
interface Bounds { x: number; y: number; width: number; height: number }
type RMAction =
  | { type: 'message'; label?: string; text: string }
  | { type: 'uri'; label?: string; uri: string }
  | { type: 'postback'; label?: string; data: string; displayText?: string }
  | { type: 'richmenuswitch'; label?: string; richMenuAliasId: string; data?: string }

interface Area { bounds: Bounds; action: RMAction }

interface RichMenu {
  id: string
  name: string
  line_rich_menu_id: string | null
  size_width: number
  size_height: number
  chat_bar_text: string
  areas: Area[]
  image_url: string | null
  is_default: boolean
  created_at: string
}

interface Template { id: string; name: string }

// ── Layout presets ──
interface Layout { id: string; label: string; size: 'tall' | 'compact'; bounds: Bounds[] }
const LAYOUTS: Layout[] = [
  {
    id: 'tall-6',
    label: '3×2 (6分割)',
    size: 'tall',
    bounds: [
      { x: 0, y: 0, width: 833, height: 843 },
      { x: 833, y: 0, width: 834, height: 843 },
      { x: 1667, y: 0, width: 833, height: 843 },
      { x: 0, y: 843, width: 833, height: 843 },
      { x: 833, y: 843, width: 834, height: 843 },
      { x: 1667, y: 843, width: 833, height: 843 },
    ],
  },
  {
    id: 'tall-4',
    label: '2×2 (4分割)',
    size: 'tall',
    bounds: [
      { x: 0, y: 0, width: 1250, height: 843 },
      { x: 1250, y: 0, width: 1250, height: 843 },
      { x: 0, y: 843, width: 1250, height: 843 },
      { x: 1250, y: 843, width: 1250, height: 843 },
    ],
  },
  {
    id: 'tall-1-3',
    label: '上1 + 下3',
    size: 'tall',
    bounds: [
      { x: 0, y: 0, width: 2500, height: 843 },
      { x: 0, y: 843, width: 833, height: 843 },
      { x: 833, y: 843, width: 834, height: 843 },
      { x: 1667, y: 843, width: 833, height: 843 },
    ],
  },
  {
    id: 'tall-1-2',
    label: '上1 + 下2',
    size: 'tall',
    bounds: [
      { x: 0, y: 0, width: 2500, height: 843 },
      { x: 0, y: 843, width: 1250, height: 843 },
      { x: 1250, y: 843, width: 1250, height: 843 },
    ],
  },
  {
    id: 'tall-3-1',
    label: '上3 + 下1',
    size: 'tall',
    bounds: [
      { x: 0, y: 0, width: 833, height: 843 },
      { x: 833, y: 0, width: 834, height: 843 },
      { x: 1667, y: 0, width: 833, height: 843 },
      { x: 0, y: 843, width: 2500, height: 843 },
    ],
  },
  {
    id: 'tall-2-1',
    label: '上2 + 下1',
    size: 'tall',
    bounds: [
      { x: 0, y: 0, width: 1250, height: 843 },
      { x: 1250, y: 0, width: 1250, height: 843 },
      { x: 0, y: 843, width: 2500, height: 843 },
    ],
  },
  {
    id: 'tall-big-small-3',
    label: '上: 大+小 / 下3',
    size: 'tall',
    bounds: [
      { x: 0, y: 0, width: 1667, height: 843 },
      { x: 1667, y: 0, width: 833, height: 843 },
      { x: 0, y: 843, width: 833, height: 843 },
      { x: 833, y: 843, width: 834, height: 843 },
      { x: 1667, y: 843, width: 833, height: 843 },
    ],
  },
  {
    id: 'tall-2v',
    label: '1×2 縦 (大×2)',
    size: 'tall',
    bounds: [
      { x: 0, y: 0, width: 2500, height: 843 },
      { x: 0, y: 843, width: 2500, height: 843 },
    ],
  },
  {
    id: 'tall-1',
    label: '1分割 (全面)',
    size: 'tall',
    bounds: [{ x: 0, y: 0, width: 2500, height: 1686 }],
  },
  {
    id: 'compact-3',
    label: '横3分割 (小)',
    size: 'compact',
    bounds: [
      { x: 0, y: 0, width: 833, height: 843 },
      { x: 833, y: 0, width: 834, height: 843 },
      { x: 1667, y: 0, width: 833, height: 843 },
    ],
  },
  {
    id: 'compact-2',
    label: '横2分割 (小)',
    size: 'compact',
    bounds: [
      { x: 0, y: 0, width: 1250, height: 843 },
      { x: 1250, y: 0, width: 1250, height: 843 },
    ],
  },
  {
    id: 'compact-1',
    label: '1分割 (小)',
    size: 'compact',
    bounds: [{ x: 0, y: 0, width: 2500, height: 843 }],
  },
]

function createDefaultAction(): RMAction {
  return { type: 'message', label: 'ボタン', text: '' }
}

export default function RichMenus() {
  const [menus, setMenus] = useState<RichMenu[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [chatBarText, setChatBarText] = useState('メニュー')
  const [layoutId, setLayoutId] = useState('tall-6')
  const [areas, setAreas] = useState<Area[]>([])
  const [imageUrl, setImageUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [activatingId, setActivatingId] = useState<string | null>(null)

  const fetchMenus = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get<RichMenu[]>('/rich-menus')
      setMenus(r.data)
    } catch (err) {
      console.error('fetch rich menus:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchTemplates = useCallback(async () => {
    try {
      const r = await api.get<Template[]>('/message-templates')
      setTemplates(r.data)
    } catch (err) {
      console.error('fetch templates:', err)
    }
  }, [])

  useEffect(() => { fetchMenus() }, [fetchMenus])
  useEffect(() => { fetchTemplates() }, [fetchTemplates])

  const layout = LAYOUTS.find(l => l.id === layoutId) || LAYOUTS[0]

  const applyLayout = (lid: string) => {
    const l = LAYOUTS.find(x => x.id === lid) || LAYOUTS[0]
    setLayoutId(lid)
    setAreas(l.bounds.map(b => ({ bounds: b, action: createDefaultAction() })))
  }

  const openCreate = () => {
    setName('')
    setChatBarText('メニュー')
    setLayoutId('tall-6')
    setAreas(LAYOUTS[0].bounds.map(b => ({ bounds: b, action: createDefaultAction() })))
    setImageUrl('')
    setEditingId(null)
    setShowForm(true)
  }

  const openEdit = (m: RichMenu) => {
    setName(m.name)
    setChatBarText(m.chat_bar_text || 'メニュー')
    // レイアウトを推定
    const matched = LAYOUTS.find(l =>
      l.bounds.length === m.areas.length &&
      l.bounds.every((b, i) =>
        b.x === m.areas[i]?.bounds.x && b.y === m.areas[i]?.bounds.y &&
        b.width === m.areas[i]?.bounds.width && b.height === m.areas[i]?.bounds.height
      ),
    )
    setLayoutId(matched?.id || 'custom')
    setAreas(m.areas || [])
    setImageUrl(m.image_url || '')
    setEditingId(m.id)
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!name.trim() || areas.length === 0) { alert('名前とエリアを設定してください'); return }
    setSaving(true)
    try {
      const payload = {
        name,
        chat_bar_text: chatBarText,
        size_width: layout.size === 'tall' ? 2500 : 2500,
        size_height: layout.size === 'tall' ? 1686 : 843,
        areas,
        image_url: imageUrl || null,
      }
      if (editingId) {
        await api.put(`/rich-menus/${editingId}`, payload)
      } else {
        await api.post('/rich-menus', payload)
      }
      setShowForm(false)
      fetchMenus()
    } catch (err) {
      alert('保存失敗: ' + (axios.isAxiosError(err) ? err.response?.data?.error || err.message : ''))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このリッチメニューを削除しますか？\n（LINE側からも削除されます）')) return
    try {
      await api.delete(`/rich-menus/${id}`)
      fetchMenus()
    } catch (err) {
      alert('削除失敗: ' + (axios.isAxiosError(err) ? err.response?.data?.error || err.message : ''))
    }
  }

  const handleActivate = async (id: string) => {
    if (!confirm('このリッチメニューをLINEに公開し、デフォルトに設定しますか？')) return
    setActivatingId(id)
    try {
      await api.post(`/rich-menus/${id}/activate`)
      alert('公開しました')
      fetchMenus()
    } catch (err) {
      alert('公開失敗: ' + (axios.isAxiosError(err) ? err.response?.data?.error || err.message : ''))
    } finally {
      setActivatingId(null)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#06C755]/10 flex items-center justify-center">
            <LayoutGrid size={20} className="text-[#06C755]" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">リッチメニュー</h2>
            <p className="text-sm text-slate-500">{menus.length} 件のメニュー</p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-medium cursor-pointer"
        >
          <Plus size={16} /> 新規作成
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading ? (
          <div className="col-span-full flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : menus.length === 0 ? (
          <div className="col-span-full text-center py-20 text-slate-400">
            <LayoutGrid size={40} className="mx-auto mb-3 opacity-50" />
            <p>リッチメニューがありません</p>
          </div>
        ) : (
          menus.map(m => (
            <div key={m.id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
              <div className="relative bg-slate-100 dark:bg-slate-900" style={{ aspectRatio: `${m.size_width} / ${m.size_height}` }}>
                {m.image_url ? (
                  <img src={m.image_url} alt="" className="absolute inset-0 w-full h-full object-cover" onError={e => (e.currentTarget.style.display = 'none')} />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-xs">画像なし</div>
                )}
                <AreaOverlay areas={m.areas} size={{ w: m.size_width, h: m.size_height }} />
                {m.is_default && (
                  <span className="absolute top-2 right-2 bg-[#06C755] text-white text-xs font-bold px-2 py-0.5 rounded-full shadow">
                    公開中
                  </span>
                )}
              </div>
              <div className="p-4">
                <h3 className="font-medium text-slate-900 dark:text-white text-sm">{m.name}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{m.areas.length}エリア・{m.chat_bar_text}</p>
                <div className="flex items-center gap-1 mt-3">
                  <button
                    onClick={() => handleActivate(m.id)}
                    disabled={activatingId === m.id || !m.image_url}
                    className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded-md bg-[#06C755] hover:bg-[#05b34c] text-white text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <CheckCircle size={12} />
                    {activatingId === m.id ? '公開中...' : m.is_default ? '再公開' : '公開'}
                  </button>
                  <button onClick={() => openEdit(m)} className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 cursor-pointer">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => handleDelete(m.id)} className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-500 hover:text-red-500 cursor-pointer">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-4xl shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
              <h3 className="font-semibold text-slate-900 dark:text-white">
                {editingId ? 'リッチメニュー編集' : 'リッチメニュー作成'}
              </h3>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">メニュー名</label>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="例: メインメニュー"
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755]" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">チャットバーテキスト <span className="text-xs text-slate-400 font-normal">（14字以内）</span></label>
                  <input type="text" value={chatBarText} onChange={e => setChatBarText(e.target.value)} maxLength={14} placeholder="メニュー"
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#06C755]/40 focus:border-[#06C755]" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">レイアウトテンプレート</label>
                <div className="grid grid-cols-4 gap-2">
                  {LAYOUTS.map(l => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => applyLayout(l.id)}
                      className={`p-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                        layoutId === l.id
                          ? 'border-[#06C755] bg-[#06C755]/5 text-[#06C755]'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                      }`}
                    >
                      <div className="relative mx-auto mb-1" style={{ width: 50, aspectRatio: l.size === 'tall' ? '2500 / 1686' : '2500 / 843' }}>
                        <div className="absolute inset-0 bg-slate-200 dark:bg-slate-600" />
                        {(l.bounds || []).filter(Boolean).map((b, i) => (
                          <div key={i} className="absolute border border-white/70 bg-[#06C755]/30" style={{
                            left: `${(b.x / 2500) * 100}%`,
                            top: `${(b.y / (l.size === 'tall' ? 1686 : 843)) * 100}%`,
                            width: `${(b.width / 2500) * 100}%`,
                            height: `${(b.height / (l.size === 'tall' ? 1686 : 843)) * 100}%`,
                          }} />
                        ))}
                      </div>
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">背景画像 <span className="text-xs text-slate-400 font-normal">（{layout.size === 'tall' ? '2500×1686' : '2500×843'} 推奨）</span></label>
                <ImageUpload value={imageUrl} onChange={setImageUrl} targetHeight={layout.size === 'tall' ? 1686 : 843} />
                {imageUrl && (
                  <div className="mt-3 relative bg-slate-100 dark:bg-slate-900 rounded-lg overflow-hidden" style={{ aspectRatio: `${layout.size === 'tall' ? '2500 / 1686' : '2500 / 843'}` }}>
                    <img src={imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
                    <AreaOverlay areas={areas} size={{ w: 2500, h: layout.size === 'tall' ? 1686 : 843 }} showLabels />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">エリアのアクション</label>
                <div className="space-y-2">
                  {areas.map((a, i) => (
                    <AreaActionEditor
                      key={i}
                      index={i}
                      area={a}
                      templates={templates}
                      onChange={next => setAreas(areas.map((x, idx) => idx === i ? next : x))}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex-shrink-0">
              <button onClick={() => setShowForm(false)} className="px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-medium cursor-pointer">
                キャンセル
              </button>
              <button onClick={handleSave} disabled={saving} className="px-5 py-2.5 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-medium disabled:opacity-40 cursor-pointer">
                {saving ? '保存中...' : editingId ? '更新' : '作成'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function AreaOverlay({ areas, size, showLabels = false }: { areas: Area[]; size: { w: number; h: number }; showLabels?: boolean }) {
  if (!size.w || !size.h) return null
  return (
    <>
      {(areas || []).filter(a => a && a.bounds).map((a, i) => (
        <div
          key={i}
          className="absolute border border-white/70 bg-[#06C755]/20 pointer-events-none"
          style={{
            left: `${(a.bounds.x / size.w) * 100}%`,
            top: `${(a.bounds.y / size.h) * 100}%`,
            width: `${(a.bounds.width / size.w) * 100}%`,
            height: `${(a.bounds.height / size.h) * 100}%`,
          }}
        >
          {showLabels && (
            <span className="absolute top-1 left-1 bg-white/90 text-[10px] font-mono px-1 rounded text-slate-700">#{i + 1}</span>
          )}
        </div>
      ))}
    </>
  )
}

function AreaActionEditor({ index, area, templates, onChange }: { index: number; area: Area; templates: Template[]; onChange: (a: Area) => void }) {
  const type = area.action.type
  const setType = (t: RMAction['type']) => {
    let next: RMAction
    if (t === 'message') next = { type: 'message', label: 'ボタン', text: '' }
    else if (t === 'uri') next = { type: 'uri', label: 'ボタン', uri: '' }
    else if (t === 'postback') next = { type: 'postback', label: 'ボタン', data: '' }
    else next = { type: 'message', label: 'ボタン', text: '' }
    onChange({ ...area, action: next })
  }
  const parseTemplateId = (data: string): string => {
    const m = data.match(/template_id=([0-9a-f-]+)/)
    return m ? m[1] : ''
  }
  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 bg-slate-50/50 dark:bg-slate-900/30">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-mono bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded">#{index + 1}</span>
        <select
          value={type}
          onChange={e => setType(e.target.value as RMAction['type'])}
          className="px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs"
        >
          <option value="message">テキスト送信</option>
          <option value="uri">URLを開く</option>
          <option value="postback">テンプレート送信</option>
        </select>
      </div>
      {area.action.type === 'message' && (() => {
        const act = area.action
        return (
          <input type="text" value={act.text} onChange={e => onChange({ ...area, action: { type: 'message', label: act.label, text: e.target.value } })}
            placeholder="送信するテキスト"
            className="w-full px-3 py-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs" />
        )
      })()}
      {area.action.type === 'uri' && (() => {
        const act = area.action
        return (
          <input type="text" value={act.uri} onChange={e => onChange({ ...area, action: { type: 'uri', label: act.label, uri: e.target.value } })}
            placeholder="https://..."
            className="w-full px-3 py-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs" />
        )
      })()}
      {area.action.type === 'postback' && (() => {
        const act = area.action
        return (
        <select
          value={parseTemplateId(act.data)}
          onChange={e => {
            const id = e.target.value
            const name = templates.find(t => t.id === id)?.name || ''
            onChange({
              ...area,
              action: {
                type: 'postback',
                label: act.label,
                data: id ? `action=send_template&template_id=${id}` : '',
                displayText: name,
              },
            })
          }}
          className="w-full px-3 py-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs"
        >
          <option value="">テンプレートを選択...</option>
          {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        )
      })()}
    </div>
  )
}

// LINEリッチメニュー仕様に合わせて画像をリサイズ+圧縮（最大2500×1686・1MB未満）
async function compressForRichMenu(file: File, targetHeight: number): Promise<Blob> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as string)
    fr.onerror = reject
    fr.readAsDataURL(file)
  })
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = reject
    i.src = dataUrl
  })
  // 最大サイズ
  const MAX_W = 2500
  const MAX_H = targetHeight // 843 or 1686
  const scale = Math.min(1, MAX_W / img.width, MAX_H / img.height)
  const w = Math.round(img.width * scale)
  const h = Math.round(img.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas取得失敗')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  // 品質を徐々に下げて1MB未満を目指す
  for (const q of [0.92, 0.85, 0.75, 0.65, 0.55, 0.45]) {
    const blob: Blob = await new Promise((res, rej) =>
      canvas.toBlob(b => (b ? res(b) : rej(new Error('toBlob失敗'))), 'image/jpeg', q),
    )
    if (blob.size < 1024 * 1024) return blob
  }
  // それでも1MB超える場合は最後の品質を返す
  return await new Promise((res, rej) =>
    canvas.toBlob(b => (b ? res(b) : rej(new Error('toBlob失敗'))), 'image/jpeg', 0.4),
  )
}

function ImageUpload({ value, onChange, targetHeight = 1686 }: { value: string; onChange: (v: string) => void; targetHeight?: number }) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)

  const uploadFile = async (file: File) => {
    setUploading(true)
    setProgress(0)
    try {
      // LINE仕様に合わせてリサイズ+圧縮
      const blob = await compressForRichMenu(file, targetHeight)
      const compressedFile = new File([blob], 'richmenu.jpg', { type: 'image/jpeg' })
      const fd = new FormData()
      fd.append('file', compressedFile)
      const r = await api.post<{ url: string }>('/media/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: e => e.total && setProgress(Math.round((e.loaded / e.total) * 100)),
      })
      onChange(r.data.url)
    } catch (err) {
      alert('アップロード失敗: ' + (axios.isAxiosError(err) ? err.response?.data?.error || err.message : (err instanceof Error ? err.message : '')))
    } finally {
      setUploading(false)
      setProgress(0)
    }
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) uploadFile(file)
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${dragging ? 'border-[#06C755] bg-[#06C755]/5' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'} transition-colors`}
    >
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder="画像URL またはファイルをドロップ"
        className="flex-1 bg-transparent text-slate-900 dark:text-white text-sm focus:outline-none" />
      <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 text-xs font-medium cursor-pointer disabled:opacity-50">
        <Upload size={12} />
        {uploading ? `${progress}%` : 'アップロード'}
      </button>
      <input ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />
    </div>
  )
}
