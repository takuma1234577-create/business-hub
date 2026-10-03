import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Brain, Wrench, Package, Radio, AlertTriangle, CheckCircle2, MessagesSquare } from 'lucide-react'
import { saApi } from './api'

// AIエージェント管理マップ。fitpeak-ai-org の出来事（org_events）を3秒ごとに差分で取り、
// ①組織マップ ②思考コンソール ③ツール起動 ④成果物タイムライン に出す。表示だけで、書き込みはしない。

interface Agent { id: string; parent_id: string | null; layer: number; role_title: string; enabled: boolean; dept?: string | null; model?: string | null }
interface ChatMsg { id: number; dept: string; from_agent: string; to_agent: string | null; body: string; created_at: string }
interface Ev { id: number; at: string; agent_id: string | null; run_id: string | null; kind: string; level: string; title: string; detail: string | null; meta?: Record<string, unknown> | null }
interface Running { run_id: string; agent_id: string; started_at: string; task: string; last: { title: string; at: string } | null }
interface Status {
  running: Running[]; queued: number | null; escalations_open: number | null; heartbeat_at: string | null; errors_24h: number | null
  cost_24h_usd: number | null; cap_24h_usd: number | null; cost_30d_usd: number | null; cap_30d_usd: number | null; revenue_30d_jpy: number | null
}
interface Resp { agents: Agent[]; events: Ev[]; last_id: number; status: Status }

const POLL_MS = 3000
const KEEP = 400
const DELIVERABLE = new Set(['run_end', 'finish', 'proposal', 'decision', 'apply', 'escalation', 'sns'])
const TOOL = new Set(['tool', 'tool_error'])

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const hhmmss = (iso: string) => new Date(iso).toLocaleTimeString('ja-JP', { hourCycle: 'h23', timeZone: 'Asia/Tokyo' })
const yen = (usd: number | null) => (usd == null ? '-' : `約${Math.round(usd * 150).toLocaleString('ja-JP')}円`)

function useTyped(text: string, key: string | number) {
  const [n, setN] = useState(0)
  useEffect(() => {
    setN(0)
    const t = setInterval(() => setN((v) => (v >= text.length ? v : v + 3)), 25)
    return () => clearInterval(t)
  }, [text, key])
  return text.slice(0, n)
}

interface Node { a: Agent; x: number; y: number }

function layout(agents: Agent[]) {
  const byLayer = new Map<number, Agent[]>()
  for (const a of agents) byLayer.set(a.layer, [...(byLayer.get(a.layer) || []), a])
  const layers = [...byLayer.keys()].sort((p, q) => p - q)
  const pos = new Map<string, Node>()
  const order = new Map<string, number>()
  const W = Math.max(720, Math.max(...layers.map((l) => byLayer.get(l)!.length), 1) * 92)
  layers.forEach((l, li) => {
    const row = [...byLayer.get(l)!].sort((p, q) => (order.get(p.parent_id || '') ?? -1) - (order.get(q.parent_id || '') ?? -1) || p.id.localeCompare(q.id))
    row.forEach((a, i) => {
      order.set(a.id, i + li * 1000)
      pos.set(a.id, { a, x: ((i + 0.5) / row.length) * W, y: 54 + li * 108 })
    })
  })
  return { pos, W, H: 54 + Math.max(layers.length - 1, 0) * 108 + 62 }
}


const DEPTS: { id: string; label: string }[] = [
  { id: 'all', label: 'すべて' }, { id: 'exec', label: '社長室' }, { id: 'site', label: 'サイト運用' }, { id: 'sns', label: 'SNS' }, { id: 'gear', label: 'ギア' }, { id: 'cs', label: 'お客様対応' }, { id: 'amazon', label: 'Amazon' }, { id: 'creashot', label: 'クレアショット' }, { id: 'company', label: '全社チャット' },
]

