import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Activity, BarChart3, FileText, Flame, Code2, ExternalLink, UserPlus } from 'lucide-react'
import type { Device, Preset } from './site-analytics/api'
import { Seg } from './site-analytics/ui'
import { useOverview } from './site-analytics/useOverview'
import RealtimeTab from './site-analytics/RealtimeTab'
import OverviewTab from './site-analytics/OverviewTab'
import PageTab from './site-analytics/PageTab'
import HeatmapTab from './site-analytics/HeatmapTab'
import SetupTab from './site-analytics/SetupTab'
import SignupsTab from './site-analytics/SignupsTab'

type Tab = 'realtime' | 'overview' | 'signups' | 'page' | 'heatmap' | 'setup'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'realtime', label: 'リアルタイム', icon: <Activity size={15} /> },
  { id: 'overview', label: 'サイト全体', icon: <BarChart3 size={15} /> },
  { id: 'signups', label: '登録（LINE・My FITPEAK）', icon: <UserPlus size={15} /> },
  { id: 'page', label: 'ページ別', icon: <FileText size={15} /> },
  { id: 'heatmap', label: 'ヒートマップ', icon: <Flame size={15} /> },
  { id: 'setup', label: '設置方法', icon: <Code2 size={15} /> },
]

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: '今日' },
  { value: 'yesterday', label: '昨日' },
  { value: '7d', label: '7日間' },
  { value: '30d', label: '30日間' },
  { value: '90d', label: '90日間' },
]

export default function SiteAnalytics() {
  const navigate = useNavigate()
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('tab') as Tab) || 'realtime'
  const preset = (sp.get('range') as Preset) || '7d'
  const device = (sp.get('device') as Device) || 'all'
  const path = sp.get('path') || '/'

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp)
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) next.delete(k)
      else next.set(k, v)
    }
    setSp(next, { replace: false })
  }
  const openPage = (p: string) => set({ tab: 'page', path: p })

  // ページ選択用の一覧（サイト全体の集計から取る）
  const needPages = tab === 'page' || tab === 'heatmap'
  const { data: siteData } = useOverview(preset, 'all', null, needPages)
  const pages = siteData?.pages || []

  const showFilters = tab === 'overview' || tab === 'signups' || tab === 'page' || tab === 'heatmap'

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900" style={{ fontFamily: '"Noto Sans JP", "Hiragino Sans", "Meiryo", sans-serif' }}>
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4 flex items-center gap-3">
          <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 cursor-pointer" aria-label="ホームへ戻る">
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white leading-tight">FITPEAK サイト分析</h1>
            <a href="https://fitpeak.co" target="_blank" rel="noopener noreferrer" className="text-[11px] text-slate-500 hover:text-slate-900 dark:hover:text-white inline-flex items-center gap-1">
              fitpeak.co <ExternalLink size={10} />
            </a>
          </div>
        </div>
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 mt-3 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => set({ tab: t.id })}
              className={`inline-flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 whitespace-nowrap cursor-pointer ${
                tab === t.id
                  ? 'border-slate-900 dark:border-white text-slate-900 dark:text-white font-medium'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-5">
        {showFilters && (
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <Seg<Preset> value={preset} onChange={(v) => set({ range: v })} options={PRESETS} />
            {tab !== 'heatmap' && (
              <Seg<Device> value={device} onChange={(v) => set({ device: v === 'all' ? null : v })} options={[
                { value: 'all', label: 'すべて' }, { value: 'mobile', label: 'スマホ' }, { value: 'desktop', label: 'PC' },
              ]} />
            )}
          </div>
        )}

        {tab === 'realtime' && <RealtimeTab onOpenPage={openPage} />}
        {tab === 'overview' && <OverviewTab preset={preset} device={device} onOpenPage={openPage} />}
        {tab === 'signups' && <SignupsTab preset={preset} device={device} onOpenPage={openPage} />}
        {tab === 'page' && (
          <PageTab preset={preset} device={device} path={path} pages={pages}
            onChangePath={(p) => set({ path: p })} onOpenHeatmap={() => set({ tab: 'heatmap' })} />
        )}
        {tab === 'heatmap' && (
          <HeatmapTab preset={preset} path={path} pages={pages} onChangePath={(p) => set({ path: p })} />
        )}
        {tab === 'setup' && <SetupTab />}
      </main>
    </div>
  )
}
