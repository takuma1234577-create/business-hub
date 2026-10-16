import { useEffect, useState } from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { Package, UserRound, Bell, Crown, ChevronDown, Star, Users, Ticket, Gift, Repeat } from 'lucide-react'

import { SITE, SITE_NAV } from './lib/siteNav'
import { isEmbedded } from './lib/embed'

export default function FitpeakLayout() {
  // fitpeak.co に埋め込んだとき（アプリプロキシ）は、テーマのヘッダー・フッターがあるので自前のものは出さない
  const embedded = isEmbedded()
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  useEffect(() => {
    const previousTitle = document.title
    document.title = 'My FITPEAK'
    return () => {
      document.title = previousTitle
    }
  }, [])

  // マイページ内のタブ: Appleのセグメント風（選ばれているものだけ黒いピル）
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-1.5 px-3 sm:px-4 h-9 rounded-full text-[13px] sm:text-sm font-bold whitespace-nowrap transition-colors duration-200 ${
      isActive
        ? 'bg-[#111] text-white'
        : 'text-[#555] hover:text-[#111] hover:bg-[#ececec]'
    }`

  return (
    <div className="fp-root min-h-screen bg-[#f5f5f7] overflow-x-hidden">
      {/* 公式サイト（fitpeak.co）と同じ黒ヘッダー＋白ロゴ＋太字メニュー */}
      {!embedded && (
      <header className="bg-[#0b0b0b] text-white">
        <div className="max-w-5xl mx-auto px-3 sm:px-6">
          <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-3 py-1 sm:py-0 sm:h-16">
            <a href={SITE} className="flex items-center gap-2.5 min-w-0 min-h-[48px]" aria-label="FITPEAK 公式サイトへ">
              <img src="/fitpeak-wordmark-white.png" alt="FITPEAK" className="h-[19px] sm:h-[22px] lg:h-7 w-auto" />
              <span className="text-[10px] sm:text-[11px] font-bold tracking-[0.14em] text-white/70 border-l border-white/25 pl-2.5 whitespace-nowrap">MY PAGE</span>
            </a>
            <nav className="order-3 sm:order-none w-full sm:w-auto flex items-center justify-between sm:justify-end sm:gap-1" aria-label="公式サイト">
              {SITE_NAV.map((g) =>
                g.items ? (
                  <div key={g.label} className="relative">
                    <button
                      type="button"
                      onClick={() => setOpenMenu(openMenu === g.label ? null : g.label)}
                      className="flex items-center gap-0.5 px-2 sm:px-3 min-h-[44px] rounded-[8px] text-[13px] sm:text-sm font-bold text-white hover:bg-white/10 whitespace-nowrap"
                      aria-expanded={openMenu === g.label}
                    >
                      {g.label}
                      <ChevronDown size={12} />
                    </button>
                    {openMenu === g.label && (
                      <div className="absolute right-0 top-full mt-1 z-30 min-w-[13rem] rounded-[14px] border border-[#e5e5e5] bg-white text-[#111] p-2 shadow-[0_12px_32px_rgba(0,0,0,0.14)]">
                        {g.items.map((it) =>
                          it.soon || !it.href ? (
                            <span key={it.name} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm font-bold text-[#999]">
                              {it.name}<span className="text-[11px] font-normal rounded-full bg-[#eee] text-[#666] px-2 py-0.5">準備中</span>
                            </span>
                          ) : (
                            <a key={it.name} href={it.href} className="block px-3 py-2.5 rounded-[8px] text-sm font-bold text-[#111] hover:bg-[#f3f3f3]">
                              {it.name}
                            </a>
                          )
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <a key={g.label} href={g.href} className="flex items-center px-2 sm:px-3 min-h-[44px] rounded-[8px] text-[13px] sm:text-sm font-bold text-white hover:bg-white/10 whitespace-nowrap">
                    {g.label}
                  </a>
                )
              )}
            </nav>
          </div>
        </div>
      </header>
      )}

      <div className="sticky top-0 z-20 border-b border-black/[0.08] bg-[#f5f5f7]/85 backdrop-blur-xl">
        <nav className="max-w-3xl mx-auto px-3 sm:px-6 py-2 flex gap-1 overflow-x-auto [-webkit-overflow-scrolling:touch] [scrollbar-width:none]" aria-label="マイページ">
          <NavLink to="/my-fitpeak" end className={linkClass}>
            <Package size={15} /> ご注文
          </NavLink>
          <NavLink to="/my-fitpeak/subscriptions" className={linkClass}>
            <Repeat size={15} /> 定期便
          </NavLink>
          <NavLink to="/my-fitpeak/coupons" className={linkClass}>
            <Ticket size={15} /> クーポン
          </NavLink>
          <NavLink to="/my-fitpeak/referral" className={linkClass}>
            <Gift size={15} /> 紹介
          </NavLink>
          <NavLink to="/my-fitpeak/gotore" className={linkClass}>
            <Users size={15} /> 合トレ
          </NavLink>
          <NavLink to="/my-fitpeak/notifications" className={linkClass}>
            <Bell size={15} /> 通知
          </NavLink>
          <NavLink to="/my-fitpeak/saved" className={linkClass}>
            <Star size={15} /> 保存
          </NavLink>
          <NavLink to="/my-fitpeak/pro" className={linkClass}>
            <Crown size={15} /> PRO
          </NavLink>
          <NavLink to="/my-fitpeak/account" className={linkClass}>
            <UserRound size={15} /> アカウント
          </NavLink>
        </nav>
      </div>

      <main className="fp-page max-w-3xl mx-auto px-4 sm:px-6 pt-8 pb-12 sm:pt-12">
        <Outlet />
      </main>

      {!embedded && (
      <footer className="bg-[#0b0b0b] text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-10 pb-8">
          <a href={SITE} aria-label="FITPEAK 公式サイトへ" className="inline-block">
            <img src="/fitpeak-wordmark-white.png" alt="FITPEAK" className="h-[18px] w-auto" />
          </a>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <a href={SITE} className="py-1.5 text-white hover:opacity-70 transition-opacity">FITPEAK 公式サイトへ戻る</a>
            <a href={`${SITE}/policies/legal-notice`} className="py-1.5 text-white hover:opacity-70 transition-opacity">特定商取引法に基づく表記</a>
            <a href={`${SITE}/policies/privacy-policy`} className="py-1.5 text-white hover:opacity-70 transition-opacity">プライバシーポリシー</a>
          </div>
          <p className="mt-6 pt-5 border-t border-white/20 text-[11px] text-white/70">合同会社SVPコーポレーション</p>
        </div>
      </footer>
      )}
    </div>
  )
}
