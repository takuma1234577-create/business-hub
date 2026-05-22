import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { Home, Package, MessageCircle, LogOut } from 'lucide-react'
import { useFitpeakAuth } from './lib/auth'

export default function FitpeakLayout() {
  const { user, signOut } = useFitpeakAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/my-fitpeak/login')
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition ${
      isActive
        ? 'bg-white/10 text-[#c8a960]'
        : 'text-white/60 hover:text-white hover:bg-white/5'
    }`

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <header className="border-b border-white/10 bg-[#0f0f0f]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/fitpeak-logo.svg" alt="FITPEAK" className="h-6" />
            <span className="text-xs text-white/40 hidden sm:inline">My Account</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40 hidden sm:inline">{user?.email}</span>
            <button
              onClick={handleSignOut}
              className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <nav className="border-b border-white/10 bg-[#0f0f0f]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex gap-1 overflow-x-auto">
          <NavLink to="/my-fitpeak" end className={linkClass}>
            <Home size={16} /> マイページ
          </NavLink>
          <NavLink to="/my-fitpeak/orders" className={linkClass}>
            <Package size={16} /> 注文履歴
          </NavLink>
          <NavLink to="/my-fitpeak/line" className={linkClass}>
            <MessageCircle size={16} /> LINE連携
          </NavLink>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
