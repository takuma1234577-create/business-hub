import { useState } from 'react'
import ToolLayout from '../components/ToolLayout'
import Dashboard from './streamer-clip/Dashboard'
import ProfileManager from './streamer-clip/ProfileManager'
import JobList from './streamer-clip/JobList'
import ReviewCandidates from './streamer-clip/ReviewCandidates'

type Tab = 'dashboard' | 'profiles' | 'jobs' | 'review'

const tabs: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'ダッシュボード' },
  { id: 'profiles', label: 'プロファイル管理' },
  { id: 'jobs', label: 'ジョブ一覧' },
  { id: 'review', label: 'レビュー' },
]

export default function StreamerClip() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard')

  return (
    <ToolLayout title="切り抜きプラットフォーム">
      {/* Tabs */}
      <div className="flex gap-1 mb-8 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition cursor-pointer ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'dashboard' && <Dashboard />}
      {activeTab === 'profiles' && <ProfileManager />}
      {activeTab === 'jobs' && <JobList />}
      {activeTab === 'review' && <ReviewCandidates />}
    </ToolLayout>
  )
}
