import { Link } from 'react-router-dom'
import {
  FileText,
  Package,
  MessageCircle,
  ArrowRight,
  Settings,
  RotateCcw,
  Users,
  Send,
  Mail,
  Scissors,
  Star,
  Globe,
  Video,
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
    links: [
      { label: 'LINE CRM', path: '/line-crm' },
      { label: 'My FITPEAK（顧客ポータル）', path: '/my-fitpeak' },
    ],
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
  {
    id: 'consulting',
    name: 'Amazonコンサル管理',
    description: 'コンサルLP申込の自動リスト作成・メール送信。面談予約連携・ステータス管理。',
    icon: <Users size={28} />,
    path: '/consulting',
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-50 dark:bg-orange-950/50',
    status: 'active',
  },
  {
    id: 'outreach',
    name: 'セラー発掘 & 自動メール',
    description: 'Amazonセラーを自動発掘、メールアドレス抽出、テンプレートで一括コンサル営業メール送信。',
    icon: <Send size={28} />,
    path: '/outreach',
    color: 'text-rose-600 dark:text-rose-400',
    bgColor: 'bg-rose-50 dark:bg-rose-950/50',
    status: 'active',
  },
{
    id: 'sales-email',
    name: '営業メール自動送信',
    description: 'スプレッドシートからリードを取得し、AIでパーソナライズ営業メールを生成・Gmail自動送信。',
    icon: <Mail size={28} />,
    path: '/sales-email',
    color: 'text-teal-600 dark:text-teal-400',
    bgColor: 'bg-teal-50 dark:bg-teal-950/50',
    status: 'active',
  },
  {
    id: 'amazon-analytics',
    name: 'Amazon分析 & 自動化',
    description: 'Amazonレビューリクエスト自動送信、売上分析、ランキング追跡。SP-API連携で業務を自動化。',
    icon: <Star size={28} />,
    path: '/amazon-analytics',
    color: 'text-yellow-600 dark:text-yellow-400',
    bgColor: 'bg-yellow-50 dark:bg-yellow-950/50',
    status: 'active',
    links: [
      { label: 'レビューリクエスト', path: '/amazon-analytics' },
      { label: 'レビュー監視', path: '/amazon-analytics' },
    ],
  },
  {
    id: 'hp-outreach',
    name: 'HP制作 自動営業',
    description: 'Googleマップから店舗を自動リサーチ。HP未保有の店舗を発掘し、AIでLP自動生成、営業メール送信まで一括自動化。',
    icon: <Globe size={28} />,
    path: '/hp-outreach',
    color: 'text-cyan-600 dark:text-cyan-400',
    bgColor: 'bg-cyan-50 dark:bg-cyan-950/50',
    status: 'active' as const,
    links: [
      { label: 'Google Maps検索', path: '/hp-outreach' },
      { label: 'リード一覧', path: '/hp-outreach' },
      { label: 'LP生成 & 営業', path: '/hp-outreach' },
    ],
  },
  {
    id: 'shopify-reviews',
    name: 'Shopifyレビュー管理',
    description: 'アンケート・Amazonレビューを自動でShopifyストアに反映。レビュー承認・管理。',
    icon: <Star size={28} />,
    path: '/shopify-reviews',
    color: 'text-purple-600 dark:text-purple-400',
    bgColor: 'bg-purple-50 dark:bg-purple-950/50',
    status: 'active',
  },
  {
    id: 'fitpeak-sns',
    name: 'SNS動画 自動生成',
    description: 'Instagram/TikTok向け教育系リール動画を台本から自動生成。ElevenLabs音声＋JSON2Videoレンダリング。',
    icon: <Video size={28} />,
    path: '/fitpeak-sns',
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-50 dark:bg-red-950/50',
    status: 'active' as const,
    links: [
      { label: '台本管理', path: '/fitpeak-sns' },
      { label: '素材管理', path: '/fitpeak-sns' },
      { label: '生成動画', path: '/fitpeak-sns' },
    ],
  },
  {
    id: 'streamer-clip',
    name: '切り抜きプラットフォーム',
    description: '海外配信者の切り抜きYouTubeチャンネルを半自動運用。AI候補抽出、プロファイル別マルチチャンネル対応。',
    icon: <Scissors size={28} />,
    path: '/streamer-clip',
    color: 'text-pink-600 dark:text-pink-400',
    bgColor: 'bg-pink-50 dark:bg-pink-950/50',
    status: 'active',
  },
]

export default function Home() {
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
          <Link
            to="/settings"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600 transition text-sm font-medium no-underline"
          >
            <Settings size={16} />
            API設定
          </Link>
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
              <Link
                to={tool.path}
                className="w-full text-left cursor-pointer no-underline"
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
              </Link>

              {/* Sub-links */}
              {tool.links && (
                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 w-full flex flex-wrap gap-2">
                  {tool.links.map((link) => (
                    <Link
                      key={link.path}
                      to={link.path}
                      className="text-xs px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer no-underline"
                    >
                      {link.label}
                    </Link>
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
