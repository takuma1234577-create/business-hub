import { useSyncExternalStore } from 'react'

export type Language = 'ja' | 'en' | 'es'
const key = 'business-hub.language'
const isLanguage = (value: unknown): value is Language => value === 'ja' || value === 'en' || value === 'es'
function readLanguage(): Language {
  try {
    const saved = localStorage.getItem(key)
    return isLanguage(saved) ? saved : 'ja'
  } catch { return 'ja' }
}
let language = readLanguage()
const listeners = new Set<() => void>()
function updateDocument() {
  document.documentElement.lang = language
  document.title = { ja: '業務ツール', en: 'Business Hub', es: 'Business Hub' }[language]
}
updateDocument()
export function setLanguage(value: Language) {
  if (!isLanguage(value)) return
  language = value
  try { localStorage.setItem(key, value) } catch { /* Storage may be disabled. */ }
  updateDocument()
  listeners.forEach(listener => listener())
}
window.addEventListener('storage', event => {
  if (event.key !== key && event.key !== null) return
  language = readLanguage()
  updateDocument()
  listeners.forEach(listener => listener())
})
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export const getLanguage = () => language
export const getLocale = () => ({ ja: 'ja-JP', en: 'en-US', es: 'es-ES' })[language]
export function useLanguage() {
  return useSyncExternalStore(subscribe, () => language, () => 'ja' as Language)
}
