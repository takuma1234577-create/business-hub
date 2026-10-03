import { Globe } from 'lucide-react'
import { setLanguage, useLanguage } from './store'
import type { Language } from './store'

export default function LanguageSwitcher() {
  const language = useLanguage()
  return (
    <div translate="no" className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
      <div className="mx-auto flex max-w-5xl items-center justify-end gap-2 px-4 py-2 text-sm text-slate-700 dark:text-slate-200">
        <Globe size={16} aria-hidden="true" />
        <label htmlFor="business-hub-language">{{ ja: '言語', en: 'Language', es: 'Idioma' }[language]}</label>
        <select id="business-hub-language" value={language} onChange={event => setLanguage(event.target.value as Language)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="ja">日本語</option>
          <option value="en">English</option>
          <option value="es">Español</option>
        </select>
      </div>
    </div>
  )
}
