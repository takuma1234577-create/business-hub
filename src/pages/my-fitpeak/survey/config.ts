// アンケートの設問（旧 my-fitpeak の src/lib/survey-config.ts をそのまま移植）
// 商品名の一覧は server/my-fitpeak-survey.cjs の SURVEY_PRODUCTS と揃えること（サーバー側で検証する）

export interface SurveyQuestion {
  id: string
  type: 'star' | 'multi_checkbox' | 'textarea' | 'single_select' | 'date'
  label: string
  required: boolean
  options?: string[]
  placeholder?: string
  maxLength?: number
  minLength?: number
  hint?: string
}

export interface SurveyAnswers {
  product?: string
  rating: number
  positive_points: string[]
  recommendation_text?: string
  [key: string]: unknown
}

// 回答後の画面で使う、本人の回答の要点（サーバーの /survey/status・/survey/submit が返す）
export interface SurveySummary {
  rating: number
  productName: string
  productAsin: string
  recommendationText: string
}

// 商品一覧（親ASIN）
export const FITPEAK_PRODUCTS = [
  { name: 'パワーグリップ', asin: 'B0FSL6K37K' },
  { name: 'リストラップ', asin: 'B0F7HG9JCF' },
  { name: 'ニースリーブ', asin: 'B0DXFPMTWZ' },
  { name: 'エルボースリーブ', asin: 'B0FDLD6F5S' },
  { name: 'トレーニングベルト（本牛革）', asin: 'B0G12F9GYQ' },
  { name: 'ナイロン トレーニングベルト', asin: 'B0GWYRQNHZ' },
  { name: '可変式ダンベル 20kg', asin: 'B0FL8RXNSZ' },
  { name: '筋トレギアセット', asin: 'B0GCDCF1NF' },
] as const

// 商品別「気に入った点」の選択肢
export const PRODUCT_POSITIVE_POINTS: Record<string, string[]> = {
  'パワーグリップ': [
    'グリップ感が良い',
    '滑りにくい',
    '手首への負担が少ない',
    '装着が簡単',
    '耐久性がある',
    'フィット感が良い',
    'デザインが気に入った',
    'コストパフォーマンスが良い',
  ],
  'リストラップ': [
    'サポート力が強い',
    '巻きやすい',
    '手首が安定する',
    '長さがちょうど良い',
    '耐久性がある',
    'フィット感が良い',
    'デザインが気に入った',
    'コストパフォーマンスが良い',
  ],
  'ニースリーブ': [
    '膝のサポート力が強い',
    'フィット感が良い',
    'ズレにくい',
    '保温効果がある',
    '耐久性がある',
    '動きやすい',
    'デザインが気に入った',
    'コストパフォーマンスが良い',
  ],
  'エルボースリーブ': [
    '肘のサポート力が強い',
    'フィット感が良い',
    'ズレにくい',
    '保温効果がある',
    '耐久性がある',
    '動きやすい',
    'デザインが気に入った',
    'コストパフォーマンスが良い',
  ],
  'トレーニングベルト（本牛革）': [
    'サポート力が強い',
    '本革の質感が良い',
    'フィット感が良い',
    '腰が安定する',
    '耐久性がある',
    'バックルが使いやすい',
    'デザインが気に入った',
    'コストパフォーマンスが良い',
  ],
  'ナイロン トレーニングベルト': [
    'サポート力が強い',
    '軽量で使いやすい',
    'フィット感が良い',
    '腰が安定する',
    '着脱が簡単',
    '洗濯できる',
    'デザインが気に入った',
    'コストパフォーマンスが良い',
  ],
  '可変式ダンベル 20kg': [
    '重量変更が簡単',
    '場所を取らない',
    'グリップ感が良い',
    '重量の幅が十分',
    '耐久性がある',
    '安定感がある',
    'デザインが気に入った',
    'コストパフォーマンスが良い',
  ],
  '筋トレギアセット': [
    'セット内容が充実',
    'お得感がある',
    '各ギアの品質が良い',
    'トレーニングの幅が広がった',
    '耐久性がある',
    '初心者でも使いやすい',
    'デザインが気に入った',
    'コストパフォーマンスが良い',
  ],
}

// デフォルトの「気に入った点」（商品が見つからない場合のフォールバック）
export const DEFAULT_POSITIVE_POINTS = [
  'グリップ感が良い',
  '耐久性がある',
  'デザインが気に入った',
  '効果を実感できた',
  'コストパフォーマンスが良い',
  'サイズ・フィット感が良い',
  '使い方が簡単',
  '期待以上だった',
]

