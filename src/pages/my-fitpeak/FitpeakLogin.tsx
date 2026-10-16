import { useEffect, useState, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useFitpeakAuth } from './lib/auth'
import { fitpeakSupabase } from './lib/supabase'
import { CheckCircle, MessageCircle } from 'lucide-react'

const LIFF_ID = import.meta.env.VITE_LIFF_ID || ''

// ログイン後の戻り先。My FITPEAK の中のパスだけ（外部サイトへの転送に使われないように）
function safeNext(v: string | null): string {
  return v && v.startsWith('/my-fitpeak') && !v.startsWith('//') ? v : '/my-fitpeak'
}

// スマホのブラウザ→LINEアプリでログインしたときに、この画面（元のブラウザ）へログインを引き渡す
const HANDOFF_KEY = 'myfp_line_handoff'
type Handoff = { id: string; pollKey: string; code: string; next: string; at: number }
const HANDOFF_TTL_MS = 10 * 60 * 1000
function readHandoff(): Handoff | null {
  try {
    const h = JSON.parse(sessionStorage.getItem(HANDOFF_KEY) || 'null') as Handoff | null
    if (h && h.id && h.pollKey && Date.now() - h.at < HANDOFF_TTL_MS) return h
  } catch { /* 読めなければ無し */ }
  try { sessionStorage.removeItem(HANDOFF_KEY) } catch { /* noop */ }
  return null
}
const isMobileBrowser = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

