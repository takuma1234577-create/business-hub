import { useState } from 'react'
import ToolLayout from '../components/ToolLayout'
import ScriptEditor from './fitpeak-sns/ScriptEditor'
import AssetManager from './fitpeak-sns/AssetManager'
import VideoList from './fitpeak-sns/VideoList'
import PostQueue from './fitpeak-sns/PostQueue'

type Tab = 'scripts' | 'assets' | 'videos' | 'queue'

const tabs: { id: Tab; label: string }[] = [
  { id: 'scripts', label: '台本管理' },
  { id: 'assets', label: '素材管理' },
  { id: 'videos', label: '生成動画' },
  { id: 'queue', label: '投稿キュー' },
]

export default function FitpeakSns() {
  const [activeTab, setActiveTab] = useState<Tab>('scripts')

  return (
    <ToolLayout title="SNS動画 自動生成">
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

      {activeTab === 'scripts' && <ScriptEditor />}
      {activeTab === 'assets' && <AssetManager />}
      {activeTab === 'videos' && <VideoList />}
      {activeTab === 'queue' && <PostQueue />}
    </ToolLayout>
  )
}