// ★4-5のときスキップする設問ID
export const SKIP_IF_HIGH_RATING = [
  'usage_scene',
  'improvement_text',
  'purchase_reason',
  'usage_frequency',
  'size_fit',
  'material_quality',
  'specific_issues',
  'usage_duration',
  'expectation_gap',
  'compared_products',
  'support_preference',
]

export const SURVEY_QUESTIONS: SurveyQuestion[] = [
  // === 共通（全員） ===
  {
    id: 'product',
    type: 'single_select',
    label: '購入した商品を選んでください',
    required: true,
    options: FITPEAK_PRODUCTS.map(p => p.name),
  },
  {
    id: 'rating',
    type: 'star',
    label: '商品の総合満足度を教えてください',
    required: true,
  },
  {
    id: 'positive_points',
    type: 'multi_checkbox',
    label: '気に入った点をお選びください（複数選択可）',
    required: false,
    options: DEFAULT_POSITIVE_POINTS,
  },

  // === ★1-3のみ ===
  {
    id: 'purchase_reason',
    type: 'single_select',
    label: 'この商品を購入した理由を教えてください',
    required: true,
    options: [
      '価格が手頃だった',
      'デザインが気に入った',
      '口コミ・レビューが良かった',
      '友人・知人のすすめ',
      'ブランドに興味があった',
      'その他',
    ],
  },
  {
    id: 'usage_duration',
    type: 'single_select',
    label: 'どのくらいの期間使用していますか？',
    required: true,
    options: [
      'まだ使用していない',
      '1週間未満',
      '1週間〜1ヶ月',
      '1ヶ月〜3ヶ月',
      '3ヶ月以上',
    ],
  },
  {
    id: 'usage_frequency',
    type: 'single_select',
    label: 'どのくらいの頻度で使用していますか？',
    required: true,
    options: [
      'ほぼ毎日',
      '週3〜4回',
      '週1〜2回',
      '月数回',
      'ほとんど使っていない',
    ],
  },
  {
    id: 'usage_scene',
    type: 'textarea',
    label: 'どのようなトレーニング・場面で使用していますか？',
    placeholder: '例：自宅でのウェイトトレーニング、ジムでのデッドリフト時など',
    required: true,
    minLength: 100,
    maxLength: 400,
    hint: '100文字以上でご記入ください',
  },
  {
    id: 'size_fit',
    type: 'single_select',
    label: 'サイズ・フィット感はいかがでしたか？',
    required: true,
    options: [
      'ぴったり',
      '少し大きい',
      '少し小さい',
      'かなり大きい',
      'かなり小さい',
      'サイズ選びに迷った',
    ],
  },
  {
    id: 'material_quality',
    type: 'single_select',
    label: '素材・品質の印象を教えてください',
    required: true,
    options: [
      '期待以上に良い',
      '価格相応',
      'やや期待以下',
      '品質に問題がある',
    ],
  },
  {
    id: 'specific_issues',
    type: 'multi_checkbox',
    label: '具体的にどのような問題がありましたか？（複数選択可）',
    required: false,
    options: [
      'サイズが合わない',
      '素材が安っぽい',
      '耐久性に不安',
      '使いにくい',
      '期待した効果がない',
      '写真と実物が異なる',
      '縫製・仕上げが雑',
      '匂いが気になる',
      '特に問題はない',
    ],
  },
  {
    id: 'expectation_gap',
    type: 'textarea',
    label: '購入前の期待と実際に使ってみた感想の違いを教えてください',
    placeholder: '例：もう少しクッション性があると思っていた',
    required: false,
    maxLength: 300,
  },
  {
    id: 'compared_products',
    type: 'single_select',
    label: '他ブランドの類似商品と比較していかがですか？',
    required: true,
    options: [
      'FITPEAKの方が良い',
      '同じくらい',
      '他社の方が良い',
      '他社製品は使ったことがない',
    ],
  },
  {
    id: 'improvement_text',
    type: 'textarea',
    label: '改善してほしい点を具体的に教えてください',
    placeholder: '率直なご意見をお聞かせください',
    required: true,
    minLength: 100,
    maxLength: 400,
    hint: '100文字以上でご記入ください',
  },
  {
    id: 'support_preference',
    type: 'single_select',
    label: '今後どのような対応を希望されますか？',
    required: true,
    options: [
      '返品・返金を希望',
      '交換（サイズ変更等）を希望',
      '改善を期待して使い続ける',
      '特に対応は不要',
    ],
  },

  // === 共通（全員・最後） ===
  {
    id: 'recommendation_text',
    type: 'textarea',
    label: 'トレーニング仲間に勧めるとしたら、どんな言葉で紹介しますか？',
    placeholder: '例：握力が弱くてもデッドリフトの重量が伸びました！',
    required: true,
    maxLength: 400,
    hint: 'この内容はAmazonレビューの下書きとしても活用できます',
  },
]
