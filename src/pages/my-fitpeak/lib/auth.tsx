import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { fitpeakSupabase } from './supabase'
import type { User, Session } from '@supabase/supabase-js'

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  signIn: (email: string) => Promise<{ error: string | null }>
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const FitpeakAuthContext = createContext<AuthContextType | null>(null)

// ---------------------------------------------------------------------------
// fitpeak.co のどのページ・どのリンクから来て登録したか（サイト分析の「登録」タブ用）
// fitpeak.co の計測タグが my.fitpeak.co へのリンクに fa_vid / fa_sid / fa_from / fa_place / fa_t を付ける。
// ここで覚えておき、ログインしたらサーバーへ送る（新規登録かどうかはサーバーが判定）。
// ---------------------------------------------------------------------------
const ATTR_KEY = 'fp_site_attr'

function captureSiteAttr() {
  try {
    const q = new URLSearchParams(window.location.search)
    if (!q.get('fa_sid')) return
    const attr = {
      vid: q.get('fa_vid') || '', sid: q.get('fa_sid') || '', from: q.get('fa_from') || '',
      place: q.get('fa_place') || '', t: Number(q.get('fa_t')) || Date.now(),
    }
    localStorage.setItem(ATTR_KEY, JSON.stringify(attr))
    ;['fa_vid', 'fa_sid', 'fa_from', 'fa_place', 'fa_t'].forEach((k) => q.delete(k))
    const qs = q.toString()
    window.history.replaceState(window.history.state, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash)
  } catch { /* noop */ }
}

let attrSending = false
async function sendSiteAttr(session: Session | null) {
  if (!session?.access_token || attrSending) return
  let attr: Record<string, unknown> | null = null
  try { attr = JSON.parse(localStorage.getItem(ATTR_KEY) || 'null') } catch { attr = null }
  if (!attr) return
  attrSending = true
  try {
    const r = await fetch('/api/public/site-analytics/signup-attr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(attr),
    })
    // 記録できた／対象外（既存会員・期限切れ）なら消す。サーバーエラー時は次回に再送
    if (r.ok) localStorage.removeItem(ATTR_KEY)
  } catch { /* noop */ } finally { attrSending = false }
}

captureSiteAttr()

export function FitpeakAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fitpeakSupabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
      sendSiteAttr(session)
    })

    const { data: { subscription } } = fitpeakSupabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      sendSiteAttr(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email: string) => {
    const { error } = await fitpeakSupabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    return { error: error?.message || null }
  }

  const signInWithPassword = async (email: string, password: string) => {
    const { error } = await fitpeakSupabase.auth.signInWithPassword({ email: email.trim(), password })
    if (!error) return { error: null }
    // Translate common Supabase auth errors to Japanese
    if (error.message === 'Invalid login credentials') {
      return { error: 'メールアドレスまたはパスワードが正しくありません' }
    }
    if (error.message.includes('Email not confirmed')) {
      return { error: 'メールアドレスが未確認です。確認メールをご確認ください。' }
    }
    return { error: error.message }
  }

  const signUp = async (email: string, password: string) => {
    const { error } = await fitpeakSupabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    })
    return { error: error?.message || null }
  }

  const signOut = async () => {
    await fitpeakSupabase.auth.signOut()
  }

  return (
    <FitpeakAuthContext.Provider value={{ user, session, loading, signIn, signInWithPassword, signUp, signOut }}>
      {children}
    </FitpeakAuthContext.Provider>
  )
}

export function useFitpeakAuth() {
  const ctx = useContext(FitpeakAuthContext)
  if (!ctx) throw new Error('useFitpeakAuth must be used within FitpeakAuthProvider')
  return ctx
}
