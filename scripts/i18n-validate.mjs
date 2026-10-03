import fs from 'node:fs'
import assert from 'node:assert/strict'

const draft = process.argv.includes('--draft')
const path = draft ? 'docs/i18n-handoff/messages-draft.json' : 'src/i18n/messages.json'
const messages = JSON.parse(fs.readFileSync(path, 'utf8'))
const reviewed = new Set(JSON.parse(fs.readFileSync('docs/i18n-handoff/reviewed-keys.json', 'utf8')))
const tokens = text => (text.match(/\{[^{}]+\}/g) || []).sort()
const problems = []
for (const [source, translations] of Object.entries(messages)) {
  if (!draft && !reviewed.has(source)) problems.push({ source, issue: 'Not reviewed' })
  if (!Array.isArray(translations) || translations.length !== 2) {
    problems.push({ source, issue: 'Expected English and Spanish' }); continue
  }
  translations.forEach((text, index) => {
    const language = ['en', 'es'][index]
    if (typeof text !== 'string' || !text.length || (!text.trim() && !['様', '御中'].includes(source))) {
      problems.push({ source, language, issue: 'Empty translation' }); return
    }
    try { assert.deepEqual(tokens(text), tokens(source)) }
    catch { problems.push({ source, language, issue: 'Placeholder mismatch' }) }
    if (/[ぁ-んァ-ヶ一-龠]/.test(text.replace(/\{[^{}]+\}/g, ''))) {
      problems.push({ source, language, issue: 'Untranslated Japanese' })
    }
    if (/&(?:quot|amp|lt|gt);|#{10}|\{\}|\}\}\}/.test(text)) problems.push({ source, language, issue: 'Corrupted output' })
    // Digits with unit labels and limits must survive translation. Linguistic
    // counters (1日 = daily) are reviewed as semantic equivalents separately.
    const numbers = value => value.replace(/\{[^{}]+\}/g, '').match(/\d+(?:\.\d+)?/g) || []
    const importantNumbers = numbers(source).filter(n => Number(n) > 2 || ((/%|kg|SKU|AES/i.test(source)) && !/1日1回/.test(source)))
    const targetNumbers = numbers(text)
    for (const number of importantNumbers) {
      const position = targetNumbers.indexOf(number)
      if (position < 0) problems.push({ source, language, issue: `Missing number ${number}` })
      else targetNumbers.splice(position, 1)
    }
  })
}
console.log(`${path}: ${Object.keys(messages).length} entries; ${problems.length} validation problems`)
if (problems.length) { console.log(JSON.stringify(problems, null, 2)); process.exitCode = 1 }