export default function FitpeakLogin() {
  const { user, signInWithPassword, signUp } = useFitpeakAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const nextPath = safeNext(searchParams.get('next'))
  const code = searchParams.get('code')

  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const [resetting, setResetting] = useState(false)

  // LINE連携関連
  const [lineUserId, setLineUserId] = useState<string | null>(null)
  const [lineDisplayName, setLineDisplayName] = useState('')
  const [linkDone, setLinkDone] = useState(false)
  const [linking, setLinking] = useState(false)
  const linkTriedRef = useRef(false)

  const isLineContext = !!lineUserId || !!code

  // LINEログイン（メール・パスワード不要）
  const [lineLoginLoading, setLineLoginLoading] = useState(false)
  const [handoffCode, setHandoffCode] = useState<string | null>(null)

  // LINEアプリでの承認を待つ。戻ってきた瞬間（画面が表に出たとき）にもすぐ確認する
  useEffect(() => {
    const h = readHandoff()
    if (!h) return
    setHandoffCode(h.code)
    setLineLoginLoading(true)
    let stopped = false
    let busy = false
    const check = async () => {
      if (stopped || busy || document.visibilityState === 'hidden') return
      busy = true
      try {
        const res = await fetch(`/api/my-fitpeak/auth/line/handoff/${encodeURIComponent(h.id)}/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pollKey: h.pollKey }),
        })
        const data = await res.json().catch(() => ({}))
        if (data.status === 'pending' && Date.now() - h.at < HANDOFF_TTL_MS) return
        stopped = true
        try { sessionStorage.removeItem(HANDOFF_KEY) } catch { /* noop */ }
        setHandoffCode(null)
        if (data.status === 'approved' && data.tokenHash) {
          const { error: otpError } = await fitpeakSupabase.auth.verifyOtp({ token_hash: data.tokenHash, type: 'magiclink' })
          setLineLoginLoading(false)
          if (otpError) { setError('LINEログインに失敗しました。お手数ですが、もう一度お試しください。'); return }
          navigate(h.next)
          return
        }
        setLineLoginLoading(false)
        setError(data.status === 'expired'
          ? '時間切れになりました。もう一度「LINEでログイン」を押してください。'
          : 'LINEログインを完了できませんでした。もう一度お試しください。')
      } catch { /* 通信エラーは次の確認で再試行 */ } finally { busy = false }
    }
    const timer = window.setInterval(check, 2000)
    const onVisible = () => { void check() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    window.addEventListener('pageshow', onVisible)
    void check()
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('pageshow', onVisible)
    }
  }, [navigate, handoffCode === null ? 0 : 1])

  // ブラウザでLINEログインから戻ってきたとき（#lt=<token_hash>）にセッションを作る
  useEffect(() => {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : ''
    if (!hash) return
    const params = new URLSearchParams(hash)
    const tokenHash = params.get('lt')
    if (!tokenHash) return
    const next = safeNext(params.get('next'))
    setLineLoginLoading(true)
    ;(async () => {
      const { error: otpError } = await fitpeakSupabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: 'magiclink',
      })
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      setLineLoginLoading(false)
      if (otpError) {
        setError('LINEログインに失敗しました。お手数ですが、もう一度お試しください。')
        return
      }
      navigate(next)
    })()
  }, [navigate])

  // LINEログインのエラー表示（コールバックからの戻り）
  useEffect(() => {
    const lineError = searchParams.get('line_error')
    if (lineError) setError(lineError)
  }, [searchParams])

  const handleLineLogin = async () => {
    setError('')
    setLineLoginLoading(true)
    try {
      // LINEアプリ内（LIFF）ならIDトークンでそのままログイン
      if (LIFF_ID) {
        try {
          const liff = (await import('@line/liff')).default
          await liff.init({ liffId: LIFF_ID })
          if (liff.isLoggedIn()) {
            const idToken = liff.getIDToken()
            const accessToken = liff.getAccessToken()
            if (idToken || accessToken) {
              const res = await fetch('/api/my-fitpeak/auth/line', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idToken, accessToken }),
              })
              const data = await res.json()
              if (!res.ok) throw new Error(data.error || 'LINEログインに失敗しました')
              const { error: otpError } = await fitpeakSupabase.auth.verifyOtp({
                token_hash: data.tokenHash,
                type: 'magiclink',
              })
              if (otpError) throw new Error(otpError.message)
              navigate(nextPath)
              return
            }
          }
        } catch (liffErr) {
          console.error('LIFF login error:', liffErr)
        }
      }
      // 通常のブラウザはLINEの認可画面へ。スマホはLINEアプリが開くので、ログインをこの画面へ引き渡す準備をする
      let h = ''
      if (isMobileBrowser()) {
        try {
          const r = await fetch('/api/my-fitpeak/auth/line/handoff', { method: 'POST' })
          const d = await r.json()
          if (r.ok && d.id && d.pollKey) {
            sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ id: d.id, pollKey: d.pollKey, code: d.code, next: nextPath, at: Date.now() }))
            setHandoffCode(d.code)
            h = `&h=${encodeURIComponent(d.id)}`
          }
        } catch { /* 引き渡しが用意できなくても、従来どおりLINEでログインは進める */ }
      }
      window.location.href = `/api/my-fitpeak/auth/line/start?redirect=${encodeURIComponent(nextPath)}${h}`
    } catch (err) {
      setError(err instanceof Error ? err.message : 'LINEログインに失敗しました')
      setLineLoginLoading(false)
    }
  }

  // LIFF初期化
  useEffect(() => {
    if (!LIFF_ID) return
    async function initLiff() {
      try {
        const liff = (await import('@line/liff')).default
        await liff.init({ liffId: LIFF_ID })
        if (!liff.isLoggedIn()) {
          if (!liff.isInClient()) return
          liff.login({ redirectUri: window.location.href })
          return
        }
        const profile = await liff.getProfile()
        setLineUserId(profile.userId)
        setLineDisplayName(profile.displayName)
      } catch (err) {
        console.error('LIFF init error:', err)
      }
    }
    initLiff()
  }, [])

  // コードフローでlineUserIdを取得
  useEffect(() => {
    if (!code || lineUserId) return
    async function verifyCode() {
      try {
        await fetch(`/api/my-fitpeak/line-link/verify?code=${code}`)
      } catch { /* ignore */ }
    }
    verifyCode()
  }, [code, lineUserId])

  // ログイン済み + LINE連携コンテキストの場合、自動でLINE連携を実行
  useEffect(() => {
    if (user && isLineContext && !linking && !linkDone && !linkTriedRef.current) {
      linkTriedRef.current = true
      performLineLink()
    }
  }, [user, isLineContext, linking, linkDone])

  // ログイン済み + 非LINEコンテキストならダッシュボードへリダイレクト
  // ただしLINEログインから戻ってきた直後（#lt=）は、その処理が終わるまで待つ
  useEffect(() => {
    if (user && !isLineContext && !lineLoginLoading && !window.location.hash.includes('lt=')) {
      navigate(nextPath)
    }
  }, [user, isLineContext, lineLoginLoading, navigate, nextPath])

  const performLineLink = async () => {
    if (!lineUserId && !code) return
    if (!email && !password) return
    setLinking(true)
    try {
      const res = await fetch('/api/my-fitpeak/line-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(lineUserId ? { lineUserId } : { code }),
          email: email.trim(),
          password,
        }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setLinkDone(true)
        setSuccess(data.message || 'LINE連携が完了しました')
      } else {
        setError(data.error || 'LINE連携に失敗しました')
      }
    } catch {
      setError('LINE連携中にエラーが発生しました')
    } finally {
      setLinking(false)
    }
  }

  const handleResetPassword = async () => {
    if (!email.trim()) { setError('上のメールアドレス欄に入力してから、もう一度押してください'); return }
    setResetting(true); setError(''); setSuccess('')
    try {
      const res = await fetch('/api/my-fitpeak/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'エラーが発生しました'); return }
      setSuccess('パスワードリセットメールを送信しました。メールをご確認ください。')
    } catch { setError('エラーが発生しました') }
    finally { setResetting(false) }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === 'reset') return
    setError('')
    setSuccess('')
    setLoading(true)

    try {
      if (mode === 'login') {
        const { error } = await signInWithPassword(email, password)
        if (error) {
          setError(error)
          return
        }
        // LINE連携が必要な場合
        if (isLineContext) {
          await performLineLink()
        }
        if (!linkDone) {
          navigate('/my-fitpeak')
        }
      } else {
        // 新規登録
        if (isLineContext) {
          // LINE連携モード: サーバーAPIで登録
          const res = await fetch('/api/my-fitpeak/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim(), password }),
          })
          const data = await res.json()
          if (!res.ok) {
            setError(data.error || '登録に失敗しました')
            return
          }
          // 登録成功 → ログイン試行
          const { error: loginErr } = await signInWithPassword(email, password)
          if (loginErr) {
            // メール確認が必要な場合
            setSuccess('アカウントを作成しました。確認メールをご確認の上、再度ログインしてLINE連携を行ってください。')
            return
          }
          // ログイン成功 → LINE連携
          await performLineLink()
          if (!linkDone) {
            navigate('/my-fitpeak')
          }
        } else {
          // 通常の新規登録
          const { error } = await signUp(email, password)
          if (error) {
            setError(error)
          } else {
            setSuccess('確認メールを送信しました。メール内のリンクをクリックして登録を完了してください。')
          }
        }
      }
    } catch (err) {
      console.error('handleSubmit error:', err)
      setError('エラーが発生しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }

  // LINE連携完了画面
  if (linkDone) {
    return (
      <div className="fp-root min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <img src="/fitpeak-logo.svg" alt="FITPEAK" className="h-10 mx-auto mb-2" />
            <p className="text-white/40 text-sm">My FITPEAK</p>
          </div>
          <div className="bg-[#151515] border border-white/10 rounded-2xl p-6 sm:p-8 text-center">
            <CheckCircle size={48} className="mx-auto text-[#06C755] mb-4" />
            <h2 className="text-lg font-semibold text-white mb-2">連携完了</h2>
            <p className="text-sm text-white/80 mb-6">{success}</p>
            <button
              type="button"
              onClick={() => navigate('/my-fitpeak')}
              className="w-full py-3 rounded-lg bg-[#c8a960] hover:bg-[#b89a55] text-black text-sm font-semibold transition"
            >
              Myページへ
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fp-root min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/fitpeak-logo.svg" alt="FITPEAK" className="h-10 mx-auto mb-2" />
          <p className="text-white/40 text-sm">My FITPEAK</p>
        </div>

        <div className="bg-[#151515] border border-white/10 rounded-2xl p-6 sm:p-8">
          {isLineContext && mode !== 'reset' && (
            <div className="flex items-center gap-3 mb-5 p-3 rounded-lg bg-[#06C755]/5 border border-[#06C755]/20">
              <MessageCircle size={20} className="text-[#06C755] shrink-0" />
              <div>
                <p className="text-xs text-[#06C755]">LINE連携モード</p>
                {lineDisplayName && (
                  <p className="text-xs text-white/90 mt-0.5">{lineDisplayName}</p>
                )}
                <p className="text-[10px] text-white/50 mt-0.5">ログインまたは会員登録するとLINEと自動連携されます</p>
              </div>
            </div>
          )}

          {mode === 'reset' ? (
            <div className="space-y-4">
              <h2 className="text-white text-sm font-semibold text-center">パスワードを再設定</h2>
              <p className="text-white/50 text-xs text-center leading-relaxed">
                登録済みのメールアドレスを入力してください。<br />パスワード再設定用のメールをお送りします。
              </p>

              <div>
                <label className="block text-xs font-medium text-white/50 mb-1.5">メールアドレス</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="example@email.com"
                  className="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/20 text-sm focus:outline-none focus:border-[#c8a960]/50 focus:ring-1 focus:ring-[#c8a960]/30 transition"
                />
              </div>

              {error && (
                <p className="text-red-400 text-xs bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>
              )}
              {success && (
                <p className="text-green-400 text-xs bg-green-400/10 px-3 py-2 rounded-lg">{success}</p>
              )}

              <button
                type="button"
                onClick={handleResetPassword}
                disabled={resetting || !email.trim()}
                className="w-full py-3 rounded-lg bg-[#c8a960] hover:bg-[#b89a55] text-black text-sm font-semibold transition disabled:opacity-50"
              >
                {resetting ? '送信中...' : 'リセットメールを送信'}
              </button>

              <button
                type="button"
                onClick={() => { setMode('login'); setError(''); setSuccess('') }}
                className="w-full text-center text-xs text-white/50 hover:text-white/80 underline underline-offset-4 cursor-pointer transition py-2"
              >
                ログインに戻る
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={handleLineLogin}
                disabled={lineLoginLoading}
                className="w-full mb-4 py-3 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <MessageCircle size={18} />
                {lineLoginLoading ? 'ログイン中...' : 'LINEでログイン'}
              </button>
              {handoffCode && (
                <p className="mb-4 -mt-1 text-xs leading-relaxed text-center opacity-80">
                  LINEアプリで番号 <b className="text-base">{handoffCode}</b> を確かめて「ログインする」を押し、この画面に戻ってください。自動でログインします。
                </p>
              )}

              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-px bg-white/10" />
                <span className="text-[10px] text-white/30">メールアドレスでログイン</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>

              <div className="flex gap-1 mb-6 bg-white/5 rounded-lg p-1">
                <button
                  type="button"
                  onClick={() => { setMode('login'); setError(''); setSuccess('') }}
                  className={`flex-1 py-2 text-sm font-medium rounded-md transition ${
                    mode === 'login' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'
                  }`}
                >
                  ログイン
                </button>
                <button
                  type="button"
                  onClick={() => { setMode('signup'); setError(''); setSuccess('') }}
                  className={`flex-1 py-2 text-sm font-medium rounded-md transition ${
                    mode === 'signup' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'
                  }`}
                >
                  会員登録
                </button>
              </div>

              <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-white/50 mb-1.5">メールアドレス</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="example@email.com"
                    className="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/20 text-sm focus:outline-none focus:border-[#c8a960]/50 focus:ring-1 focus:ring-[#c8a960]/30 transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/50 mb-1.5">パスワード</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    placeholder={mode === 'signup' ? '6文字以上' : ''}
                    className="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/20 text-sm focus:outline-none focus:border-[#c8a960]/50 focus:ring-1 focus:ring-[#c8a960]/30 transition"
                  />
                </div>

                {error && (
                  <p className="text-red-400 text-xs bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>
                )}
                {success && (
                  <p className="text-green-400 text-xs bg-green-400/10 px-3 py-2 rounded-lg">{success}</p>
                )}

                <button
                  type="submit"
                  disabled={loading || linking}
                  className={`w-full py-3 rounded-lg text-sm font-semibold transition disabled:opacity-50 ${
                    isLineContext
                      ? 'bg-[#06C755] hover:bg-[#05b34c] text-white'
                      : 'bg-[#c8a960] hover:bg-[#b89a55] text-black'
                  }`}
                >
                  {loading || linking
                    ? '処理中...'
                    : isLineContext
                      ? mode === 'login' ? 'ログインしてLINE連携' : '新規登録してLINE連携'
                      : mode === 'login' ? 'ログイン' : '会員登録'
                  }
                </button>
              </form>

              {mode === 'login' && (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPassword(''); setMode('reset'); setError(''); setSuccess('') }}
                  className="w-full text-center text-xs text-white/50 hover:text-white/80 underline underline-offset-4 cursor-pointer transition py-3 mt-2"
                >
                  パスワードを忘れた方はこちら
                </button>
              )}

              {mode === 'signup' && (
                <p className="text-white/30 text-xs mt-4 text-center leading-relaxed">
                  公式サイトでのご購入時と同じメールアドレスで登録すると、注文履歴や配送状況が自動で連携されます。
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
