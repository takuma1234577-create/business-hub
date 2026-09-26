import { Fragment, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { saApi, type Device, type JourneyEvent, type Preset, type SignupRecent } from './api'
import { useSignups, placeLabel } from './useSignups'
import { formatBucket } from './useOverview'
import { Card, Kpi, BarList, LineChart, Seg, Empty } from './ui'
import { fmtNum, fmtPct, fmtDur, prettyPath, deviceLabel } from './format'

type Metric = 'all' | 'line' | 'myfp'
type Kind = 'all' | 'line' | 'myfitpeak'

const rate = (n: number, d: number) => (d ? n / d : null)

function fmtAt(iso: string) {
  const d = new Date(iso)
  const j = new Date(d.getTime() + 9 * 3600000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${p(j.getUTCHours())}:${p(j.getUTCMinutes())}`
}

function KindBadge({ kind, isNew, method }: { kind: 'line' | 'myfitpeak'; isNew: boolean; method: string | null }) {
  const label = kind === 'line'
    ? (isNew ? '公式LINE 新規' : '公式LINE 既存友だち')
    : `My FITPEAK${method === 'line' ? '（LINEで登録）' : method === 'email' ? '（メールで登録）' : ''}`
  return (
    <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${
      kind === 'line' && !isNew
        ? 'border-slate-200 dark:border-slate-700 text-slate-500'
        : 'border-slate-900 dark:border-white text-slate-900 dark:text-white font-medium'
    }`}>{label}</span>
  )
}