// やり取りの種類（指示・報告・日報）。先頭の【…】で見分けて、色をつける
const KINDS: { tag: string; cls: string }[] = [
  { tag: '【指示】', cls: 'bg-amber-500/20 text-amber-200 border-amber-500/40' },
  { tag: '【報告】', cls: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40' },
  { tag: '【日報】', cls: 'bg-violet-500/20 text-violet-200 border-violet-500/40' },
  { tag: '【オーナーへの日報】', cls: 'bg-rose-500/20 text-rose-200 border-rose-500/40' },
]
const kindOf = (body: string) => KINDS.find((k) => body.startsWith(k.tag))

// 部門のグループチャット（AI同士のやり取り）。オーナーが中身を読む
// オーナーが直接書き込んで指示する欄。宛先を省略すると、社長室・全社は社長、部門はその部門の部長に最優先の仕事として入る
const ROOM_OPTIONS = [{ id: 'exec', label: '社長室' }, { id: 'company', label: '全社チャット（全員宛て）' }, { id: 'site', label: 'サイト運用' }, { id: 'sns', label: 'SNS' }, { id: 'gear', label: 'ギア' }, { id: 'cs', label: 'お客様対応' }, { id: 'amazon', label: 'Amazon' }, { id: 'creashot', label: 'クレアショット' }]
function ChatComposer({ agents, defaultRoom, onSent }: { agents: Agent[]; defaultRoom: string; onSent: () => void }) {
  const [room, setRoom] = useState(defaultRoom)
  const [to, setTo] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => { setRoom(defaultRoom) }, [defaultRoom])
  const targets = agents.filter((a) => a.enabled && a.id !== 'jev')
  const send = async () => {
    if (!body.trim() || busy) return
    setBusy(true); setMsg(null)
    try {
      const r = await saApi.post<{ target: string }>('/ai-chat', { room, to: room === 'company' ? undefined : to || undefined, body })
      setMsg({ ok: true, text: `送りました（${targets.find((a) => a.id === r.data.target)?.role_title || r.data.target} に最優先で伝わります）` })
      setBody(''); onSent()
    } catch (e: unknown) {
      setMsg({ ok: false, text: (e as { response?: { data?: { error?: string } } })?.response?.data?.error || '送れませんでした' })
    } finally { setBusy(false) }
  }
  return (
    <div className="mt-3 pt-3 border-t border-slate-800">
      <div className="flex flex-wrap gap-2 mb-2">
        <label className="text-xs text-slate-400">部屋
          <select value={room} onChange={(e) => setRoom(e.target.value)} className="ml-1 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs text-slate-200">{ROOM_OPTIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
        </label>
        <label className="text-xs text-slate-400">宛先
          <select value={room === 'company' ? '' : to} disabled={room === 'company'} onChange={(e) => setTo(e.target.value)} className="ml-1 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs text-slate-200 max-w-[14rem]">
            <option value="">責任者（社長／部門の部長）</option>
            {targets.map((a) => <option key={a.id} value={a.id}>{a.role_title}</option>)}
          </select>
        </label>
      </div>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={3} placeholder="ここに直接書き込んで、指示できます（例: 記事ページの最初の画面にLINE登録ボタンを出して）" className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-100 placeholder-slate-600" />
      <div className="flex items-center gap-3 mt-1.5">
        <button onClick={send} disabled={busy || !body.trim()} className="px-3 py-1.5 rounded-full text-xs bg-sky-500/80 text-white disabled:opacity-40 cursor-pointer">{busy ? '送信中…' : '送信して指示する'}</button>
        <span className="text-[11px] text-slate-500">{body.length}/1000 ・ 鍵・パスワードは書かない</span>
        {msg && <span className={`text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</span>}
      </div>
    </div>
  )
}

function ChatPanel({ name, agents }: { name: (id: string | null) => string; agents: Agent[] }) {
  const [dept, setDept] = useState('all')
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    if (document.hidden) return
    try {
      const r = await saApi.get<{ messages: ChatMsg[]; last_24h: Record<string, number> }>('/ai-chat', { params: { dept, limit: 100 } })
      setMsgs(r.data.messages || []); setCounts(r.data.last_24h || {}); setErr('')
    } catch (e: unknown) {
      const m = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setErr(m || '取得に失敗しました')
    }
  }, [dept])
  useEffect(() => {
    const first = setTimeout(load, 0)
    const t = setInterval(load, 10000)
    return () => { clearTimeout(first); clearInterval(t) }
  }, [load])
  const total24 = Object.values(counts).reduce((a, b) => a + b, 0)
  return (
    <section className="min-w-0 rounded-xl bg-slate-950 border border-slate-800 p-3">
      <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2"><MessagesSquare size={15} className="text-sky-300" />部門のグループチャット<span className="text-xs font-normal text-slate-500">直近24時間 {total24}件</span></h3>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {DEPTS.map((d) => (
          <button key={d.id} onClick={() => setDept(d.id)} className={`px-2.5 py-1 rounded-full text-xs cursor-pointer border ${dept === d.id ? 'bg-sky-500/20 border-sky-400 text-sky-200' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}>
            {d.label}{d.id !== 'all' && counts[d.id] ? ` ${counts[d.id]}` : ''}
          </button>
        ))}
      </div>
      {err && <p className="text-xs text-red-300 mb-2">{err}</p>}
      {msgs.length === 0 ? <p className="text-xs text-slate-500">まだ、やり取りがありません（部長が動き始めると、ここに出ます）</p> : (
        <ul className="space-y-2 max-h-96 overflow-y-auto">
          {[...msgs].reverse().map((m) => (
            <li key={m.id} className="text-sm">
              <div className="text-[11px] text-slate-500">{hhmmss(m.created_at)} ／ {DEPTS.find((d) => d.id === m.dept)?.label || m.dept}</div>
              <div className="break-words"><b className="text-sky-300">{name(m.from_agent)}</b>{m.to_agent ? <span className="text-slate-400"> → {name(m.to_agent)}</span> : <span className="text-slate-500"> → 全員</span>}{(() => { const k = kindOf(m.body); return <><span className="text-slate-400">：</span>{k && <span className={`mr-1 px-1.5 py-0.5 rounded border text-[10px] align-middle ${k.cls}`}>{k.tag.replace(/[【】]/g, '')}</span>}<span className="text-slate-200 whitespace-pre-wrap">{k ? m.body.slice(k.tag.length) : m.body}</span></> })()}</div>
            </li>
          ))}
        </ul>
      )}
      <ChatComposer agents={agents} defaultRoom={dept === 'all' ? 'exec' : dept} onSent={() => { void load() }} />
    </section>
  )
}

