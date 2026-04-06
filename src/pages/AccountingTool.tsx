import { useState } from 'react'
import ToolLayout from '../components/ToolLayout'
import { Dashboard } from './accounting/Dashboard'
import { DocumentList } from './accounting/DocumentList'
import { DocumentDetail } from './accounting/DocumentDetail'
import { PendingDocuments } from './accounting/PendingDocuments'
import { SourceSettings } from './accounting/SourceSettings'
import { Transactions } from './accounting/Transactions'
import { JournalEntries } from './accounting/JournalEntries'
import { BalanceSheet } from './accounting/BalanceSheet'
import { ProfitLoss } from './accounting/ProfitLoss'
import { FiscalAnalysis } from './accounting/FiscalAnalysis'
import type { AccountingDocument } from './accounting/types'

type Tab = 'dashboard' | 'documents' | 'pending' | 'transactions' | 'journal' | 'bs' | 'pl' | 'fiscal' | 'sources'

const tabs: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'ダッシュボード' },
  { id: 'fiscal', label: '事業年度分析' },
  { id: 'documents', label: '書類一覧' },
  { id: 'pending', label: '未確認・手動追加' },
  { id: 'transactions', label: '取引明細' },
  { id: 'journal', label: '仕訳帳' },
  { id: 'bs', label: '貸借対照表' },
  { id: 'pl', label: '損益計算書' },
  { id: 'sources', label: '収集設定' },
]

export default function AccountingTool() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard')
  const [selectedDoc, setSelectedDoc] = useState<AccountingDocument | null>(null)

  const handleSelectDoc = (doc: AccountingDocument) => {
    setSelectedDoc(doc)
  }

  const handleBackToList = () => {
    setSelectedDoc(null)
  }

  return (
    <ToolLayout title="会計書類管理">
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
      {activeTab === 'documents' && (
        selectedDoc
          ? <DocumentDetail documentId={selectedDoc.id} onBack={handleBackToList} />
          : <DocumentList onSelect={handleSelectDoc} />
      )}
      {activeTab === 'pending' && <PendingDocuments />}
      {activeTab === 'transactions' && <Transactions />}
      {activeTab === 'journal' && <JournalEntries />}
      {activeTab === 'bs' && <BalanceSheet />}
      {activeTab === 'pl' && <ProfitLoss />}
      {activeTab === 'fiscal' && <FiscalAnalysis />}
      {activeTab === 'sources' && <SourceSettings />}
    </ToolLayout>
  )
}
