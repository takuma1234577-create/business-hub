import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { fmtNum, fmtPct, prettyPath } from './format'

// ---------------------------------------------------------------------------
// レイアウト部品
// ---------------------------------------------------------------------------
export function Card({ title, right, children, className = '' }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
          {title && <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>}
          {right}
        </div>
      )}
      <div className="px-4 pb-4">{children}</div>
    </section>
  )
}

export function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex gap-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap transition-colors ${
            value === o.value
              ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-xs text-slate-400 py-6 text-center">{children}</p>
}

/** KPIタイル（前期間比つき）。lowerIsBetter のとき増加を悪化として扱う */
export function Kpi({ label, value, cur, prev, lowerIsBetter, hint }: {
  label: string; value: string; cur?: number; prev?: number; lowerIsBetter?: boolean; hint?: string
}) {
  let delta: ReactNode = null
  if (cur != null && prev != null && isFinite(cur) && isFinite(prev)) {
    if (prev === 0 && cur === 0) delta = <span className="text-slate-400">前期間 0</span>
    else if (prev === 0) delta = <span className="text-slate-400">前期間 0</span>
    else {
      const ch = (cur - prev) / prev
      const good = lowerIsBetter ? ch < 0 : ch > 0
      const flat = Math.abs(ch) < 0.005
      delta = (
        <span className={flat ? 'text-slate-400' : good ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
          {flat ? '±0%' : `${ch > 0 ? '▲' : '▼'} ${Math.abs(ch * 100).toFixed(ch > 9.99 ? 0 : 1)}%`}
          <span className="text-slate-400 ml-1">前期間比</span>
        </span>
      )
    }
  }
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 py-3" title={hint}>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="text-xl font-semibold text-slate-900 dark:text-white tabular-nums mt-0.5">{value}</p>
      <p className="text-[11px] mt-0.5 tabular-nums">{delta}</p>
    </div>
  )
}

