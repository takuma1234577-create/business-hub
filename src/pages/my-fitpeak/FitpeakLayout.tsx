import { useEffect, useState } from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { Package, UserRound, Bell, Crown, ChevronDown } from 'lucide-react'

import { SITE, SITE_NAV } from './lib/siteNav'

export default function FitpeakLayout() {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  useEffect(() => {
    const previousTitle = document.title
    document.title = 'My FITPEAK'
    return () => {
      document.title = previousTitle
    }
  }, [])

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition ${
      isActive
        ? 'border-[#c8a960] text-white'
        : 'border-transparent text-white/40 hover:text-white/70'
    }`

  return (
    <div className="fp-root min-h-screen bg-[#0a0a0a] overflow-x-hidden">
      <header className="border-b border-white/10 bg-[#0f0f0f]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between gap-3 py-4">
            <a href={SITE} className="flex items-center gap-3 min-w-0" aria-label="FITPEAK 公式サイトへ">
              <img src="/fitpeak-logo.svg" alt="FITPEAK" className="h-6" />
              <span className="text-xs text-white/30">マイページ</span>
            </a>
            <nav className="flex items-center gap-0.5 sm:gap-2" aria-label="公式サイト">
              {SITE_NAV.map((g) =>
                g.items ? (
                  <div key={g.label} className="relative">
                    <button
                      type="button"
                      onClick={() => setOpenMenu(openMenu === g.label ? null : g.label)}
                      className="flex items-center gap-0.5 px-1.5 sm:px-2 py-1 text-[11px] sm:text-xs text-white/60 hover:text-white whitespace-nowrap"
                      aria-expanded={openMenu === g.label}
                    >
                      {g.label}
                      <ChevronDown size={11} />
                    </button>
                    {openMenu === g.label && (
                      <div className="absolute right-0 top-full mt-1 z-30 min-w-[11rem] rounded-xl border border-white/10 bg-[#151515] py-1.5 shadow-xl">
                        {g.items.map((it) =>
                          it.soon || !it.href ? (
                            <span key={it.name} className="flex items-center justify-between gap-3 px-4 py-2 text-xs text-white/30">
                              {it.name}<span className="text-[10px]">準備中</span>
                            </span>
                          ) : (
                            <a key={it.name} href={it.href} className="block px-4 py-2 text-xs text-white/70 hover:text-white hover:bg-white/5">
                              {it.name}
                            </a>
                          )
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <a key={g.label} href={g.href} className="px-1.5 sm:px-2 py-1 text-[11px] sm:text-xs text-white/60 hover:text-white whitespace-nowrap">
                    {g.label}
                  </a>
                )
              )}
            </nav>
          </div>
          <nav className="flex gap-1 -mb-px">
            <NavLink to="/my-fitpeak" end className={linkClass}>
              <Package size={16} /> ご注文
            </NavLink>
            <NavLink to="/my-fitpeak/notifications" className={linkClass}>
              <Bell size={16} /> 通知
            </NavLink>
            <NavLink to="/my-fitpeak/pro" className={linkClass}>
              <Crown size={16} /> PRO
            </NavLink>
            <NavLink to="/my-fitpeak/account" className={linkClass}>
              <UserRound size={16} /> アカウント
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <Outlet />
      </main>

      <footer className="border-t border-white/10 mt-8">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 text-xs text-white/40 space-y-3">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <a href={SITE} className="hover:text-white">FITPEAK 公式サイトへ戻る</a>
            <a href={`${SITE}/policies/legal-notice`} className="hover:text-white">特定商取引法に基づく表記</a>
            <a href={`${SITE}/policies/privacy-policy`} className="hover:text-white">プライバシーポリシー</a>
          </div>
          <p>合同会社SVPコーポレーション</p>
        </div>
      </footer>
    </div>
  )
}
