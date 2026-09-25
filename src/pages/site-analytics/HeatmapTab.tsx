import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Smartphone, Monitor, MousePointerClick, ArrowDown, Eye, Flame, RefreshCw } from 'lucide-react'
import { saApi, type Heatmap, type PageRow, type Preset } from './api'
import { PageSelector } from './PageTab'
import { Card, Seg, Empty, ScrollReach } from './ui'
import { fmtNum, fmtPct } from './format'

type Mode = 'click' | 'scroll' | 'attention'
type Dev = 'mobile' | 'desktop'

// ヒートマップの色（少ない→多い）。ヒートマップの慣習に合わせた寒色→暖色
const STOPS: [number, [number, number, number]][] = [
  [0.0, [37, 99, 235]],
  [0.35, [6, 182, 212]],
  [0.55, [132, 204, 22]],
  [0.75, [250, 204, 21]],
  [1.0, [220, 38, 38]],
]
function colorAt(t: number): [number, number, number] {
  const v = Math.max(0, Math.min(1, t))
  for (let i = 1; i < STOPS.length; i++) {
    if (v <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1]
      const [b, cb] = STOPS[i]
      const f = (v - a) / (b - a || 1)
      return [0, 1, 2].map((k) => Math.round(ca[k] + (cb[k] - ca[k]) * f)) as [number, number, number]
    }
  }
  return STOPS[STOPS.length - 1][1]
}
const LUT = (() => {
  const arr = new Uint8ClampedArray(256 * 3)
  for (let i = 0; i < 256; i++) {
    const c = colorAt(i / 255)
    arr[i * 3] = c[0]; arr[i * 3 + 1] = c[1]; arr[i * 3 + 2] = c[2]
  }
  return arr
})()

