import { useCallback, useEffect, useState } from 'react'
import { Smartphone, Monitor, Tablet, ShoppingCart, MousePointerClick, Eye, CreditCard, Flame } from 'lucide-react'
import { saApi, type Realtime } from './api'
import { Card, Columns, BarList, Empty } from './ui'
import { fmtNum, timeAgo, prettyPath, countryLabel, deviceLabel } from './format'

const POLL_MS = 5000

function DeviceIcon({ d }: { d: string | null }) {
  if (d === 'mobile') return <Smartphone size={13} className="text-slate-400" />
  if (d === 'tablet') return <Tablet size={13} className="text-slate-400" />
  return <Monitor size={13} className="text-slate-400" />
}

const FEED_LABEL: Record<string, { label: string; icon: React.ReactNode }> = {
  pageview: { label: '閲覧', icon: <Eye size={12} /> },
  click: { label: 'クリック', icon: <MousePointerClick size={12} /> },
  rageclick: { label: '連打', icon: <Flame size={12} /> },
  cart_add: { label: 'カート追加', icon: <ShoppingCart size={12} /> },
  checkout: { label: '購入手続きへ', icon: <CreditCard size={12} /> },
}

export default function RealtimeTab({ onOpenPage }: { onOpenPage: (path: string) => void }) {
  const [data, setData] = useState<Realtime | null>(null)
  const [err, setErr] = useState('')
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    try {
      const r = await saApi.get<Realtime>('/realtime')
      setData(r.data)
      setErr('')
    } catch (e: unknown) {
      const m = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setErr(m || '取得に失敗しました')
    }
  }, [])

  useEffect(() => {
    const first = setTimeout(load, 0)
    const id = setInterval(() => { if (document.visibilityState === 'visible') load() }, POLL_MS)
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => { clearTimeout(first); clearInterval(id); clearInterval(t) }
  }, [load])

  return (
    <div className="space-y-4">
      {err && <p className="text-xs text-rose-600">{err}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <div className="pt-4">
            <p className="text-xs text-slate-500 flex items-center gap-1.5">
              <span className="relative flex w-2 h-2">
                <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-500 opacity-60 animate-ping" />
                <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-500" />
              </span>
              今サイトを見ている人
            </p>
            <p className="text-6xl font-semibold tabular-nums text-slate-900 dark:text-white mt-2">{data ? fmtNum(data.active_users) : '—'}</p>
            <p className="text-[11px] text-slate-400 mt-1">直近90秒以内に画面を開いていた人数（5秒ごとに自動更新）</p>
            <div className="grid grid-cols-3 gap-2 mt-5 text-center">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900 py-2">
                <p className="text-[10px] text-slate-500">30分のユーザー</p>
                <p className="text-lg font-semibold tabular-nums text-slate-900 dark:text-white">{fmtNum(data?.users_30m)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900 py-2">
                <p className="text-[10px] text-slate-500">30分のPV</p>
                <p className="text-lg font-semibold tabular-nums text-slate-900 dark:text-white">{fmtNum(data?.pageviews_30m)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900 py-2">
                <p className="text-[10px] text-slate-500">30分のカート追加</p>
                <p className="text-lg font-semibold tabular-nums text-slate-900 dark:text-white">{fmtNum(data?.cart_adds_30m)}</p>
              </div>
            </div>
          </div>
        </Card>

        <Card title="直近30分のページビュー（1分ごと）" className="lg:col-span-2">
          {data ? (
            <Columns items={data.per_minute.map((m) => ({ label: m.t, value: m.pageviews }))} height={150} unit=" PV" />
          ) : <Empty>読み込み中…</Empty>}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="今見られているページ" className="lg:col-span-2">
          {data && data.active_pages.length ? (
            <BarList
              items={data.active_pages.map((p) => ({ name: p.path, users: p.users, title: p.title }))}
              unit="人"
              format={(name) => {
                const p = data.active_pages.find((x) => x.path === name)
                return (
                  <span>
                    <span className="text-slate-900 dark:text-white">{p?.title || prettyPath(name)}</span>
                    <span className="text-slate-400 ml-2">{prettyPath(name)}</span>
                  </span>
                )
              }}
              onClickItem={onOpenPage}
            />
          ) : <Empty>今は誰も見ていません</Empty>}
        </Card>
        <div className="space-y-4">
          <Card title="流入元（今いる人）">
            <BarList items={(data?.active_channels || []) as unknown as Record<string, unknown>[]} unit="人" />
          </Card>
          <Card title="デバイス（今いる人）">
            <BarList items={(data?.active_devices || []).map((d) => ({ ...d, name: deviceLabel(d.name) }))} unit="人" />
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="いまサイトにいる人（行動の詳細）">
          {data && data.active_sessions.length ? (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.active_sessions.map((s) => (
                <li key={s.session_id} className="py-2 flex items-start gap-3 text-xs">
                  <DeviceIcon d={s.device} />
                  <div className="min-w-0 flex-1">
                    <button onClick={() => onOpenPage(s.path)} className="text-slate-900 dark:text-white font-medium truncate block max-w-full text-left hover:underline cursor-pointer">
                      {s.title || prettyPath(s.path)}
                    </button>
                    <p className="text-slate-400 truncate">
                      {[s.channel || '直接', s.ref_host, countryLabel(s.country), s.city].filter(Boolean).join('・')}
                    </p>
                  </div>
                  <div className="text-right shrink-0 tabular-nums">
                    <p className="text-slate-700 dark:text-slate-200">{fmtNum(s.pageviews || 1)}ページ目{s.cart ? <ShoppingCart size={11} className="inline ml-1 -mt-0.5" /> : null}</p>
                    <p className="text-slate-400">{s.started ? `滞在 ${Math.max(0, Math.round((now - new Date(s.started).getTime()) / 60000))}分` : ''}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : <Empty>今は誰も見ていません</Empty>}
        </Card>

        <Card title="ライブ行動ログ（直近30分）">
          {data && data.feed.length ? (
            <ul className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
              {data.feed.map((f, i) => {
                const k = FEED_LABEL[f.type] || { label: f.type, icon: null }
                const strong = f.type === 'cart_add' || f.type === 'checkout'
                return (
                  <li key={`${f.at}-${i}`} className="flex items-start gap-2 text-xs">
                    <span className="w-14 shrink-0 text-slate-400 tabular-nums">{timeAgo(f.at)}</span>
                    <span className={`inline-flex items-center gap-1 shrink-0 px-1.5 py-0.5 rounded text-[10px] ${strong ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                      {k.icon}{k.label}
                    </span>
                    <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">
                      {f.type === 'click' || f.type === 'rageclick' ? `「${f.label || '（テキストなし）'}」` : ''}
                      <span className={f.type === 'click' || f.type === 'rageclick' ? 'text-slate-400 ml-1' : ''}>{f.title || prettyPath(f.path)}</span>
                      <span className="text-slate-400 ml-1">・{deviceLabel(f.device)}{f.city ? `・${f.city}` : ''}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : <Empty>直近30分のアクセスはありません</Empty>}
        </Card>
      </div>
    </div>
  )
}
