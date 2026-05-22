import { useState, useEffect, createContext, useContext } from 'react'
import ToolLayout from '../components/ToolLayout'
import { Dashboard } from './accounting/Dashboard'
import { DocumentList } from './accounting/DocumentList'
import { DocumentDetail } from './accounting/DocumentDetail'
import { PendingDocuments } from './accounting/PendingDocuments'
import { SourceSettings } from './accounting/SourceSettings'
import { Transactions } from './accounting/Transactions'
import { JournalEntries } from './accounting/JournalEntries'
import { FiscalAnalysis } from './accounting/FiscalAnalysis'
import { fiscalYearApi } from './accounting/api'
import type { FiscalYear } from './accounting/api'
import type { AccountingDocument } from './accounting/types'
import { Calendar, ChevronDown } from 'lucide-react'

// グローバル年度コンテキスト
interface FiscalYearContextType {
  fiscalYear: FiscalYear | null
  allYears: FiscalYear[]
  setFiscalYear: (fy: FiscalYear) => void
}
export const FiscalYearContext = createContext<FiscalYearContextType>({
  fiscalYear: null, allYears: [], setFiscalYear: () => {}
})
export const useFiscalYear = () => useContext(FiscalYearContext)

type Tab = 'dashboard' | 'fiscal' | 'journal' | 'transactions' | 'documents' | 'pending' | 'sources'

const tabs: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'ダッシュボード' },
  { id: 'fiscal', label: '決算書・分析' },
  { id: 'journal', label: '仕訳帳' },
  { id: 'transactions', label: '取引明細' },
  { id: 'documents', label: '書類一覧' },
  { id: 'pending', label: '未確認・手動追加' },
  { id: 'sources', label: '収集設定' },
]

export default function AccountingTool() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard')
  const [selectedDoc, setSelectedDoc] = useState<AccountingDocument | null>(null)
  const [allYears, setAllYears] = useState<FiscalYear[]>([])
  const [fiscalYear, setFiscalYear] = useState<FiscalYear | null>(null)
  const [showYearDropdown, setShowYearDropdown] = useState(false)

  useEffect(() => {
    fiscalYearApi.listYears().then(years => {
      setAllYears(years)
      const current = years.find(y => y.is_current) || years[0]
      if (current) setFiscalYear(current)
    }).catch(console.error)
  }, [])

  return (
    <FiscalYearContext.Provider value={{ fiscalYear, allYears, setFiscalYear }}>
      <ToolLayout title="会計書類管理">
        {/* 年度セレクター */}
        {allYears.length > 0 && (
          <div className="flex items-center justify-between mb-4 bg-white border border-gray-200 rounded-lg px-4 py-2.5">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Calendar size={16} className="text-violet-500" />
              <span>事業年度:</span>
            </div>
            <div className="relative">
              <button
                onClick={() => setShowYearDropdown(!showYearDropdown)}
                className="flex items-center gap-2 px-4 py-1.5 text-sm font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-lg hover:bg-violet-100"
              >
                {fiscalYear?.year_label || '全期'}
                {fiscalYear && (
                  <span className="text-xs text-violet-400 font-normal">
                    ({fiscalYear.start_date} 〜 {fiscalYear.end_date})
                  </span>
                )}
                <ChevronDown size={14} />
              </button>
              {showYearDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowYearDropdown(false)} />
                  <div className="absolute right-0 top-full mt-1 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                    <button
                      onClick={() => { setFiscalYear(null as any); setShowYearDropdown(false) }}
                      className={`w-full text-left px-4 py-2.5 text-sm hover:bg-violet-50 flex items-center justify-between border-b border-gray-100 ${
                        !fiscalYear ? 'bg-violet-50 text-violet-700 font-medium' : 'text-gray-700'
                      }`}
                    >
                      <span>全期</span>
                      <span className="text-xs text-gray-400">全事業年度を合算</span>
                    </button>
                    {allYears.map(y => (
                      <button
                        key={y.id}
                        onClick={() => { setFiscalYear(y); setShowYearDropdown(false) }}
                        className={`w-full text-left px-4 py-2.5 text-sm hover:bg-violet-50 flex items-center justify-between ${
                          fiscalYear?.id === y.id ? 'bg-violet-50 text-violet-700 font-medium' : 'text-gray-700'
                        }`}
                      >
                        <span>{y.year_label}</span>
                        <span className="text-xs text-gray-400">{y.start_date} 〜 {y.end_date}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* タブナビ */}
        <nav className="flex space-x-1 border-b border-gray-200 mb-6 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setSelectedDoc(null) }}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-violet-500 text-violet-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'fiscal' && <FiscalAnalysis />}
        {activeTab === 'journal' && <JournalEntries />}
        {activeTab === 'transactions' && <Transactions />}
        {activeTab === 'documents' && (
          selectedDoc
            ? <DocumentDetail documentId={selectedDoc.id} onBack={() => setSelectedDoc(null)} />
            : <DocumentList onSelect={(doc: AccountingDocument) => setSelectedDoc(doc)} />
        )}
        {activeTab === 'pending' && <PendingDocuments />}
        {activeTab === 'sources' && <SourceSettings />}
      </ToolLayout>
    </FiscalYearContext.Provider>
  )
}
