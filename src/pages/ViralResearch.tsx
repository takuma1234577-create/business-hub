import { useEffect, useRef, useState, Fragment } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { Loader2, Send, Search, Bot, Users, FileText, Sparkles, Trash2, RefreshCw, Play, Copy, Printer, Plus } from 'lucide-react'
import ToolLayout from '../components/ToolLayout'
import { parseBlocks, parseInline } from '../lib/markdown'

const BASE = '/api/viral-research'

interface Video {
  url: string
  platform: 'youtube' | 'tiktok'
  title: string
  creator: string
  views: number | null
  likes?: number | null
  followers?: number | null
  baseline?: number | null
  score?: number | null
  tier?: string
  publishedAt?: string | null
  thumbnail?: string | null
}
interface Agent { id: string; name: string; brief?: string; queries: string[]; schedule?: string; lastRunAt?: string; lastCount?: number; running?: boolean }
interface Tracked { platform: string; handle: string; name?: string }
interface Asset { id: string; title: string; kind: string; createdAt: string; body?: string }
interface Thread { id: string; title: string }
interface ChatMsg { role: 'user' | 'assistant'; text: string; videos?: Video[]; tools?: string[]; error?: string }
interface StreamEvent { type: string; message?: string; videos?: Video[]; text?: string; id?: string; command?: string }

type Tab = 'copilot' | 'search' | 'agents' | 'tracked' | 'assets'

const TIER_COLOR: Record<string, string> = {
  exceptional: 'bg-orange-600', viral: 'bg-amber-600', good: 'bg-green-700', normal: 'bg-slate-500', unknown: 'bg-slate-400',
}
const SCHEDULE_LABEL: Record<string, string> = { daily: '毎日', weekly: '毎週', monthly: '毎月' }
const KIND_LABEL: Record<string, string> = { script: '台本', brief: 'ブリーフ', report: 'レポート' }
const STARTERS = [
  'クレアチン関連でここ3か月に伸びたショートを探して、共通するフックの型をまとめて',
  '監視アカウントで最近バズった動画と、その理由を教えて',
  '筋トレ初心者向けで、小さいアカウントなのに伸びた動画のフォーマットを分析して',
  'いちばんスコアが高い動画を元に、クレアショットの30秒UGC台本を作って保存して',
]

