// ---------------------------------------------------------------------------
// 表記ヘルパー
//
// 言語は getLang() を見て切り替える純関数。呼び出し側のコンポーネントが
// useT() / useLang() を呼んでいるので、言語を変えると再描画で反映される。
// ---------------------------------------------------------------------------
import { getLang, locale, t } from './i18n'

export const fmtNum = (v: number | null | undefined) => (v == null ? '—' : Math.round(v).toLocaleString(locale()))
export const fmtPct = (v: number | null | undefined, d = 0) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`)
export function fmtDur(sec: number | null | undefined) {
  if (sec == null || !isFinite(sec)) return '—'
  const en = getLang() === 'en'
  const s = Math.round(sec)
  if (s < 60) return en ? `${s}s` : `${s}秒`
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m < 60) {
    if (en) return r ? `${m}m ${r}s` : `${m}m`
    return r ? `${m}分${r}秒` : `${m}分`
  }
  return en ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}時間${m % 60}分`
}
export function timeAgo(iso: string) {
  const en = getLang() === 'en'
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return en ? `${s}s ago` : `${s}秒前`
  const m = Math.floor(s / 60)
  if (m < 60) return en ? `${m}m ago` : `${m}分前`
  return en ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 60)}時間前`
}
export const deviceLabel = (d: string | null | undefined) =>
  d === 'mobile' ? t('スマホ') : d === 'desktop' ? t('PC') : d === 'tablet' ? t('タブレット') : d || t('不明')

const COUNTRY: Record<string, string> = {
  JP: '日本', US: 'アメリカ', AR: 'アルゼンチン', KR: '韓国', CN: '中国', TW: '台湾', HK: '香港',
  GB: 'イギリス', DE: 'ドイツ', FR: 'フランス', SG: 'シンガポール', TH: 'タイ', VN: 'ベトナム',
  PH: 'フィリピン', AU: 'オーストラリア', CA: 'カナダ', GE: 'ジョージア', IE: 'アイルランド', NL: 'オランダ',
}
const COUNTRY_EN: Record<string, string> = {
  JP: 'Japan', US: 'United States', AR: 'Argentina', KR: 'South Korea', CN: 'China', TW: 'Taiwan', HK: 'Hong Kong',
  GB: 'United Kingdom', DE: 'Germany', FR: 'France', SG: 'Singapore', TH: 'Thailand', VN: 'Vietnam',
  PH: 'Philippines', AU: 'Australia', CA: 'Canada', GE: 'Georgia', IE: 'Ireland', NL: 'Netherlands',
}
export const countryLabel = (c: string | null | undefined) => {
  if (!c) return t('不明')
  return (getLang() === 'en' ? COUNTRY_EN[c] : COUNTRY[c]) || c
}

/** パスを読みやすく（日本語URLのデコード） */
export function prettyPath(p: string | null | undefined) {
  if (!p) return '—'
  try { return decodeURIComponent(p) } catch { return p }
}
