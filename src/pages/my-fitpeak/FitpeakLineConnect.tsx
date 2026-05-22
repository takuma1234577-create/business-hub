import { useEffect, useState } from 'react'
import { MessageCircle, CheckCircle, ExternalLink, User } from 'lucide-react'
import { useFitpeakAuth } from './lib/auth'
import { fitpeakSupabase } from './lib/supabase'

interface LinkInfo {
  id: string
  line_user_id: string
  shopify_customer_name: string
  linked_at: string
  friends: {
    display_name: string
    picture_url: string | null
  } | null
}

export default function FitpeakLineConnect() {
  const { user } = useFitpeakAuth()
  const [linkInfo, setLinkInfo] = useState<LinkInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      if (!user?.email) return
      const { data } = await fitpeakSupabase
        .from('line_shopify_links')
        .select('id, line_user_id, shopify_customer_name, linked_at, friends(display_name, picture_url)')
        .eq('shopify_email', user.email)
        .maybeSingle()
      setLinkInfo(data as LinkInfo | null)
      setLoading(false)
    }
    load()
  }, [user])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-[#c8a960] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-6">LINE連携</h1>

      <div className="bg-[#151515] border border-white/10 rounded-xl p-6">
        {linkInfo ? (
          <div>
            <div className="flex items-center gap-5 mb-6">
              <div className="w-20 h-20 rounded-full bg-white/10 overflow-hidden flex-shrink-0">
                {linkInfo.friends?.picture_url ? (
                  <img src={linkInfo.friends.picture_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <User size={32} className="text-white/30" />
                  </div>
                )}
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle size={16} className="text-[#06C755]" />
                  <span className="text-xs font-medium text-[#06C755]">LINE連携済み</span>
                </div>
                <h2 className="text-lg font-semibold text-white">
                  {linkInfo.friends?.display_name || linkInfo.shopify_customer_name || 'LINEユーザー'}
                </h2>
                <p className="text-xs text-white/40 mt-0.5">{user?.email}</p>
              </div>
            </div>

            <div className="bg-white/5 rounded-lg p-4 space-y-3">
              <div className="flex justify-between">
                <span className="text-xs text-white/40">LINEアカウント</span>
                <span className="text-sm text-white">{linkInfo.friends?.display_name || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-white/40">連携日</span>
                <span className="text-xs text-white/60">{new Date(linkInfo.linked_at).toLocaleDateString('ja-JP')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-white/40">ステータス</span>
                <span className="text-xs text-[#06C755]">有効</span>
              </div>
            </div>

            <div className="mt-5 p-4 rounded-lg bg-[#06C755]/5 border border-[#06C755]/20">
              <h3 className="text-sm font-medium text-white mb-2">LINEで受け取れる通知</h3>
              <ul className="text-xs text-white/50 space-y-1.5">
                <li>- 注文完了通知（注文内容・金額）</li>
                <li>- 発送完了通知（配送業者・追跡番号）</li>
                <li>- 配達完了通知</li>
                <li>- カスタマーサポート</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-[#06C755]/10 flex items-center justify-center mx-auto mb-4">
              <MessageCircle size={32} className="text-[#06C755]" />
            </div>
            <h2 className="text-lg font-semibold text-white mb-2">LINEと連携する</h2>
            <p className="text-sm text-white/40 mb-6 leading-relaxed">
              FITPEAK公式LINEを友だち追加して、<br />
              リッチメニューの「会員登録」からこのアカウントのメールアドレスを入力してください。
            </p>

            <a
              href="https://line.me/R/ti/p/@956iyppc"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-semibold transition"
            >
              <MessageCircle size={18} />
              FITPEAK公式LINEを友だち追加
              <ExternalLink size={14} />
            </a>

            <div className="bg-white/5 rounded-lg p-4 mt-6 text-left">
              <h3 className="text-xs font-semibold text-white/60 mb-2">連携手順</h3>
              <ol className="text-xs text-white/40 space-y-1.5 list-decimal list-inside">
                <li>上のボタンからFITPEAK公式LINEを友だち追加</li>
                <li>リッチメニューの「会員登録」をタップ</li>
                <li>このアカウントのメールアドレス ({user?.email}) を入力</li>
                <li>「会員登録完了」のメッセージが届いたら連携完了</li>
              </ol>
            </div>

            <p className="text-xs text-white/30 mt-4">
              連携すると、注文完了・発送・配達の通知がLINEに届きます。
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
