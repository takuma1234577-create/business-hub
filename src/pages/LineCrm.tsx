import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Users, MessageCircle, Bot, FileText, ExternalLink, TrendingUp, Send, ShieldBan, X, User, Settings, ChevronDown } from 'lucide-react'
import FriendList from './line-crm/FriendList'
import FriendDetail from './line-crm/FriendDetail'
import ChatThreads from './line-crm/ChatThreads'
import ChatView from './line-crm/ChatView'
import AutoResponses from './line-crm/AutoResponses'
import Broadcasts from './line-crm/Broadcasts'
import AiSettings from './line-crm/AiSettings'
import KnowledgeChunks from './line-crm/KnowledgeChunks'
import MessageTemplates from './line-crm/MessageTemplates'
import RichMenus from './line-crm/RichMenus'
import GreetingSettings from './line-crm/GreetingSettings'
import TagManager from './line-crm/TagManager'
import EmailAutoReply from './line-crm/EmailAutoReply'
import TagScheduledReplies from './line-crm/TagScheduledReplies'
import TrafficSources from './line-crm/TrafficSources'
import FriendsAnalytics from './line-crm/FriendsAnalytics'
import FitpeakDashboard from './line-crm/FitpeakDashboard'
import LineAccounts from './line-crm/LineAccounts'
import { useLineAccounts } from './line-crm/useLineAccounts'
import { getChannelId, DEFAULT_CHANNEL_ID } from './line-crm/lineAccount'
import type { Friend } from './line-crm/types'

type MainTabId = 'chat' | 'content' | 'delivery' | 'ai' | 'analytics' | 'accounts'

interface MainTabDef {
  id: MainTabId
  label: string
  icon: React.ReactNode
}

