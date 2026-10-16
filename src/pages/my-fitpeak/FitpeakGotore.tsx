import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Routes, Route, Link, useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { Bell, BellOff, ChevronLeft, Flag, MessageCircle, Send, ShieldCheck, Users } from 'lucide-react'
import { apiFetch } from './lib/api'

/**
 * 合トレナビ
 * fitpeak.co のジム店舗レビュー記事の枠から来る。ジムごとの掲示板 → 「合トレしたい」→ 募集者が承認 → 2人だけのチャット。
 * 連絡先はマッチするまで出さない。通知は公式LINEに届く。
 *   /my-fitpeak/gotore                 自分の募集・届いた申請・チャット・通知待ちのジム
 *   /my-fitpeak/gotore/gym/:handle     ジムの掲示板（?watch=1 で通知待ちを自動でオン、?new=1 で募集フォームを開く）
 *   /my-fitpeak/gotore/profile         プロフィールと規約への同意
 *   /my-fitpeak/gotore/chat/:id        チャット
 */

const API = '/api/my-fitpeak/gotore'
const GOLD = '#111'

export const SLOTS: Record<string, string> = { wd_am: '平日朝', wd_pm: '平日昼', wd_night: '平日夜', we_am: '土日朝', we_pm: '土日昼', we_night: '土日夜' }
export const PARTS: Record<string, string> = { chest: '胸', back: '背中', legs: '脚', shoulders: '肩', arms: '腕', full: '全身', cardio: '有酸素' }
export const GOALS: Record<string, string> = { spot: '補助してほしい', form: 'フォームを見てほしい', motivation: 'モチベーション維持', learn: '教わりたい', teach: '教えられます' }
const LEVELS: Record<string, string> = { beginner: '初心者', intermediate: '中級者', advanced: '上級者', competitor: '大会出場' }
const GENDERS: Record<string, string> = { male: '男性', female: '女性', none: '回答しない' }
const AGES: Record<string, string> = { '18-24': '18〜24歳', '25-34': '25〜34歳', '35-44': '35〜44歳', '45+': '45歳以上', none: '回答しない' }

type Gym = { handle: string; name: string; pref: string | null; city: string | null }
type Post = {
  id: string; nickname: string; gender: string; age_band: string; level: string; bio: string
  history?: string | null; fav_lifts?: string; usual_slots?: string[]; purposes?: string[]; city?: string | null; gyms?: string[]
  slots: string[]; parts: string[]; goals: string[]; gender_pref: string; note: string
  created_at: string; mine: boolean; requested: boolean
}
type Board = { gym: Gym; has_profile: boolean; my_gender: string | null; watching: boolean; watchers: number; posts: Post[] }

async function call<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await apiFetch(API + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || '通信に失敗しました')
  return j
}