function Journey({ sessionId }: { sessionId: string }) {
  const [events, setEvents] = useState<JourneyEvent[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let alive = true
    saApi.get<{ events: JourneyEvent[] }>('/journey', { params: { session: sessionId } })
      .then((r) => { if (alive) setEvents(r.data.events) })
      .catch((e) => { if (alive) setErr(e?.response?.data?.error || '取得に失敗しました') })
    return () => { alive = false }
  }, [sessionId])
  if (err) return <p className="text-xs text-rose-600">{err}</p>
  if (!events) return <p className="text-xs text-slate-400">読み込み中…</p>
  if (!events.length) return <p className="text-xs text-slate-400">この訪問の記録はありません</p>
  const t0 = new Date(events[0].at).getTime()
  const first = events.find((e) => e.type === 'pageview')
  return (
    <div className="text-xs">
      {first && (
        <p className="text-slate-500 mb-2">
          流入元：{first.channel || '不明'}{first.ref_host ? `（${first.ref_host}）` : ''}
        </p>
      )}
      <ol className="space-y-1 border-l border-slate-200 dark:border-slate-700 ml-1 pl-3">
        {events.map((e, i) => {
          const sec = Math.round((new Date(e.at).getTime() - t0) / 1000)
          const isSignup = e.type === 'click' && !!e.href && /line\.me|liff|my\.fitpeak\.co/i.test(e.href) && !/social-plugins/.test(e.href)
          if (e.type === 'click' && !isSignup) return null
          return (
            <li key={i} className="flex gap-2">
              <span className="w-12 shrink-0 text-slate-400 tabular-nums">+{fmtDur(sec)}</span>
              {e.type === 'pageview' ? (
                <span className="text-slate-700 dark:text-slate-200 min-w-0">
                  <span className="text-slate-400 mr-1">表示</span>{e.title || prettyPath(e.path)}
                  <span className="block text-[10px] text-slate-400 truncate">{prettyPath(e.path)}</span>
                </span>
              ) : e.type === 'cart_add' ? (
                <span className="text-slate-700 dark:text-slate-200">カートに追加</span>
              ) : e.type === 'checkout' ? (
                <span className="text-slate-700 dark:text-slate-200">購入手続きへ</span>
              ) : (
                <span className="font-medium text-slate-900 dark:text-white">
                  登録ボタンを押す：{(e.label || '').slice(0, 40) || '（文言なし）'}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function RecentTable({ rows }: { rows: SignupRecent[] }) {
  const [open, setOpen] = useState<number | null>(null)
  if (!rows.length) return <Empty>この期間の登録はまだありません</Empty>
  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full text-xs min-w-[860px]">
        <thead>
          <tr className="text-left text-[11px] text-slate-500 border-b border-slate-100 dark:border-slate-800">
            <th className="py-2 pr-2 font-normal w-6" />
            <th className="py-2 pr-3 font-normal">日時</th>
            <th className="py-2 pr-3 font-normal">登録</th>
            <th className="py-2 pr-3 font-normal">名前</th>
            <th className="py-2 pr-3 font-normal">登録したページ</th>
            <th className="py-2 pr-3 font-normal">押した場所</th>
            <th className="py-2 pr-3 font-normal">入口ページ・流入元</th>
            <th className="py-2 pr-3 font-normal text-right">見たページ</th>
            <th className="py-2 font-normal text-right">登録まで</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <Fragment key={i}>
              <tr
                className={`border-b border-slate-50 dark:border-slate-900 align-top ${r.session_id ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900' : ''}`}
                onClick={() => r.session_id && setOpen(open === i ? null : i)}
              >
                <td className="py-2 pr-2 text-slate-400">
                  {r.session_id ? (open === i ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}
                </td>
                <td className="py-2 pr-3 tabular-nums whitespace-nowrap text-slate-600 dark:text-slate-300">{fmtAt(r.at)}</td>
                <td className="py-2 pr-3"><KindBadge kind={r.kind} isNew={r.is_new} method={r.method} /></td>
                <td className="py-2 pr-3 text-slate-700 dark:text-slate-200 max-w-[120px] truncate">{r.name || '—'}</td>
                <td className="py-2 pr-3 max-w-[260px]">
                  <span className="block truncate text-slate-900 dark:text-white">{r.title?.replace(/ – FITPEAK$/, '') || prettyPath(r.path)}</span>
                  <span className="block truncate text-[10px] text-slate-400">{prettyPath(r.path)}</span>
                </td>
                <td className="py-2 pr-3 text-slate-600 dark:text-slate-300 max-w-[170px]">
                  <span className="block truncate">{placeLabel(r.place, r.kind)}</span>
                  {r.source && <span className="block truncate text-[10px] text-slate-400">経路：{r.source}</span>}
                </td>
                <td className="py-2 pr-3 max-w-[220px]">
                  {r.session_id ? (
                    <>
                      <span className="block truncate text-slate-700 dark:text-slate-200">{prettyPath(r.entry_path)}</span>
                      <span className="block text-[10px] text-slate-400">{r.channel || '不明'}・{deviceLabel(r.device)}</span>
                    </>
                  ) : <span className="text-slate-400">訪問と未連携</span>}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{r.session_id ? `${fmtNum(r.pages_before)}ページ` : '—'}</td>
                <td className="py-2 text-right tabular-nums whitespace-nowrap">{r.sec_to_signup != null ? fmtDur(r.sec_to_signup) : '—'}</td>
              </tr>
              {open === i && r.session_id && (
                <tr className="bg-slate-50/60 dark:bg-slate-900/60">
                  <td />
                  <td colSpan={8} className="py-3 pr-3"><Journey sessionId={r.session_id} /></td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function SignupsTab({ preset, device, onOpenPage }: { preset: Preset; device: Device; onOpenPage: (p: string) => void }) {
  const [includeAds, setIncludeAds] = useState(false)
  const { data, loading, err } = useSignups(preset, device, null, includeAds)
  const [metric, setMetric] = useState<Metric>('all')
  const [pageKind, setPageKind] = useState<Kind>('all')
  const [recentKind, setRecentKind] = useState<Kind>('all')

  if (err) return <p className="text-xs text-rose-600">{err}</p>
  if (!data) return <Empty>{loading ? '集計中…' : 'データがありません'}</Empty>
  const k = data.kpis
  const p = data.prev_kpis

  const pages = data.pages.filter((r) =>
    pageKind === 'all' ? true : pageKind === 'line' ? r.line_clicks + r.line_signups > 0 : r.myfp_clicks + r.myfp_signups > 0)
  const places = data.places.filter((r) => pageKind === 'all' || r.kind === pageKind)
  const recent = data.recent.filter((r) => recentKind === 'all' || r.kind === recentKind)

  return (
    <div className={`space-y-4 ${loading ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          fitpeak.co のボタン・リンクから公式LINEの友だち追加、My FITPEAKの会員登録をした人の分析です。
        </p>
        <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none">
          <input type="checkbox" checked={includeAds} onChange={(e) => setIncludeAds(e.target.checked)} className="accent-slate-900" />
          Meta広告のLINE登録LPも含める
          {!includeAds && k.ad_line_signups > 0 && <span className="text-slate-400">（除外中：広告LPの登録 {fmtNum(k.ad_line_signups)}件）</span>}
        </label>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="公式LINE 新規登録" value={`${fmtNum(k.line_signups)}人`} cur={k.line_signups} prev={p?.line_signups}
          hint="サイトのLINEボタンから友だち追加した人（既に友だちだった人は除く）" />
        <Kpi label="LINEボタンのクリック" value={fmtNum(k.line_clicks)} cur={k.line_clicks} prev={p?.line_clicks} />
        <Kpi label="LINE クリック→登録率" value={fmtPct(rate(k.line_signups, k.line_clicks), 1)}
          cur={rate(k.line_signups, k.line_clicks) ?? undefined} prev={p ? rate(p.line_signups, p.line_clicks) ?? undefined : undefined} />
        <Kpi label="訪問あたりのLINE登録率" value={fmtPct(rate(k.line_signups, k.sessions), 2)}
          cur={rate(k.line_signups, k.sessions) ?? undefined} prev={p ? rate(p.line_signups, p.sessions) ?? undefined : undefined}
          hint={`新規登録 ÷ セッション（${fmtNum(k.sessions)}）`} />
        <Kpi label="My FITPEAK 新規登録" value={`${fmtNum(k.myfp_signups)}人`} cur={k.myfp_signups} prev={p?.myfp_signups}
          hint="サイトのリンクから my.fitpeak.co に来て、新しく会員登録した人" />
        <Kpi label="My FITPEAKリンクのクリック" value={fmtNum(k.myfp_clicks)} cur={k.myfp_clicks} prev={p?.myfp_clicks} />
        <Kpi label="My FITPEAK クリック→登録率" value={fmtPct(rate(k.myfp_signups, k.myfp_clicks), 1)}
          cur={rate(k.myfp_signups, k.myfp_clicks) ?? undefined} prev={p ? rate(p.myfp_signups, p.myfp_clicks) ?? undefined : undefined} />
        <Kpi label="既存友だちの追加操作" value={fmtNum(k.line_existing)} cur={k.line_existing} prev={p?.line_existing}
          hint="LINEボタンを押したが、既に友だちだった人（新規登録には数えない）" />
      </div>

      <Card
        title="新規登録の推移"
        right={<Seg<Metric> value={metric} onChange={setMetric} options={[
          { value: 'all', label: '合計' }, { value: 'line', label: '公式LINE' }, { value: 'myfp', label: 'My FITPEAK' },
        ]} />}
      >
        <LineChart
          points={data.timeseries.map((t) => ({ x: t.t, y: metric === 'line' ? t.line : metric === 'myfp' ? t.myfp : t.line + t.myfp }))}
          formatX={(x) => formatBucket(x, data.granularity)}
          unit="人"
        />
      </Card>

      <Card
        title="どのページで登録したか"
        right={<Seg<Kind> value={pageKind} onChange={setPageKind} options={[
          { value: 'all', label: 'すべて' }, { value: 'line', label: '公式LINE' }, { value: 'myfitpeak', label: 'My FITPEAK' },
        ]} />}
      >
        {!pages.length ? <Empty>この期間の登録・クリックはまだありません</Empty> : (
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-xs min-w-[720px]">
              <thead>
                <tr className="text-left text-[11px] text-slate-500 border-b border-slate-100 dark:border-slate-800">
                  <th className="py-2 pr-3 font-normal">ページ</th>
                  <th className="py-2 pr-3 font-normal text-right">PV</th>
                  {pageKind !== 'myfitpeak' && <>
                    <th className="py-2 pr-3 font-normal text-right">LINEクリック</th>
                    <th className="py-2 pr-3 font-normal text-right">LINE登録</th>
                    <th className="py-2 pr-3 font-normal text-right" title="LINE新規登録 ÷ ページビュー">登録/PV</th>
                  </>}
                  {pageKind !== 'line' && <>
                    <th className="py-2 pr-3 font-normal text-right">My FITPEAKクリック</th>
                    <th className="py-2 font-normal text-right">My FITPEAK登録</th>
                  </>}
                </tr>
              </thead>
              <tbody>
                {pages.map((r) => (
                  <tr key={r.path} className="border-b border-slate-50 dark:border-slate-900 hover:bg-slate-50 dark:hover:bg-slate-900 cursor-pointer" onClick={() => onOpenPage(r.path)}>
                    <td className="py-2 pr-3 max-w-[340px]">
                      <span className="block truncate text-slate-900 dark:text-white">{r.title?.replace(/ – FITPEAK$/, '') || prettyPath(r.path)}</span>
                      <span className="block truncate text-[10px] text-slate-400">{prettyPath(r.path)}</span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.pageviews ? fmtNum(r.pageviews) : <span className="text-slate-400" title="計測タグのないページ">—</span>}</td>
                    {pageKind !== 'myfitpeak' && <>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(r.line_clicks)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums font-semibold text-slate-900 dark:text-white">{fmtNum(r.line_signups)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.pageviews ? fmtPct(r.line_signups / r.pageviews, 2) : '—'}</td>
                    </>}
                    {pageKind !== 'line' && <>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(r.myfp_clicks)}</td>
                      <td className="py-2 text-right tabular-nums font-semibold text-slate-900 dark:text-white">{fmtNum(r.myfp_signups)}</td>
                    </>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="押された場所（ボタン・リンク）">
          {!places.length ? <Empty>データがまだありません</Empty> : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] text-slate-500 border-b border-slate-100 dark:border-slate-800">
                  <th className="py-2 pr-3 font-normal">場所</th>
                  <th className="py-2 pr-3 font-normal text-right">クリック</th>
                  <th className="py-2 pr-3 font-normal text-right">新規登録</th>
                  <th className="py-2 font-normal text-right">登録率</th>
                </tr>
              </thead>
              <tbody>
                {places.map((r, i) => (
                  <tr key={i} className="border-b border-slate-50 dark:border-slate-900">
                    <td className="py-2 pr-3 max-w-[260px]">
                      <span className="block truncate text-slate-800 dark:text-slate-100">{placeLabel(r.name, r.kind)}</span>
                      <span className="block text-[10px] text-slate-400">{r.kind === 'line' ? '公式LINE' : 'My FITPEAK'}</span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(r.clicks)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums font-semibold text-slate-900 dark:text-white">{fmtNum(r.signups)}</td>
                    <td className="py-2 text-right tabular-nums">{r.clicks ? fmtPct(r.signups / r.clicks, 0) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="登録した人の流入元">
          <BarList items={data.channels as unknown as Record<string, unknown>[]} valueKey="count" unit="人" format={(n) => n} />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="登録した人の入口ページ（サイトに最初に来たページ）">
          <BarList items={data.entry_pages as unknown as Record<string, unknown>[]} valueKey="count" unit="人"
            onClickItem={(n) => n.startsWith('/') && onOpenPage(n)} />
        </Card>
        <Card title="登録した人のデバイス">
          <BarList items={data.devices.map((d) => ({ ...d, name: deviceLabel(d.name) }))} valueKey="count" unit="人" format={(n) => n} />
        </Card>
      </div>

      <Card
        title="最近の登録（行を押すと、その人がサイトで見たページの順番を表示）"
        right={<Seg<Kind> value={recentKind} onChange={setRecentKind} options={[
          { value: 'all', label: 'すべて' }, { value: 'line', label: '公式LINE' }, { value: 'myfitpeak', label: 'My FITPEAK' },
        ]} />}
      >
        <RecentTable rows={recent} />
        <p className="text-[10px] text-slate-400 mt-3 leading-relaxed">
          「訪問と未連携」は、サイト分析の訪問記録と結び付けられなかった登録です（計測タグのないページ、2026年9月26日の連携開始前の一部など）。
          公式LINEは友だち追加の確定をもって登録とし、ボタンを押した時点で既に友だちだった人は新規に数えません。
          My FITPEAKは、サイトのリンクを押してから3日以内に新しく会員になった人を数えます。
        </p>
      </Card>
    </div>
  )
}
