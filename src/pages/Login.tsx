import { useState } from 'react'
import { Lock, Mail, Eye, EyeOff, ShieldCheck } from 'lucide-react'

interface Props {
  onLogin: (token: string) => void
}

export default function Login({ onLogin }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [isSetup, setIsSetup] = useState(false)
  const [setupDone, setSetupDone] = useState(false)

  // 2FA
  const [step, setStep] = useState<'credentials' | '2fa'>('credentials')
  const [pendingToken, setPendingToken] = useState('')
  const [code, setCode] = useState('')
  const [maskedEmail, setMaskedEmail] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      if (isSetup) {
        const res = await fetch('/api/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        setSetupDone(true)
        setIsSetup(false)
      } else {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)

        if (data.requires_2fa) {
          setPendingToken(data.pending_token)
          setMaskedEmail(data.email.replace(/(.{2})(.*)(@.*)/, '$1***$3'))
          setStep('2fa')
        } else {
          localStorage.setItem('auth_token', data.token)
          onLogin(data.token)
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'エラー')
    } finally {
      setLoading(false)
    }
  }

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/verify-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pending_token: pendingToken, code }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      localStorage.setItem('auth_token', data.token)
      onLogin(data.token)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'エラー')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-slate-900 dark:bg-white flex items-center justify-center mx-auto mb-4">
            {step === '2fa' ? <ShieldCheck size={24} className="text-white dark:text-slate-900" /> : <Lock size={24} className="text-white dark:text-slate-900" />}
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Business Hub</h1>
          <p className="text-sm text-slate-500 mt-1">
            {step === '2fa' ? '二段階認証' : isSetup ? '初回セットアップ' : 'ログイン'}
          </p>
        </div>

        {setupDone && (
          <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm text-green-700 dark:text-green-400">
            セットアップ完了！ログインしてください。
          </div>
        )}

        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {step === 'credentials' ? (
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">メールアドレス</label>
                  <div className="relative">
                    <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" required
                      className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-900/20" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">パスワード</label>
                  <div className="relative">
                    <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                      placeholder={isSetup ? '6文字以上' : 'パスワード'} required minLength={isSetup ? 6 : 1}
                      className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-900/20" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 cursor-pointer">
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </div>
              <button type="submit" disabled={loading}
                className="w-full mt-6 py-2.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium hover:bg-slate-800 dark:hover:bg-slate-100 disabled:opacity-50 cursor-pointer transition">
                {loading ? '...' : isSetup ? 'セットアップ' : 'ログイン'}
              </button>
              <button type="button" onClick={() => { setIsSetup(!isSetup); setError('') }}
                className="w-full mt-3 text-xs text-slate-400 hover:text-slate-600 cursor-pointer text-center">
                {isSetup ? 'ログイン画面に戻る' : '初回セットアップ'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerify2FA}>
              <div className="text-center mb-4">
                <ShieldCheck size={32} className="mx-auto text-blue-500 mb-2" />
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  <span className="font-semibold">{maskedEmail}</span> に<br/>認証コードを送信しました
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">6桁の認証コード</label>
                <input type="text" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456" required maxLength={6} autoFocus
                  className="w-full text-center text-2xl tracking-[0.5em] px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 font-mono" />
              </div>
              <button type="submit" disabled={loading || code.length !== 6}
                className="w-full mt-6 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 cursor-pointer transition">
                {loading ? '検証中...' : '認証する'}
              </button>
              <button type="button" onClick={() => { setStep('credentials'); setCode(''); setError('') }}
                className="w-full mt-3 text-xs text-slate-400 hover:text-slate-600 cursor-pointer text-center">
                ログイン画面に戻る
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
