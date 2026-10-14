import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Home, Plus, Minus } from 'lucide-react'
import { buildNames } from './agentNames'
import { CityScene, type CityAgent, type CityState, type CityStateInfo, type DeptStat } from './cityScene'

// 3Dの街（部門ごとの部屋）。部屋を押すと寄り、人を押すと「いま何をしているか」のカードが出る。表示だけで書き込みはしない。

export interface MapAgent { id: string; parent_id: string | null; layer: number; role_title: string; enabled: boolean; dept?: string | null; model?: string | null }
export interface MapEvent { id: number; at: string; agent_id: string | null; kind: string; level: string; title: string; detail: string | null }
export interface PendingItem { id: string; agent_id: string; kind: string; urgency: string; headline: string; detail: string; options: string[] | null; ref: string | null; created_at: string }
export interface MapRunning { run_id: string; agent_id: string; started_at: string; task: string; last: { title: string; at: string } | null }

interface Props {
  agents: MapAgent[]
  deptOrder: string[]
  deptLabels: Record<string, string>
  events: MapEvent[]
  running: Map<string, MapRunning>
  stateOf: (id: string, enabled: boolean) => CityState
  titleOf: (a: MapAgent) => string
  sel: string | null
  onSel: (id: string | null) => void
  now: number
  pending: Map<string, PendingItem[]>
  onAnswer: (id: string, action: 'approve' | 'reject') => Promise<{ ok: boolean; message: string }>
  onComment: (agentId: string, text: string) => Promise<{ ok: boolean; message: string }>
}

const STATE_LABEL: Record<CityState, string> = { run: '作業中', warm: '直前まで作業', err: '失敗', idle: '待機中', off: '停止中' }
const STATE_DOT: Record<CityState, string> = { run: '#22d3ee', warm: '#4ade80', err: '#f87171', idle: '#64748b', off: '#334155' }
const KIND_LABEL: Record<string, string> = {
  think: '考えている', run_start: '仕事を開始', run_end: '仕事を完了', tool: '道具を使用', tool_error: '道具が失敗', finish: '結論', proposal: '提案', decision: '判断',
  apply: '反映', escalation: '人に確認', sns: 'SNS', run_error: '失敗',
}
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

