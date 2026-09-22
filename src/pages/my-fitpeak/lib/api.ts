import { fitpeakSupabase } from './supabase'

/**
 * My FITPEAK のAPI呼び出し。ログイン中の顧客のトークンを付けて送る。
 * （サーバー側はこのトークンで本人確認し、本人の注文だけを返す）
 */
export async function apiFetch(input: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {})
  try {
    const { data } = await fitpeakSupabase.auth.getSession()
    const token = data.session?.access_token
    if (token) headers.set('Authorization', `Bearer ${token}`)
  } catch { /* 未ログインならそのまま送る */ }
  return fetch(input, { ...init, headers })
}

/**
 * 画面に出す表示名。
 * LINEログインの人は内部用のメールアドレスを持つので、その場合はLINEの表示名を出す。
 */
export function displayName(user: { email?: string | null; user_metadata?: Record<string, unknown> } | null): string {
  if (!user) return ''
  const email = user.email || ''
  if (email.endsWith('@line.fitpeak.co')) {
    const name = user.user_metadata?.display_name
    return typeof name === 'string' && name ? `${name}（LINE）` : 'LINEアカウント'
  }
  return email
}
