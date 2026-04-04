// Bilingual color/size synonyms for product search
// When user types one term, we expand to all equivalents

const SYNONYM_GROUPS: string[][] = [
  // Colors - Japanese / English / Kanji
  ['ブラック', 'black', '黒', 'くろ', 'クロ'],
  ['ホワイト', 'white', '白', 'しろ', 'シロ'],
  ['レッド', 'red', '赤', 'あか', 'アカ'],
  ['ブルー', 'blue', '青', 'あお', 'アオ'],
  ['グリーン', 'green', '緑', 'みどり', 'ミドリ'],
  ['イエロー', 'yellow', '黄', '黄色', 'きいろ', 'キイロ'],
  ['ピンク', 'pink'],
  ['グレー', 'gray', 'grey', '灰色', 'はいいろ', 'ハイイロ', 'グレイ'],
  ['ネイビー', 'navy', '紺', 'こん', 'コン'],
  ['ベージュ', 'beige'],
  ['オレンジ', 'orange', '橙', 'だいだい'],
  ['パープル', 'purple', '紫', 'むらさき', 'ムラサキ'],
  ['ブラウン', 'brown', '茶', '茶色', 'ちゃいろ', 'チャイロ'],
  ['ゴールド', 'gold', '金', 'きん'],
  ['シルバー', 'silver', '銀', 'ぎん'],
  // Sizes
  ['small', 'ｓ', 'エス'],
  ['medium', 'ｍ', 'エム'],
  ['large', 'ｌ', 'エル'],
]

// Convert full-width to half-width for digits and ASCII
function normalizeWidth(s: string): string {
  return s.replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, ' ')
}

// Expand a search term to include all synonyms
function expandTerm(term: string): string[] {
  const lower = term.toLowerCase()
  for (const group of SYNONYM_GROUPS) {
    if (group.some(s => s.toLowerCase() === lower)) {
      return group.map(s => s.toLowerCase())
    }
  }
  return [lower]
}

/**
 * Check if `text` matches all `query` terms (AND search).
 * - Handles full-width ↔ half-width digits/ASCII
 * - Handles Japanese ↔ English color/size synonyms
 */
export function smartMatch(text: string, query: string): boolean {
  if (!query.trim()) return true
  const normText = normalizeWidth(text).toLowerCase()
  const terms = normalizeWidth(query).toLowerCase().split(/\s+/).filter(Boolean)

  return terms.every(term => {
    const variants = expandTerm(term)
    return variants.some(v => normText.includes(v))
  })
}
