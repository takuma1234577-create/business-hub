import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Users, MessageCircle, Zap, Megaphone, Bot, BookOpen, FileText, LayoutGrid, Sparkles, Mail } from 'lucide-react'
import FriendList from './line-crm/FriendList'
import ChatThreads from './line-crm/ChatThreads'
import ChatView from './line-crm/ChatView'
import AutoResponses from './line-crm/AutoResponses'
import Broadcasts from './line-crm/Broadcasts'
import AiSettings from './line-crm/AiSettings'
import KnowledgeChunks from './line-crm/KnowledgeChunks'
import MessageTemplates from './line-crm/MessageTemplates'
import RichMenus from './line-crm/RichMenus'
import GreetingSettings from './line-crm/GreetingSettings'
import EmailAutoReply from './line-crm/EmailAutoReply'
import type { Friend } from './line-crm/types'

type TabId = 'friends' | 'threads' | 'chat' | 'auto-responses' | 'broadcasts' | 'ai-settings' | 'knowledge' | 'templates' | 'rich-menus' | 'greeting' | 'email-auto-reply'

interface TabDef {
  id: TabId
  label: string
  icon: React.ReactNode
  hidden?: boolean
}

export default function LineCrm() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<TabId>('friends')
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null)

  const tabs: TabDef[] = [
    { id: 'friends', label: '友だち一覧', icon: <Users size={18} /> },
    { id: 'threads', label: 'チャット一覧', icon: <MessageCircle size={18} /> },
    { id: 'chat', label: 'チャット', icon: <MessageCircle size={18} />, hidden: !selectedFriend },
    { id: 'templates', label: 'テンプレート', icon: <FileText size={18} /> },
    { id: 'rich-menus', label: 'リッチメニュー', icon: <LayoutGrid size={18} /> },
    { id: 'greeting', label: '挨拶メッセージ', icon: <Sparkles size={18} /> },
    { id: 'auto-responses', label: '自動応答', icon: <Zap size={18} /> },
    { id: 'broadcasts', label: '一斉配信', icon: <Megaphone size={18} /> },
    { id: 'ai-settings', label: 'AI設定', icon: <Bot size={18} /> },
    { id: 'knowledge', label: 'RAGナレッジ', icon: <BookOpen size={18} /> },
    { id: 'email-auto-reply', label: 'メール自動返信', icon: <Mail size={18} /> },
  ]

  const handleSelectFriend = (friend: Friend) => {
    setSelectedFriend(friend)
    setActiveTab('chat')
  }

  const handleBackFromChat = () => {
    setActiveTab('threads')
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Header */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors cursor-pointer"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#06C755] flex items-center justify-center">
              <MessageCircle size={16} className="text-white" />
            </div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
              LINE CRM
            </h1>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex gap-1 -mb-px overflow-x-auto">
            {tabs.filter(t => !t.hidden).map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === tab.id
                    ? 'border-[#06C755] text-[#06C755]'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300'
                }`}
              >
                {tab.icon}
                {tab.label}
                {tab.id === 'chat' && selectedFriend && (
                  <span className="text-xs bg-[#06C755]/10 text-[#06C755] px-2 py-0.5 rounded-full ml-1 max-w-[100px] truncate">
                    {selectedFriend.display_name}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {activeTab === 'friends' && (
          <FriendList onSelectFriend={handleSelectFriend} />
        )}
        {activeTab === 'threads' && (
          <ChatThreads onSelectFriend={handleSelectFriend} />
        )}
        {activeTab === 'chat' && selectedFriend && (
          <ChatView friend={selectedFriend} onBack={handleBackFromChat} />
        )}
        {activeTab === 'auto-responses' && (
          <AutoResponses />
        )}
        {activeTab === 'broadcasts' && (
          <Broadcasts />
        )}
        {activeTab === 'ai-settings' && (
          <AiSettings />
        )}
        {activeTab === 'knowledge' && (
          <KnowledgeChunks />
        )}
        {activeTab === 'templates' && (
          <MessageTemplates />
        )}
        {activeTab === 'rich-menus' && (
          <RichMenus />
        )}
        {activeTab === 'greeting' && (
          <GreetingSettings />
        )}
        {activeTab === 'email-auto-reply' && (
          <EmailAutoReply />
        )}
      </main>
    </div>
  )
}