export default function HeatmapTab({ preset, path, onChangePath, pages }: {
  preset: Preset; path: string; onChangePath: (p: string) => void; pages: PageRow[]
}) {
  const [device, setDevice] = useState<Dev>('mobile')
  const [mode, setMode] = useState<Mode>('click')
  const [data, setData] = useState<Heatmap | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [shotUrl, setShotUrl] = useState<string | null>(null)
  const [shotBusy, setShotBusy] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })

  useEffect(() => {
    let alive = true
    setLoading(true); setErr(''); setShotUrl(null); setImgFailed(false)
    saApi.get<Heatmap>('/heatmap', { params: { preset, path, device } })
      .then((r) => { if (alive) setData(r.data) })
      .catch((e) => { if (alive) setErr(e?.response?.data?.error || '取得に失敗しました') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [preset, path, device])

  const imgSrc = !imgFailed ? (shotUrl || data?.screenshot_url || null) : null
  const displayW = device === 'mobile' ? 390 : 1000

  // 画像が無いときは計測したページの縦横比で白紙に描く
  const measure = useCallback(() => {
    const img = imgRef.current
    if (img && img.complete && img.naturalWidth) {
      setBox({ w: img.clientWidth, h: img.clientHeight })
    } else if (!imgSrc) {
      const w = Math.min(displayW, wrapRef.current?.clientWidth || displayW)
      const ratio = data?.doc_h && data?.doc_w ? data.doc_h / data.doc_w : (device === 'mobile' ? 6 : 3)
      setBox({ w, h: Math.round(w * Math.min(ratio, 30)) })
    }
  }, [imgSrc, displayW, data, device])

  useEffect(() => { measure() }, [measure])
  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  // 描画
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !data || !box.w || !box.h) return
    const W = box.w, H = Math.min(box.h, 16000)
    // 縦長ページでメモリを使いすぎないよう、大きいときは等倍で描く
    const dpr = W * H > 6_000_000 ? 1 : Math.min(2, window.devicePixelRatio || 1)
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr)
    cv.style.width = `${W}px`; cv.style.height = `${H}px`
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    if (mode === 'click') {
      if (!data.clicks.length) return
      const max = Math.max(...data.clicks.map((c) => c[2]))
      const r = Math.max(14, Math.min(28, W / 22))
      const off = document.createElement('canvas')
      off.width = cv.width; off.height = cv.height
      const o = off.getContext('2d')!
      o.setTransform(dpr, 0, 0, dpr, 0, 0)
      for (const [bx, by, n] of data.clicks) {
        const x = (bx / 200) * W, y = (by / 2000) * box.h
        if (y > H) continue
        const g = o.createRadialGradient(x, y, 0, x, y, r)
        const a = Math.min(1, 0.25 + 0.75 * (n / max))
        g.addColorStop(0, `rgba(0,0,0,${a})`)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        o.fillStyle = g
        o.beginPath(); o.arc(x, y, r, 0, Math.PI * 2); o.fill()
      }
      const img = o.getImageData(0, 0, off.width, off.height)
      const px = img.data
      for (let i = 0; i < px.length; i += 4) {
        const a = px[i + 3]
        if (!a) continue
        const j = a * 3
        px[i] = LUT[j]; px[i + 1] = LUT[j + 1]; px[i + 2] = LUT[j + 2]
        px[i + 3] = Math.min(210, 40 + a)
      }
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.putImageData(img, 0, 0); ctx.restore()
      // レイジクリック（連打）の位置
      ctx.lineWidth = 2
      for (const [bx, by, , rg] of data.clicks) {
        if (!rg) continue
        const x = (bx / 200) * W, y = (by / 2000) * box.h
        ctx.strokeStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke()
        ctx.strokeStyle = '#dc2626'; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke()
      }
      return
    }

    // スクロール到達 / 熟読エリア：ページを20の帯に分けて色を塗る
    const bands = 20
    let vals: number[] = []
    if (mode === 'scroll') {
      const reach = new Map(data.scroll_reach.map((s) => [s.depth, s.pct]))
      vals = Array.from({ length: bands }, (_, i) => ((reach.get(i * 5) ?? 0) + (reach.get((i + 1) * 5) ?? 0)) / 2)
    } else {
      const m = new Map(data.attention.map((a) => [a.band, Number(a.ms)]))
      const raw = Array.from({ length: bands }, (_, i) => m.get(i) || 0)
      const mx = Math.max(1, ...raw)
      vals = raw.map((v) => v / mx)
    }
    const bh = box.h / bands
    ctx.font = '600 12px "Noto Sans JP", "Hiragino Sans", sans-serif'
    for (let i = 0; i < bands; i++) {
      const y = i * bh
      if (y > H) break
      const [r, g, b] = colorAt(vals[i])
      ctx.fillStyle = `rgba(${r},${g},${b},0.42)`
      ctx.fillRect(0, y, W, bh)
      if (mode === 'scroll' ? i % 2 === 0 : true) {
        const label = mode === 'scroll'
          ? `${Math.round(((new Map(data.scroll_reach.map((s) => [s.depth, s.pct])).get(i * 5)) ?? 0) * 100)}% がここまで到達`
          : `注目度 ${Math.round(vals[i] * 100)}`
        const tw = ctx.measureText(label).width
        ctx.fillStyle = 'rgba(15,23,42,0.82)'
        ctx.fillRect(6, y + 4, tw + 12, 20)
        ctx.fillStyle = '#fff'
        ctx.fillText(label, 12, y + 18)
      }
    }
  }, [data, box, mode])

  const takeShot = async () => {
    setShotBusy(true)
    try {
      const r = await saApi.post<{ url: string }>('/screenshot', { path, device }, { timeout: 120000 })
      setShotUrl(r.data.url); setImgFailed(false)
    } catch (e: unknown) {
      const m = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      alert('スクリーンショットの撮影に失敗しました：' + (m || ''))
    } finally { setShotBusy(false) }
  }

  const clickCount = data?.click_total || 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageSelector pages={pages} value={path} onChange={onChangePath} />
        <div className="flex flex-wrap items-center gap-2">
          <Seg<Dev> value={device} onChange={setDevice} options={[
            { value: 'mobile', label: <span className="inline-flex items-center gap-1"><Smartphone size={12} />スマホ</span> },
            { value: 'desktop', label: <span className="inline-flex items-center gap-1"><Monitor size={12} />PC</span> },
          ]} />
          <Seg<Mode> value={mode} onChange={setMode} options={[
            { value: 'click', label: <span className="inline-flex items-center gap-1"><MousePointerClick size={12} />クリック</span> },
            { value: 'scroll', label: <span className="inline-flex items-center gap-1"><ArrowDown size={12} />スクロール</span> },
            { value: 'attention', label: <span className="inline-flex items-center gap-1"><Eye size={12} />熟読エリア</span> },
          ]} />
        </div>
      </div>

      {err && <p className="text-xs text-rose-600">{err}</p>}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4">
        <Card
          title={<span className="inline-flex items-center gap-2">ページ上の分布 {loading && <RefreshCw size={12} className="animate-spin text-slate-400" />}</span>}
          right={
            <button onClick={takeShot} disabled={shotBusy} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900 disabled:opacity-50 cursor-pointer">
              <Camera size={13} /> {shotBusy ? '撮影中…（30秒ほど）' : imgSrc ? 'スクショを撮り直す' : 'ページを撮影する'}
            </button>
          }
        >
          <div ref={wrapRef} className="rounded-lg bg-slate-100 dark:bg-slate-900 overflow-auto max-h-[78vh] flex justify-center">
            <div className="relative" style={{ width: imgSrc ? '100%' : box.w || undefined, maxWidth: displayW }}>
              {imgSrc ? (
                <img
                  ref={imgRef}
                  src={imgSrc}
                  alt="ページのスクリーンショット"
                  className="block w-full"
                  onLoad={measure}
                  onError={() => setImgFailed(true)}
                />
              ) : (
                <div className="bg-white dark:bg-slate-950 border border-dashed border-slate-300 dark:border-slate-700" style={{ width: box.w, height: box.h }}>
                  <p className="text-[11px] text-slate-400 p-3 leading-relaxed">
                    まだページの画像がありません。右上の「ページを撮影する」で、実際の画面の上に重ねて表示できます。
                  </p>
                </div>
              )}
              <canvas ref={canvasRef} className="absolute top-0 left-0 pointer-events-none" />
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3 text-[10px] text-slate-500">
            <span>{mode === 'click' ? 'クリック 少' : mode === 'scroll' ? '到達 少' : '注目 少'}</span>
            <span className="h-2 w-40 rounded-full" style={{ background: `linear-gradient(90deg, ${STOPS.map(([p, c]) => `rgb(${c.join(',')}) ${p * 100}%`).join(',')})` }} />
            <span>多</span>
            {mode === 'click' && <span className="ml-3 inline-flex items-center gap-1"><span className="w-3 h-3 rounded-full border-2 border-red-600 inline-block" />連打（イライラの兆候）</span>}
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="このページ（期間内）">
            <div className="grid grid-cols-2 gap-2 text-center">
              {[
                ['ページビュー', fmtNum(data?.pageviews)],
                ['セッション', fmtNum(data?.sessions)],
                ['クリック', fmtNum(clickCount)],
                ['連打', fmtNum(data?.rage_total)],
              ].map(([l, v]) => (
                <div key={l} className="rounded-lg bg-slate-50 dark:bg-slate-900 py-2">
                  <p className="text-[10px] text-slate-500">{l}</p>
                  <p className="text-base font-semibold tabular-nums text-slate-900 dark:text-white">{v}</p>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
              {device === 'mobile' ? 'スマホ' : 'PC'}で見られたときのデータです。クリック位置はページ全体の縦横比で記録しているため、ページの構成を大きく変えた後は撮り直してください。
            </p>
          </Card>

          <Card title={<span className="inline-flex items-center gap-1.5"><Flame size={14} />クリックされている要素</span>}>
            {data && data.top_elements.length ? (
              <ul className="space-y-1.5">
                {data.top_elements.map((e) => (
                  <li key={e.label} className="flex items-start justify-between gap-2 text-xs">
                    <span className="min-w-0">
                      <span className="block truncate text-slate-800 dark:text-slate-100">{e.label}</span>
                      {e.href && <span className="block truncate text-[10px] text-slate-400">{e.href.replace(/^https?:\/\/(www\.)?fitpeak\.co/, '')}</span>}
                    </span>
                    <span className="shrink-0 tabular-nums font-medium text-slate-900 dark:text-white">
                      {fmtNum(e.count)}
                      {e.rage > 0 && <span className="ml-1 text-rose-600">（連打{e.rage}）</span>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <Empty>クリックのデータがまだありません</Empty>}
          </Card>

          <Card title="スクロール到達率">
            <ScrollReach data={(data?.scroll_reach || []).filter((s) => s.depth % 10 === 0 && s.depth > 0)} />
            {data && data.scroll_reach.length > 0 && (
              <p className="text-[10px] text-slate-400 mt-2">ページの半分まで読まれた割合：{fmtPct(data.scroll_reach.find((s) => s.depth === 50)?.pct)}</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
