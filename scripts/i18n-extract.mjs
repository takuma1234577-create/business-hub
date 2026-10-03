import ts from 'typescript'
import fs from 'node:fs'
import path from 'node:path'

const japanese = /[ぁ-んァ-ヶ一-龠]/
const strings = new Set()
function add(text) {
  const value = text.trim()
  if (japanese.test(value) && value.length < 1500) strings.add(value)
}
function visitDirectory(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name)
    if (item.isDirectory()) {
      if (item.name !== 'i18n') visitDirectory(file)
      continue
    }
    if (!/\.tsx?$/.test(file)) continue
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    function visit(node) {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node.text)
      if (ts.isJsxText(node)) {
        add(node.text.replace(/\s+/g, ' ').replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&#39;/g, "'"))
      }
      if (ts.isTemplateExpression(node)) {
        add(node.head.text + node.templateSpans.map((span, index) => `{${index}}${span.literal.text}`).join(''))
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
}
visitDirectory('src')
const dictionary = JSON.parse(fs.readFileSync('src/i18n/messages.json', 'utf8'))
const missing = [...strings].filter(text => !dictionary[text])
if (process.argv.includes('--check')) {
  console.log(`${strings.size} source strings; ${missing.length} missing translations`)
  if (missing.length) { console.log(JSON.stringify(missing, null, 2)); process.exitCode = 1 }
} else {
  console.log(JSON.stringify([...strings], null, 2))
}
