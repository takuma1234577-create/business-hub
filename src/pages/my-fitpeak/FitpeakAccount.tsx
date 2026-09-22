import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageCircle, CheckCircle, ExternalLink, User, LogOut } from 'lucide-react'
import { useFitpeakAuth } from './lib/auth'
import { fitpeakSupabase } from './lib/supabase'
import { displayName } from './lib/api'

interface LinkInfo {
  id: string
  line_user_id: string
  shopify_customer_name: string
  linked_at: string
  friends: { display_name: string; picture_url: string | null } | null
}

export default function FitpeakAccount() {
  const { user, signOut } = useFitpeakAuth()
  const navigate = useNavigate()
  const [linkInfo, setLinkInfo] = useState<LinkInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      if (!user?.email) { setLoading(false); return }
      try {
        const { data } = await fitpeakSupabase
          .from('line_shopify_links')
          .select('id, line_user_id, shopify_customer_name, linked_at, friends(display_name, picture_url)')
          .eq('shopify_email', user.email)
          .maybeSingle()
        setLinkInfo(data as LinkInfo | null)
      } catch { /* 取得できなくても画面は出す */ }
      setLoading(false)
    }
    load()
  }, [user])

  const handleSignOut = async () => {
    await signOut()
    navigate('/my-fitpeak/login')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-[#c8a960] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-base font-bold text-white">アカウント</h1>

      {/* LINE連携 */}
      <section className="rounded-2xl bg-[#151515] border border-white/10 p-5 sm:p-6">
        {linkInfo ? (
          <div>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-white/10 overflow-hidden shrink-0">
                {linkInfo.friends?.picture_url ? (
                  <img src={linkInfo.friends.picture_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <User size={24} className="text-white/30" />
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <CheckCircle size={14} className="text-[#06C755]" />
                  <span className="text-xs font-medium text-[#06C755]">LINE連携済み</span>
                </div>
                <p className="text-base font-semibold text-white truncate mt-0.5">
                  {linkInfo.friends?.display_name || linkInfo.shopify_customer_name || 'LINEユーザー'}
                </p>
                <p className="text-xs text-white/30 mt-0.5">
                  {new Date(linkInfo.linked_at).toLocaleDateString('ja-JP')} に連携
                </p>
              </div>
            </div>

            <div className="mt-5 pt-5 border-t border-white/5">
              <h2 className="text-sm font-medium text-white mb-2">LINEに届く通知</h2>
              <ul className="text-xs text-white/50 space-y-1.5">
                <li>ご注文の確認</li>
                <li>発送のお知らせ（配送業者・追跡番号）</li>
                <li>お届け完了のお知らせ</li>
              </ul>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-[#06C755]/10 flex items-center justify-center shrink-0">
                <MessageCircle size={22} className="text-[#06C755]" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-white">LINEと連携する</h2>
                <p className="text-xs text-white/40 mt-0.5">発送や配達のお知らせがLINEに届きます</p>
              </div>
            </div>

            <a
              href="https://line.me/R/ti/p/@956iyppc"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full mt-5 py-3.5 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-semibold transition"
            >
              <MessageCircle size={18} />
              FITPEAK公式LINEを友だち追加
              <ExternalLink size={14} />
            </a>

            <ol className="mt-5 space-y-2 text-xs text-white/40 list-decimal list-inside">
              <li>上のボタンから友だち追加</li>
              <li>リッチメニューの「会員登録」をタップ</li>
              <li>このアカウントの情報（{displayName(user)}）を入力</li>
            </ol>
          </div>
        )}
      </section>

      {/* ログイン情報 */}
      <section className="rounded-2xl bg-[#151515] border border-white/10 p-5 sm:p-6">
        <h2 className="text-sm font-medium text-white mb-3">ログイン情報</h2>
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-white/60 truncate">{displayName(user)}</p>
          <button
            onClick={handleSignOut}
            className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm text-white/60 hover:text-white border border-white/10 hover:border-white/25 transition"
          >
            <LogOut size={16} />
            ログアウト
          </button>
        </div>
      </section>
    </div>
  )
}
