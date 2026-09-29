import { useEffect } from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { Package, UserRound, Bell, Crown } from 'lucide-react'

// 公式サイト（fitpeak.co）と同じメニュー。My FITPEAK は公式サイトの一部として見せる
const SITE = 'https://fitpeak.co'
const SITE_LINKS = [
  { label: '商品', href: `${SITE}/collections/fitpeak筋トレギア一覧` },
  { label: 'ツール', href: `${SITE}/pages/tools` },
  { label: '最安ナビ', href: `${SITE}/pages/compare` },
  { label: 'メディア', href: `${SITE}/pages/fitpeak-media` },
]

export default function FitpeakLayout() {
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
    <div className="min-h-screen bg-[#0a0a0a]">
      <header className="border-b border-white/10 bg-[#0f0f0f]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between gap-3 py-4">
            <a href={SITE} className="flex items-center gap-3 min-w-0" aria-label="FITPEAK 公式サイトへ">
              <img src="/fitpeak-logo.svg" alt="FITPEAK" className="h-6" />
              <span className="text-xs text-white/30">マイページ</span>
            </a>
            <nav className="flex items-center gap-1 sm:gap-3" aria-label="公式サイト">
              {SITE_LINKS.map((l) => (
                <a key={l.label} href={l.href} className="px-1.5 sm:px-2 py-1 text-[11px] sm:text-xs text-white/50 hover:text-white whitespace-nowrap">
                  {l.label}
                </a>
              ))}
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
