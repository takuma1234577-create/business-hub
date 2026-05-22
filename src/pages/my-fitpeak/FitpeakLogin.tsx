import { useEffect, useState, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useFitpeakAuth } from './lib/auth'
import { CheckCircle, MessageCircle } from 'lucide-react'

const LIFF_ID = import.meta.env.VITE_LIFF_ID || ''

export default function FitpeakLogin() {
  const { user, signInWithPassword, signUp } = useFitpeakAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
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
  useEffect(() => {
    if (user && !isLineContext) {
      navigate('/my-fitpeak')
    }
  }, [user, isLineContext, navigate])

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
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
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
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
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
