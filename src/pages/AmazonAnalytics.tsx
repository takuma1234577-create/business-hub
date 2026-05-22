import { useState } from 'react'
import { Star, ShieldAlert } from 'lucide-react'
import ToolLayout from '../components/ToolLayout'
import ReviewRequests from './amazon-analytics/ReviewRequests'
import ReviewMonitor from './amazon-analytics/ReviewMonitor'

type Tab = 'review-requests' | 'review-monitor'

const TABS: { key: Tab; label: string; icon: typeof Star }[] = [
  { key: 'review-requests', label: 'レビューリクエスト', icon: Star },
  { key: 'review-monitor', label: 'レビュー監視', icon: ShieldAlert },
]

export default function AmazonAnalytics() {
  const [activeTab, setActiveTab] = useState<Tab>('review-requests')

  return (
    <ToolLayout title="Amazon分析 & 自動化">
      {/* Tab Navigation */}
      <div className="flex gap-1 mb-6 border-b border-slate-200 dark:border-slate-700">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === key
                ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'review-requests' && <ReviewRequests />}
      {activeTab === 'review-monitor' && <ReviewMonitor />}
    </ToolLayout>
  )
}
