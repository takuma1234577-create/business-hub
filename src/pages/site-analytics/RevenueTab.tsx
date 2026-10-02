import { useEffect, useState } from 'react'
import { saApi, type Device, type Preset, type Revenue } from './api'
import { useOverview } from './useOverview'
import { Card, Kpi, LineChart, Columns, Empty } from './ui'
import { fmtNum, timeAgo } from './format'

const yen = (v: number | null | undefined) => (v == null ? '—' : `¥${Math.round(v).toLocaleString('ja-JP')}`)
const dayLabel = (d: string) => {
  const [, m, day] = d.split('-')
  return `${Number(m)}/${Number(day)}`
}

export default function RevenueTab({ preset, device }: { preset: Preset; device: Device }) {
  const [data, setData] = useState<Revenue | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  // 「1,000PVあたり」を出すために、同じ期間のページビューも読む
  const { data: ov } = useOverview(preset, device, null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    saApi.get<Revenue>('/revenue', { params: { preset } })
      .then((r) => { if (alive) { setData(r.data); setErr('') } })
      .catch((e) => { if (alive) setErr(e?.response?.data?.error || '取得に失敗しました') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [preset])

  if (err) return <p className="text-xs text-rose-600">{err}</p>
  if (!data) return <Empty>{loading ? '集計中…' : 'データがありません'}</Empty>

  const t = data.totals
  const p = data.prev_totals
  const pv = ov?.kpis.pageviews ?? 0
  const rpm = pv > 0 ? (t.total / pv) * 1000 : null
  const epc = t.clicks > 0 ? t.total / t.clicks : null
  const noData = t.total === 0 && t.clicks === 0 && t.orders === 0

  return (
    <div className={`space-y-4 ${loading ? 'opacity-60' : ''}`}>
      {noData && (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
          この期間の収益データはまだありません。楽天アフィリエイト・Amazonアソシエイトのレポートから、毎日取り込みます（取り込み前は 0 と表示されます）。
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <Kpi label="収益（合計）" value={yen(t.total)} cur={t.total} prev={p.total} hint="楽天とAmazonの発生ベースの合計。確定前のものを含みます" />
        <Kpi label="楽天" value={yen(t.rakuten)} cur={t.rakuten} prev={p.rakuten} />
        <Kpi label="Amazon" value={yen(t.amazon)} cur={t.amazon} prev={p.amazon} />
        <Kpi label="注文数" value={fmtNum(t.orders)} cur={t.orders} prev={p.orders} />
        <Kpi label="クリック数" value={fmtNum(t.clicks)} cur={t.clicks} prev={p.clicks} />
        <Kpi label="1,000PVあたり収益" value={yen(rpm)} hint="同じ期間のページビュー1,000回あたりの収益" />
      </div>

      <Card title="日別の収益" right={<span className="text-[11px] text-slate-400">{data.last_imported_at ? `最終取り込み ${timeAgo(data.last_imported_at)}` : '未取り込み'}</span>}>
        <LineChart
          points={data.days.map((d) => ({ x: d.day, y: d.total }))}
          formatX={dayLabel}
          unit="円"
        />
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="楽天の日別">
          <Columns items={data.days.map((d) => ({ label: dayLabel(d.day), value: d.rakuten }))} unit="円" />
        </Card>
        <Card title="Amazonの日別">
          <Columns items={data.days.map((d) => ({ label: dayLabel(d.day), value: d.amazon }))} unit="円" />
        </Card>
      </div>

      <Card title="数字の見方">
        <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1 list-disc pl-5">
          <li>収益は「発生」ベースです。返品・キャンセルで、あとから減ることがあります。</li>
          <li>1クリックあたり収益（EPC）: {epc == null ? '—' : yen(epc)}。リンクを置く場所の良し悪しを比べる目安です。</li>
          <li>AI組織の予算には、直近30日の収益がそのまま上限に加算されます（収益が増えるほど、AIが動ける範囲が広がります）。</li>
        </ul>
      </Card>
    </div>
  )
}
