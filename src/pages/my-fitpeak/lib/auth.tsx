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

export function FitpeakAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fitpeakSupabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = fitpeakSupabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
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
