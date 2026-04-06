import { useState, useEffect, useCallback } from 'react'
import { journalEntryApi, accountTitleApi, importStatementApi } from './api'
import type { JournalEntry } from './api'
import { Plus, Trash2, Upload, Search, ChevronLeft, ChevronRight, X } from 'lucide-react'

const fmt = (n: number) => n > 0 ? `¥${n.toLocaleString()}` : ''

interface AccountTitle { id: string; code: string; name: string; category: string; subcategory: string }

export function JournalEntries() {
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [accounts, setAccounts] = useState<AccountTitle[]>([])

  // 新規仕訳フォーム
  const [showForm, setShowForm] = useState(false)
  const [formDate, setFormDate] = useState(new Date().toISOString().split('T')[0])
  const [formDesc, setFormDesc] = useState('')
  const [formLines, setFormLines] = useState([
    { accountTitleId: '', debitAmount: 0, creditAmount: 0 },
    { accountTitleId: '', debitAmount: 0, creditAmount: 0 },
  ])

  // 決算書アップロード
  const [showImport, setShowImport] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importType, setImportType] = useState('tax_return')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ created: number; skipped: number } | null>(null)

  const limit = 30

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string | number> = { page, limit }
      if (search) params.search = search
      if (dateFrom) params.dateFrom = dateFrom
      if (dateTo) params.dateTo = dateTo
      const data = await journalEntryApi.list(params)
      setEntries(data.entries)
      setTotal(data.total)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }, [page, search, dateFrom, dateTo])

  useEffect(() => {
    accountTitleApi.list().then(setAccounts).catch(console.error)
  }, [])
  useEffect(() => { fetchEntries() }, [fetchEntries])

  const addLine = () => setFormLines(l => [...l, { accountTitleId: '', debitAmount: 0, creditAmount: 0 }])
  const removeLine = (i: number) => setFormLines(l => l.filter((_, idx) => idx !== i))
  const updateLine = (i: number, field: string, value: string | number) => {
    setFormLines(l => l.map((line, idx) => idx === i ? { ...line, [field]: value } : line))
  }

  const totalDebit = formLines.reduce((s, l) => s + (Number(l.debitAmount) || 0), 0)
  const totalCredit = formLines.reduce((s, l) => s + (Number(l.creditAmount) || 0), 0)
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0

  const handleCreate = async () => {
    if (!isBalanced) return alert('借方と貸方の合計が一致しません')
    const validLines = formLines.filter(l => l.accountTitleId && (l.debitAmount > 0 || l.creditAmount > 0))
    if (validLines.length < 2) return alert('最低2行の仕訳が必要です')
    try {
      await journalEntryApi.create({ entryDate: formDate, description: formDesc || undefined, lines: validLines })
      setShowForm(false)
      setFormDate(new Date().toISOString().split('T')[0])
      setFormDesc('')
      setFormLines([
        { accountTitleId: '', debitAmount: 0, creditAmount: 0 },
        { accountTitleId: '', debitAmount: 0, creditAmount: 0 },
      ])
      fetchEntries()
    } catch (err) {
      console.error(err)
      alert('仕訳の作成に失敗しました')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('この仕訳を削除しますか？')) return
    try { await journalEntryApi.delete(id); fetchEntries() }
    catch (err) { console.error(err); alert('削除に失敗しました') }
  }

  const handleImport = async () => {
    if (!importFile) return
    setImporting(true); setImportResult(null)
    try {
      const result = await importStatementApi.upload(importFile, importType)
      setImportResult(result)
      fetchEntries()
    } catch (err) { console.error(err); alert('取り込みに失敗しました') }
    finally { setImporting(false) }
  }

  const totalPages = Math.ceil(total / limit)

  // 勘定科目をカテゴリ別グループ化
  const groupedAccounts = accounts.reduce<Record<string, AccountTitle[]>>((g, a) => {
    const key = a.subcategory || a.category
    if (!g[key]) g[key] = []
    g[key].push(a)
    return g
  }, {})

  return (
    <div className="space-y-6">
      {/* アクションバー */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-700">
          <Plus size={16} /> 仕訳入力
        </button>
        <button onClick={() => setShowImport(!showImport)}
          className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700">
          <Upload size={16} /> 決算書取り込み
        </button>
      </div>

      {/* 決算書アップロード */}
      {showImport && (
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <h4 className="text-sm font-medium text-gray-700 mb-3">決算書・財務諸表の取り込み</h4>
          <p className="text-xs text-gray-400 mb-3">過去の決算書をアップロードすると、AIが読み取って仕訳データを自動生成します。</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">書類種別</label>
              <select value={importType} onChange={e => setImportType(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                <option value="tax_return">決算書（B/S+P/L）</option>
                <option value="bs">貸借対照表のみ</option>
                <option value="pl">損益計算書のみ</option>
                <option value="journal">仕訳帳</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">ファイル（PDF/画像）</label>
              <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={e => setImportFile(e.target.files?.[0] || null)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex items-end">
              <button onClick={handleImport} disabled={!importFile || importing}
                className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                {importing ? 'AI解析中...' : '取り込み開始'}
              </button>
            </div>
          </div>
          {importResult && (
            <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800">
              取り込み完了: {importResult.created}件の仕訳を作成 / {importResult.skipped}件スキップ
            </div>
          )}
        </div>
      )}

      {/* 仕訳入力フォーム */}
      {showForm && (
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <h4 className="text-sm font-medium text-gray-700 mb-3">新規仕訳</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">日付 *</label>
              <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">摘要</label>
              <input value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="取引の内容"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          <table className="w-full text-sm mb-3">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left px-3 py-2 text-xs text-gray-500">勘定科目</th>
                <th className="text-right px-3 py-2 text-xs text-gray-500 w-36">借方</th>
                <th className="text-right px-3 py-2 text-xs text-gray-500 w-36">貸方</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {formLines.map((line, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="px-3 py-2">
                    <select value={line.accountTitleId} onChange={e => updateLine(i, 'accountTitleId', e.target.value)}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                      <option value="">勘定科目を選択...</option>
                      {Object.entries(groupedAccounts).map(([group, items]) => (
                        <optgroup key={group} label={group}>
                          {items.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" value={line.debitAmount || ''} onChange={e => updateLine(i, 'debitAmount', Number(e.target.value) || 0)}
                      placeholder="0" className="w-full text-right border border-gray-300 rounded px-2 py-1.5 text-sm" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" value={line.creditAmount || ''} onChange={e => updateLine(i, 'creditAmount', Number(e.target.value) || 0)}
                      placeholder="0" className="w-full text-right border border-gray-300 rounded px-2 py-1.5 text-sm" />
                  </td>
                  <td className="px-3 py-2">
                    {formLines.length > 2 && (
                      <button onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="bg-gray-50 font-medium">
                <td className="px-3 py-2 text-right text-xs text-gray-600">合計</td>
                <td className={`px-3 py-2 text-right text-sm ${isBalanced ? 'text-emerald-600' : 'text-red-600'}`}>¥{totalDebit.toLocaleString()}</td>
                <td className={`px-3 py-2 text-right text-sm ${isBalanced ? 'text-emerald-600' : 'text-red-600'}`}>¥{totalCredit.toLocaleString()}</td>
                <td></td>
              </tr>
            </tbody>
          </table>

          <div className="flex items-center gap-3">
            <button onClick={addLine} className="text-xs text-violet-600 hover:text-violet-700">+ 行を追加</button>
            <div className="flex-1" />
            {!isBalanced && totalDebit > 0 && (
              <span className="text-xs text-red-500">借方と貸方が一致していません（差額: ¥{Math.abs(totalDebit - totalCredit).toLocaleString()}）</span>
            )}
            <button onClick={handleCreate} disabled={!isBalanced}
              className="px-4 py-2 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-700 disabled:opacity-50">登録</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded-lg">キャンセル</button>
          </div>
        </div>
      )}

      {/* フィルター */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="摘要で検索..." className="w-full pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm" />
          {search && <button onClick={() => { setSearch(''); setPage(1) }} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"><X size={14} /></button>}
        </div>
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1) }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        <span className="text-gray-400 text-sm">〜</span>
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1) }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
      </div>

      {/* 仕訳一覧 */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 text-center"><div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full mx-auto" /></div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            <p>仕訳データがありません</p>
            <p className="text-xs mt-1">「仕訳入力」または「決算書取り込み」から追加してください</p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-gray-100">
              {entries.map(entry => (
                <div key={entry.id} className="px-5 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-500">{entry.entry_date}</span>
                      <span className="text-sm font-medium text-gray-900">{entry.description || '-'}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                        entry.source === 'ai_import' ? 'bg-blue-100 text-blue-700' :
                        entry.source === 'opening' ? 'bg-purple-100 text-purple-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>{entry.source === 'ai_import' ? 'AI取込' : entry.source === 'opening' ? '開始' : '手動'}</span>
                    </div>
                    <button onClick={() => handleDelete(entry.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
                  </div>
                  <table className="w-full text-xs">
                    <tbody>
                      {(entry.journal_entry_lines || []).map((line, i) => (
                        <tr key={i} className="text-gray-600">
                          <td className="pr-4 py-0.5 w-1/3">
                            <span className="text-gray-400 mr-1">{line.account_titles?.code}</span>
                            {line.account_titles?.name}
                          </td>
                          <td className="text-right w-28 text-gray-900">{fmt(Number(line.debit_amount))}</td>
                          <td className="text-right w-28 text-gray-900">{fmt(Number(line.credit_amount))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
                <span className="text-xs text-gray-500">{total}件</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"><ChevronLeft size={18} /></button>
                  <span className="text-sm text-gray-600">{page}/{totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"><ChevronRight size={18} /></button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
