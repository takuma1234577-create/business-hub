import messages from './messages.json'
import type { Language } from './store'

const dictionary: Record<string, string[]> = messages
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const templates = Object.entries(dictionary)
  .filter(([source]) => /\{\d+\}/.test(source))
  .sort(([a], [b]) => b.length - a.length)
  .map(([source, translations]) => {
    const parameters: string[] = []
    const pattern = source.split(/(\{\d+\})/).map(part => {
      if (/^\{\d+\}$/.test(part)) { parameters.push(part); return '(.*?)' }
      return escapeRegExp(part)
    }).join('')
    return { pattern: new RegExp(`^${pattern}$`, 's'), parameters, translations }
  })
/** Translate known UI copy only. Never modify values sent to APIs or user input. */
export function translate(text: string, language: Language): string {
  if (language === 'ja' || !/[ぁ-んァ-ヶ一-龠]/.test(text)) return text
  const source = text.trim()
  const entry = dictionary[source] ?? dictionary[source.replace(/\s+/g, ' ')]
  let translated = entry?.[language === 'en' ? 0 : 1]
  if (translated === undefined) {
    for (const template of templates) {
      const match = source.match(template.pattern)
      if (!match) continue
      translated = template.translations[language === 'en' ? 0 : 1].replace(/\{\d+\}/g, parameter => {
        const index = template.parameters.indexOf(parameter)
        return index >= 0 ? match[index + 1] : parameter
      })
      break
    }
  }
  if (translated === undefined || !translated.length) return text
  return text.slice(0, text.length - text.trimStart().length) + translated + text.slice(text.trimEnd().length)
}
