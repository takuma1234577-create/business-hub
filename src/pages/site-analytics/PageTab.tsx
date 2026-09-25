import { useState } from 'react'
import { ExternalLink, Flame } from 'lucide-react'
import type { Device, PageRow, Preset } from './api'
import { useOverview, formatBucket } from './useOverview'
import { Card, Kpi, BarList, LineChart, ScrollReach, Empty } from './ui'
import { fmtNum, fmtPct, fmtDur, prettyPath, deviceLabel } from './format'
import { useT } from './i18n'

export function PageSelector({ pages, value, onChange }: { pages: PageRow[]; value: string; onChange: (p: string) => void }) {
  const t = useT()
  const [custom, setCustom] = useState('')
  const inList = pages.some((p) => p.path === value)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={inList ? value : ''}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white px-3 py-2 w-full sm:w-auto sm:max-w-[420px]"
      >
        {!inList && <option value="">{prettyPath(value)}{t('（期間内のアクセスなし）')}</option>}
        {pages.map((p) => (
          <option key={p.path} value={p.path}>
            {(p.title || prettyPath(p.path)).slice(0, 40)} {prettyPath(p.path).slice(0, 50)}{t('（')}{fmtNum(p.pageviews)} PV{t('）')}
          </option>
        ))}
      </select>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          let v = custom.trim()
          if (!v) return
          try { if (/^https?:/.test(v)) v = new URL(v).pathname } catch { /* noop */ }
          if (!v.startsWith('/')) v = '/' + v
          onChange(v)
          setCustom('')
        }}
        className="flex gap-1 w-full sm:w-auto"
      >
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder={`URL${t('かパスを入力（例：/products/xxx）')}`}
          className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 flex-1 sm:w-64 min-w-0"
        />
        <button className="text-xs px-3 py-2 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 cursor-pointer">{t('表示')}</button>
      </form>
    </div>
  )
}

export default function PageTab({ preset, device, path, onChangePath, onOpenHeatmap, pages }: {
  preset: Preset; device: Device; path: string; onChangePath: (p: string) => void; onOpenHeatmap: () => void; pages: PageRow[]
}) {
  const t = useT()
  const { data, loading, err } = useOverview(preset, device, path)

  return (
    <div className={`space-y-4 ${loading ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageSelector pages={pages} value={path} onChange={onChangePath} />
        <div className="flex gap-2">
          <a href={`https://fitpeak.co${path}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900">
            <ExternalLink size={13} /> {t('ページを開く')}
          </a>
          <button onClick={onOpenHeatmap} className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 cursor-pointer">
            <Flame size={13} /> {t('ヒートマップを見る')}
          </button>
        </div>
      </div>

      {err && <p className="text-xs text-rose-600">{err}</p>}
      {!data ? <Empty>{loading ? t('集計中…') : t('データがありません')}</Empty> : (() => {
        const k = data.kpis
        const p = data.prev_kpis
        return (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
              <Kpi label={t('ページビュー')} value={fmtNum(k.pageviews)} cur={k.pageviews} prev={p.pageviews} />
              <Kpi label={t('ユーザー')} value={fmtNum(k.users)} cur={k.users} prev={p.users} />
              <Kpi label={t('平均閲覧時間')} value={fmtDur(k.avg_time_on_page_sec)} cur={k.avg_time_on_page_sec} prev={p.avg_time_on_page_sec} hint={t('このページを画面に表示していた時間の平均')} />
              <Kpi label={t('平均スクロール到達')} value={fmtPct(k.avg_scroll)} cur={k.avg_scroll} prev={p.avg_scroll} />
              <Kpi label={t('入口になった回数')} value={fmtNum(k.entries)} cur={k.entries} prev={p.entries} />
              <Kpi label={t('直帰率')} value={fmtPct(k.bounce_rate, 1)} cur={k.bounce_rate} prev={p.bounce_rate} lowerIsBetter hint={t('このページから入り、他のページを見ずに離脱した割合')} />
              <Kpi label={t('離脱率')} value={fmtPct(k.exit_rate, 1)} cur={k.exit_rate} prev={p.exit_rate} lowerIsBetter hint={t('このページが最後に見られたページだった割合')} />
              <Kpi label={t('カート追加')} value={fmtNum(k.cart_adds)} cur={k.cart_adds} prev={p.cart_adds} />
            </div>

            <Card title={t('ページビューの推移')}>
              <LineChart points={data.timeseries.map((t) => ({ x: t.t, y: t.pageviews }))} formatX={(x) => formatBucket(x, data.granularity)} unit=" PV" />
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card title={t('スクロール到達率（どこまで読まれたか）')}>
                <ScrollReach data={data.scroll_reach} />
              </Card>
              <Card title={t('直前に見ていたページ')}>
                <BarList items={data.prev_pages as unknown as Record<string, unknown>[]} valueKey="count" unit={t('回')} onClickItem={(n) => n.startsWith('/') && onChangePath(n)} />
              </Card>
              <Card title={t('次に見たページ')}>
                <BarList items={data.next_pages as unknown as Record<string, unknown>[]} valueKey="count" unit={t('回')} onClickItem={(n) => n.startsWith('/') && onChangePath(n)} />
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card title={t('流入チャネル')}>
                <BarList items={data.channels.map((c) => ({ ...c, name: t(c.name) }))} valueKey="sessions" />
              </Card>
              <Card title={t('デバイス')}>
                <BarList items={data.devices.map((d) => ({ ...d, name: deviceLabel(d.name) }))} unit={t('人')} />
              </Card>
              <Card title={t('よくクリックされている要素')}>
                <BarList items={data.top_clicks.map((c) => ({ name: c.label, count: c.count }))} valueKey="count" unit={t('回')} />
              </Card>
            </div>
          </>
        )
      })()}
    </div>
  )
}