export default function CityView({ agents, deptOrder, deptLabels, events, running, stateOf, titleOf, sel, onSel, now, pending, onAnswer, onComment }: Props) {
  const holder = useRef<HTMLDivElement>(null)
  const engine = useRef<CityScene | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [zoomK, setZoomK] = useState(1)
  const [failed, setFailed] = useState(false)
  const popped = useRef<number | null>(null)
  const cbs = useRef({ onSel, setFocus })
  useEffect(() => { cbs.current = { onSel, setFocus } }, [onSel])

  const names = useMemo(() => buildNames(agents.map((x) => x.id)), [agents])
  const nameOf = (id: string) => names.get(id) || ''
  const fullOf = (a: MapAgent) => `${titleOf(a)} ${nameOf(a.id)}`.trim()
  const deptOf = (a: MapAgent) => a.dept || (a.layer <= 2 ? 'exec' : 'other')

  // 3Dの本体（一度だけ作る）。WebGLが使えない端末では案内を出す
  useEffect(() => {
    const el = holder.current
    if (!el) return
    try {
      engine.current = new CityScene(el, {
        onPickAgent: (id) => cbs.current.onSel(id),
        onPickDept: (id) => cbs.current.setFocus(id),
        onZoom: (k) => setZoomK(k),
      })
    } catch {
      setTimeout(() => setFailed(true), 0)
      return
    }
    return () => { engine.current?.dispose(); engine.current = null }
  }, [])

  const cityAgents: CityAgent[] = useMemo(
    () => agents.map((a) => ({ id: a.id, parent_id: a.parent_id, layer: a.layer, label: `${titleOf(a)} ${names.get(a.id) || ''}`.trim(), enabled: a.enabled, dept: deptOf(a) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agents, names],
  )

  useEffect(() => {
    engine.current?.setLabels(deptLabels)
    engine.current?.setAgents(cityAgents, deptOrder, deptLabels)
  }, [cityAgents, deptOrder, deptLabels])

  const stats = useMemo(() => {
    const out: Record<string, DeptStat> = {}
    for (const a of agents) {
      const k = deptOf(a)
      const s = (out[k] ||= { busy: 0, bad: 0, total: 0, wait: 0 })
      const st = stateOf(a.id, a.enabled)
      s.total++
      if (st === 'run') s.busy++
      if (st === 'err') s.bad++
      if (pending.get(a.id)?.length) s.wait++
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, stateOf, now, pending])

  // 毎秒の状態を3Dへ渡す
  useEffect(() => {
    const states: Record<string, CityStateInfo> = {}
    for (const a of agents) states[a.id] = { st: stateOf(a.id, a.enabled), task: running.get(a.id)?.task, wait: pending.get(a.id)?.length || 0 }
    engine.current?.setStates(states, stats)
  }, [agents, stateOf, running, stats, pending])

  useEffect(() => { engine.current?.setSelected(sel) }, [sel])
  useEffect(() => {
    if (sel) engine.current?.focusAgent(sel)
    // 人を押したら、その部屋を表示にする
    if (sel) { const a = agents.find((x) => x.id === sel); if (a) setFocus(deptOf(a)) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel])

  // 新しい出来事を、本人の頭の上にふきだしで出す（最初の読み込み分は出さない）
  useEffect(() => {
    if (!events.length) return
    const maxId = events[events.length - 1].id
    if (popped.current === null) { popped.current = maxId; return }
    const last = popped.current
    const fresh = events.filter((e) => e.id > last && e.agent_id && ['think', 'tool', 'finish', 'proposal', 'decision', 'tool_error', 'run_start'].includes(e.kind)).slice(-6)
    for (const e of fresh) engine.current?.pop(e.agent_id!, e.title)
    popped.current = maxId
  }, [events])

  const depts = useMemo(() => {
    const ks = [...new Set(agents.map(deptOf))]
    const rank = (k: string) => (deptOrder.indexOf(k) < 0 ? 99 : deptOrder.indexOf(k))
    return ks.sort((p, q) => rank(p) - rank(q))
  }, [agents, deptOrder])

  const a = sel ? agents.find((x) => x.id === sel) : null
  const parent = a?.parent_id ? agents.find((x) => x.id === a.parent_id) : null
  const aState = a ? stateOf(a.id, a.enabled) : 'idle'
  const aRun = a ? running.get(a.id) : undefined
  const aEvents = a ? events.filter((e) => e.agent_id === a.id).slice(-6).reverse() : []
  const roomAgents = focus ? agents.filter((x) => deptOf(x) === focus) : []
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('ja-JP', { hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Tokyo' })
  const ago = (iso: string) => { const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000)); return s < 60 ? `${s}秒` : s < 3600 ? `${Math.floor(s / 60)}分` : `${Math.floor(s / 3600)}時間` }

  const overview = () => { setFocus(null); onSel(null); engine.current?.overview() }

  return (
    <div className="relative h-[560px] sm:h-[680px] bg-[#e6eafb] select-none overflow-hidden">
      <div ref={holder} className="absolute inset-0" />
      {failed && <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-slate-600">この端末では3D表示を使えません。「部門別」か「ツリー図」に切り替えてください。</div>}

      {/* 上の帯: 部門チップ（押すとその部屋へ） */}
      <div className="absolute top-2 left-2 right-2 flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
        {depts.map((k) => {
          const s = stats[k]
          const on = focus === k
          return (
            <button key={k} onClick={() => { setFocus(k); engine.current?.focus(k) }} className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 h-8 text-xs shadow-sm cursor-pointer ${on ? 'bg-[#5b4be0] border-[#5b4be0] text-white' : 'bg-white/95 border-indigo-100 text-slate-700 hover:bg-white'}`}>
              <i className={`w-2 h-2 rounded-full ${s?.wait ? 'bg-red-500 animate-pulse' : s?.bad ? 'bg-red-400' : s?.busy ? 'bg-cyan-400 animate-pulse' : 'bg-slate-300'}`} />
              <b className="font-semibold">{deptLabels[k] || (k === 'other' ? 'その他' : k)}</b>
              <span className={on ? 'text-indigo-100' : 'text-slate-400'}>{s?.busy ? `作業中 ${s.busy}` : `${s?.total ?? 0}体`}</span>
              {s?.wait ? <span className="rounded-full bg-red-500 text-white px-1.5 text-[10px] font-semibold">判断待ち {s.wait}</span> : null}
            </button>
          )
        })}
      </div>

      {/* 左上: 全体表示 */}
      <button onClick={overview} className="absolute top-12 left-2 inline-flex items-center gap-1.5 rounded-full bg-white/95 border border-indigo-100 shadow-sm px-3 h-8 text-xs text-slate-700 cursor-pointer hover:bg-white">
        <Home size={13} />全体表示
      </button>

      {/* 右下: ズーム */}
      <div className="absolute bottom-3 right-3 max-sm:bottom-auto max-sm:top-24 max-sm:right-2 flex flex-col gap-1.5">
        <button onClick={() => engine.current?.zoomBy(1.35)} aria-label="拡大" className="w-9 h-9 grid place-items-center rounded-full bg-white/95 border border-indigo-100 shadow text-slate-700 cursor-pointer hover:bg-white"><Plus size={16} /></button>
        <button onClick={() => engine.current?.zoomBy(1 / 1.35)} aria-label="縮小" className="w-9 h-9 grid place-items-center rounded-full bg-white/95 border border-indigo-100 shadow text-slate-700 cursor-pointer hover:bg-white"><Minus size={16} /></button>
      </div>
      <div className="absolute bottom-3 left-3 max-sm:hidden text-[11px] text-slate-500 bg-white/80 rounded px-2 py-1">ドラッグで移動 ・ ホイール/ピンチで拡大 ・ 部屋や人を押すと詳細{zoomK > 1.05 ? ` ・ ${Math.round(zoomK * 100)}%` : ''}</div>

      {/* 右: 人を押したときのカード / 部屋を押したときの一覧 */}
      {a ? (
        <aside className="absolute top-24 right-2 w-[min(300px,calc(100%-1rem))] max-h-[calc(100%-7rem)] max-sm:top-auto max-sm:bottom-2 max-sm:left-2 max-sm:w-auto max-sm:max-h-[40%] overflow-y-auto rounded-xl bg-white/97 border border-indigo-100 shadow-lg p-3 text-slate-800">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] text-slate-500">{deptLabels[deptOf(a)] || deptOf(a)}{parent ? ` ／ 上司: ${fullOf(parent)}` : ''}</div>
              <div className="font-bold text-base leading-tight break-words">{nameOf(a.id)}<span className="ml-1.5 text-xs font-semibold text-indigo-600">{titleOf(a)}</span></div>
            </div>
            <button onClick={() => onSel(null)} aria-label="閉じる" className="shrink-0 w-7 h-7 grid place-items-center rounded-full hover:bg-slate-100 cursor-pointer text-slate-500"><X size={15} /></button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold text-white" style={{ background: STATE_DOT[aState] }}>
              <i className={`w-1.5 h-1.5 rounded-full bg-white ${aState === 'run' ? 'animate-pulse' : ''}`} />{STATE_LABEL[aState]}
            </span>
            {a.model && <span className="text-slate-500 truncate" translate="no">{a.model}</span>}
          </div>
          {(pending.get(a.id) || []).map((e) => <PendingCard key={e.id} e={e} onAnswer={onAnswer} onComment={onComment} />)}
          <div className="mt-2.5 rounded-lg bg-indigo-50 border border-indigo-100 p-2.5">
            <div className="text-[11px] text-indigo-500 font-semibold mb-0.5">いまやっていること</div>
            {aRun ? (
              <>
                <div className="text-sm break-words" translate="no">{aRun.task}</div>
                {aRun.last && <div className="text-xs text-slate-500 mt-1 break-words" translate="no">直近: {clip(aRun.last.title, 80)}</div>}
                <div className="text-[11px] text-slate-400 mt-1">開始から {ago(aRun.started_at)}</div>
              </>
            ) : <div className="text-sm text-slate-500">{aState === 'off' ? '停止中です' : 'いまは次の仕事を待っています'}</div>}
          </div>
          <div className="mt-2.5">
            <div className="text-[11px] text-slate-500 font-semibold mb-1">最近の動き</div>
            {aEvents.length === 0 ? <div className="text-xs text-slate-400">まだ記録がありません</div> : (
              <ul className="space-y-1.5">
                {aEvents.map((e) => (
                  <li key={e.id} className="text-xs leading-snug">
                    <span className="text-slate-400">{hhmm(e.at)} </span>
                    <span className={`font-semibold ${e.level === 'error' ? 'text-red-500' : 'text-indigo-600'}`}>{KIND_LABEL[e.kind] || e.kind}</span>
                    <div className="text-slate-700 break-words" translate="no">{clip(e.title, 90)}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      ) : focus ? (
        <aside className="absolute top-24 right-2 w-[min(280px,calc(100%-1rem))] max-h-[calc(100%-7rem)] max-sm:top-auto max-sm:bottom-2 max-sm:left-2 max-sm:w-auto max-sm:max-h-[40%] overflow-y-auto rounded-xl bg-white/97 border border-indigo-100 shadow-lg p-3 text-slate-800">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-bold text-base">{deptLabels[focus] || focus}</div>
              <div className="text-xs text-slate-500">{stats[focus]?.total ?? 0}体 ／ 作業中 {stats[focus]?.busy ?? 0}{stats[focus]?.bad ? ` ／ 失敗 ${stats[focus].bad}` : ''}</div>
            </div>
            <button onClick={overview} aria-label="閉じる" className="shrink-0 w-7 h-7 grid place-items-center rounded-full hover:bg-slate-100 cursor-pointer text-slate-500"><X size={15} /></button>
          </div>
          <ul className="mt-2 space-y-0.5">
            {roomAgents.map((x) => {
              const st = stateOf(x.id, x.enabled)
              const r = running.get(x.id)
              return (
                <li key={x.id}>
                  <button onClick={() => onSel(x.id)} className="w-full text-left flex items-center gap-2 rounded px-1.5 py-1.5 hover:bg-indigo-50 cursor-pointer text-[13px]">
                    <i className={`shrink-0 w-2.5 h-2.5 rounded-full ${st === 'run' ? 'animate-pulse' : ''}`} style={{ background: STATE_DOT[st] }} />
                    <span className="truncate font-medium">{titleOf(x)}<span className="ml-1.5 text-slate-500 font-normal">{nameOf(x.id)}</span></span>
                    {r && <span className="ml-auto text-[11px] text-cyan-600 truncate max-w-[50%]" translate="no">{clip(r.task, 18)}</span>}
                    {pending.get(x.id)?.length ? <span className="ml-auto text-[11px] font-semibold text-white bg-red-500 rounded-full px-1.5">判断待ち</span> : !r && st === 'err' && <span className="ml-auto text-[11px] text-red-500">失敗</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>
      ) : null}
    </div>
  )
}

// 人の判断待ち。承認/却下で答える（LINEの回答と同じ処理）。選択式の案件は、選んだ内容を担当へ返す
function PendingCard({ e, onAnswer, onComment }: { e: PendingItem; onAnswer: Props['onAnswer']; onComment: Props['onComment'] }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const opts = e.options || []
  const binary = opts.some((o) => o === 'approve' || o === '承認して反映')
  const cs = !!e.ref && e.ref.startsWith('cs:')
  const run = async (f: () => Promise<{ ok: boolean; message: string }>) => {
    if (busy) return
    setBusy(true); setMsg(null)
    try { const r = await f(); setMsg({ ok: r.ok, text: r.message }); if (r.ok) setText('') } finally { setBusy(false) }
  }
  const answer = (action: 'approve' | 'reject') => {
    if (action === 'approve' && !window.confirm(cs ? 'AIの返信案を、そのままお客様に送ります。よろしいですか？' : '承認して反映します。よろしいですか？')) return
    void run(() => onAnswer(e.id, action))
  }
  const reply = (body: string) => run(() => onComment(e.agent_id, `【判断待ちへの返答】案件: ${e.headline.slice(0, 80)}\n${body}`))
  return (
    <div className="mt-2.5 rounded-lg border-2 border-red-400 bg-red-50 p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-bold text-red-600"><span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />判断待ち{e.urgency === 'high' ? '（急ぎ）' : ''}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900 break-words" translate="no">{clip(e.headline, 140)}</div>
      {e.detail && <button onClick={() => setOpen(!open)} className="mt-1 text-[11px] text-red-600 underline cursor-pointer">{open ? '詳細を閉じる' : '詳細を見る'}</button>}
      {open && <div className="mt-1 text-xs text-slate-700 whitespace-pre-wrap break-words max-h-40 overflow-y-auto" translate="no">{e.detail}</div>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {binary ? (
          <>
            <button disabled={busy} onClick={() => answer('approve')} className="px-3 h-8 rounded-full text-xs font-semibold bg-red-600 text-white disabled:opacity-40 cursor-pointer">{cs ? 'AI案で送信' : '承認して反映'}</button>
            <button disabled={busy} onClick={() => answer('reject')} className="px-3 h-8 rounded-full text-xs font-semibold bg-white border border-red-300 text-red-700 disabled:opacity-40 cursor-pointer">{cs ? '対応しない' : '却下'}</button>
          </>
        ) : opts.map((o) => (
          <button key={o} disabled={busy} onClick={() => { if (window.confirm(`この内容で担当に返答します。\n\n${o}`)) void reply(`選んだ案: ${o}`) }} className="px-3 py-1.5 rounded-2xl text-xs font-semibold bg-red-600 text-white disabled:opacity-40 cursor-pointer text-left break-words max-w-full">{clip(o, 60)}</button>
        ))}
      </div>
      <div className="mt-2">
        <textarea value={text} onChange={(ev) => setText(ev.target.value)} maxLength={900} rows={2} placeholder="条件やコメントを書いて、担当へ返す（例: 来週まで待って）" className="w-full rounded border border-red-200 bg-white px-2 py-1 text-xs text-slate-800" />
        <button disabled={busy || !text.trim()} onClick={() => void reply(text.trim())} className="mt-1 px-3 h-7 rounded-full text-xs bg-slate-700 text-white disabled:opacity-40 cursor-pointer">コメントで返す</button>
      </div>
      {msg && <div className={`mt-1.5 text-xs ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</div>}
    </div>
  )
}
