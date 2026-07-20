// 選択中のLINEアカウント(channel_id)を保持するモジュール単位のシングルトン。
// api.ts の axios interceptor や生の fetch() 呼び出しから同期的に参照できるようにするため、
// React Context ではなくこの形にしている（コンポーネント外のヘルパー関数からも使えるように）。
export const DEFAULT_CHANNEL_ID = '00000000-0000-0000-0000-000000000010'

const STORAGE_KEY = 'line_crm_channel_id'

let current: string = localStorage.getItem(STORAGE_KEY) || DEFAULT_CHANNEL_ID
const listeners = new Set<() => void>()

export function getChannelId(): string {
  return current
}

export function setChannelId(id: string) {
  if (id === current) return
  current = id
  localStorage.setItem(STORAGE_KEY, id)
  listeners.forEach((l) => l())
}

export function subscribeChannelId(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