/** 横棒ランキング（1系列なので単色） */
export function BarList({ items, valueKey = 'users', unit = '', format, onClickItem, max = 10, label }: {
  items: Record<string, unknown>[]; valueKey?: string; unit?: string; format?: (n: string) => ReactNode
  onClickItem?: (name: string) => void; max?: number; label?: string
}) {
  const [all, setAll] = useState(false)
  const list = all ? items : items.slice(0, max)
  const top = Math.max(1, ...items.map((i) => Number(i[valueKey]) || 0))
  const total = items.reduce((a, i) => a + (Number(i[valueKey]) || 0), 0)
  if (!items.length) return <Empty>データがまだありません</Empty>
  return (
    <div>
      {label && <div className="flex justify-between text-[10px] text-slate-400 mb-1"><span /> <span>{label}</span></div>}
      <ul className="space-y-1">
        {list.map((i) => {
          const name = String(i.name ?? '')
          const v = Number(i[valueKey]) || 0
          return (
            <li key={name}>
              <button
                type="button"
                disabled={!onClickItem}
                onClick={() => onClickItem?.(name)}
                title={`${prettyPath(name)}：${fmtNum(v)}${unit}（${fmtPct(total ? v / total : 0, 1)}）`}
                className={`relative w-full flex items-center justify-between gap-3 px-2 py-1.5 rounded-md text-left text-xs ${onClickItem ? 'hover:bg-slate-50 dark:hover:bg-slate-900 cursor-pointer' : 'cursor-default'}`}
              >
                <span className="absolute inset-y-0.5 left-0 rounded bg-slate-100 dark:bg-slate-800" style={{ width: `${(v / top) * 100}%` }} />
                <span className="relative truncate text-slate-700 dark:text-slate-200">{format ? format(name) : prettyPath(name)}</span>
                <span className="relative tabular-nums text-slate-900 dark:text-white font-medium shrink-0">
                  {fmtNum(v)}{unit}
                  <span className="text-slate-400 font-normal ml-1.5">{fmtPct(total ? v / total : 0)}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {items.length > max && (
        <button onClick={() => setAll(!all)} className="mt-2 text-[11px] text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer">
          {all ? '閉じる' : `すべて表示（${items.length}件）`}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 折れ線（エリア）チャート：1系列・ホバーでクロスヘア＋ツールチップ
// ---------------------------------------------------------------------------
export function LineChart({ points, height = 220, formatX, unit = '' }: {
  points: { x: string; y: number }[]; height?: number; formatX: (x: string) => string; unit?: string
}) {
  const ref = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(800)
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.max(280, Math.round(el.clientWidth))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const H = W < 500 ? Math.round(height * 0.8) : height
  const pad = { l: 40, r: 12, t: 12, b: 26 }
  const maxY = Math.max(1, ...points.map((p) => p.y))
  const niceMax = useMemo(() => {
    const pow = Math.pow(10, Math.floor(Math.log10(maxY)))
    const n = maxY / pow
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
    return step * pow
  }, [maxY])
  const n = points.length
  const x = (i: number) => pad.l + (n <= 1 ? (W - pad.l - pad.r) / 2 : (i / (n - 1)) * (W - pad.l - pad.r))
  const y = (v: number) => pad.t + (1 - v / niceMax) * (H - pad.t - pad.b)
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join('')
  const area = n ? `${line}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z` : ''
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * niceMax)
  const labelEvery = Math.max(1, Math.ceil(n / (W < 500 ? 4 : 8)))

  const onMove = (e: React.MouseEvent) => {
    const svg = ref.current
    if (!svg || !n) return
    const r = svg.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }

  return (
    <div className="relative" ref={boxRef}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="stroke-slate-100 dark:stroke-slate-800" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" className="fill-slate-400 text-[10px]">{fmtNum(t)}</text>
          </g>
        ))}
        {points.map((p, i) => (i % labelEvery === 0 || i === n - 1) && (
          <text key={p.x} x={x(i)} y={H - 8} textAnchor={n > 1 && i === n - 1 ? 'end' : n > 1 && i === 0 ? 'start' : 'middle'} className="fill-slate-400 text-[10px]">{formatX(p.x)}</text>
        ))}
        <path d={area} className="fill-slate-900/[0.06] dark:fill-white/[0.08]" />
        <path d={line} fill="none" className="stroke-slate-900 dark:stroke-white" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && points[hover] && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="stroke-slate-300 dark:stroke-slate-600" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(points[hover].y)} r={5} className="fill-slate-900 dark:fill-white stroke-white dark:stroke-slate-950" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hover != null && points[hover] && (
        <div
          className="absolute top-1 pointer-events-none rounded-md bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-[11px] px-2 py-1 shadow"
          style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > n / 2 ? '-105%' : '5%'})` }}
        >
          <div className="opacity-70">{formatX(points[hover].x)}</div>
          <div className="font-semibold tabular-nums">{fmtNum(points[hover].y)}{unit}</div>
        </div>
      )}
    </div>
  )
}

/** 縦棒（分単位の推移など） */
export function Columns({ items, height = 120, unit = '' }: { items: { label: string; value: number }[]; height?: number; unit?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <div>
      <div className="flex items-end gap-[2px]" style={{ height }}>
        {items.map((i) => (
          <div key={i.label} className="group relative flex-1 h-full flex items-end">
            <div
              className="w-full rounded-t-[3px] bg-slate-900 dark:bg-white group-hover:opacity-70 transition-opacity"
              style={{ height: `${i.value ? Math.max(3, (i.value / max) * 100) : 0}%` }}
            />
            <div className="hidden group-hover:block absolute bottom-full mb-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-[10px] px-1.5 py-0.5 z-10">
              {i.label} {fmtNum(i.value)}{unit}
            </div>
            {i.value === 0 && <div className="w-full h-[2px] bg-slate-100 dark:bg-slate-800" />}
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-slate-400 mt-1">
        <span>{items[0]?.label}</span>
        <span>{items[items.length - 1]?.label}</span>
      </div>
    </div>
  )
}

/** 曜日×時間帯のアクセス量（1色の濃淡） */
export function WeekHour({ data }: { data: { dow: number; hour: number; pageviews: number }[] }) {
  const map = new Map(data.map((d) => [`${d.dow}-${d.hour}`, d.pageviews]))
  const max = Math.max(1, ...data.map((d) => d.pageviews))
  const days = ['月', '火', '水', '木', '金', '土', '日']
  const dowIdx = [1, 2, 3, 4, 5, 6, 0]
  if (!data.length) return <Empty>データがまだありません</Empty>
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[520px]">
        <div className="grid gap-[2px]" style={{ gridTemplateColumns: '28px repeat(24, minmax(0, 1fr))' }}>
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="text-[9px] text-slate-400 text-center">{h % 3 === 0 ? h : ''}</div>
          ))}
          {dowIdx.map((dw, r) => (
            <FragmentRow key={dw} label={days[r]}>
              {Array.from({ length: 24 }, (_, h) => {
                const v = map.get(`${dw}-${h}`) || 0
                const a = v ? 0.12 + 0.88 * (v / max) : 0
                return (
                  <div
                    key={h}
                    title={`${days[r]}曜 ${h}時台：${fmtNum(v)} PV`}
                    className="h-5 rounded-[3px] bg-slate-100 dark:bg-slate-800 relative overflow-hidden"
                  >
                    {v > 0 && <div className="absolute inset-0 bg-slate-900 dark:bg-white" style={{ opacity: a }} />}
                  </div>
                )
              })}
            </FragmentRow>
          ))}
        </div>
        <p className="text-[10px] text-slate-400 mt-2">日本時間。濃いほどページビューが多い時間帯</p>
      </div>
    </div>
  )
}
function FragmentRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div className="text-[10px] text-slate-500 flex items-center">{label}</div>
      {children}
    </>
  )
}

/** スクロール到達率（深さごと） */
export function ScrollReach({ data }: { data: { depth: number; pct: number }[] }) {
  if (!data.length) return <Empty>データがまだありません</Empty>
  return (
    <div className="space-y-1">
      {data.map((f) => (
        <div key={f.depth} className="flex items-center gap-2 text-[11px]">
          <span className="w-10 text-right text-slate-400 tabular-nums">{f.depth}%</span>
          <div className="flex-1 h-3.5 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
            <div className="h-full bg-slate-900 dark:bg-white rounded" style={{ width: `${Math.round(f.pct * 100)}%` }} />
          </div>
          <span className="w-10 tabular-nums text-slate-700 dark:text-slate-200 text-right">{fmtPct(f.pct)}</span>
        </div>
      ))}
    </div>
  )
}

/** 購入までのファネル */
export function Funnel({ steps }: { steps: { step: string; sessions: number }[] }) {
  const first = steps[0]?.sessions || 0
  return (
    <div className="space-y-2">
      {steps.map((s, i) => {
        const prev = i ? steps[i - 1].sessions : s.sessions
        return (
          <div key={s.step}>
            <div className="flex justify-between text-xs mb-0.5">
              <span className="text-slate-700 dark:text-slate-200">{s.step}</span>
              <span className="tabular-nums text-slate-900 dark:text-white font-medium">
                {fmtNum(s.sessions)}
                <span className="text-slate-400 font-normal ml-1.5">{i ? `前の段階から ${fmtPct(prev ? s.sessions / prev : 0)}` : ''}</span>
              </span>
            </div>
            <div className="h-5 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
              <div className="h-full bg-slate-900 dark:bg-white rounded" style={{ width: `${first ? Math.max(s.sessions ? 1.5 : 0, (s.sessions / first) * 100) : 0}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
