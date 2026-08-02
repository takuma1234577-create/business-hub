// 選択中のLINEアカウント(channel_id)を保持するモジュール単位のシングルトン。
// api.ts の axios interceptor や生の fetch() 呼び出しから同期的に参照できるようにするため、
// React Context ではなくこの形にしている（コンポーネント外のヘルパー関数からも使えるように）。
//
// アカウントをURL(?account=<id>)に同期し、ブックマーク/共有できるようにする。
// - 読み込み時: URLパラメータ → localStorage → デフォルト の優先順で決定
// - 切替時: URLバーを replaceState で更新（履歴を汚さず、React Router とも競合しない）
export const DEFAULT_CHANNEL_ID = '00000000-0000-0000-0000-000000000010'

const STORAGE_KEY = 'line_crm_channel_id'
const URL_PARAM = 'account'

function readFromUrl(): string | null {
  try {
    return new URLSearchParams(window.location.search).get(URL_PARAM)
  } catch {
    return null
  }
}

function writeToUrl(id: string) {
  try {
    const url = new URL(window.location.href)
    if (url.searchParams.get(URL_PARAM) === id) return
    url.searchParams.set(URL_PARAM, id)
    window.history.replaceState(window.history.state, '', url.toString())
  } catch {
    /* ignore */
  }
}

let current: string = readFromUrl() || localStorage.getItem(STORAGE_KEY) || DEFAULT_CHANNEL_ID
const listeners = new Set<() => void>()

// 初期値をURL・localStorageの両方に反映しておく（?account= が無くても付与＝常に共有可能に）
try { localStorage.setItem(STORAGE_KEY, current) } catch { /* ignore */ }
writeToUrl(current)

export function getChannelId(): string {
  return current
}

export function setChannelId(id: string) {
  if (id === current) return
  current = id
  try { localStorage.setItem(STORAGE_KEY, id) } catch { /* ignore */ }
  writeToUrl(id)
  listeners.forEach((l) => l())
}

export function subscribeChannelId(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