const gymUrl = (h: string) => `/my-fitpeak/gotore/gym/${encodeURIComponent(h)}`
const articleUrl = (h: string) => `https://fitpeak.co/blogs/gym-review/${encodeURIComponent(h)}`
const ago = (iso: string) => {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60) return `${Math.max(m, 1)}分前`
  if (m < 1440) return `${Math.floor(m / 60)}時間前`
  return `${Math.floor(m / 1440)}日前`
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[20px] border border-[#e6e6e6] bg-white p-4 sm:p-5 ${className}`}>{children}</div>
}
function Chips({ items, map }: { items: string[]; map: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((k) => <span key={k} className="rounded-full bg-[#f3f3f3] px-2.5 py-1 text-xs text-[#222]">{map[k] || k}</span>)}
    </div>
  )
}
function Toggle({ options, value, onChange, multi }: { options: Record<string, string>; value: string[]; onChange: (v: string[]) => void; multi?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(options).map(([k, label]) => {
        const on = value.includes(k)
        return (
          <button key={k} type="button"
            onClick={() => onChange(multi ? (on ? value.filter((x) => x !== k) : [...value, k]) : [k])}
            className={`rounded-full border px-3 py-1.5 text-sm transition ${on ? 'border-[#111] bg-[#f2f2f2] text-[#111]' : 'border-[#d9d9d9] text-[#555] hover:text-[#111]'}`}>
            {label}
          </button>
        )
      })}
    </div>
  )
}
function ErrorText({ msg }: { msg: string }) {
  return msg ? <p className="text-sm text-[#c8102e]">{msg}</p> : null
}
function Spinner() {
  return <div className="flex justify-center py-16"><div className="h-7 w-7 animate-spin rounded-full border-2 border-[#111] border-t-transparent" /></div>
}
function Btn({ children, onClick, disabled, kind = 'gold', type = 'button' }: { children: ReactNode; onClick?: () => void; disabled?: boolean; kind?: 'gold' | 'ghost'; type?: 'button' | 'submit' }) {
  const cls = kind === 'gold'
    ? 'bg-[#111] text-white hover:bg-[#333]'
    : 'border border-[#d9d9d9] text-[#222] hover:text-[#111]'
  return <button type={type} onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-1.5 rounded-[14px] px-4 py-2.5 text-sm font-bold transition disabled:opacity-40 ${cls}`}>{children}</button>
}
function Back({ to, label }: { to: string; label: string }) {
  return <Link to={to} className="mb-4 inline-flex items-center gap-1 text-sm text-[#666] hover:text-[#111]"><ChevronLeft size={16} />{label}</Link>
}

// 通報（理由を聞いてから送る）とブロック
function SafetyMenu({ postId, matchId, onDone }: { postId?: string; matchId?: string; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState('')
  const target = { post_id: postId || null, match_id: matchId || null }
  const report = async () => {
    const reason = window.prompt('通報の理由を教えてください（例：出会い目的、迷惑行為、無断キャンセル）')
    if (!reason) return
    try { await call('/report', 'POST', { ...target, reason }); setMsg('通報を受け付けました。運営が確認します'); } catch (e: any) { setMsg(e.message) }
  }
  const block = async () => {
    if (!window.confirm('この人をブロックしますか？ お互いの募集が見えなくなり、チャットも終了します')) return
    try { await call('/block', 'POST', target); onDone() } catch (e: any) { setMsg(e.message) }
  }
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="p-1 text-[#808080] hover:text-[#111]" aria-label="通報・ブロック"><Flag size={15} /></button>
      {open && (
        <div className="absolute right-0 top-7 z-20 w-40 rounded-[14px] border border-[#e6e6e6] bg-white py-1 text-sm shadow-xl">
          <button type="button" onClick={report} className="block w-full px-4 py-2 text-left text-[#222] hover:bg-[#f3f3f3]">通報する</button>
          <button type="button" onClick={block} className="block w-full px-4 py-2 text-left text-[#c8102e] hover:bg-[#f3f3f3]">ブロックする</button>
        </div>
      )}
      {msg && <p className="absolute right-0 top-8 w-56 rounded-lg bg-black/90 p-2 text-xs text-white/80">{msg}</p>}
    </div>
  )
}

function Rules() {
  return (
    <div className="rounded-[14px] border border-[#e6e6e6] bg-[#f6f6f6] p-4 text-sm leading-relaxed text-[#444]">
      <p className="mb-2 flex items-center gap-1.5 font-bold text-[#111]"><ShieldCheck size={16} style={{ color: GOLD }} />合トレナビのルール</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>18歳以上の方だけが使えます。</li>
        <li>合トレ（一緒にトレーニングする相手さがし）専用です。恋愛・交際などの出会いを目的とした利用は禁止です。</li>
        <li>募集文やプロフィールに、電話番号・メール・LINE ID・SNSなどの連絡先は書けません。連絡は承認後のチャットで行ってください。</li>
        <li>初めて会うときは、そのジムの中で会いましょう。</li>
        <li>勧誘・営業・迷惑行為は禁止です。困ったときは通報・ブロックしてください。違反した方は利用を停止します。</li>
      </ul>
    </div>
  )
}

// ── プロフィール ──────────────────────────────────────────────────────────
// 表示名・性別・年代・市区町村・通っているジムは My FITPEAK アカウントのプロフィールから（ここでは合トレ固有の項目だけ）
const HISTORY: Record<string, string> = { '<1y': '1年未満', '1-3y': '1〜3年', '3-5y': '3〜5年', '5y+': '5年以上' }
type GotoreProfile = { level: string; bio: string; history: string; fav_lifts: string; usual_slots: string[]; purposes: string[] }

function accountUrl(next: string) { return `/my-fitpeak/account?next=${encodeURIComponent(next)}#profile` }

function ProfileForm({ initial, onSaved }: { initial?: Partial<GotoreProfile> | null; onSaved: () => void }) {
  const [p, setP] = useState<GotoreProfile>({ level: '', bio: '', history: '', fav_lifts: '', usual_slots: [], purposes: [], ...(initial || {}) } as GotoreProfile)
  const [agree, setAgree] = useState(!!initial)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const ok = p.level && agree
  const save = async () => {
    setErr(''); setBusy(true)
    try { await call('/profile', 'PUT', { ...p, agree }); onSaved() } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-5">
      <div><p className="mb-1.5 text-sm text-[#444]">レベル</p><Toggle options={LEVELS} value={[p.level]} onChange={(v) => setP({ ...p, level: v[0] })} /></div>
      <div><p className="mb-1.5 text-sm text-[#444]">トレーニング歴（任意）</p><Toggle options={HISTORY} value={[p.history || '']} onChange={(v) => setP({ ...p, history: v[0] })} /></div>
      <label className="block">
        <span className="mb-1.5 block text-sm text-[#444]">得意種目（任意・40文字まで）</span>
        <input value={p.fav_lifts || ''} maxLength={40} onChange={(e) => setP({ ...p, fav_lifts: e.target.value })}
          className="w-full rounded-[12px] border border-[#d2d2d7] bg-white px-3 py-2.5 text-[#111] outline-none focus:border-[#111]" placeholder="例：ベンチプレス・スクワット" />
      </label>
      <div><p className="mb-1.5 text-sm text-[#444]">よく行く時間帯（任意・複数可）</p><Toggle multi options={SLOTS} value={p.usual_slots || []} onChange={(v) => setP({ ...p, usual_slots: v })} /></div>
      <div><p className="mb-1.5 text-sm text-[#444]">合トレの目的（任意・複数可）</p><Toggle multi options={GOALS} value={p.purposes || []} onChange={(v) => setP({ ...p, purposes: v })} /></div>
      <label className="block">
        <span className="mb-1.5 block text-sm text-[#444]">自己紹介（任意・200文字まで）</span>
        <textarea value={p.bio} maxLength={200} rows={3} onChange={(e) => setP({ ...p, bio: e.target.value })}
          className="w-full rounded-[12px] border border-[#d2d2d7] bg-white px-3 py-2.5 text-[#111] outline-none focus:border-[#111]" placeholder="例：BIG3中心。週3で夜に通っています" />
      </label>
      <Rules />
      <label className="flex items-start gap-2 text-sm text-[#222]">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 accent-[#111]" />
        18歳以上であり、上のルールに同意します
      </label>
      <ErrorText msg={err} />
      <Btn onClick={save} disabled={!ok || busy}>{busy ? '保存中…' : '保存する'}</Btn>
    </div>
  )
}

// アカウントに足りない項目があるときのお願い（既に使っている人は使えなくはしない）
function AccountMissing({ missing, next }: { missing: string[]; next: string }) {
  if (!missing || !missing.length) return null
  return (
    <div className="mb-4 rounded-[14px] border border-[#111] bg-white p-4 text-sm leading-relaxed text-[#222]">
      <p className="font-bold text-[#111]">アカウントのプロフィールに未入力の項目があります</p>
      <p className="mt-1 text-[#555]">市区町村・通っているジム・お名前・メールアドレスなどを入力してください。お名前・メール・住所はほかの会員には表示されません。</p>
      <Link to={accountUrl(next)} className="mt-3 inline-block font-bold underline">アカウントのプロフィールを入力する</Link>
    </div>
  )
}

function ProfilePage() {
  const [me, setMe] = useState<any>(null)
  const [params] = useSearchParams()
  const nav = useNavigate()
  useEffect(() => { call('/me').then(setMe).catch(() => setMe({})) }, [])
  if (!me) return <Spinner />
  // LINEの案内から来た人（?b=掲示板ID）は、保存後にその掲示板へ
  const b = params.get('b')
  const next = b && /^[0-9a-f-]{36}$/i.test(b) ? `/my-fitpeak/gotore/b/${b}` : params.get('next')
  const here = `/my-fitpeak/gotore/profile${b ? `?b=${b}` : next ? `?next=${encodeURIComponent(next)}` : ''}`
  const missing: string[] = me.account_missing || []
  return (
    <div>
      <Back to={next || '/my-fitpeak/gotore'} label="戻る" />
      <h1 className="mb-1 text-[#111] text-[26px] sm:text-[30px] font-black tracking-[-0.01em] leading-tight">合トレのプロフィール</h1>
      <p className="mb-5 text-sm text-[#666]">掲示板で相手に見えるのは、アカウントの表示名・年代・性別・市区町村・通っているジムと、ここで登録した内容だけです。LINEの名前やアイコン、お名前・メール・住所は出ません。</p>
      {!me.profile && missing.length > 0 ? (
        <Card>
          <p className="text-sm leading-relaxed text-[#222]">合トレナビを使うには、先に My FITPEAK のアカウントのプロフィール（表示名・市区町村・通っているジム・年代・性別・お名前・メールアドレス）を登録してください。</p>
          <Link to={accountUrl(here)} className="mt-4 block"><Btn>アカウントのプロフィールを登録する</Btn></Link>
        </Card>
      ) : (
        <>
          <AccountMissing missing={missing} next={here} />
          {me.profile && (
            <p className="mb-4 text-sm text-[#444]">表示名：<b className="text-[#111]">{me.profile.nickname}</b>　{GENDERS[me.profile.gender] || ''}・{AGES[me.profile.age_band] || ''}
              <Link to={accountUrl(here)} className="ml-2 text-[#666] underline">アカウントで変更</Link></p>
          )}
          <Card><ProfileForm initial={me.profile} onSaved={() => nav(next && next.startsWith('/my-fitpeak/') ? next : '/my-fitpeak/gotore')} /></Card>
        </>
      )}
    </div>
  )
}

// ── ジムの掲示板 ──────────────────────────────────────────────────────────
function PostForm({ handle, myGender, onDone }: { handle: string; myGender: string | null; onDone: () => void }) {
  const [slots, setSlots] = useState<string[]>([])
  const [parts, setParts] = useState<string[]>([])
  const [goals, setGoals] = useState<string[]>([])
  const [same, setSame] = useState(false)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setErr(''); setBusy(true)
    try {
      await call('/posts', 'POST', { handle, slots, parts, goals, gender_pref: same ? 'same' : 'any', note })
      onDone()
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-4">
      <div><p className="mb-1.5 text-sm text-[#444]">行ける時間帯（複数可）</p><Toggle multi options={SLOTS} value={slots} onChange={setSlots} /></div>
      <div><p className="mb-1.5 text-sm text-[#444]">一緒にやりたい部位（任意）</p><Toggle multi options={PARTS} value={parts} onChange={setParts} /></div>
      <div><p className="mb-1.5 text-sm text-[#444]">目的（任意）</p><Toggle multi options={GOALS} value={goals} onChange={setGoals} /></div>
      <label className="block">
        <span className="mb-1.5 block text-sm text-[#444]">ひとこと（任意・200文字まで）</span>
        <textarea value={note} maxLength={200} rows={3} onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-[12px] border border-[#d2d2d7] bg-white px-3 py-2.5 text-[#111] outline-none focus:border-[#111]"
          placeholder={handle.startsWith('area:') ? '例：〇〇ジム渋谷店に通っています。ベンチの補助をお願いできる方を探しています' : '例：ベンチの補助をお願いできる方を探しています。重量は問いません'} />
      </label>
      {myGender && myGender !== 'none' && (
        <label className="flex items-center gap-2 text-sm text-[#222]">
          <input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} className="accent-[#111]" />
          同性（{GENDERS[myGender]}）の人にだけ表示する
        </label>
      )}
      <p className="text-xs text-[#6b6b6b]">募集は30日で自動的に締め切られます。連絡先は書けません。</p>
      <ErrorText msg={err} />
      <Btn onClick={submit} disabled={!slots.length || busy}>{busy ? '送信中…' : 'この内容で募集する'}</Btn>
    </div>
  )
}

function PostCard({ p, onChange, needProfile }: { p: Post; onChange: () => void; needProfile?: () => void }) {
  const [asking, setAsking] = useState(false)
  const [message, setMessage] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    setErr(''); setBusy(true)
    try { await call(`/posts/${p.id}/request`, 'POST', { message }); onChange() } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  const close = async () => {
    if (!window.confirm('この募集を締め切りますか？')) return
    try { await call(`/posts/${p.id}/close`, 'POST'); onChange() } catch (e: any) { setErr(e.message) }
  }
  return (
    <Card className={p.mine ? 'border-[#111]/30' : ''}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="font-bold text-[#111]">{p.nickname}{p.mine && <span className="ml-2 text-xs font-normal" style={{ color: GOLD }}>あなたの募集</span>}</p>
          <p className="text-xs text-[#666]">{[GENDERS[p.gender], AGES[p.age_band], LEVELS[p.level], p.history ? `歴${HISTORY[p.history] || ''}` : '', p.city || ''].filter((x) => x && x !== '回答しない').join('・')}・{ago(p.created_at)}</p>
        </div>
        {!p.mine && <SafetyMenu postId={p.id} onDone={onChange} />}
      </div>
      <div className="space-y-2">
        <Chips items={p.slots} map={SLOTS} />
        {p.parts.length > 0 && <Chips items={p.parts} map={PARTS} />}
        {p.goals.length > 0 && <Chips items={p.goals} map={GOALS} />}
        {p.note && <p className="whitespace-pre-wrap pt-1 text-sm text-[#222]">{p.note}</p>}
        {p.fav_lifts && <p className="text-xs text-[#6b6b6b]">得意種目：{p.fav_lifts}</p>}
        {p.gyms && p.gyms.length > 0 && <p className="text-xs text-[#6b6b6b]">通っているジム：{p.gyms.join('、')}</p>}
        {p.usual_slots && p.usual_slots.length > 0 && <p className="text-xs text-[#6b6b6b]">よく行く時間帯：{p.usual_slots.map((x) => SLOTS[x]).filter(Boolean).join('・')}</p>}
        {p.bio && <p className="text-xs text-[#6b6b6b]">自己紹介：{p.bio}</p>}
        {p.gender_pref === 'same' && <p className="text-xs text-[#6b6b6b]">同性のみの募集です</p>}
      </div>
      <div className="mt-4">
        {p.mine ? (
          <div className="flex flex-wrap gap-2">
            <Link to="/my-fitpeak/gotore"><Btn kind="ghost">届いた申請を見る</Btn></Link>
            <Btn kind="ghost" onClick={close}>締め切る</Btn>
          </div>
        ) : p.requested ? (
          <p className="text-sm" style={{ color: GOLD }}>申請済みです。承認されるとLINEでお知らせします</p>
        ) : asking ? (
          <div className="space-y-2">
            <textarea value={message} maxLength={200} rows={2} onChange={(e) => setMessage(e.target.value)}
              className="w-full rounded-[12px] border border-[#d2d2d7] bg-white px-3 py-2 text-sm text-[#111] outline-none focus:border-[#111]"
              placeholder="ひとこと（任意）例：火曜と木曜の夜なら行けます" />
            <ErrorText msg={err} />
            <div className="flex gap-2"><Btn onClick={send} disabled={busy}>送る</Btn><Btn kind="ghost" onClick={() => setAsking(false)}>やめる</Btn></div>
          </div>
        ) : (
          <Btn onClick={() => (needProfile ? needProfile() : setAsking(true))}><Users size={16} />合トレしたい</Btn>
        )}
      </div>
      {!asking && <ErrorText msg={err} />}
    </Card>
  )
}

function GymBoard() {
  const { handle = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const [b, setB] = useState<Board | null>(null)
  const [err, setErr] = useState('')
  const [showForm, setShowForm] = useState(params.get('new') === '1')
  const autoWatched = useRef(false)

  const load = useCallback(() => call<Board>(`/gyms/${encodeURIComponent(handle)}`).then(setB).catch((e) => setErr(e.message)), [handle])
  useEffect(() => {
    // 記事の「募集が出たらLINEで知らせる」から来たとき（?watch=1）は、ログイン後に自動で通知待ちをオンにする
    if (params.get('watch') === '1' && !autoWatched.current) {
      autoWatched.current = true
      call(`/gyms/${encodeURIComponent(handle)}/watch`, 'POST', { on: true }).finally(() => {
        params.delete('watch'); setParams(params, { replace: true }); load()
      })
    } else load()
  }, [handle]) // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <div><Back to="/my-fitpeak/gotore" label="合トレナビ" /><p className="text-[#555]">{err}</p></div>
  if (!b) return <Spinner />
  const mine = b.posts.some((p) => p.mine)
  const toggleWatch = async () => { await call(`/gyms/${encodeURIComponent(handle)}/watch`, 'POST', { on: !b.watching }); load() }
  const openForm = () => {
    if (!b.has_profile) { nav(`/my-fitpeak/gotore/profile?next=${encodeURIComponent(`${gymUrl(handle)}?new=1`)}`); return }
    setShowForm(true)
  }

  return (
    <div>
      <Back to="/my-fitpeak/gotore" label="合トレナビ" />
      <h1 className="text-[#111] text-[26px] sm:text-[30px] font-black tracking-[-0.01em] leading-tight">{b.gym.name}</h1>
      {handle.startsWith('area:') ? (
        <p className="mb-4 text-sm text-[#666]">
          {b.gym.pref}{b.gym.city || ''}のどのジムに通う人でも使えるエリア掲示板です。通っているジム名は「ひとこと」に書いてください。
          <a href={`https://fitpeak.co/pages/gym-area?pref=${encodeURIComponent(b.gym.pref || '')}${b.gym.city ? `&city=${encodeURIComponent(b.gym.city)}` : ''}`} className="ml-1 underline hover:text-[#111]">近くのジムを探す</a>
        </p>
      ) : (
        <p className="mb-4 text-sm text-[#666]">{b.gym.pref}{b.gym.city}・<a href={articleUrl(handle)} className="underline hover:text-[#111]">ジムの記事を見る</a></p>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <Card>
          <p className="text-sm text-[#555]">このジムの募集</p>
          <p className="text-2xl font-black text-[#111]">{b.posts.length}<span className="ml-1 text-sm font-normal text-[#666]">件</span></p>
          {!mine && !showForm && <div className="mt-3"><Btn onClick={openForm}>自分も募集する</Btn></div>}
        </Card>
        <Card>
          <p className="text-sm text-[#555]">募集が出たら知らせてほしい人</p>
          <p className="text-2xl font-black text-[#111]">{b.watchers}<span className="ml-1 text-sm font-normal text-[#666]">人</span></p>
          <div className="mt-3">
            <Btn kind={b.watching ? 'ghost' : 'gold'} onClick={toggleWatch}>
              {b.watching ? <><BellOff size={16} />通知をやめる</> : <><Bell size={16} />募集が出たらLINEで知らせる</>}
            </Btn>
          </div>
        </Card>
      </div>

      {showForm && (
        <Card className="mb-5">
          <p className="mb-4 font-bold text-[#111]">{b.gym.name}で合トレ仲間を募集する</p>
          <PostForm handle={handle} myGender={b.my_gender} onDone={() => { setShowForm(false); load() }} />
        </Card>
      )}

      <div className="space-y-3">
        {b.posts.map((p) => (
          <PostCard key={p.id} p={p} onChange={load}
            needProfile={b.has_profile ? undefined : () => nav(`/my-fitpeak/gotore/profile?next=${encodeURIComponent(gymUrl(handle))}`)} />
        ))}
        {b.posts.length === 0 && !showForm && (
          <Card className="text-center">
            <p className="mb-1 font-bold text-[#111]">まだ募集はありません</p>
            <p className="mb-4 text-sm text-[#555]">最初の1人になりませんか？ 募集を出すと、このジムの通知待ちの人{b.watchers > 0 ? `（${b.watchers}人）` : ''}にLINEで届きます。</p>
            <Btn onClick={openForm}>募集する</Btn>
          </Card>
        )}
      </div>
    </div>
  )
}

// LINEの案内の短いリンク（/my-fitpeak/gotore/b/<掲示板ID>）→ 掲示板へ
function ShortLink() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const [err, setErr] = useState('')
  useEffect(() => {
    call<{ handle: string }>(`/b/${encodeURIComponent(id)}`)
      .then((r) => nav(gymUrl(r.handle), { replace: true }))
      .catch((e) => setErr(e.message))
  }, [id, nav])
  if (err) return <div><Back to="/my-fitpeak/gotore" label="合トレナビ" /><p className="text-[#555]">{err}</p></div>
  return <Spinner />
}

// ── チャット ──────────────────────────────────────────────────────────────
function Chat() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const [m, setM] = useState<any>(null)
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const load = useCallback(() => call(`/matches/${id}`).then(setM).catch((e) => setErr(e.message)), [id])
  useEffect(() => {
    load()
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 10000)
    return () => clearInterval(t)
  }, [load])
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }) }, [m?.messages?.length])

  const send = async () => {
    if (!text.trim()) return
    setErr(''); setBusy(true)
    try { await call(`/matches/${id}/messages`, 'POST', { body: text }); setText(''); load() } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  if (err && !m) return <div><Back to="/my-fitpeak/gotore" label="戻る" /><p className="text-[#555]">{err}</p></div>
  if (!m) return <Spinner />
  return (
    <div>
      <Back to="/my-fitpeak/gotore" label="合トレナビ" />
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[#111] text-[26px] sm:text-[30px] font-black tracking-[-0.01em] leading-tight">{m.partner.nickname}さん</h1>
          <p className="text-xs text-[#666]">{[GENDERS[m.partner.gender], AGES[m.partner.age_band], LEVELS[m.partner.level]].filter((x) => x && x !== '回答しない').join('・')}・<Link to={gymUrl(m.gym.handle)} className="underline">{m.gym.name}</Link></p>
        </div>
        <SafetyMenu matchId={m.id} onDone={() => nav('/my-fitpeak/gotore')} />
      </div>
      <p className="mb-4 rounded-[14px] bg-[#f6f6f6] p-3 text-xs leading-relaxed text-[#555]">日時が決まったら、初回は{m.gym.name}の中で待ち合わせましょう。合トレ以外の誘い・勧誘があったら、右上から通報・ブロックできます。</p>
      <div className="mb-4 space-y-2">
        {m.messages.map((x: any, i: number) => (
          <div key={i} className={`flex ${x.mine ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] whitespace-pre-wrap rounded-[20px] px-3.5 py-2 text-sm ${x.mine ? 'bg-[#111] text-white' : 'bg-[#eeeeee] text-[#111]'}`}>
              {x.body}
              <div className={`mt-0.5 text-[10px] ${x.mine ? 'text-white/60' : 'text-[#6b6b6b]'}`}>{ago(x.at)}</div>
            </div>
          </div>
        ))}
        {m.messages.length === 0 && <p className="py-6 text-center text-sm text-[#666]">マッチしました。まずはあいさつと、行ける曜日・時間を送ってみましょう。</p>}
        <div ref={bottom} />
      </div>
      {m.closed ? (
        <p className="text-center text-sm text-[#666]">このチャットは終了しています</p>
      ) : (
        <div className="sticky bottom-0 flex gap-2 bg-white py-2">
          <textarea value={text} maxLength={500} rows={1} onChange={(e) => setText(e.target.value)}
            className="flex-1 min-w-0 resize-none rounded-[12px] border border-[#d2d2d7] bg-white px-3 py-2.5 text-sm text-[#111] outline-none focus:border-[#111]" placeholder="メッセージ" />
          <Btn onClick={send} disabled={busy || !text.trim()}><Send size={16} /></Btn>
        </div>
      )}
      <ErrorText msg={err} />
    </div>
  )
}

// ── トップ（自分の状況）──────────────────────────────────────────────────
function Home() {
  const [me, setMe] = useState<any>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => call('/me').then(setMe).catch((e) => setErr(e.message)), [])
  useEffect(() => { load() }, [load])
  if (err) return <p className="text-[#555]">{err}</p>
  if (!me) return <Spinner />

  const answer = async (rid: string, accept: boolean) => {
    try { await call(`/requests/${rid}/answer`, 'POST', { accept }); load() } catch (e: any) { alert(e.message) }
  }
  const pending = me.posts.flatMap((p: any) => p.requests.filter((r: any) => r.status === 'pending').map((r: any) => ({ ...r, gym: p.gym })))
  const openPosts = me.posts.filter((p: any) => p.status === 'open')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-[#111] text-[26px] sm:text-[30px] font-black tracking-[-0.01em] leading-tight"><Users size={20} style={{ color: GOLD }} />合トレナビ</h1>
        <p className="mt-1 text-sm text-[#666]">同じジムに通う人と、一緒にトレーニングする相手を見つけられます。</p>
      </div>

      {me.profile && <AccountMissing missing={me.account_missing || []} next="/my-fitpeak/gotore" />}

      {!me.profile && (
        <Card className="border-[#111]/30">
          <p className="mb-1 font-bold text-[#111]">まずはプロフィールを登録しましょう</p>
          <p className="mb-3 text-sm text-[#555]">募集や「合トレしたい」を送るのに必要です（1分で終わります）。</p>
          <Link to="/my-fitpeak/gotore/profile"><Btn>プロフィールを登録する</Btn></Link>
        </Card>
      )}

      {pending.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold text-[#444]">届いた「合トレしたい」</h2>
          <div className="space-y-3">
            {pending.map((r: any) => (
              <Card key={r.id}>
                <p className="font-bold text-[#111]">{r.nickname}<span className="ml-2 text-xs font-normal text-[#666]">{[GENDERS[r.gender], AGES[r.age_band], LEVELS[r.level]].filter((x) => x && x !== '回答しない').join('・')}</span></p>
                <p className="text-xs text-[#666]">{r.gym.name}・{ago(r.created_at)}</p>
                {r.message && <p className="mt-2 whitespace-pre-wrap text-sm text-[#222]">{r.message}</p>}
                {r.bio && <p className="mt-1 text-xs text-[#6b6b6b]">自己紹介：{r.bio}</p>}
                <div className="mt-3 flex gap-2"><Btn onClick={() => answer(r.id, true)}>承認してチャットする</Btn><Btn kind="ghost" onClick={() => answer(r.id, false)}>見送る</Btn></div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {me.matches.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold text-[#444]">チャット</h2>
          <div className="space-y-2">
            {me.matches.map((m: any) => (
              <Link key={m.id} to={`/my-fitpeak/gotore/chat/${m.id}`} className="block">
                <Card className="hover:border-[#111]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-[#111]">{m.partner_nickname}さん<span className="ml-2 text-xs font-normal text-[#6b6b6b]">{m.gym.name}</span></p>
                      <p className="truncate text-sm text-[#666]">{m.closed ? '終了したチャット' : (m.last_message || 'マッチしました。あいさつを送りましょう')}</p>
                    </div>
                    <MessageCircle size={18} className="shrink-0 text-[#808080]" />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-bold text-[#444]">あなたの募集</h2>
        {openPosts.length === 0 ? <p className="text-sm text-[#6b6b6b]">出している募集はありません。ジムの記事か、下の「通知待ちのジム」から募集できます。</p> : (
          <div className="space-y-2">
            {openPosts.map((p: any) => (
              <Link key={p.id} to={gymUrl(p.gym.handle)} className="block"><Card className="hover:border-[#111]">
                <p className="font-bold text-[#111]">{p.gym.name}</p>
                <p className="text-xs text-[#666]">{p.slots.map((s: string) => SLOTS[s]).join('・')}・申請{p.requests.length}件・{new Date(p.expires_at).toLocaleDateString('ja-JP')}まで</p>
              </Card></Link>
            ))}
          </div>
        )}
      </section>

      {me.sent.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold text-[#444]">送った「合トレしたい」</h2>
          <div className="space-y-2">
            {me.sent.map((r: any) => (
              <Card key={r.id}>
                <p className="text-sm text-[#111]">{r.nickname}さん（{r.gym.name}）</p>
                <p className="text-xs" style={{ color: r.status === 'accepted' ? GOLD : undefined }}>
                  {r.status === 'pending' ? '返事待ち' : r.status === 'accepted' ? <Link to={`/my-fitpeak/gotore/chat/${r.match_id}`} className="underline">承認されました。チャットを開く</Link> : '今回は見送られました'}
                </p>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-bold text-[#444]">通知待ちのジム</h2>
        {me.watches.length === 0 ? <p className="text-sm text-[#6b6b6b]">fitpeak.co のジム記事で「募集が出たらLINEで知らせる」を押すと、ここに入ります。</p> : (
          <div className="space-y-2">
            {me.watches.map((g: any) => (
              <Link key={g.handle} to={gymUrl(g.handle)} className="block"><Card className="hover:border-[#111]">
                <div className="flex items-center justify-between"><div><p className="font-bold text-[#111]">{g.name}</p><p className="text-xs text-[#666]">{g.pref}{g.city}</p></div>
                  <span className="text-sm" style={{ color: GOLD }}>募集{g.open_posts}件</span></div>
              </Card></Link>
            ))}
          </div>
        )}
        <p className="mt-3 text-sm"><a href="https://fitpeak.co/pages/gym-navi" className="underline text-[#555] hover:text-[#111]">ジムナビで近くのジムを探す</a></p>
      </section>

      {me.profile && <p className="text-sm"><Link to="/my-fitpeak/gotore/profile" className="text-[#666] underline hover:text-[#111]">プロフィールを編集</Link></p>}
      <Rules />
    </div>
  )
}

export default function FitpeakGotore() {
  return (
    <Routes>
      <Route index element={<Home />} />
      <Route path="profile" element={<ProfilePage />} />
      <Route path="gym/:handle" element={<GymBoard />} />
      <Route path="b/:id" element={<ShortLink />} />
      <Route path="chat/:id" element={<Chat />} />
    </Routes>
  )
}
