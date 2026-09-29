// 公式サイト（fitpeak.co）のヘッダーと同じメニュー定義。
// 公式サイト側の「fp-nav-data」と同じ並び・同じ名前で持つ。特化サイトを足すときは sites に1行足すだけ。
// soon: true は「準備中」（リンクなし）
export const SITE = 'https://fitpeak.co'

export interface NavItem { name: string; href?: string; desc?: string; soon?: boolean }
export interface NavGroup { label: string; href?: string; items?: NavItem[] }

export const SITE_NAV: NavGroup[] = [
  { label: '商品', href: `${SITE}/collections/fitpeak筋トレギア一覧` },
  {
    label: 'ツール',
    items: [
      { name: '筋トレ最安ナビ', href: `${SITE}/pages/compare` },
      { name: '筋トレ偏差値', href: `${SITE}/pages/strength-score` },
      { name: '計算ツール一覧', href: `${SITE}/pages/tools` },
    ],
  },
  {
    label: '特化サイト',
    items: [
      { name: 'プロテインナビ', href: `${SITE}/blogs/protein-navi` },
      { name: 'クレアチンナビ', href: `${SITE}/blogs/creatine-navi` },
      { name: 'アミノ酸ナビ', href: `${SITE}/blogs/amino-times` },
      { name: 'FITPEAK NAVI（ジム）', href: `${SITE}/pages/fitpeak-navi` },
      { name: '筋トレギアマニア', soon: true },
    ],
  },
  {
    label: 'メディア',
    items: [
      { name: 'KINNIKU TIMES', href: `${SITE}/blogs/kinniku-times` },
      { name: 'メディア一覧', href: `${SITE}/pages/fitpeak-media` },
    ],
  },
]
