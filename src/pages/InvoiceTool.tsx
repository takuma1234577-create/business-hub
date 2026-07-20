import { useState } from 'react'
import ToolLayout from '../components/ToolLayout'
import { InvoiceForm } from './invoice/InvoiceForm'
import { ReceiptForm } from './invoice/ReceiptForm'
import { ClientManager } from './invoice/ClientManager'
import { TemplateManager } from './invoice/TemplateManager'
import { HistoryView } from './invoice/HistoryView'
import { ScheduleManager } from './invoice/ScheduleManager'
import { SettingsManager } from './invoice/SettingsManager'
import { AuthStatus } from './invoice/AuthStatus'

type Tab = 'invoice' | 'receipt' | 'clients' | 'templates' | 'history' | 'schedules' | 'settings'

const tabs: { id: Tab; label: string }[] = [
  { id: 'invoice', label: '請求書作成' },
  { id: 'receipt', label: '領収書作成' },
  { id: 'clients', label: 'クライアント管理' },
  { id: 'templates', label: 'メールテンプレート' },
  { id: 'history', label: '送信履歴' },
  { id: 'schedules', label: '自動送信設定' },
  { id: 'settings', label: '設定' },
]

export default function InvoiceTool() {
  const [activeTab, setActiveTab] = useState<Tab>('invoice')

  return (
    <ToolLayout title="請求書ツール">
      <div className="mb-6 flex items-center justify-between">
        <nav className="flex space-x-1 border-b border-gray-200 flex-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="ml-4">
          <AuthStatus />
        </div>
      </div>

      {activeTab === 'invoice' && <InvoiceForm />}
      {activeTab === 'receipt' && <ReceiptForm />}
      {activeTab === 'clients' && <ClientManager />}
      {activeTab === 'templates' && <TemplateManager />}
      {activeTab === 'history' && <HistoryView />}
      {activeTab === 'schedules' && <ScheduleManager />}
      {activeTab === 'settings' && <SettingsManager />}
    </ToolLayout>
  )
}
