// node --experimental-strip-types --test tests/markdown.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBlocks, parseInline } from '../src/lib/markdown.ts'

test('見出し・段落・箇条書き・番号つき', () => {
  const b = parseBlocks('## 結論\n伸びた理由は2つ。\n\n- フック\n- 尺\n\n1. 撮る\n2. 出す')
  assert.deepEqual(b.map((x) => x.type), ['heading', 'paragraph', 'list', 'list'])
  assert.equal(b[0].type === 'heading' && b[0].level, 2)
  assert.deepEqual(b[2].type === 'list' && b[2].items, ['フック', '尺'])
  assert.equal(b[3].type === 'list' && b[3].ordered, true)
})

test('表: 区切り行を除いて見出しと行に分ける', () => {
  const b = parseBlocks('| 秒 | 内容 |\n|---|---|\n| 0:00 | フック |\n| 0:03 | 導入 |')
  assert.equal(b.length, 1)
  const t = b[0]
  assert.equal(t.type, 'table')
  if (t.type !== 'table') return
  assert.deepEqual(t.header, ['秒', '内容'])
  assert.deepEqual(t.rows, [['0:00', 'フック'], ['0:03', '導入']])
})

test('コードブロックは中身をそのまま', () => {
  const b = parseBlocks('```\na **b**\n```')
  assert.deepEqual(b, [{ type: 'code', text: 'a **b**' }])
})

test('インライン: 太字・リンク・URL・コード', () => {
  assert.deepEqual(parseInline('**強調**と[元動画](https://youtu.be/x)'), [
    { type: 'bold', text: '強調' }, { type: 'text', text: 'と' }, { type: 'link', text: '元動画', href: 'https://youtu.be/x' },
  ])
  assert.deepEqual(parseInline('見る https://www.youtube.com/shorts/abc で'), [
    { type: 'text', text: '見る ' }, { type: 'link', text: 'https://www.youtube.com/shorts/abc', href: 'https://www.youtube.com/shorts/abc' }, { type: 'text', text: ' で' },
  ])
  assert.deepEqual(parseInline('`node x`'), [{ type: 'code', text: 'node x' }])
})

test('javascript: のリンクは文字として扱う', () => {
  assert.deepEqual(parseInline('[x](javascript:alert(1))'), [{ type: 'text', text: '[x](javascript:alert(1))' }])
})