export default function LineCrm() {
  const navigate = useNavigate()
  const [mainTab, setMainTab] = useState<MainTabId>('chat')
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null)

  // チャットタブ内のビュー
  const [chatView, setChatView] = useState<'threads' | 'friend-detail' | 'detail'>('threads')

  // 各グループ内のサブタブ
  const [contentSub, setContentSub] = useState<'templates' | 'rich-menus' | 'greeting' | 'tags'>('templates')
  const [deliverySub, setDeliverySub] = useState<'auto-responses' | 'tag-scheduled' | 'broadcasts'>('auto-responses')
  const [aiSub, setAiSub] = useState<'ai-settings' | 'knowledge' | 'email-auto-reply'>('ai-settings')
  const [analyticsSub, setAnalyticsSub] = useState<'friends' | 'traffic' | 'fitpeak'>('friends')

  const mainTabs: MainTabDef[] = [
    { id: 'chat', label: 'チャット', icon: <MessageCircle size={18} /> },
    { id: 'content', label: 'コンテンツ', icon: <FileText size={18} /> },
    { id: 'delivery', label: '配信', icon: <Send size={18} /> },
    { id: 'ai', label: 'AI', icon: <Bot size={18} /> },
    { id: 'analytics', label: '分析', icon: <TrendingUp size={18} /> },
    { id: 'accounts', label: 'アカウント管理', icon: <Settings size={18} /> },
  ]

  const { accounts, selectedChannelId, selectChannel } = useLineAccounts()
  const [showAccountMenu, setShowAccountMenu] = useState(false)
  const currentAccount = accounts.find((a) => a.id === selectedChannelId)

  const handleSelectFriend = (friend: Friend) => {
    setSelectedFriend(friend)
    setChatView('friend-detail')
    setMainTab('chat')
  }

  const handleOpenChatFromDetail = (friend: Friend) => {
    setSelectedFriend(friend)
    setChatView('detail')
  }

  const handleBackFromChat = () => {
    setChatView('threads')
  }

  const handleBackFromFriendDetail = () => {
    setChatView('threads')
  }

  // ブロック一覧
  const [showBlockList, setShowBlockList] = useState(false)
  const [blockedFriends, setBlockedFriends] = useState<{ id: string; display_name: string; picture_url: string | null; status: string; updated_at: string }[]>([])
  const [loadingBlocked, setLoadingBlocked] = useState(false)

  const fetchBlockedFriends = async () => {
    setLoadingBlocked(true)
    try {
      const res = await fetch(`/api/line-crm/friends-blocked?channel_id=${getChannelId()}`)
      if (res.ok) setBlockedFriends(await res.json())
    } catch (err) { console.error(err) }
    finally { setLoadingBlocked(false) }
  }

  useEffect(() => {
    if (showBlockList) fetchBlockedFriends()
  }, [showBlockList])

  const handleUnblock = async (id: string) => {
    if (!confirm('ブロックを解除しますか？')) return
    try {
      await fetch(`/api/line-crm/friends/${id}/block`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocked: false }),
      })
      fetchBlockedFriends()
    } catch (err) { console.error(err) }
  }

  const subTabCls = (active: boolean) =>
    `px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
      active
        ? 'bg-[#06C755] text-white'
        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
    }`

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

          {/* アカウントswitcher */}
          {accounts.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowAccountMenu((v) => !v)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              >
                {currentAccount?.display_name || 'アカウント選択'}
                <ChevronDown size={14} />
              </button>
              {showAccountMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowAccountMenu(false)} />
                  <div className="absolute left-0 mt-1 w-56 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg z-20 py-1">
                    {accounts.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => { selectChannel(a.id); setShowAccountMenu(false) }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer ${
                          a.id === selectedChannelId ? 'text-[#06C755] font-medium' : 'text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        {a.display_name}
                        {!a.is_active && <span className="ml-2 text-xs text-slate-400">(無効)</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <button
            onClick={() => navigate('/my-fitpeak')}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#c8a960]/10 text-[#c8a960] hover:bg-[#c8a960]/20 transition-colors cursor-pointer"
          >
            <ExternalLink size={14} />
            My FITPEAK
          </button>
        </div>
      </header>

      {/* Main Tab Navigation */}
      <nav className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex gap-1 -mb-px overflow-x-auto">
            {mainTabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setMainTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                  mainTab === tab.id
                    ? 'border-[#06C755] text-[#06C755]'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Content (アカウント切替時に配下を強制リマウントして再取得させる) */}
      <main className="max-w-6xl mx-auto px-6 py-8" key={selectedChannelId}>

        {/* ===== チャット ===== */}
        {mainTab === 'chat' && (
          <>
            {chatView === 'detail' && selectedFriend ? (
              <ChatView friend={selectedFriend} onBack={handleBackFromChat} onFriendUpdated={(f) => setSelectedFriend(f)} />
            ) : chatView === 'friend-detail' && selectedFriend ? (
              <FriendDetail friend={selectedFriend} onBack={handleBackFromFriendDetail} onOpenChat={handleOpenChatFromDetail} />
            ) : (
              <div>
                {/* ブロック一覧ボタン */}
                <div className="flex justify-end mb-4">
                  <button
                    onClick={() => setShowBlockList(true)}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                  >
                    <ShieldBan size={14} />
                    ブロック一覧
                  </button>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* 左: 友だち一覧 */}
                  <div className="lg:col-span-1">
                    <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                      <Users size={14} /> 友だち一覧
                    </h2>
                    <FriendList onSelectFriend={handleSelectFriend} />
                  </div>
                  {/* 右: チャット一覧 */}
                  <div className="lg:col-span-2">
                    <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                      <MessageCircle size={14} /> チャット一覧
                    </h2>
                    <ChatThreads onSelectFriend={handleSelectFriend} />
                  </div>
                </div>
              </div>
            )}

            {/* ブロック一覧モーダル */}
            {showBlockList && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
                  <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                      <ShieldBan size={18} /> ブロック一覧
                    </h3>
                    <button onClick={() => setShowBlockList(false)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer">
                      <X size={20} className="text-slate-500" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-5">
                    {loadingBlocked ? (
                      <div className="flex justify-center py-8">
                        <div className="w-6 h-6 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : blockedFriends.length === 0 ? (
                      <div className="text-center py-8 text-slate-400 text-sm">
                        ブロック中の友だちはいません
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {blockedFriends.map(f => (
                          <div key={f.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-700/50">
                            <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-600 flex-shrink-0 overflow-hidden">
                              {f.picture_url ? (
                                <img src={f.picture_url} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center"><User size={18} className="text-slate-400" /></div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{f.display_name}</p>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                f.status === 'blocked' ? 'bg-red-100 text-red-700' : 'bg-slate-200 text-slate-600'
                              }`}>
                                {f.status === 'blocked' ? 'ブロック中' : 'ブロックされた'}
                              </span>
                            </div>
                            {f.status === 'blocked' && (
                              <button
                                onClick={() => handleUnblock(f.id)}
                                className="px-3 py-1.5 text-xs font-medium bg-white dark:bg-slate-600 border border-slate-200 dark:border-slate-500 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-500 text-slate-700 dark:text-slate-200 cursor-pointer"
                              >
                                解除
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ===== コンテンツ (テンプレート / リッチメニュー / 挨拶メッセージ) ===== */}
        {mainTab === 'content' && (
          <>
            <div className="flex items-center gap-2 mb-6">
              <button onClick={() => setContentSub('templates')} className={subTabCls(contentSub === 'templates')}>
                テンプレート
              </button>
              <button onClick={() => setContentSub('rich-menus')} className={subTabCls(contentSub === 'rich-menus')}>
                リッチメニュー
              </button>
              <button onClick={() => setContentSub('greeting')} className={subTabCls(contentSub === 'greeting')}>
                挨拶メッセージ
              </button>
              <button onClick={() => setContentSub('tags')} className={subTabCls(contentSub === 'tags')}>
                タグ
              </button>
            </div>
            {contentSub === 'templates' && <MessageTemplates />}
            {contentSub === 'rich-menus' && <RichMenus />}
            {contentSub === 'greeting' && <GreetingSettings />}
            {contentSub === 'tags' && <TagManager />}
          </>
        )}

        {/* ===== 配信 (自動応答 / タグ遅延配信 / 一斉配信) ===== */}
        {mainTab === 'delivery' && (
          <>
            <div className="flex items-center gap-2 mb-6">
              <button onClick={() => setDeliverySub('auto-responses')} className={subTabCls(deliverySub === 'auto-responses')}>
                自動応答
              </button>
              <button onClick={() => setDeliverySub('tag-scheduled')} className={subTabCls(deliverySub === 'tag-scheduled')}>
                タグ遅延配信
              </button>
              <button onClick={() => setDeliverySub('broadcasts')} className={subTabCls(deliverySub === 'broadcasts')}>
                一斉配信
              </button>
            </div>
            {deliverySub === 'auto-responses' && <AutoResponses />}
            {deliverySub === 'tag-scheduled' && <TagScheduledReplies />}
            {deliverySub === 'broadcasts' && <Broadcasts />}
          </>
        )}

        {/* ===== AI (AI設定 / RAGナレッジ / メール自動返信) ===== */}
        {mainTab === 'ai' && (
          selectedChannelId !== DEFAULT_CHANNEL_ID ? (
            <div className="p-8 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-center text-sm text-slate-500 dark:text-slate-400">
              AI自動応答（FITPEAK AI）は既存のFITPEAKアカウント専用の機能のため、このアカウントでは利用できません。
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-6">
                <button onClick={() => setAiSub('ai-settings')} className={subTabCls(aiSub === 'ai-settings')}>
                  AI設定
                </button>
                <button onClick={() => setAiSub('knowledge')} className={subTabCls(aiSub === 'knowledge')}>
                  RAGナレッジ
                </button>
                <button onClick={() => setAiSub('email-auto-reply')} className={subTabCls(aiSub === 'email-auto-reply')}>
                  メール自動返信
                </button>
              </div>
              {aiSub === 'ai-settings' && <AiSettings />}
              {aiSub === 'knowledge' && <KnowledgeChunks />}
              {aiSub === 'email-auto-reply' && <EmailAutoReply />}
            </>
          )
        )}

        {/* ===== 分析 (友だち増減 / 流入経路) ===== */}
        {mainTab === 'analytics' && (
          <>
            <div className="flex items-center gap-2 mb-6">
              <button onClick={() => setAnalyticsSub('friends')} className={subTabCls(analyticsSub === 'friends')}>
                友だち増減
              </button>
              <button onClick={() => setAnalyticsSub('traffic')} className={subTabCls(analyticsSub === 'traffic')}>
                流入経路
              </button>
              <button onClick={() => setAnalyticsSub('fitpeak')} className={subTabCls(analyticsSub === 'fitpeak')}>
                My FITPEAK
              </button>
            </div>
            {analyticsSub === 'friends' && <FriendsAnalytics />}
            {analyticsSub === 'traffic' && <TrafficSources />}
            {analyticsSub === 'fitpeak' && <FitpeakDashboard />}
          </>
        )}

        {/* ===== アカウント管理 ===== */}
        {mainTab === 'accounts' && <LineAccounts />}

      </main>
    </div>
  )
}
