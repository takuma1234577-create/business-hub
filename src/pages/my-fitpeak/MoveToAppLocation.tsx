import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { fitpeakSupabase } from './lib/supabase'
import { useFitpeakAuth } from './lib/auth'
import { isEmbedded } from './lib/embed'

/**
 * 画面の場所（サーバーの MY_FITPEAK_APP_URL）が my.fitpeak.co 以外（例 https://fitpeak.co/a）になったら、
 * my.fitpeak.co/my-fitpeak/* に来た人をそちらへ移す。
 *   - ログイン中: POST /api/my-fitpeak/auth/migrate で本人用の1回限りのトークンをもらい、
 *                 新しい場所の /my-fitpeak/login#lt=…&next=… へ（トークンは # にだけ載る）
 *   - 未ログイン: 同じパスへそのまま移す
 * 切替前（moved=false）・埋め込み時は何もしない。
 * 1回限りの処理（?alt= / ?code= / #lt= / LINEアプリでの承認待ち / LINE連携）の途中では移さない。
 */

const ONE_TIME_PARAMS = ['alt', 'code', 'lt', 'token', 'token_hash', 'access_token', 'refresh_token', 'type']
const APP_URL_RE = /^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._-]+)*$/

let appLocation: Promise<{ moved: boolean; appUrl: string } | null> | null = null
function fetchAppLocation() {
  if (!appLocation) {
    appLocation = fetch('/api/my-fitpeak/auth/app-location')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
  }
  return appLocation
}

function busyWithOneTimeFlow(pathname: string, search: string) {
  if (pathname.startsWith('/my-fitpeak/line-link')) return true
  if (window.location.hash) return true
  const q = new URLSearchParams(search)
  if (ONE_TIME_PARAMS.some((k) => q.has(k))) return true
  try { if (sessionStorage.getItem('myfp_line_handoff')) return true } catch { /* noop */ }
  return false
}

export default function MoveToAppLocation() {
  const location = useLocation()
  const { user, loading } = useFitpeakAuth()
  const movingRef = useRef(false)

  useEffect(() => {
    if (isEmbedded() || loading || movingRef.current) return
    if (!location.pathname.startsWith('/my-fitpeak')) return
    if (busyWithOneTimeFlow(location.pathname, location.search)) return
    movingRef.current = true
    ;(async () => {
      const loc = await fetchAppLocation()
      if (!loc || !loc.moved || !APP_URL_RE.test(loc.appUrl) || loc.appUrl.startsWith(window.location.origin)) {
        movingRef.current = false
        return
      }
      const next = location.pathname + location.search
      try {
        const { data } = await fitpeakSupabase.auth.getSession()
        const token = data.session?.access_token
        if (token) {
          const r = await fetch('/api/my-fitpeak/auth/migrate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ next }),
          })
          if (r.ok) {
            const d = await r.json()
            if (typeof d.url === 'string' && d.url.startsWith(`${loc.appUrl}/my-fitpeak/login#`)) {
              window.location.replace(d.url)
              return
            }
          }
        }
      } catch { /* 移行できなくても、そのまま移す（新しい場所でもう一度ログイン） */ }
      window.location.replace(`${loc.appUrl}${next}`)
    })()
  }, [location.pathname, location.search, user, loading])

  return null
}
