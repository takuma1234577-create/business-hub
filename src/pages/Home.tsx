import { useNavigate } from 'react-router-dom'
import {
  FileText,
  ClipboardList,
  Package,
  MessageCircle,
  Receipt,
  ArrowRight,
  Settings,
  RotateCcw,
} from 'lucide-react'
import type { ReactNode } from 'react'

interface Tool {
  id: string
  name: string
  description: string
  icon: ReactNode
  path: string
  color: string
  bgColor: string
  status: 'active' | 'coming-soon'
  links?: { label: string; path: string }[]
}

const tools: Tool[] = [
  {
    id: 'invoice',
    name: '請求書ツール',
    description: '請求書の作成・送信・自動化。Amazon売上データ連携、PDF生成、Gmail送信に対応。',
    icon: <FileText size={28} />,
    path: '/invoice',
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-950/50',
    status: 'active',
  },
  {
    id: 'tasks',
    name: 'AI秘書 / タスク管理',
    description: 'Chatwork・Gmailからタスクを自動生成。会議メモ解析、顧客別タスク管理。',
    icon: <ClipboardList size={28} />,
    path: '/tasks',
    color: 'text-emerald-600 dark:text-emerald-400',
    bgColor: 'bg-emerald-50 dark:bg-emerald-950/50',
    status: 'active',
  },
  {
    id: 'amazon',
    name: 'Amazon自動出荷',
    description: 'マルチチャネル自動出荷。Shopify・TikTok ShopからAmazon MCFへの自動連携。',
    icon: <Package size={28} />,
    path: '/amazon',
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-50 dark:bg-orange-950/50',
    status: 'active',
  },
  {
    id: 'line-crm',
    name: 'LINE CRM',
    description: 'LINE公式アカウントの顧客管理。メッセージ配信、セグメント管理。',
    icon: <MessageCircle size={28} />,
    path: '/line-crm',
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-50 dark:bg-green-950/50',
    status: 'active',
  },
  {
    id: 'accounting',
    name: '会計書類管理',
    description: 'Gmail・Webから請求書・領収書を自動収集。AI解析で仕訳・整理を自動化。',
    icon: <Receipt size={28} />,
    path: '/accounting',
    color: 'text-violet-600 dark:text-violet-400',
    bgColor: 'bg-violet-50 dark:bg-violet-950/50',
    status: 'active',
  },
  {
    id: 'return-review',
    name: '返品・交換審査システム',
    description: 'お客様からの返品・交換申請をAIで自動審査。Shopify返金・LINE通知を自動化。',
    icon: <RotateCcw size={28} />,
    path: '/return-request',
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-950/50',
    status: 'active',
    links: [
      { label: '顧客申請フォーム', path: '/return-request' },
      { label: '審査ルール設定', path: '/return-settings' },
      { label: '審査ログ一覧', path: '/return-logs' },
    ],
  },
]

export default function Home() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Header */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
        <div className="max-w-5xl mx-auto px-6 py-8 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              業務ツール
            </h1>
            <p className="mt-1 text-slate-500 dark:text-slate-400">
              業務効率化・自動化ツール一覧
            </p>
          </div>
          <button
            onClick={() => navigate('/settings')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600 transition text-sm font-medium"
          >
            <Settings size={16} />
            API設定
          </button>
        </div>
      </header>

      {/* Tool Grid */}
      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tools.map((tool) => (
            <div
              key={tool.id}
              className="group relative flex flex-col items-start text-left p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-md transition-all duration-200"
            >
              <button
                onClick={() => navigate(tool.path)}
                className="w-full text-left cursor-pointer"
              >
                {/* Icon */}
                <div className={`p-3 rounded-lg ${tool.bgColor} ${tool.color} mb-4`}>
                  {tool.icon}
                </div>

                {/* Content */}
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  {tool.name}
                  {tool.status === 'coming-soon' && (
                    <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">
                      準備中
                    </span>
                  )}
                </h2>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                  {tool.description}
                </p>
              </button>

              {/* Sub-links */}
              {tool.links && (
                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 w-full flex flex-wrap gap-2">
                  {tool.links.map((link) => (
                    <button
                      key={link.path}
                      onClick={() => navigate(link.path)}
                      className="text-xs px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer"
                    >
                      {link.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Arrow */}
              <div className="absolute top-6 right-6 text-slate-300 dark:text-slate-700 group-hover:text-slate-500 dark:group-hover:text-slate-400 transition-colors">
                <ArrowRight size={20} />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
