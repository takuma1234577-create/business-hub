import { Outlet, NavLink } from 'react-router-dom'
import { Package, UserRound } from 'lucide-react'

export default function FitpeakLayout() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition ${
      isActive
        ? 'border-[#c8a960] text-white'
        : 'border-transparent text-white/40 hover:text-white/70'
    }`

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <header className="border-b border-white/10 bg-[#0f0f0f]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <img src="/fitpeak-logo.svg" alt="FITPEAK" className="h-6" />
              <span className="text-xs text-white/30">マイページ</span>
            </div>
          </div>
          <nav className="flex gap-1 -mb-px">
            <NavLink to="/my-fitpeak" end className={linkClass}>
              <Package size={16} /> ご注文
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
    </div>
  )
}
