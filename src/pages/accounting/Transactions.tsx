import { useState, useEffect, useCallback, useRef } from 'react'
import { financialAccountApi, transactionApi, institutionApi } from './api'
import type { InstitutionSearchResult, BranchSearchResult } from './api'
import type { FinancialAccount, FinancialTransaction } from './types'
import { ACCOUNT_TYPE_LABELS } from './types'
import {
  Building2, CreditCard, Plus, Upload, Trash2, ChevronLeft, ChevronRight,
  Search, X, ArrowUpCircle, ArrowDownCircle, Wallet, PiggyBank,
} from 'lucide-react'

const formatCurrency = (amount: number) => `¥${Math.abs(amount).toLocaleString()}`

const CSV_PRESETS = [
  { id: 'generic', label: '汎用（UTF-8）' },
  { id: 'mufg', label: '三菱UFJ銀行' },
  { id: 'smbc', label: '三井住友銀行' },
  { id: 'mizuho', label: 'みずほ銀行' },
  { id: 'rakuten_bank', label: '楽天銀行' },
  { id: 'credit_card_generic', label: 'クレジットカード汎用' },
  { id: 'rakuten_card', label: '楽天カード' },
  { id: 'amazon_card', label: 'Amazon Mastercard' },
]

// 検索式ドロップダウン
function SearchSelect<T extends { id: string }>({
  label, placeholder, value, displayValue, onSearch, onSelect, onClear, renderItem, required,
}: {
  label: string
  placeholder: string
  value: string
  displayValue: string
  onSearch: (q: string) => Promise<T[]>
  onSelect: (item: T) => void
  onClear: () => void
  renderItem: (item: T) => React.ReactNode
  required?: boolean
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<T[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSearch = (q: string) => {
    setQuery(q)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await onSearch(q)
        setResults(data)
      } catch { setResults([]) }
      finally { setLoading(false) }
    }, 200)
  }

  const handleFocus = async () => {
    setOpen(true)
    if (results.length === 0) {
      setLoading(true)
      try { setResults(await onSearch('')) } catch { /* */ }
      finally { setLoading(false) }
    }
  }

  return (
    <div ref={ref} className="relative">
      <label className="block text-xs text-gray-500 mb-1">{label}{required && ' *'}</label>
      {value ? (
        <div className="flex items-center gap-2 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
          <span className="flex-1 truncate">{displayValue}</span>
          <button type="button" onClick={() => { onClear(); setQuery(''); setResults([]) }} className="text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        </div>
      ) : (
        <div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={e => handleSearch(e.target.value)}
              onFocus={handleFocus}
              placeholder={placeholder}
              className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          {open && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {loading ? (
                <div className="px-3 py-2 text-xs text-gray-400">検索中...</div>
              ) : results.length === 0 ? (
                <div className="px-3 py-2 text-xs text-gray-400">
                  {query ? '該当なし' : 'キーワードを入力してください'}
                </div>
              ) : (
                results.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => { onSelect(item); setOpen(false); setQuery('') }}
                    className="w-full text-left px-3 py-2 hover:bg-violet-50 text-sm border-b border-gray-50 last:border-0"
                  >
                    {renderItem(item)}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const BANK_ACCOUNT_CATEGORIES = [
  { id: 'ordinary', label: '普通' },
  { id: 'current', label: '当座' },
  { id: 'savings', label: '貯蓄' },
  { id: 'fixed_deposit', label: '定期預金' },
  { id: 'other', label: 'その他' },
]

const CARD_ACCOUNT_CATEGORIES = [
  { id: 'personal', label: '個人用' },
  { id: 'business', label: '法人用' },
  { id: 'family', label: '家族カード' },
]

function buildAccountName(
  type: 'bank' | 'credit_card',
  institution: InstitutionSearchResult | null,
  branch: BranchSearchResult | null,
  category: string,
  accountNumber: string,
) {
  if (!institution) return ''
  const parts = [institution.name]
  if (type === 'bank') {
    if (branch) parts.push(branch.name)
    const cat = BANK_ACCOUNT_CATEGORIES.find(c => c.id === category)
    if (cat) parts.push(cat.label)
  } else {
    const cat = CARD_ACCOUNT_CATEGORIES.find(c => c.id === category)
    if (cat) parts.push(cat.label)
  }
  if (accountNumber) parts.push(accountNumber)
  return parts.join(' ')
}

export function Transactions() {
  // 口座
  const [accounts, setAccounts] = useState<FinancialAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const [showAccountForm, setShowAccountForm] = useState(false)

  // 口座フォーム
  const [formAccountType, setFormAccountType] = useState<'bank' | 'credit_card'>('bank')
  const [formAccountCategory, setFormAccountCategory] = useState('ordinary') // 口座種目
  const [formAccountName, setFormAccountName] = useState('')
  const [formAccountNameManual, setFormAccountNameManual] = useState(false) // 手動編集フラグ
  const [formInstitution, setFormInstitution] = useState<InstitutionSearchResult | null>(null)
  const [formBranch, setFormBranch] = useState<BranchSearchResult | null>(null)
  const [formAccountNumber, setFormAccountNumber] = useState('')

  // 取引
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [loading, setLoading] = useState(true)

  // CSV取り込み
  const [showCsvImport, setShowCsvImport] = useState(false)
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvPreset, setCsvPreset] = useState('generic')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null)

  // 手動入力
  const [showManualForm, setShowManualForm] = useState(false)
  const [manualForm, setManualForm] = useState({
    transactionDate: new Date().toISOString().split('T')[0],
    description: '',
    amount: '',
    counterparty: '',
    memo: '',
    isExpense: true,
  })

  const limit = 50

  const fetchAccounts = useCallback(async () => {
    try {
      const data = await financialAccountApi.list()
      setAccounts(data)
      if (data.length > 0 && !selectedAccountId) {
        setSelectedAccountId(data[0].id)
      }
    } catch (err) {
      console.error('Failed to fetch accounts:', err)
    }
  }, [selectedAccountId])

  const fetchTransactions = useCallback(async () => {
    if (!selectedAccountId) { setTransactions([]); setTotal(0); setLoading(false); return }
    setLoading(true)
    try {
      const params: Record<string, string | number> = { accountId: selectedAccountId, page, limit }
      if (search) params.search = search
      if (dateFrom) params.dateFrom = dateFrom
      if (dateTo) params.dateTo = dateTo
      const data = await transactionApi.list(params)
      setTransactions(data.transactions)
      setTotal(data.total)
    } catch (err) {
      console.error('Failed to fetch transactions:', err)
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId, page, search, dateFrom, dateTo])

  useEffect(() => { fetchAccounts() }, [])
  useEffect(() => { fetchTransactions() }, [fetchTransactions])

  const resetAccountForm = () => {
    setFormAccountType('bank')
    setFormAccountCategory('ordinary')
    setFormAccountName('')
    setFormAccountNameManual(false)
    setFormInstitution(null)
    setFormBranch(null)
    setFormAccountNumber('')
  }

  // 口座名の自動生成（手動編集していない場合のみ）
  const updateAutoName = (
    type = formAccountType,
    inst: InstitutionSearchResult | null = formInstitution,
    br: BranchSearchResult | null = formBranch,
    cat = formAccountCategory,
    num = formAccountNumber,
  ) => {
    if (!formAccountNameManual) {
      setFormAccountName(buildAccountName(type, inst, br, cat, num))
    }
  }

  const handleCreateAccount = async () => {
    if (!formInstitution) return alert('金融機関は必須です')
    const name = formAccountName || buildAccountName(formAccountType, formInstitution, formBranch, formAccountCategory, formAccountNumber)
    if (!name) return alert('口座名を入力してください')
    try {
      await financialAccountApi.create({
        accountType: formAccountType,
        accountName: name,
        institutionName: formInstitution.name,
        branchName: formBranch?.name || null,
        accountNumberMasked: formAccountNumber || null,
        currency: 'JPY',
      })
      setShowAccountForm(false)
      resetAccountForm()
      fetchAccounts()
    } catch (err) {
      console.error(err)
      alert('口座の登録に失敗しました')
    }
  }

  const handleDeleteAccount = async (id: string) => {
    if (!confirm('この口座と関連する全取引を削除しますか？')) return
    try {
      await financialAccountApi.delete(id)
      if (selectedAccountId === id) setSelectedAccountId('')
      fetchAccounts()
    } catch (err) {
      console.error(err)
      alert('削除に失敗しました')
    }
  }

  const handleCsvImport = async () => {
    if (!csvFile || !selectedAccountId) return
    setImporting(true)
    setImportResult(null)
    try {
      const result = await transactionApi.importCsv(selectedAccountId, csvFile, csvPreset)
      setImportResult(result)
      fetchTransactions()
      fetchAccounts()
    } catch (err) {
      console.error(err)
      alert('CSV取り込みに失敗しました')
    } finally {
      setImporting(false)
    }
  }

  const handleManualCreate = async () => {
    if (!selectedAccountId || !manualForm.description || !manualForm.amount) return alert('日付・摘要・金額は必須です')
    try {
      const amount = manualForm.isExpense
        ? -Math.abs(parseFloat(manualForm.amount))
        : Math.abs(parseFloat(manualForm.amount))
      await transactionApi.create({
        accountId: selectedAccountId,
        transactionDate: manualForm.transactionDate,
        description: manualForm.description,
        amount,
        counterparty: manualForm.counterparty || null,
        memo: manualForm.memo || null,
        source: 'manual',
      })
      setShowManualForm(false)
      setManualForm({ transactionDate: new Date().toISOString().split('T')[0], description: '', amount: '', counterparty: '', memo: '', isExpense: true })
      fetchTransactions()
    } catch (err) {
      console.error(err)
      alert('取引の登録に失敗しました')
    }
  }

  const handleDeleteTransaction = async (id: string) => {
    if (!confirm('この取引を削除しますか？')) return
    try {
      await transactionApi.delete(id)
      fetchTransactions()
    } catch (err) {
      console.error(err)
      alert('削除に失敗しました')
    }
  }

  const totalPages = Math.ceil(total / limit)
  const totalIncome = transactions.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0)
  const totalExpense = transactions.filter(t => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0)

  return (
    <div className="space-y-6">
      {/* 口座セレクター */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-gray-700">口座</h3>
          <button onClick={() => { setShowAccountForm(true); resetAccountForm() }} className="flex items-center gap-1 text-sm text-violet-600 hover:text-violet-700">
            <Plus size={16} /> 口座を追加
          </button>
        </div>

        {accounts.length === 0 && !showAccountForm ? (
          <p className="text-gray-400 text-sm text-center py-4">口座が登録されていません。上の「口座を追加」から登録してください。</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {accounts.map(acc => (
              <div
                key={acc.id}
                onClick={() => { setSelectedAccountId(acc.id); setPage(1) }}
                className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                  selectedAccountId === acc.id
                    ? 'border-violet-500 bg-violet-50'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    {acc.accountType === 'bank'
                      ? <Building2 size={18} className="text-blue-500" />
                      : <CreditCard size={18} className="text-orange-500" />
                    }
                    <div>
                      <p className="text-sm font-medium text-gray-900">{acc.accountName}</p>
                      <p className="text-xs text-gray-500">{acc.institutionName} {acc.branchName && `/ ${acc.branchName}`}</p>
                    </div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); handleDeleteAccount(acc.id) }} className="text-gray-300 hover:text-red-500">
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="mt-3 text-right">
                  <span className="text-xs text-gray-500">{ACCOUNT_TYPE_LABELS[acc.accountType]}</span>
                  <p className={`text-lg font-bold ${acc.balance >= 0 ? 'text-gray-900' : 'text-red-600'}`}>
                    {formatCurrency(acc.balance)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 口座追加フォーム（検索式） */}
        {showAccountForm && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h4 className="text-sm font-medium text-gray-700 mb-3">新しい口座を登録</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* 種別 */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">種別</label>
                <select value={formAccountType} onChange={e => {
                  const v = e.target.value as 'bank' | 'credit_card'
                  setFormAccountType(v)
                  setFormInstitution(null); setFormBranch(null)
                  setFormAccountCategory(v === 'bank' ? 'ordinary' : 'personal')
                  updateAutoName(v, null, null, v === 'bank' ? 'ordinary' : 'personal')
                }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  <option value="bank">銀行口座</option>
                  <option value="credit_card">クレジットカード</option>
                </select>
              </div>

              {/* 金融機関（検索式） */}
              <SearchSelect<InstitutionSearchResult>
                label="金融機関"
                placeholder="銀行名・カード名で検索..."
                value={formInstitution?.id || ''}
                displayValue={formInstitution ? `${formInstitution.name}（${formInstitution.code}）` : ''}
                required
                onSearch={q => institutionApi.search(q, formAccountType === 'credit_card' ? 'credit_card' : undefined)}
                onSelect={item => { setFormInstitution(item); setFormBranch(null); updateAutoName(undefined, item, null) }}
                onClear={() => { setFormInstitution(null); setFormBranch(null); updateAutoName(undefined, null, null) }}
                renderItem={item => (
                  <div className="flex items-center gap-2">
                    {item.institutionType === 'credit_card'
                      ? <CreditCard size={14} className="text-orange-400 shrink-0" />
                      : <Building2 size={14} className="text-blue-400 shrink-0" />
                    }
                    <span className="font-medium">{item.name}</span>
                    <span className="text-xs text-gray-400">{item.code}</span>
                  </div>
                )}
              />

              {/* 支店（検索式、銀行のみ&金融機関選択後） */}
              {formAccountType === 'bank' && formInstitution && (
                <SearchSelect<BranchSearchResult>
                  label="支店"
                  placeholder="支店名・コードで検索..."
                  value={formBranch?.id || ''}
                  displayValue={formBranch ? `${formBranch.name}（${formBranch.code}）` : ''}
                  onSearch={q => institutionApi.searchBranches(formInstitution!.id, q)}
                  onSelect={item => { setFormBranch(item); updateAutoName(undefined, undefined, item) }}
                  onClear={() => { setFormBranch(null); updateAutoName(undefined, undefined, null) }}
                  renderItem={item => (
                    <div>
                      <span className="font-medium">{item.name}</span>
                      <span className="text-xs text-gray-400 ml-2">{item.code}</span>
                    </div>
                  )}
                />
              )}

              {/* 口座種目 */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">口座種目</label>
                <select value={formAccountCategory} onChange={e => {
                  setFormAccountCategory(e.target.value)
                  updateAutoName(undefined, undefined, undefined, e.target.value)
                }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {(formAccountType === 'bank' ? BANK_ACCOUNT_CATEGORIES : CARD_ACCOUNT_CATEGORIES).map(c => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>

              {/* 口座番号 */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">口座番号（下4桁など）</label>
                <input value={formAccountNumber} onChange={e => {
                  setFormAccountNumber(e.target.value)
                  updateAutoName(undefined, undefined, undefined, undefined, e.target.value)
                }}
                  placeholder="例: ****1234" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>

              {/* 口座名（自動生成 + 手動編集可） */}
              <div className="md:col-span-2 lg:col-span-3">
                <label className="block text-xs text-gray-500 mb-1">
                  口座名
                  {!formAccountNameManual && formAccountName && (
                    <span className="ml-2 text-violet-500">自動生成</span>
                  )}
                </label>
                <input value={formAccountName}
                  onChange={e => { setFormAccountName(e.target.value); setFormAccountNameManual(true) }}
                  placeholder="選択内容から自動生成されます（編集も可能）"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white" />
                {formAccountNameManual && (
                  <button type="button" onClick={() => {
                    setFormAccountNameManual(false)
                    setFormAccountName(buildAccountName(formAccountType, formInstitution, formBranch, formAccountCategory, formAccountNumber))
                  }} className="text-xs text-violet-500 hover:text-violet-700 mt-1">
                    自動生成に戻す
                  </button>
                )}
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={handleCreateAccount} className="px-4 py-2 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-700">登録</button>
              <button onClick={() => { setShowAccountForm(false); resetAccountForm() }} className="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300">キャンセル</button>
            </div>
          </div>
        )}
      </div>

      {/* 取引エリア（口座選択時のみ表示） */}
      {selectedAccountId && (
        <>
          {/* アクションバー */}
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => setShowCsvImport(v => !v)}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700">
              <Upload size={16} /> CSV取り込み
            </button>
            <button onClick={() => setShowManualForm(v => !v)}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
              <Plus size={16} /> 手動入力
            </button>
            <div className="flex-1" />
            <div className="flex items-center gap-2 text-sm">
              <PiggyBank size={16} className="text-emerald-500" />
              <span className="text-emerald-700 font-medium">入金 {formatCurrency(totalIncome)}</span>
              <span className="text-gray-300 mx-1">|</span>
              <Wallet size={16} className="text-red-500" />
              <span className="text-red-700 font-medium">出金 {formatCurrency(totalExpense)}</span>
            </div>
          </div>

          {/* CSV取り込みパネル */}
          {showCsvImport && (
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h4 className="text-sm font-medium text-gray-700 mb-3">CSV取り込み</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">フォーマット</label>
                  <select value={csvPreset} onChange={e => setCsvPreset(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                    {CSV_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">CSVファイル</label>
                  <input type="file" accept=".csv" onChange={e => setCsvFile(e.target.files?.[0] || null)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="flex items-end">
                  <button onClick={handleCsvImport} disabled={!csvFile || importing}
                    className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                    {importing ? '取り込み中...' : '取り込み開始'}
                  </button>
                </div>
              </div>
              {importResult && (
                <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800">
                  取り込み完了: {importResult.imported}件登録 / {importResult.skipped}件スキップ
                </div>
              )}
              <p className="mt-2 text-xs text-gray-400">
                各銀行・カード会社のWebサイトからダウンロードしたCSVファイルを選択してください。
                Shift_JISエンコーディングにも対応しています。
              </p>
            </div>
          )}

          {/* 手動入力フォーム */}
          {showManualForm && (
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h4 className="text-sm font-medium text-gray-700 mb-3">取引を手動入力</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">日付 *</label>
                  <input type="date" value={manualForm.transactionDate}
                    onChange={e => setManualForm(p => ({ ...p, transactionDate: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">摘要 *</label>
                  <input value={manualForm.description}
                    onChange={e => setManualForm(p => ({ ...p, description: e.target.value }))}
                    placeholder="取引内容" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">金額 *</label>
                  <div className="flex gap-2">
                    <select value={manualForm.isExpense ? 'expense' : 'income'}
                      onChange={e => setManualForm(p => ({ ...p, isExpense: e.target.value === 'expense' }))}
                      className="border border-gray-300 rounded-lg px-2 py-2 text-sm">
                      <option value="expense">出金</option>
                      <option value="income">入金</option>
                    </select>
                    <input type="number" value={manualForm.amount}
                      onChange={e => setManualForm(p => ({ ...p, amount: e.target.value }))}
                      placeholder="10000" className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">取引先</label>
                  <input value={manualForm.counterparty}
                    onChange={e => setManualForm(p => ({ ...p, counterparty: e.target.value }))}
                    placeholder="取引先名" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">メモ</label>
                  <input value={manualForm.memo}
                    onChange={e => setManualForm(p => ({ ...p, memo: e.target.value }))}
                    placeholder="備考" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="flex items-end gap-2">
                  <button onClick={handleManualCreate} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">登録</button>
                  <button onClick={() => setShowManualForm(false)} className="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300">キャンセル</button>
                </div>
              </div>
            </div>
          )}

          {/* フィルター */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1) }}
                placeholder="摘要・取引先で検索..."
                className="w-full pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm"
              />
              {search && (
                <button onClick={() => { setSearch(''); setPage(1) }} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X size={14} />
                </button>
              )}
            </div>
            <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1) }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="開始日" />
            <span className="text-gray-400 text-sm">〜</span>
            <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1) }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="終了日" />
          </div>

          {/* 取引一覧 */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {loading ? (
              <div className="p-8 text-center">
                <div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full mx-auto" />
              </div>
            ) : transactions.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <Upload size={24} className="mx-auto mb-2" />
                <p>取引データがありません</p>
                <p className="text-xs mt-1">CSVファイルを取り込むか、手動で入力してください</p>
              </div>
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">日付</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">摘要</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">取引先</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">金額</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">残高</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-gray-500">取得元</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {transactions.map(tx => (
                      <tr key={tx.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{tx.transactionDate}</td>
                        <td className="px-4 py-3 text-gray-900 max-w-[250px] truncate">{tx.description}</td>
                        <td className="px-4 py-3 text-gray-600 max-w-[150px] truncate">{tx.counterparty || '-'}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1 font-medium ${tx.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {tx.amount >= 0
                              ? <ArrowUpCircle size={14} />
                              : <ArrowDownCircle size={14} />
                            }
                            {formatCurrency(tx.amount)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-500 whitespace-nowrap">
                          {tx.balanceAfter != null ? formatCurrency(tx.balanceAfter) : '-'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            tx.source === 'csv_import' ? 'bg-emerald-100 text-emerald-700' :
                            tx.source === 'api' ? 'bg-blue-100 text-blue-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {tx.source === 'csv_import' ? 'CSV' : tx.source === 'api' ? 'API' : '手動'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => handleDeleteTransaction(tx.id)} className="text-gray-300 hover:text-red-500">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* ページネーション */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
                    <span className="text-xs text-gray-500">{total}件中 {(page - 1) * limit + 1}〜{Math.min(page * limit, total)}件</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                        className="p-1 rounded hover:bg-gray-100 disabled:opacity-30">
                        <ChevronLeft size={18} />
                      </button>
                      <span className="text-sm text-gray-600">{page} / {totalPages}</span>
                      <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                        className="p-1 rounded hover:bg-gray-100 disabled:opacity-30">
                        <ChevronRight size={18} />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
