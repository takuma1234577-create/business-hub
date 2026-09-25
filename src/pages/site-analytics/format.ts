// ---------------------------------------------------------------------------
// 表記ヘルパー
// ---------------------------------------------------------------------------
export const fmtNum = (v: number | null | undefined) => (v == null ? '—' : Math.round(v).toLocaleString('ja-JP'))
export const fmtPct = (v: number | null | undefined, d = 0) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`)
export function fmtDur(sec: number | null | undefined) {
  if (sec == null || !isFinite(sec)) return '—'
  const s = Math.round(sec)
  if (s < 60) return `${s}秒`
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m < 60) return r ? `${m}分${r}秒` : `${m}分`
  return `${Math.floor(m / 60)}時間${m % 60}分`
}
export function timeAgo(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}秒前`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}分前`
  return `${Math.floor(m / 60)}時間前`
}
export const deviceLabel = (d: string | null | undefined) =>
  d === 'mobile' ? 'スマホ' : d === 'desktop' ? 'PC' : d === 'tablet' ? 'タブレット' : d || '不明'

const COUNTRY: Record<string, string> = {
  JP: '日本', US: 'アメリカ', AR: 'アルゼンチン', KR: '韓国', CN: '中国', TW: '台湾', HK: '香港',
  GB: 'イギリス', DE: 'ドイツ', FR: 'フランス', SG: 'シンガポール', TH: 'タイ', VN: 'ベトナム',
  PH: 'フィリピン', AU: 'オーストラリア', CA: 'カナダ', GE: 'ジョージア', IE: 'アイルランド', NL: 'オランダ',
}
export const countryLabel = (c: string | null | undefined) => (c ? COUNTRY[c] || c : '不明')

/** パスを読みやすく（日本語URLのデコード） */
export function prettyPath(p: string | null | undefined) {
  if (!p) return '—'
  try { return decodeURIComponent(p) } catch { return p }
}

