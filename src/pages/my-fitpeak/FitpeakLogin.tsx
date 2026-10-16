import { useEffect, useState, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useFitpeakAuth } from './lib/auth'
import { fitpeakSupabase } from './lib/supabase'
import { CheckCircle, MessageCircle } from 'lucide-react'
import { apiUrl, assetUrl, isEmbedded, loginHash, clearLoginHash } from './lib/embed'

// LIFF は my.fitpeak.co でしか動かないので、fitpeak.co に埋め込んだときは使わない
const LIFF_ID = isEmbedded() ? '' : (import.meta.env.VITE_LIFF_ID || '')

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
// LINEアプリ内のブラウザは除く（LINEの中なら、そのままLINEでログインできるので引き渡しは要らない）
const isMobileBrowser = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) && !/\bLine\//i.test(navigator.userAgent)

export default function FitpeakLogin() {
  // タブ名（管理ツールの「業務ツール」のままにしない）
  useEffect(() => {
    const prev = document.title
    document.title = 'ログイン | My FITPEAK'
    return () => { document.title = prev }
  }, [])
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
        const res = await fetch(apiUrl(`/api/my-fitpeak/auth/line/handoff/${encodeURIComponent(h.id)}/claim`), {
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
    const rawHash = loginHash()
    const hash = rawHash.startsWith('#') ? rawHash.slice(1) : ''
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
      clearLoginHash()
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
              const res = await fetch(apiUrl('/api/my-fitpeak/auth/line'), {
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
          const r = await fetch(apiUrl('/api/my-fitpeak/auth/line/handoff'), { method: 'POST' })
          const d = await r.json()
          if (r.ok && d.id && d.pollKey) {
            sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ id: d.id, pollKey: d.pollKey, code: d.code, next: nextPath, at: Date.now() }))
            setHandoffCode(d.code)
            h = `&h=${encodeURIComponent(d.id)}`
          }
        } catch { /* 引き渡しが用意できなくても、従来どおりLINEでログインは進める */ }
      }
      window.location.href = apiUrl(`/api/my-fitpeak/auth/line/start?redirect=${encodeURIComponent(nextPath)}${h}`)
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
        await fetch(apiUrl(`/api/my-fitpeak/line-link/verify?code=${code}`))
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
    if (user && !isLineContext && !lineLoginLoading && !loginHash().includes('lt=')) {
      navigate(nextPath)
    }
  }, [user, isLineContext, lineLoginLoading, navigate, nextPath])

  const performLineLink = async () => {
    if (!lineUserId && !code) return
    if (!email && !password) return
    setLinking(true)
    try {
      // LINEユーザーはサーバーがLIFFのトークンで確かめる（IDそのものは送らない）
      let liffAccessToken: string | null = null
      if (lineUserId) {
        const liff = (await import('@line/liff')).default
        liffAccessToken = liff.getAccessToken()
      }
      const res = await fetch(apiUrl('/api/my-fitpeak/line-link'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(liffAccessToken ? { liffAccessToken } : { code }),
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
      const res = await fetch(apiUrl('/api/my-fitpeak/auth/reset-password'), {
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
          const res = await fetch(apiUrl('/api/my-fitpeak/auth/signup'), {
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
      <div className="fp-root min-h-screen bg-white flex flex-col">
      {/* fitpeak.co に埋め込んだときはテーマのヘッダーがあるので出さない */}
      {!isEmbedded() && (
      <header className="bg-[#0b0b0b]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-12 sm:h-14 flex items-center">
          <a href="https://fitpeak.co" aria-label="FITPEAK 公式サイトへ" className="inline-flex items-center min-h-[44px]">
            <img src={assetUrl('/fitpeak-wordmark-white.png')} alt="FITPEAK" className="h-[17px] sm:h-5 w-auto" />
          </a>
        </div>
      </header>
      )}
      <div className="flex-1 flex items-center justify-center px-5 py-12">
        <div className="fp-rise w-full max-w-[400px]">
          <div className="text-center">
            <CheckCircle size={52} strokeWidth={1.6} className="mx-auto text-[#047d3b] mb-5" />
            <p className="text-xs font-bold tracking-[0.14em] text-[#6b6b6b]">MY FITPEAK</p>
            <h2 className="mt-2 text-[28px] font-black tracking-[-0.01em] leading-tight text-[#111]">連携完了</h2>
            <p className="mt-3 mb-8 text-[15px] leading-relaxed text-[#444]">{success}</p>
            <button
              type="button"
              onClick={() => navigate('/my-fitpeak')}
              className="w-full h-12 rounded-full bg-[#111] hover:bg-[#333] text-white text-[15px] font-bold transition-colors"
            >
              Myページへ
            </button>
          </div>
        </div>
      </div>
      </div>
    )
  }

  return (
    <div className="fp-root min-h-screen bg-white flex flex-col">
      {/* fitpeak.co に埋め込んだときはテーマのヘッダーがあるので出さない */}
      {!isEmbedded() && (
      <header className="bg-[#0b0b0b]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-12 sm:h-14 flex items-center">
          <a href="https://fitpeak.co" aria-label="FITPEAK 公式サイトへ" className="inline-flex items-center min-h-[44px]">
            <img src={assetUrl('/fitpeak-wordmark-white.png')} alt="FITPEAK" className="h-[17px] sm:h-5 w-auto" />
          </a>
        </div>
      </header>
      )}
      <div className="flex-1 flex items-start sm:items-center justify-center px-5 pt-12 pb-16 sm:py-16">
      <div className="fp-rise w-full max-w-[400px]">
        <div className="text-center mb-9">
          <p className="text-xs font-bold tracking-[0.14em] text-[#6b6b6b]">MY FITPEAK</p>
          <h1 className="mt-2 text-[30px] sm:text-[34px] font-black tracking-[-0.01em] leading-tight text-[#111]">
            {mode === 'reset' ? 'パスワードの再設定' : mode === 'signup' ? '会員登録' : 'ログイン'}
          </h1>
          <p className="mt-3 text-[15px] text-[#666]">ご注文・ポイント・合トレをひとつの場所で。</p>
        </div>

        <div>
          {isLineContext && mode !== 'reset' && (
            <div className="flex items-center gap-3 mb-6 p-4 rounded-[16px] bg-[#06C755]/[0.06]">
              <MessageCircle size={20} className="text-[#047d3b] shrink-0" />
              <div>
                <p className="text-xs text-[#047d3b]">LINE連携モード</p>
                {lineDisplayName && (
                  <p className="text-xs text-[#222] mt-0.5">{lineDisplayName}</p>
                )}
                <p className="text-[10px] text-[#666] mt-0.5">ログインまたは会員登録するとLINEと自動連携されます</p>
              </div>
            </div>
          )}

          {mode === 'reset' ? (
            <div className="space-y-5">
              <p className="text-[#666] text-sm text-center leading-relaxed">
                登録済みのメールアドレスを入力してください。<br />パスワード再設定用のメールをお送りします。
              </p>

              <div>
                <label className="block text-xs font-bold text-[#444] mb-2">メールアドレス</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="example@email.com"
                  className="w-full h-12 px-4 rounded-[12px] bg-white border border-[#d2d2d7] text-[#111] placeholder-[#aaa] text-sm focus:outline-none focus:border-[#111] focus:ring-4 focus:ring-black/[0.06] transition"
                />
              </div>

              {error && (
                <p className="text-[#c8102e] text-xs bg-[#c8102e]/5 px-4 py-3 rounded-[12px]">{error}</p>
              )}
              {success && (
                <p className="text-[#067a3a] text-xs bg-[#06c755]/10 px-4 py-3 rounded-[12px]">{success}</p>
              )}

              <button
                type="button"
                onClick={handleResetPassword}
                disabled={resetting || !email.trim()}
                className="w-full h-12 rounded-full bg-[#111] hover:bg-[#333] text-white text-[15px] font-bold transition-colors disabled:opacity-40"
              >
                {resetting ? '送信中...' : 'リセットメールを送信'}
              </button>

              <button
                type="button"
                onClick={() => { setMode('login'); setError(''); setSuccess('') }}
                className="w-full text-center text-xs text-[#666] hover:text-[#111] underline underline-offset-4 cursor-pointer transition py-2"
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
                className="w-full mb-4 h-12 rounded-full bg-[#06C755] hover:bg-[#05b34c] text-white text-[15px] font-bold transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
              >
                <MessageCircle size={18} />
                {lineLoginLoading ? 'ログイン中...' : 'LINEでログイン'}
              </button>
              {handoffCode && (
                <p className="mb-4 -mt-1 text-xs leading-relaxed text-center text-[#444]">
                  LINEアプリで番号 <b className="text-base">{handoffCode}</b> を確かめて「ログインする」を押し、この画面に戻ってください。自動でログインします。
                </p>
              )}

              <div className="flex items-center gap-3 my-6">
                <div className="flex-1 h-px bg-[#e5e5ea]" />
                <span className="text-[11px] text-[#6b6b6b]">メールアドレスでログイン</span>
                <div className="flex-1 h-px bg-[#e5e5ea]" />
              </div>

              <div className="flex gap-1 mb-6 bg-[#f0f0f2] rounded-full p-1">
                <button
                  type="button"
                  onClick={() => { setMode('login'); setError(''); setSuccess('') }}
                  className={`flex-1 h-9 text-sm font-bold rounded-full transition-all duration-200 ${
                    mode === 'login' ? 'bg-white text-[#111] shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#6b6b6b] hover:text-[#111]'
                  }`}
                >
                  ログイン
                </button>
                <button
                  type="button"
                  onClick={() => { setMode('signup'); setError(''); setSuccess('') }}
                  className={`flex-1 h-9 text-sm font-bold rounded-full transition-all duration-200 ${
                    mode === 'signup' ? 'bg-white text-[#111] shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-[#6b6b6b] hover:text-[#111]'
                  }`}
                >
                  会員登録
                </button>
              </div>

              <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-[#444] mb-2">メールアドレス</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="example@email.com"
                    className="w-full h-12 px-4 rounded-[12px] bg-white border border-[#d2d2d7] text-[#111] placeholder-[#aaa] text-sm focus:outline-none focus:border-[#111] focus:ring-4 focus:ring-black/[0.06] transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#444] mb-2">パスワード</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    placeholder={mode === 'signup' ? '6文字以上' : ''}
                    className="w-full h-12 px-4 rounded-[12px] bg-white border border-[#d2d2d7] text-[#111] placeholder-[#aaa] text-sm focus:outline-none focus:border-[#111] focus:ring-4 focus:ring-black/[0.06] transition"
                  />
                </div>

                {error && (
                  <p className="text-[#c8102e] text-xs bg-[#c8102e]/5 px-4 py-3 rounded-[12px]">{error}</p>
                )}
                {success && (
                  <p className="text-[#067a3a] text-xs bg-[#06c755]/10 px-4 py-3 rounded-[12px]">{success}</p>
                )}

                <button
                  type="submit"
                  disabled={loading || linking}
                  className={`w-full h-12 rounded-full text-[15px] font-bold transition-colors disabled:opacity-40 ${
                    isLineContext
                      ? 'bg-[#06C755] hover:bg-[#05b34c] text-white'
                      : 'bg-[#111] hover:bg-[#333] text-white'
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
                  className="w-full text-center text-xs text-[#666] hover:text-[#111] underline underline-offset-4 cursor-pointer transition py-3 mt-2"
                >
                  パスワードを忘れた方はこちら
                </button>
              )}

              {mode === 'signup' && (
                <p className="text-[#6b6b6b] text-xs mt-5 text-center leading-relaxed">
                  公式サイトでのご購入時と同じメールアドレスで登録すると、注文履歴や配送状況が自動で連携されます。
                </p>
              )}
            </>
          )}
        </div>
        <p className="mt-10 pt-6 border-t border-[#e5e5ea] text-center text-xs">
          <a href="https://fitpeak.co" className="text-[#444] hover:text-[#111] transition-colors">FITPEAK 公式サイトへ戻る ›</a>
        </p>
      </div>
      </div>
    </div>
  )
}