export default function AiMapTab() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [events, setEvents] = useState<Ev[]>([])
  const [status, setStatus] = useState<Status | null>(null)
  const [err, setErr] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const lastId = useRef(0)
  const mapBox = useRef<HTMLDivElement>(null)
  const centered = useRef(false)

  const load = useCallback(async () => {
    if (document.hidden) return
    try {
      const r = await saApi.get<Resp>('/ai-map', { params: lastId.current ? { after: lastId.current } : {} })
      const d = r.data
      setAgents(d.agents || [])
      setStatus(d.status)
      if (d.events?.length) {
        lastId.current = Math.max(lastId.current, d.last_id || 0)
        setEvents((prev) => {
          const seen = new Set(prev.map((e) => e.id))
          return [...prev, ...d.events.filter((e) => !seen.has(e.id))].slice(-KEEP)
        })
      }
      setErr('')
    } catch (e: unknown) {
      const m = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setErr(m || '取得に失敗しました')
    }
  }, [])

  useEffect(() => {
    const first = setTimeout(load, 0)
    const t = setInterval(load, POLL_MS)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => { clearTimeout(first); clearInterval(t); clearInterval(tick) }
  }, [load])

  const { pos, W, H } = useMemo(() => layout(agents), [agents])
  // 狭い画面では、最初に地図の中央（上司の列）が見える位置にそろえる
  useEffect(() => {
    const el = mapBox.current
    if (el && agents.length && !centered.current) { centered.current = true; el.scrollLeft = Math.max(0, (W - el.clientWidth) / 2) }
  }, [agents, W])
  const name = useCallback((id: string | null) => (id ? agents.find((a) => a.id === id)?.role_title || id : 'システム'), [agents])
  const running = useMemo(() => new Set((status?.running || []).map((r) => r.agent_id)), [status])
  const lastEv = useMemo(() => {
    const m = new Map<string, Ev>()
    for (const e of events) if (e.agent_id) m.set(e.agent_id, e)
    return m
  }, [events])

  const state = (id: string, enabled: boolean): 'run' | 'warm' | 'err' | 'idle' | 'off' => {
    if (!enabled) return 'off'
    const e = lastEv.get(id)
    const age = e ? now - new Date(e.at).getTime() : Infinity
    if (e && age < 5 * 60000 && (e.level === 'error' || e.kind === 'run_error')) return 'err'
    if (running.has(id)) return 'run'
    if (age < 3 * 60000) return 'warm'
    return 'idle'
  }
  const COLOR = { run: '#22d3ee', warm: '#4ade80', err: '#f87171', idle: '#64748b', off: '#334155' }

  const shown = sel ? events.filter((e) => e.agent_id === sel) : events
  const thinks = shown.filter((e) => e.kind === 'think' || e.kind === 'run_start')
  const bodyOf = (e: Ev) => (e.kind === 'think' ? e.detail || e.title : e.title)
  const latestThink = thinks[thinks.length - 1]
  const typed = useTyped(latestThink ? bodyOf(latestThink) : '', latestThink?.id ?? 0)
  const tools = shown.filter((e) => TOOL.has(e.kind)).slice(-14).reverse()
  const done = shown.filter((e) => DELIVERABLE.has(e.kind)).slice(-30).reverse()

  // ツールの所要時間は、同じ実行の「ひとつ前の出来事」からの経過で近似する（記録に所要時間が無いため）
  const gap = (e: Ev) => {
    const i = events.findIndex((x) => x.id === e.id)
    for (let j = i - 1; j >= 0; j--) if (events[j].run_id && events[j].run_id === e.run_id) return Math.max(0, (new Date(e.at).getTime() - new Date(events[j].at).getTime()) / 1000)
    return 0
  }

  const beatAge = status?.heartbeat_at ? Math.round((now - new Date(status.heartbeat_at).getTime()) / 60000) : null
  const runList = status?.running || []

  return (
    <div className="space-y-4 text-slate-100">
      <style>{`
        @keyframes aimPulse { 0% { r: 15; opacity: .55 } 100% { r: 30; opacity: 0 } }
        @keyframes aimFlash { 0% { background: rgba(34,211,238,.55) } 100% { background: transparent } }
        @keyframes aimIn { from { opacity: 0; transform: translateY(-6px) } to { opacity: 1; transform: none } }
        .aim-ring { animation: aimPulse 1.6s ease-out infinite }
        .aim-flash { animation: aimFlash 1.8s ease-out 1 }
        .aim-in { animation: aimIn .35s ease-out 1 }
        .aim-cursor::after { content: '▍'; animation: aimBlink 1s steps(2) infinite }
        @keyframes aimBlink { 50% { opacity: 0 } }
      `}</style>

      <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <span className="inline-flex items-center gap-1.5 font-semibold"><Radio size={14} className={err ? 'text-red-400' : 'text-emerald-400'} />{err ? '接続できません' : 'LIVE'}</span>
        <span>稼働中 <b className="text-cyan-300 text-sm">{runList.length}</b></span>
        <span>待機中の仕事 <b className="text-sm">{status?.queued ?? '-'}</b></span>
        <span>人に確認中 <b className={`text-sm ${status?.escalations_open ? 'text-amber-300' : ''}`}>{status?.escalations_open ?? '-'}</b></span>
        <span>24時間のエラー <b className={`text-sm ${status?.errors_24h ? 'text-red-300' : ''}`}>{status?.errors_24h ?? '-'}</b></span>
        <span>費用(24h) <b className="text-sm">{yen(status?.cost_24h_usd ?? null)}</b><span className="text-slate-500"> / {yen(status?.cap_24h_usd ?? null)}</span></span>
        <span>鼓動 <b className={`text-sm ${beatAge != null && beatAge > 30 ? 'text-red-300' : ''}`}>{beatAge == null ? '-' : `${beatAge}分前`}</b></span>
        {err && <span className="text-red-300">{err}</span>}
      </div>

      <div className="rounded-xl bg-slate-950 border border-slate-800 overflow-hidden">
        <div className="px-3 py-2 text-xs text-slate-400 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-slate-800">
          <span>組織マップ（担当を押すと、その担当だけを下に表示）</span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {sel && <button onClick={() => setSel(null)} className="underline cursor-pointer text-cyan-300">全員に戻す</button>}
            {([['run', '作業中'], ['warm', '直近'], ['idle', '待機'], ['err', '失敗']] as const).map(([k, l]) => (
              <span key={k} className="inline-flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-full" style={{ background: COLOR[k] }} />{l}</span>
            ))}
          </span>
        </div>
        <div className="overflow-x-auto" ref={mapBox}>
          {agents.length === 0 ? <div className="p-8 text-center text-slate-500 text-sm">{err ? '取得できていません' : '読み込み中…'}</div> : (
            <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: W, width: '100%', display: 'block' }} role="img" aria-label="AI組織のマップ">
              {[...pos.values()].map(({ a, x, y }) => {
                const p = a.parent_id ? pos.get(a.parent_id) : null
                if (!p) return null
                const st = state(a.id, a.enabled)
                const hot = st === 'run' || st === 'warm'
                return (
                  <g key={`e-${a.id}`}>
                    <line x1={p.x} y1={p.y} x2={x} y2={y} stroke={hot ? COLOR[st] : '#1e293b'} strokeWidth={hot ? 1.6 : 1} opacity={hot ? 0.8 : 1} />
                    {st === 'run' && (
                      <circle r="3.5" fill={COLOR.run}>
                        <animateMotion dur="1.6s" repeatCount="indefinite" path={`M${p.x},${p.y} L${x},${y}`} />
                      </circle>
                    )}
                  </g>
                )
              })}
              {[...pos.values()].map(({ a, x, y }) => {
                const st = state(a.id, a.enabled)
                const on = sel === a.id
                return (
                  <g key={a.id} onClick={() => setSel(on ? null : a.id)} style={{ cursor: 'pointer' }} role="button" aria-label={`${a.role_title}を表示`}>
                    {st === 'run' && <circle cx={x} cy={y} r="15" fill="none" stroke={COLOR.run} strokeWidth="2" className="aim-ring" />}
                    <circle cx={x} cy={y} r="15" fill="#0f172a" stroke={COLOR[st]} strokeWidth={on ? 4 : 2} />
                    <circle cx={x} cy={y} r="5" fill={COLOR[st]} />
                    <text x={x} y={y + 31} textAnchor="middle" fontSize="10.5" fill={on ? '#fff' : '#cbd5e1'}>{clip(a.role_title, 9)}</text>
                  </g>
                )
              })}
            </svg>
          )}
        </div>
        {runList.length > 0 && (
          <div className="px-3 py-2 border-t border-slate-800 text-xs space-y-1">
            {runList.map((r) => (
              <div key={r.run_id} className="flex gap-2"><b className="text-cyan-300 shrink-0">{name(r.agent_id)}</b><span className="text-slate-300 truncate">{r.task}{r.last ? ` ／ ${r.last.title}` : ''}</span></div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="min-w-0 rounded-xl bg-slate-950 border border-slate-800 p-3">
          <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2"><Brain size={15} className="text-cyan-300" />思考コンソール<span className="text-xs font-normal text-slate-500">{sel ? name(sel) : '全員'}</span></h3>
          <div className="rounded-lg bg-black/60 p-3 min-h-[120px] text-[13px] leading-relaxed font-mono text-emerald-300 whitespace-pre-wrap break-words">
            {latestThink
              ? (<><div className="text-slate-500 text-[11px] mb-1">{hhmmss(latestThink.at)} {name(latestThink.agent_id)}</div><span className="aim-cursor">{typed}</span></>)
              : <span className="text-slate-500">まだ発言がありません</span>}
          </div>
          <ul className="mt-2 space-y-1 max-h-44 overflow-y-auto text-xs">
            {thinks.slice(-12, -1).reverse().map((e) => (
              <li key={e.id} className="text-slate-400 break-words"><span className="text-slate-600">{hhmmss(e.at)} </span><span className="text-slate-300">{name(e.agent_id)}</span> {clip(e.title, 90)}</li>
            ))}
          </ul>
        </section>

        <section className="min-w-0 rounded-xl bg-slate-950 border border-slate-800 p-3">
          <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2"><Wrench size={15} className="text-amber-300" />ツール起動</h3>
          {tools.length === 0 ? <p className="text-xs text-slate-500">まだ道具の利用がありません</p> : (
            <ul className="space-y-1">
              {tools.map((e) => {
                const fresh = now - new Date(e.at).getTime() < 4000
                const g = gap(e)
                return (
                  <li key={e.id} className={`rounded px-2 py-1.5 text-xs flex items-center gap-2 ${fresh ? 'aim-flash' : ''}`}>
                    {e.kind === 'tool_error' ? <AlertTriangle size={13} className="text-red-400 shrink-0" /> : <Wrench size={13} className="text-amber-300 shrink-0" />}
                    <span className="min-w-0 flex-1 truncate">{e.title}</span>
                    <span className="hidden sm:inline text-slate-500 shrink-0">{name(e.agent_id)}</span>
                    <span className="w-16 h-1.5 rounded bg-slate-800 shrink-0" title={`直前の出来事から${g.toFixed(1)}秒`}>
                      <span className="block h-full rounded bg-amber-400" style={{ width: `${Math.min(100, (g / 20) * 100)}%` }} />
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="min-w-0 rounded-xl bg-slate-950 border border-slate-800 p-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2"><Package size={15} className="text-emerald-300" />成果物タイムライン<span className="text-xs font-normal text-slate-500">{sel ? name(sel) : '全員'}</span></h3>
        {done.length === 0 ? <p className="text-xs text-slate-500">まだ成果がありません</p> : (
          <ul className="divide-y divide-slate-800">
            {done.map((e) => (
              <li key={e.id} className="py-2 aim-in">
                <div className="flex items-start gap-2 text-sm">
                  {e.level === 'error' ? <AlertTriangle size={15} className="text-red-400 mt-0.5 shrink-0" /> : <CheckCircle2 size={15} className="text-emerald-400 mt-0.5 shrink-0" />}
                  <div className="min-w-0">
                    <div className="text-[11px] text-slate-500">{hhmmss(e.at)} ／ {name(e.agent_id)} ／ {e.kind}</div>
                    <div className="break-words">{e.title}</div>
                    {e.detail && <div className="text-xs text-slate-400 mt-0.5 break-words">{clip(e.detail, 220)}</div>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <ChatPanel name={name} agents={agents} />
    </div>
  )
}
