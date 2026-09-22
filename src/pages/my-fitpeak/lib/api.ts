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
