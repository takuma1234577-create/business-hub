import { useState } from 'react'
import ToolLayout from '../components/ToolLayout'
import { Dashboard } from './accounting/Dashboard'
import { DocumentList } from './accounting/DocumentList'
import { DocumentDetail } from './accounting/DocumentDetail'
import { PendingDocuments } from './accounting/PendingDocuments'
import { SourceSettings } from './accounting/SourceSettings'
import type { AccountingDocument } from './accounting/types'

type Tab = 'dashboard' | 'documents' | 'pending' | 'sources'

const tabs: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'ダッシュボード' },
  { id: 'documents', label: '書類一覧' },
  { id: 'pending', label: '未確認・手動追加' },
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
      <nav className="flex space-x-1 border-b border-gray-200 mb-6">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setSelectedDoc(null) }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
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
      {activeTab === 'sources' && <SourceSettings />}
    </ToolLayout>
  )
}