function fmt(n?: number | null) {
  if (n == null) return '-'
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}億`
  if (n >= 1e4) return `${(n / 1e4).toFixed(n >= 1e5 ? 0 : 1)}万`
  return n.toLocaleString()
}
const day = (s?: string | null) => (s ? new Date(s).toLocaleDateString() : '')

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(BASE + path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers || {}) } })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error || r.statusText)
  return j as T
}

// NDJSON を1行ずつ読む
async function streamApi(path: string, body: unknown, onEvent: (ev: StreamEvent) => void) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
  if (!r.ok || !r.body) {
    const j = await r.json().catch(() => ({}))
    throw new Error(j.error || r.statusText)
  }
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      if (line.trim()) onEvent(JSON.parse(line))
    }
  }
}

function InlineText({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((t, i) => {
        if (t.type === 'bold') return <strong key={i}>{t.text}</strong>
        if (t.type === 'code') return <code key={i} className="px-1 rounded bg-slate-100 dark:bg-slate-800 text-[0.9em]">{t.text}</code>
        if (t.type === 'link') return <a key={i} href={t.href} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline break-all">{t.text}</a>
        return <Fragment key={i}>{t.text}</Fragment>
      })}
    </>
  )
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed text-slate-800 dark:text-slate-200">
      {parseBlocks(text).map((b, i) => {
        if (b.type === 'heading') return <p key={i} className="font-semibold text-base mt-3"><InlineText text={b.text} /></p>
        if (b.type === 'code') return <pre key={i} className="whitespace-pre-wrap rounded-lg bg-slate-100 dark:bg-slate-800 p-3 text-xs">{b.text}</pre>
        if (b.type === 'list') {
          const Tag = b.ordered ? 'ol' : 'ul'
          return <Tag key={i} className={`${b.ordered ? 'list-decimal' : 'list-disc'} pl-5 space-y-1`}>{b.items.map((it, j) => <li key={j}><InlineText text={it} /></li>)}</Tag>
        }
        if (b.type === 'table') {
          return (
            <div key={i} className="overflow-x-auto">
              <table className="text-xs border-collapse">
                <thead><tr>{b.header.map((h, j) => <th key={j} className="border border-slate-200 dark:border-slate-700 px-2 py-1 text-left bg-slate-50 dark:bg-slate-800"><InlineText text={h} /></th>)}</tr></thead>
                <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k} className="border border-slate-200 dark:border-slate-700 px-2 py-1 align-top"><InlineText text={c} /></td>)}</tr>)}</tbody>
              </table>
            </div>
          )
        }
        return <p key={i} className="whitespace-pre-wrap"><InlineText text={b.text} /></p>
      })}
    </div>
  )
}

function thumbOf(v: Video) {
  if (v.thumbnail) return v.thumbnail
  const id = v.url.match(/(?:shorts\/|v=)([\w-]{11})/)?.[1]
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : ''
}

function VideoCard({ v, onAsk }: { v: Video; onAsk: (text: string) => void }) {
  const [hook, setHook] = useState<string | null>(null)
  async function loadHook() {
    setHook('字幕を取得中…')
    try {
      const r = await api<{ openingLine: string | null }>(`/hook?url=${encodeURIComponent(v.url)}`)
      setHook(r.openingLine ? `冒頭: 「${r.openingLine}」` : '字幕がない動画でした')
    } catch (e) { setHook(`エラー: ${(e as Error).message}`) }
  }
  const tier = v.tier || 'unknown'
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
      <a href={v.url} target="_blank" rel="noopener noreferrer" className="relative block aspect-[9/14] bg-black bg-cover bg-center" style={{ backgroundImage: `url("${thumbOf(v)}")` }}>
        <span className={`absolute top-2 left-2 rounded-full px-2 py-0.5 text-xs font-bold text-white ${TIER_COLOR[tier] || TIER_COLOR.unknown}`}>
          {v.score != null ? `${v.score}倍` : 'スコア不明'}
        </span>
        <span className="absolute top-2 right-2 rounded bg-black/60 px-1.5 text-[10px] text-white">{v.platform === 'tiktok' ? 'TikTok' : 'YouTube'}</span>
        <span className="absolute bottom-2 left-2 font-bold text-white [text-shadow:0_1px_3px_rgba(0,0,0,.8)]">{fmt(v.views)}回</span>
      </a>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <p className="line-clamp-3 text-xs text-slate-800 dark:text-slate-200">{v.title}</p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {v.creator}{v.baseline ? ` / 普段 ${fmt(v.baseline)}回` : ''}{v.followers ? ` / 登録 ${fmt(v.followers)}` : ''}
          <br />{day(v.publishedAt)}{v.likes ? ` / いいね ${fmt(v.likes)}` : ''}
        </p>
        {hook && <p className="rounded-lg bg-blue-50 dark:bg-blue-950/40 p-2 text-xs text-slate-700 dark:text-slate-300">{hook}</p>}
        <div className="mt-auto flex flex-wrap gap-1.5">
          <SmallButton onClick={loadHook}>フック</SmallButton>
          <SmallButton onClick={() => onAsk(`この動画がなぜ伸びたか、フックの型・フォーマット・構成・コメントを誘う仕掛けの観点で分析して。真似するならどう撮るかも。\n${v.url}`)}>分析</SmallButton>
          <SmallButton onClick={() => onAsk(`この動画のフックと構成を元に、クレアショット(クレアチンのサプリ)向けの30秒UGC台本を作って保存して。\n${v.url}`)}>台本に</SmallButton>
        </div>
      </div>
    </div>
  )
}

function SmallButton({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-xs text-slate-700 dark:text-slate-300 hover:border-blue-500 hover:text-blue-600 disabled:opacity-50 cursor-pointer">
      {children}
    </button>
  )
}
function PrimaryButton({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-white px-4 py-2 text-sm font-medium text-white dark:text-slate-900 disabled:opacity-50 cursor-pointer">
      {children}
    </button>
  )
}
const inputCls = 'rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white'

function VideoGrid({ videos, onAsk }: { videos: Video[]; onAsk: (t: string) => void }) {
  if (!videos.length) return null
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {videos.map((v) => <VideoCard key={v.url} v={v} onAsk={onAsk} />)}
    </div>
  )
}

const toolLabel = (cmd: string) => {
  const m = String(cmd).match(/cli\.cjs\s+([\w-]+)\s*(.*)/)
  if (!m) return String(cmd).slice(0, 80)
  const names: Record<string, string> = { search: '動画を検索', account: 'アカウントを確認', tracked: '監視アカウントを確認', detail: '詳細を確認', hook: 'フックを取得', transcript: '字幕を取得', agents: 'エージェントを確認', results: '保存済みの結果を確認', 'save-asset': '保存物に保存' }
  return `${names[m[1]] || m[1]}: ${m[2].split('<<')[0].slice(0, 70)}`
}

export default function ViralResearch() {
  const [tab, setTab] = useState<Tab>('copilot')
  const [localOnly, setLocalOnly] = useState(false)
  const [agents, setAgents] = useState<Agent[]>([])
  const [tracked, setTracked] = useState<Tracked[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [threads, setThreads] = useState<Thread[]>([])

  // Copilot
  const [threadId, setThreadId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // 検索・エージェント・監視・保存物
  const [query, setQuery] = useState('')
  const [period, setPeriod] = useState('quarter')
  const [progress, setProgress] = useState('')
  const [searching, setSearching] = useState(false)
  const [videos, setVideos] = useState<Video[]>([])
  const [agName, setAgName] = useState('')
  const [agBrief, setAgBrief] = useState('')
  const [agQueries, setAgQueries] = useState('')
  const [agSchedule, setAgSchedule] = useState('daily')
  const [accInput, setAccInput] = useState('')
  const [openAsset, setOpenAsset] = useState<Asset | null>(null)

  async function refresh() {
    try {
      const s = await api<{ agents: Agent[]; tracked: Tracked[]; assets: Asset[]; threads: Thread[] }>('/state')
      setAgents(s.agents); setTracked(s.tracked); setAssets(s.assets); setThreads(s.threads)
    } catch (e) {
      if ((e as Error).message === 'local_only') setLocalOnly(true)
    }
  }
  useEffect(() => { refresh() }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages])

  function switchTab(t: Tab) { setTab(t); setProgress(''); setVideos([]); setOpenAsset(null) }

  async function send(text?: string) {
    const msg = (text ?? input).trim()
    if (!msg || busy) return
    setTab('copilot')
    setBusy(true)
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: msg }, { role: 'assistant', text: '', videos: [], tools: [] }])
    const update = (fn: (a: ChatMsg) => ChatMsg) => setMessages((m) => [...m.slice(0, -1), fn(m[m.length - 1])])
    try {
      await streamApi('/chat', { threadId, message: msg }, (ev) => {
        if (ev.type === 'thread' && ev.id) setThreadId(ev.id)
        if (ev.type === 'text') update((a) => ({ ...a, text: a.text + (ev.text || '') }))
        if (ev.type === 'tool') update((a) => ({ ...a, tools: [...(a.tools || []), ev.command || ''] }))
        if (ev.type === 'videos') update((a) => {
          const seen = new Set((a.videos || []).map((v) => v.url))
          const add = (ev.videos || []).filter((v) => !seen.has(v.url))
          return { ...a, videos: [...(a.videos || []), ...add].slice(0, 12) }
        })
        if (ev.type === 'error') update((a) => ({ ...a, error: ev.message }))
      })
    } catch (e) {
      update((a) => ({ ...a, error: (e as Error).message }))
    }
    setBusy(false)
    refresh()
  }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
  }
  async function openThread(id: string) {
    const t = await api<{ id: string; messages: ChatMsg[] }>(`/threads/${id}`)
    setTab('copilot'); setThreadId(t.id); setMessages(t.messages)
  }

  async function runStream(path: string, body: unknown) {
    setSearching(true); setVideos([]); setProgress('開始します…')
    try {
      await streamApi(path, body, (ev) => {
        if (ev.type === 'progress') setProgress(ev.message || '')
        if (ev.type === 'videos') { setVideos(ev.videos || []); setProgress(`${(ev.videos || []).length}本見つかりました(外れ値スコア順)`) }
        if (ev.type === 'error') setProgress(`エラー: ${ev.message}`)
      })
    } catch (e) { setProgress(`エラー: ${(e as Error).message}`) }
    setSearching(false)
    refresh()
  }
  const splitQueries = (s: string) => s.split(/[,、]/).map((x) => x.trim()).filter(Boolean)

  async function suggest() {
    if (!agBrief.trim()) return
    setSearching(true); setProgress('検索語を考えています…')
    try {
      const r = await api<{ queries: string[] }>('/agents/suggest', { method: 'POST', body: JSON.stringify({ brief: agBrief }) })
      setAgQueries(r.queries.join(', ')); setProgress('検索語を直してから登録できます')
    } catch (e) { setProgress(`エラー: ${(e as Error).message}`) }
    setSearching(false)
  }
  async function saveAgent() {
    const queries = splitQueries(agQueries)
    if (!queries.length) { setProgress('検索語を入れてください'); return }
    const a = await api<Agent>('/agents', { method: 'POST', body: JSON.stringify({ name: agName || queries[0], brief: agBrief, queries, schedule: agSchedule }) })
    setAgName(''); setAgBrief(''); setAgQueries('')
    runStream(`/agents/${a.id}/run`, {})
  }
  async function showAgentResults(id: string) {
    const r = await api<{ at: string; videos: Video[] } | null>(`/agents/${id}/results`)
    setVideos(r?.videos || []); setProgress(r ? `${day(r.at)} 時点の結果` : 'まだ結果がありません')
  }
  async function addAccount() {
    setSearching(true); setProgress('取得中…(TikTokは30秒ほど)')
    try {
      const r = await api<{ name: string; videos: Video[] }>('/tracked', { method: 'POST', body: JSON.stringify({ input: accInput }) })
      setAccInput(''); setProgress(`${r.name}: 直近${r.videos.length}本(スコア順)`)
      setVideos([...r.videos].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)))
    } catch (e) { setProgress(`エラー: ${(e as Error).message}`) }
    setSearching(false)
    refresh()
  }
  async function showAccount(a: Tracked, refreshIt = false) {
    setSearching(true); setProgress('取得中…')
    try {
      const r = await api<{ name: string; videos: Video[] }>(`/tracked/videos?platform=${a.platform}&handle=${encodeURIComponent(a.handle)}${refreshIt ? '&refresh=1' : ''}`)
      setProgress(`${r.name}: 直近${r.videos.length}本(スコア順)`)
      setVideos([...r.videos].sort((x, y) => (y.score ?? 0) - (x.score ?? 0)))
    } catch (e) { setProgress(`エラー: ${(e as Error).message}`) }
    setSearching(false)
  }

  if (localOnly) {
    return (
      <ToolLayout title="バズリサーチ">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-6 text-sm text-slate-700 dark:text-slate-300 space-y-2">
          <p className="font-semibold">このツールは Mac で business-hub を起動したときだけ使えます。</p>
          <p>動画データの取得(yt-dlp)と Copilot(Claude Code)を Mac の中で動かしているためです。Mac で business-hub を起動し、localhost の画面から開いてください。</p>
        </div>
      </ToolLayout>
    )
  }

  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: 'copilot', label: 'Copilot', icon: <Sparkles size={16} /> },
    { id: 'search', label: 'ニッチ検索', icon: <Search size={16} /> },
    { id: 'agents', label: 'リサーチエージェント', icon: <Bot size={16} /> },
    { id: 'tracked', label: '監視アカウント', icon: <Users size={16} /> },
    { id: 'assets', label: '保存物', icon: <FileText size={16} /> },
  ]
  const progressLine = progress && (
    <p className={`mt-3 text-sm ${progress.startsWith('エラー') ? 'text-red-600' : 'text-slate-500 dark:text-slate-400'}`}>
      {searching && <Loader2 size={14} className="mr-1 inline animate-spin" />}{progress}
    </p>
  )

  return (
    <ToolLayout title="バズリサーチ">
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        YouTube / TikTok で、投稿者の普段の再生数に比べて何倍伸びたか(外れ値スコア)で動画を探し、Copilot にフック分析や台本づくりを頼めます。
      </p>
      <div className="mb-6 flex flex-wrap gap-2 print:hidden">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => switchTab(t.id)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm cursor-pointer ${tab === t.id ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-white text-slate-700 border border-slate-200 dark:bg-slate-950 dark:text-slate-300 dark:border-slate-800'}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {tab === 'copilot' && (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SmallButton onClick={() => { setThreadId(null); setMessages([]) }}><Plus size={12} />新しい会話</SmallButton>
            {threads.slice(0, 6).map((t) => (
              <button key={t.id} onClick={() => openThread(t.id)} className="max-w-[220px] truncate rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">{t.title}</button>
            ))}
          </div>
          {!messages.length && (
            <div className="flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-left text-xs text-slate-700 dark:text-slate-300 hover:border-blue-500 cursor-pointer">{s}</button>
              ))}
            </div>
          )}
          <div className="mt-4 space-y-4">
            {messages.map((m, i) => m.role === 'user' ? (
              <div key={i} className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-slate-900 dark:bg-white px-4 py-2 text-sm text-white dark:text-slate-900">{m.text}</div>
            ) : (
              <div key={i} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4">
                {!!m.tools?.length && (
                  <div className="mb-2 space-y-0.5 text-xs text-slate-500">{m.tools.map((c, j) => <p key={j}>&gt; {toolLabel(c)}</p>)}</div>
                )}
                {m.text ? <Markdown text={m.text} /> : !m.error && busy && i === messages.length - 1 && (
                  <p className="text-sm text-slate-400"><Loader2 size={14} className="mr-1 inline animate-spin" />考えています…</p>
                )}
                {m.error && <p className="mt-2 text-sm text-red-600">{m.error}</p>}
                <VideoGrid videos={m.videos || []} onAsk={send} />
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <div className="sticky bottom-0 mt-4 flex items-end gap-2 bg-slate-50 dark:bg-slate-900 py-3">
            <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} rows={2}
              placeholder="例: 筋トレ系で今週伸びているフックは?(Enterで送信 / Shift+Enterで改行)" className={`${inputCls} flex-1 resize-y`} />
            <PrimaryButton onClick={() => send()} disabled={busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}送信</PrimaryButton>
          </div>
        </div>
      )}

      {tab === 'search' && (
        <div>
          <div className="flex flex-wrap gap-2">
            <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) runStream('/search', { queries: splitQueries(query), period }) }}
              placeholder="例: クレアチン, 筋トレ サプリ" className={`${inputCls} min-w-[240px] flex-1`} />
            <select value={period} onChange={(e) => setPeriod(e.target.value)} className={inputCls}>
              <option value="week">1週間</option><option value="month">1か月</option><option value="quarter">3か月</option><option value="year">1年</option><option value="any">期間なし</option>
            </select>
            <PrimaryButton onClick={() => runStream('/search', { queries: splitQueries(query), period })} disabled={searching || !query.trim()}><Search size={16} />検索</PrimaryButton>
          </div>
          <p className="mt-2 text-xs text-slate-500">カンマ区切りで複数キーワード。1キーワード40秒ほど。TikTok はキーワード検索ができないため、監視アカウントに登録して見ます。</p>
          {progressLine}
          <VideoGrid videos={videos} onAsk={send} />
        </div>
      )}

      {tab === 'agents' && (
        <div>
          <div className="space-y-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">探したいことを一文で書くと、検索語を考えて登録します。毎日・毎週の自動実行は、Mac の business-hub が動いている間に行われます。</p>
            <div className="flex flex-wrap gap-2">
              <input value={agName} onChange={(e) => setAgName(e.target.value)} placeholder="名前(例: クレアショット)" className={`${inputCls} w-52`} />
              <select value={agSchedule} onChange={(e) => setAgSchedule(e.target.value)} className={inputCls}>
                <option value="">手動</option><option value="daily">毎日</option><option value="weekly">毎週</option><option value="monthly">毎月</option>
              </select>
            </div>
            <textarea value={agBrief} onChange={(e) => setAgBrief(e.target.value)} rows={2} className={`${inputCls} w-full`}
              placeholder="例: クレアチンのサプリ『クレアショット』の広告ネタになる、伸びている筋トレ・サプリ系ショートを探したい" />
            <div className="flex flex-wrap gap-2">
              <SmallButton onClick={suggest} disabled={searching}>検索語を考える</SmallButton>
              <input value={agQueries} onChange={(e) => setAgQueries(e.target.value)} placeholder="検索語(カンマ区切り。自分で書いてもよい)" className={`${inputCls} min-w-[240px] flex-1`} />
              <PrimaryButton onClick={saveAgent} disabled={searching}><Play size={16} />登録して実行</PrimaryButton>
            </div>
          </div>
          {progressLine}
          <div className="mt-4 space-y-2">
            {agents.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">{a.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1">{a.queries.map((q) => <span key={q} className="rounded bg-blue-50 dark:bg-blue-950/50 px-2 text-xs text-blue-700 dark:text-blue-300">{q}</span>)}</div>
                  <p className="mt-1 text-xs text-slate-500">
                    {SCHEDULE_LABEL[a.schedule || ''] || '手動'} / 最終実行 {a.lastRunAt ? new Date(a.lastRunAt).toLocaleString() : 'なし'}{a.lastCount != null ? ` / ${a.lastCount}本` : ''}{a.running ? ' / 実行中' : ''}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <SmallButton onClick={() => showAgentResults(a.id)}>結果</SmallButton>
                  <SmallButton onClick={() => runStream(`/agents/${a.id}/run`, {})} disabled={searching}><RefreshCw size={12} />今すぐ実行</SmallButton>
                  <SmallButton onClick={async () => { if (confirm(`${a.name} を削除しますか?`)) { await api(`/agents/${a.id}`, { method: 'DELETE' }); refresh() } }}><Trash2 size={12} /></SmallButton>
                </div>
              </div>
            ))}
          </div>
          <VideoGrid videos={videos} onAsk={send} />
        </div>
      )}

      {tab === 'tracked' && (
        <div>
          <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">競合・参考にしたいクリエイター・自社アカウントを登録すると、その人の普段の再生数と比べて伸びた動画が分かります。</p>
          <div className="flex flex-wrap gap-2">
            <input value={accInput} onChange={(e) => setAccInput(e.target.value)} placeholder="@TikTokID / https://www.youtube.com/@チャンネル" className={`${inputCls} min-w-[260px] flex-1`} />
            <PrimaryButton onClick={addAccount} disabled={searching || !accInput.trim()}><Plus size={16} />登録</PrimaryButton>
          </div>
          {progressLine}
          <div className="mt-4 space-y-2">
            {tracked.map((a) => (
              <div key={`${a.platform}:${a.handle}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">{a.name || a.handle}</p>
                  <p className="text-xs text-slate-500">{a.platform === 'tiktok' ? 'TikTok' : 'YouTube'} / {a.handle}</p>
                </div>
                <div className="flex gap-1.5">
                  <SmallButton onClick={() => showAccount(a)} disabled={searching}>動画</SmallButton>
                  <SmallButton onClick={() => showAccount(a, true)} disabled={searching}><RefreshCw size={12} />最新に更新</SmallButton>
                  <SmallButton onClick={async () => { await api(`/tracked?platform=${a.platform}&handle=${encodeURIComponent(a.handle)}`, { method: 'DELETE' }); refresh() }}><Trash2 size={12} /></SmallButton>
                </div>
              </div>
            ))}
          </div>
          <VideoGrid videos={videos} onAsk={send} />
        </div>
      )}

      {tab === 'assets' && (
        <div>
          <p className="mb-3 text-sm text-slate-600 dark:text-slate-400 print:hidden">Copilot が作った台本・ブリーフ・レポート。開いて印刷すれば PDF にできます。</p>
          {!assets.length && <p className="text-sm text-slate-500">まだありません。Copilot に「台本にして保存して」と頼むとここに入ります。</p>}
          <div className="space-y-2 print:hidden">
            {assets.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">{a.title}</p>
                  <p className="text-xs text-slate-500">{KIND_LABEL[a.kind] || a.kind} / {new Date(a.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex gap-1.5">
                  <SmallButton onClick={async () => setOpenAsset(await api<Asset>(`/assets/${a.id}`))}>開く</SmallButton>
                  <SmallButton onClick={async () => { if (confirm('削除しますか?')) { await api(`/assets/${a.id}`, { method: 'DELETE' }); setOpenAsset(null); refresh() } }}><Trash2 size={12} /></SmallButton>
                </div>
              </div>
            ))}
          </div>
          {openAsset && (
            <div className="mt-4">
              <div className="mb-2 flex gap-1.5 print:hidden">
                <SmallButton onClick={() => navigator.clipboard.writeText(openAsset.body || '')}><Copy size={12} />コピー</SmallButton>
                <SmallButton onClick={() => window.print()}><Printer size={12} />印刷 / PDF</SmallButton>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-5"><Markdown text={openAsset.body || ''} /></div>
            </div>
          )}
        </div>
      )}
    </ToolLayout>
  )
}
