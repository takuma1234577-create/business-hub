/**
 * My FITPEAK を fitpeak.co（Shopify アプリプロキシ /a/my-fitpeak/...）に埋め込んで動かすときの設定。
 *
 * - 埋め込み用エントリー（src/my-fitpeak-embed.tsx）だけが initEmbed() を呼ぶ。
 *   通常の my.fitpeak.co の画面ではここは常に「埋め込みでない」のまま（従来と同じ動き）。
 * - 埋め込み時、API と画像は my.fitpeak.co の絶対URLへ向ける。
 * - LINEログインから戻ったときの #lt=<token_hash> は、テーマや他アプリのスクリプトに長く見えないよう
 *   読み込み直後にURLから消し、メモリにだけ持つ。
 */

type EmbedConfig = { embedded: boolean; basename: string }

let config: EmbedConfig = { embedded: false, basename: '' }
let pendingLoginHash: string | null = null

const API_ORIGIN = (import.meta.env.VITE_MYFP_API_ORIGIN as string | undefined) || 'https://my.fitpeak.co'

export function initEmbed(raw: unknown) {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { embedded?: unknown; basename?: unknown }
  const basename = typeof r.basename === 'string' && /^\/[a-z]+$/.test(r.basename) ? r.basename : '/a'
  config = { embedded: r.embedded === true, basename: r.embedded === true ? basename : '' }
  if (!config.embedded) return
  // #lt=... をすぐURLから消す（1回限りのトークンだが、他のスクリプトに見える時間を短くする）
  try {
    const h = window.location.hash
    if (h && /(^#|&)lt=/.test(h)) {
      pendingLoginHash = h
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    }
  } catch { /* noop */ }
}

export function isEmbedded() {
  return config.embedded
}

export function embedBasename() {
  return config.basename
}

// API・LINEログインの場所（埋め込み時だけ絶対URL）
export function apiOrigin() {
  return config.embedded ? API_ORIGIN : ''
}

export function apiUrl(path: string) {
  return config.embedded && path.startsWith('/api/') ? `${API_ORIGIN}${path}` : path
}

// public/ の画像など（埋め込み時は my.fitpeak.co から読む）
export function assetUrl(path: string) {
  return config.embedded && path.startsWith('/') ? `${API_ORIGIN}${path}` : path
}

// LINEログインから戻ったときのフラグメント（#lt=...&next=...）
export function loginHash() {
  return pendingLoginHash ?? window.location.hash
}

export function clearLoginHash() {
  pendingLoginHash = null
}
