import { useNavigate } from 'react-router-dom'
import {
  FileText,
  ClipboardList,
  Package,
  MessageCircle,
  Receipt,
  ArrowRight,
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
]

export default function Home() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Header */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            業務ツール
          </h1>
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            業務効率化・自動化ツール一覧
          </p>
        </div>
      </header>

      {/* Tool Grid */}
      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => navigate(tool.path)}
              className="group relative flex flex-col items-start text-left p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-md transition-all duration-200 cursor-pointer"
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

              {/* Arrow */}
              <div className="absolute top-6 right-6 text-slate-300 dark:text-slate-700 group-hover:text-slate-500 dark:group-hover:text-slate-400 transition-colors">
                <ArrowRight size={20} />
              </div>
            </button>
          ))}
        </div>
      </main>
    </div>
  )
}
