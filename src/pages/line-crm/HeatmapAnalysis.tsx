import { useState, useEffect, useRef, useCallback } from 'react'
import {
  X, Monitor, Smartphone, Sparkles, MousePointerClick, Flame, ExternalLink, Camera, Users, ArrowDown,
  PlayCircle, Volume2, Maximize, MousePointer2,
} from 'lucide-react'

interface Props {
  sourceCode: string
  sourceName: string
  lpUrl: string | null
  onClose: () => void
}

interface Summary {
  name: string | null
  lp_url: string | null
  device: string
  screenshot_url: string | null
  sessions: number
  avg_scroll_pct: number
  funnel: { depth: number; count: number; pct: number }[]
  clicks: { x: number; y: number; rage: boolean }[]
  click_total: number
  top_elements: { label: string; count: number }[]
  rage_clicks: number
  device_split: { desktop: number; mobile: number }
  cta: { clicks: number; avg_scroll_at_click: number | null; depths: number[]; top_labels: { label: string; count: number }[] }
  video: { plays: number; unmutes: number; fullscreens: number; completed: number; reach: Record<string, number> }
}

// 簡易Markdownレンダラー（見出し###・番号付き/箇条書き・**太字**のみ）
function renderMarkdown(md: string) {
  const lines = md.split('\n')
  const out: React.ReactNode[] = []
  let list: React.ReactNode[] = []
  const flush = () => {
    if (list.length) { out.push(<ul key={out.length} className="list-disc pl-5 space-y-1 my-2">{list}</ul>); list = [] }
  }
  const inline = (t: string) => {
    const parts = t.split(/(\*\*[^*]+\*\*)/g)
    return parts.map((p, i) => p.startsWith('**') && p.endsWith('**')
      ? <strong key={i} className="font-semibold text-slate-900 dark:text-white">{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>)
  }
  lines.forEach((raw, idx) => {
    const line = raw.replace(/\s+$/, '')
    if (/^#{1,6}\s/.test(line)) {
      flush()
      const text = line.replace(/^#{1,6}\s/, '')
      out.push(<h4 key={idx} className="text-sm font-bold text-[#06C755] mt-4 mb-1.5">{inline(text)}</h4>)
    } else if (/^\s*[-*]\s/.test(line)) {
      list.push(<li key={idx} className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{inline(line.replace(/^\s*[-*]\s/, ''))}</li>)
    } else if (/^\s*\d+[.)]\s/.test(line)) {
      list.push(<li key={idx} className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed list-decimal">{inline(line.replace(/^\s*\d+[.)]\s/, ''))}</li>)
    } else if (line.trim() === '') {
      flush()
    } else {
      flush()
      out.push(<p key={idx} className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed my-1">{inline(line)}</p>)
    }
  })
  flush()
  return out
}

export default function HeatmapAnalysis({ sourceCode, sourceName, lpUrl, onClose }: Props) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [days, setDays] = useState(30)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [shotUrl, setShotUrl] = useState<string | null>(null)
  const [shotLoading, setShotLoading] = useState(false)
  const [shotFailed, setShotFailed] = useState(false)
  const [analysis, setAnalysis] = useState<{ result: string; created_at: string } | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeErr, setAnalyzeErr] = useState('')
  const imgRef = useRef<HTMLImageElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setShotFailed(false)
    setShotUrl(null)
    try {
      const r = await fetch(`/api/line-crm/heatmap/summary?source_code=${encodeURIComponent(sourceCode)}&device=${device}&days=${days}`)
      if (r.ok) setSummary(await r.json())
    } catch { /* noop */ } finally { setLoading(false) }
  }, [sourceCode, device, days])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch(`/api/line-crm/heatmap/analysis?source_code=${encodeURIComponent(sourceCode)}`)
      .then(r => (r.ok ? r.json() : null)).then(d => setAnalysis(d)).catch(() => {})
  }, [sourceCode])

  const drawHeatmap = useCallback(() => {
    const img = imgRef.current, canvas = canvasRef.current
    if (!img || !canvas || !summary) return
    const w = img.clientWidth, h = img.clientHeight
    if (!w || !h) return
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d'); if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    const R = Math.max(14, Math.round(w * 0.028))
    for (const c of summary.clicks) {
      const x = c.x * w, y = c.y * h
      const col = c.rage ? '239,68,68' : '6,199,85'
      const g = ctx.createRadialGradient(x, y, 0, x, y, R)
      g.addColorStop(0, `rgba(${col},0.20)`)
      g.addColorStop(1, `rgba(${col},0)`)
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill()
    }
  }, [summary])

  useEffect(() => { drawHeatmap() }, [drawHeatmap, summary, shotUrl])
  useEffect(() => {
    const on = () => drawHeatmap()
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [drawHeatmap])

  const generateShot = async () => {
    setShotLoading(true)
    setShotFailed(false)
    try {
      const r = await fetch('/api/line-crm/heatmap/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_code: sourceCode, device }),
      })
      const d = await r.json()
      if (r.ok && d.url) setShotUrl(d.url)
      else { setShotFailed(true); alert('スクショ生成失敗: ' + (d.error || '')) }
    } catch (e) {
      setShotFailed(true)
    } finally { setShotLoading(false) }
  }

  const runAnalyze = async () => {
    setAnalyzing(true)
    setAnalyzeErr('')
    try {
      const r = await fetch('/api/line-crm/heatmap/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_code: sourceCode, device, days }),
      })
      const d = await r.json()
      if (r.ok) setAnalysis({ result: d.result, created_at: d.created_at })
      else setAnalyzeErr(d.error || 'AI分析に失敗しました')
    } catch (e) {
      setAnalyzeErr('AI分析に失敗しました')
    } finally { setAnalyzing(false) }
  }

  const imgSrc = shotUrl || summary?.screenshot_url || ''
  const pct = (v: number) => `${Math.round(v * 100)}%`

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-5xl shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Flame size={18} className="text-[#06C755]" />
              <h3 className="font-semibold text-slate-900 dark:text-white truncate">ヒートマップ分析 — {sourceName}</h3>
            </div>
            {lpUrl && (
              <a href={lpUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-500 hover:text-[#06C755] inline-flex items-center gap-1 mt-0.5 truncate max-w-[520px]">
                <ExternalLink size={11} /> {decodeURIComponent(lpUrl)}
              </a>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 cursor-pointer flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-slate-200 dark:border-slate-700 flex-shrink-0 flex-wrap">
          <div className="flex gap-1 bg-slate-100 dark:bg-slate-700/50 rounded-lg p-0.5">
            <button onClick={() => setDevice('desktop')} className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md cursor-pointer ${device === 'desktop' ? 'bg-white dark:bg-slate-800 text-[#06C755] shadow-sm' : 'text-slate-500'}`}>
              <Monitor size={13} /> PC
            </button>
            <button onClick={() => setDevice('mobile')} className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md cursor-pointer ${device === 'mobile' ? 'bg-white dark:bg-slate-800 text-[#06C755] shadow-sm' : 'text-slate-500'}`}>
              <Smartphone size={13} /> スマホ
            </button>
          </div>
          <div className="flex gap-1 bg-slate-100 dark:bg-slate-700/50 rounded-lg p-0.5">
            {[7, 14, 30, 90].map(d => (
              <button key={d} onClick={() => setDays(d)} className={`px-3 py-1 text-xs font-medium rounded-md cursor-pointer ${days === d ? 'bg-white dark:bg-slate-800 text-[#06C755] shadow-sm' : 'text-slate-500'}`}>{d}日</button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-500">
            {loading && <span className="inline-flex items-center gap-1 text-slate-400"><span className="w-3 h-3 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin inline-block" />更新中</span>}
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#06C755]/60 inline-block" />クリック</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500/60 inline-block" />レイジ</span>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <Metric icon={<Users size={13} className="text-slate-400" />} label="セッション" value={summary ? summary.sessions.toLocaleString() : '—'} />
            <Metric icon={<ArrowDown size={13} className="text-slate-400" />} label="平均スクロール到達" value={summary ? pct(summary.avg_scroll_pct) : '—'} />
            <Metric icon={<MousePointerClick size={13} className="text-slate-400" />} label="クリック数" value={summary ? summary.click_total.toLocaleString() : '—'} />
            <Metric icon={<Flame size={13} className="text-red-400" />} label="レイジクリック" value={summary ? summary.rage_clicks.toLocaleString() : '—'} valueClass={summary && summary.rage_clicks > 0 ? 'text-red-500' : ''} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
            {/* Heatmap image */}
            <div className="lg:col-span-3">
              <p className="text-xs font-medium text-slate-500 mb-2">クリックヒートマップ（LP実画面に重ね表示）</p>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 overflow-hidden">
                {imgSrc && !shotFailed ? (
                  <div className="relative max-h-[62vh] overflow-y-auto">
                    <img
                      ref={imgRef}
                      src={imgSrc}
                      alt="LP"
                      className="w-full block"
                      onLoad={drawHeatmap}
                      onError={() => setShotFailed(true)}
                    />
                    <canvas ref={canvasRef} className="absolute top-0 left-0 pointer-events-none" />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-3 py-16 px-4 text-center">
                    <Camera size={32} className="text-slate-300" />
                    <p className="text-sm text-slate-500">LPのスクリーンショットがまだありません</p>
                    <p className="text-xs text-slate-400 max-w-sm">「{device === 'desktop' ? 'PC' : 'スマホ'}」表示のLPを撮影して、その上にクリック分布を重ねます（初回は30秒ほどかかります）。</p>
                    <button
                      onClick={generateShot}
                      disabled={shotLoading || !lpUrl}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-medium disabled:opacity-40 cursor-pointer"
                    >
                      <Camera size={14} /> {shotLoading ? '生成中…（30秒ほど）' : 'スクショを生成'}
                    </button>
                    {!lpUrl && <p className="text-xs text-red-400">この経路にLP URLが未設定です（編集から設定してください）</p>}
                  </div>
                )}
              </div>
            </div>

            {/* Scroll funnel + top elements */}
            <div className="lg:col-span-2 space-y-5">
              <div>
                <p className="text-xs font-medium text-slate-500 mb-2">スクロール到達率（急落＝離脱ポイント）</p>
                <div className="space-y-1.5">
                  {(summary?.funnel || []).map(f => (
                    <div key={f.depth} className="flex items-center gap-2 text-xs">
                      <span className="w-9 text-right text-slate-400 tabular-nums">{f.depth}%</span>
                      <div className="flex-1 h-4 bg-slate-100 dark:bg-slate-700/50 rounded overflow-hidden">
                        <div className="h-full bg-[#06C755] rounded transition-all" style={{ width: `${Math.round(f.pct * 100)}%` }} />
                      </div>
                      <span className="w-9 text-right font-medium text-slate-700 dark:text-slate-300 tabular-nums">{Math.round(f.pct * 100)}%</span>
                    </div>
                  ))}
                  {(!summary || summary.funnel.every(f => f.count === 0)) && (
                    <p className="text-xs text-slate-400 py-2">データがありません</p>
                  )}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-500 mb-2">よくクリックされる要素</p>
                <div className="space-y-1">
                  {(summary?.top_elements || []).slice(0, 8).map((e, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="flex-1 truncate text-slate-700 dark:text-slate-300" title={e.label}>{e.label}</span>
                      <span className="font-medium text-slate-900 dark:text-white tabular-nums">{e.count}</span>
                    </div>
                  ))}
                  {(!summary || summary.top_elements.length === 0) && (
                    <p className="text-xs text-slate-400 py-2">データがありません</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 追跡型CTA + 動画エンゲージメント */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
              <p className="text-xs font-medium text-slate-500 mb-2 flex items-center gap-1.5"><MousePointer2 size={13} className="text-[#06C755]" /> 追跡型CTAボタン（LINE登録）</p>
              <div className="flex items-baseline gap-5">
                <div>
                  <span className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{summary ? summary.cta.clicks : '—'}</span>
                  <span className="text-xs text-slate-500 ml-1">クリック</span>
                </div>
                <div className="text-xs text-slate-500">
                  平均 <b className="text-slate-800 dark:text-white">{summary && summary.cta.avg_scroll_at_click != null ? pct(summary.cta.avg_scroll_at_click) : '—'}</b> の深さで押下
                </div>
              </div>
              {summary && summary.cta.top_labels.length > 0 && (
                <div className="mt-2.5 space-y-1">
                  {summary.cta.top_labels.map((e, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="flex-1 truncate text-slate-600 dark:text-slate-400" title={e.label}>{e.label}</span>
                      <span className="font-medium text-slate-900 dark:text-white tabular-nums">{e.count}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-slate-400 mt-2">「どのくらいスクロールした時点でCTAを押したか」の平均。浅い＝上部CTAが効いている。</p>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
              <p className="text-xs font-medium text-slate-500 mb-2 flex items-center gap-1.5"><PlayCircle size={13} className="text-[#06C755]" /> 動画エンゲージメント</p>
              <div className="grid grid-cols-4 gap-2 text-center mb-3">
                <VStat icon={<PlayCircle size={13} />} label="再生" v={summary?.video.plays} />
                <VStat icon={<Volume2 size={13} />} label="音量ON" v={summary?.video.unmutes} />
                <VStat icon={<Maximize size={13} />} label="全画面" v={summary?.video.fullscreens} />
                <VStat icon={<Flame size={13} />} label="完視聴" v={summary?.video.completed} />
              </div>
              {summary && summary.video.plays > 0 ? (
                <div className="space-y-1">
                  {[25, 50, 75, 95].map(m => {
                    const reached = summary.video.reach[String(m)] || 0
                    const p = summary.video.plays ? reached / summary.video.plays : 0
                    return (
                      <div key={m} className="flex items-center gap-2 text-xs">
                        <span className="w-9 text-right text-slate-400 tabular-nums">{m}%</span>
                        <div className="flex-1 h-3.5 bg-slate-100 dark:bg-slate-700/50 rounded overflow-hidden">
                          <div className="h-full bg-[#06C755] rounded" style={{ width: `${Math.round(p * 100)}%` }} />
                        </div>
                        <span className="w-9 text-right font-medium text-slate-700 dark:text-slate-300 tabular-nums">{Math.round(p * 100)}%</span>
                      </div>
                    )
                  })}
                  <p className="text-[11px] text-slate-400 mt-1.5">再生した人のうち、動画のどこまで見たか（途中の急落＝中だるみ/長さ過多）。</p>
                </div>
              ) : (
                <p className="text-xs text-slate-400">まだ動画の再生データがありません</p>
              )}
            </div>
          </div>

          {/* AI analysis */}
          <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-[#06C755]" />
                <h4 className="text-sm font-semibold text-slate-900 dark:text-white">AI分析（ネックポイント・訴求ズレ）</h4>
              </div>
              <button
                onClick={runAnalyze}
                disabled={analyzing || !summary || summary.sessions === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-medium disabled:opacity-40 cursor-pointer"
              >
                <Sparkles size={14} /> {analyzing ? '分析中…' : analysis ? '再分析する' : 'AIで分析する'}
              </button>
            </div>
            {analyzeErr && <p className="text-xs text-red-500 mb-2">{analyzeErr}</p>}
            {analyzing && (
              <div className="flex items-center gap-2 text-sm text-slate-500 py-6">
                <div className="w-4 h-4 border-2 border-[#06C755] border-t-transparent rounded-full animate-spin" />
                計測データとLPの中身を突き合わせて分析しています…
              </div>
            )}
            {!analyzing && analysis && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30 p-4">
                <div className="prose-sm">{renderMarkdown(analysis.result)}</div>
                <p className="text-[11px] text-slate-400 mt-3">分析日時: {new Date(analysis.created_at).toLocaleString('ja-JP')}</p>
              </div>
            )}
            {!analyzing && !analysis && (
              <p className="text-xs text-slate-400">「AIで分析する」を押すと、離脱の起きている箇所と訴求のズレ、改善提案をまとめます。</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function VStat({ icon, label, v }: { icon: React.ReactNode; label: string; v: number | undefined }) {
  return (
    <div className="bg-slate-50 dark:bg-slate-900/40 rounded-lg py-2">
      <div className="flex items-center justify-center text-slate-400 mb-0.5">{icon}</div>
      <p className="text-lg font-bold text-slate-900 dark:text-white tabular-nums leading-none">{v ?? '—'}</p>
      <p className="text-[10px] text-slate-500 mt-0.5">{label}</p>
    </div>
  )
}

function Metric({ icon, label, value, valueClass = '' }: { icon: React.ReactNode; label: string; value: string; valueClass?: string }) {
  return (
    <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mb-1">{icon}{label}</div>
      <p className={`text-xl font-bold text-slate-900 dark:text-white tabular-nums ${valueClass}`}>{value}</p>
    </div>
  )
}
