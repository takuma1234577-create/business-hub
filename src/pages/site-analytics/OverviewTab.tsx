import { useState } from 'react'
import type { Device, Preset } from './api'
import { useOverview, formatBucket } from './useOverview'
import { Card, Kpi, BarList, LineChart, WeekHour, Funnel, Seg, Empty } from './ui'
import { fmtNum, fmtPct, fmtDur, prettyPath, countryLabel, deviceLabel } from './format'

type Metric = 'users' | 'sessions' | 'pageviews'

export default function OverviewTab({ preset, device, onOpenPage }: { preset: Preset; device: Device; onOpenPage: (p: string) => void }) {
  const { data, loading, err } = useOverview(preset, device, null)
  const [metric, setMetric] = useState<Metric>('users')
  const [pageSort, setPageSort] = useState<'pageviews' | 'avg_time_sec' | 'exit_rate' | 'cart_adds'>('pageviews')

  if (err) return <p className="text-xs text-rose-600">{err}</p>
  if (!data) return <Empty>{loading ? '集計中…' : 'データがありません'}</Empty>
  const k = data.kpis
  const p = data.prev_kpis
  const noData = k.pageviews === 0

  const pages = [...data.pages].sort((a, b) => (b[pageSort] as number) - (a[pageSort] as number))

  return (
    <div className={`space-y-4 ${loading ? 'opacity-60' : ''}`}>
      {noData && (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
          この期間のデータはまだありません。計測タグの設置後、アクセスがあると集計されます（「設置方法」タブ参照）。
        </div>
      )}

      {data.cached_at && (preset === '7d' || preset === '30d' || preset === '90d') && (
        <p className="text-[11px] text-slate-400 -mt-1">
          集計時刻 {new Date(data.cached_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}（7日間以上の期間は15分ごとに更新）
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Kpi label="ユーザー" value={fmtNum(k.users)} cur={k.users} prev={p.users} />
        <Kpi label="新規ユーザー" value={fmtNum(k.new_users)} cur={k.new_users} prev={p.new_users} />
        <Kpi label="セッション" value={fmtNum(k.sessions)} cur={k.sessions} prev={p.sessions} />
        <Kpi label="ページビュー" value={fmtNum(k.pageviews)} cur={k.pageviews} prev={p.pageviews} />
        <Kpi label="平均滞在時間" value={fmtDur(k.avg_session_sec)} cur={k.avg_session_sec} prev={p.avg_session_sec} hint="1セッションで画面を見ていた時間の平均" />
        <Kpi label="直帰率" value={fmtPct(k.bounce_rate, 1)} cur={k.bounce_rate} prev={p.bounce_rate} lowerIsBetter hint="1ページだけ見て離脱したセッションの割合" />
        <Kpi label="ページ/セッション" value={k.pages_per_session.toFixed(2)} cur={k.pages_per_session} prev={p.pages_per_session} />
        <Kpi label="カート追加" value={fmtNum(k.cart_adds)} cur={k.cart_adds} prev={p.cart_adds} />
      </div>

      <Card
        title="推移"
        right={<Seg<Metric> value={metric} onChange={setMetric} options={[
          { value: 'users', label: 'ユーザー' }, { value: 'sessions', label: 'セッション' }, { value: 'pageviews', label: 'ページビュー' },
        ]} />}
      >
        <LineChart
          points={data.timeseries.map((t) => ({ x: t.t, y: t[metric] }))}
          formatX={(x) => formatBucket(x, data.granularity)}
          unit={metric === 'pageviews' ? ' PV' : metric === 'users' ? '人' : ''}
        />
      </Card>

      <Card
        title="ページ別"
        right={<Seg value={pageSort} onChange={setPageSort} options={[
          { value: 'pageviews', label: 'PV順' }, { value: 'avg_time_sec', label: '滞在順' },
          { value: 'exit_rate', label: '離脱率順' }, { value: 'cart_adds', label: 'カート追加順' },
        ]} />}
      >
        {pages.length ? (
          <div className="overflow-x-auto -mx-4">
            <table className="w-full text-xs min-w-[760px]">
              <thead>
                <tr className="text-slate-500 border-b border-slate-100 dark:border-slate-800">
                  <th className="text-left font-medium px-4 py-2">ページ</th>
                  <th className="text-right font-medium px-2 py-2">PV</th>
                  <th className="text-right font-medium px-2 py-2">ユーザー</th>
                  <th className="text-right font-medium px-2 py-2">平均滞在</th>
                  <th className="text-right font-medium px-2 py-2">平均スクロール</th>
                  <th className="text-right font-medium px-2 py-2">入口数</th>
                  <th className="text-right font-medium px-2 py-2">離脱率</th>
                  <th className="text-right font-medium px-4 py-2">カート追加</th>
                </tr>
              </thead>
              <tbody>
                {pages.slice(0, 50).map((r) => (
                  <tr key={r.path} onClick={() => onOpenPage(r.path)} className="border-b border-slate-50 dark:border-slate-900 hover:bg-slate-50 dark:hover:bg-slate-900 cursor-pointer">
                    <td className="px-4 py-2 max-w-[320px]">
                      <p className="truncate text-slate-900 dark:text-white">{r.title || prettyPath(r.path)}</p>
                      <p className="truncate text-slate-400">{prettyPath(r.path)}</p>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtNum(r.pageviews)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtNum(r.users)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtDur(r.avg_time_sec)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtPct(r.avg_scroll)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtNum(r.entries)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtPct(r.exit_rate)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtNum(r.cart_adds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-slate-400 px-4 pt-2">行をクリックするとページ別の詳細とヒートマップを開きます</p>
          </div>
        ) : <Empty>データがまだありません</Empty>}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="流入チャネル（セッション）">
          <BarList items={data.channels as unknown as Record<string, unknown>[]} valueKey="sessions" />
        </Card>
        <Card title="参照元サイト">
          <BarList items={data.referrers as unknown as Record<string, unknown>[]} valueKey="sessions" />
        </Card>
        <Card title="キャンペーン（utm_source / campaign）">
          <BarList items={data.campaigns as unknown as Record<string, unknown>[]} valueKey="sessions" />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="購入までの流れ（セッション）">
          <Funnel steps={data.funnel} />
          <p className="text-[10px] text-slate-400 mt-2">決済完了はShopifyの決済画面側のため、ここでは「購入手続きへ」までを計測</p>
        </Card>
        <Card title="入口ページ（最初に見たページ）">
          <BarList items={data.entry_pages as unknown as Record<string, unknown>[]} valueKey="count" onClickItem={onOpenPage} />
        </Card>
        <Card title="離脱ページ（最後に見たページ）">
          <BarList items={data.exit_pages as unknown as Record<string, unknown>[]} valueKey="count" onClickItem={onOpenPage} />
        </Card>
      </div>

      <Card title="曜日×時間帯">
        <WeekHour data={data.week_hour} />
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card title="デバイス">
          <BarList items={data.devices.map((d) => ({ ...d, name: deviceLabel(d.name) }))} unit="人" />
        </Card>
        <Card title="新規／リピーター">
          <BarList items={[{ name: '新規', users: data.user_type.new }, { name: 'リピーター', users: data.user_type.returning }]} unit="人" />
        </Card>
        <Card title="ブラウザ">
          <BarList items={data.browsers as unknown as Record<string, unknown>[]} unit="人" />
        </Card>
        <Card title="OS">
          <BarList items={data.os as unknown as Record<string, unknown>[]} unit="人" />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="国">
          <BarList items={data.countries.map((c) => ({ ...c, name: countryLabel(c.name) }))} unit="人" />
        </Card>
        <Card title="都市">
          <BarList items={data.cities as unknown as Record<string, unknown>[]} unit="人" />
        </Card>
        <Card title="よくクリックされている要素（サイト全体）">
          <BarList items={data.top_clicks.map((c) => ({ name: c.label, count: c.count }))} valueKey="count" unit="回" />
        </Card>
      </div>
    </div>
  )
}
