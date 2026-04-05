import { Folder, FolderOpen, FolderPlus } from 'lucide-react'

interface FolderTabsProps {
  folders: string[]
  selected: string | null // null = すべて（未分類のみ）
  onSelect: (folder: string | null) => void
  onCreate?: (name: string) => void
  counts?: Record<string, number> & { __all?: number; __none?: number }
}

// 旧定数（互換用）。すべて(null) = 未分類として扱う。
export const UNCATEGORIZED = '__uncategorized__'

export default function FolderTabs({ folders, selected, onSelect, onCreate, counts = {} }: FolderTabsProps) {
  const cls = (active: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
      active
        ? 'bg-[#06C755] text-white'
        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
    }`

  const handleCreate = () => {
    if (!onCreate) return
    const name = window.prompt('フォルダ名を入力してください')
    const trimmed = name?.trim()
    if (trimmed) onCreate(trimmed)
  }

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1 mb-4">
      <button onClick={() => onSelect(null)} className={cls(selected === null)}>
        すべて
        {typeof counts.__none === 'number' && <span className="opacity-70">({counts.__none})</span>}
      </button>
      {folders.map(f => (
        <button key={f} onClick={() => onSelect(f)} className={cls(selected === f)}>
          {selected === f ? <FolderOpen size={12} /> : <Folder size={12} />}
          {f}
          {typeof counts[f] === 'number' && <span className="opacity-70">({counts[f]})</span>}
        </button>
      ))}
      {onCreate && (
        <button
          onClick={handleCreate}
          className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 hover:text-[#06C755] hover:border-[#06C755] transition-colors cursor-pointer"
        >
          <FolderPlus size={12} /> 新規フォルダ
        </button>
      )}
    </div>
  )
}

/**
 * フォルダ値(null|string)で items を絞り込む。
 * null  = 未分類のみ（フォルダ未指定）
 * string= 指定フォルダのみ
 */
export function filterByFolder<T extends { folder?: string | null }>(
  items: T[],
  selected: string | null,
): T[] {
  if (selected === null) return items.filter(i => !i.folder)
  if (selected === UNCATEGORIZED) return items.filter(i => !i.folder)
  return items.filter(i => i.folder === selected)
}

/** items から folder 集合と各件数を計算 */
export function computeFolderCounts<T extends { folder?: string | null }>(items: T[]) {
  const counts: Record<string, number> & { __all: number; __none: number } = {
    __all: items.length,
    __none: 0,
  }
  for (const it of items) {
    if (!it.folder) counts.__none++
    else counts[it.folder] = (counts[it.folder] || 0) + 1
  }
  const folders = Object.keys(counts)
    .filter(k => k !== '__all' && k !== '__none')
    .sort((a, b) => a.localeCompare(b, 'ja'))
  return { folders, counts }
}
