export interface SnsAsset {
  id: string
  category: 'background' | 'product' | 'bgm'
  product_key: string | null
  file_name: string
  file_url: string
  file_size: number
  created_at: string
}

export interface ScriptPart {
  narration: string
  subtitle: string[]
}

export interface SnsScript {
  id: string
  script_number: string
  theme: string
  product: string
  parts: Record<string, ScriptPart>
  caption: string
  hashtags: string[]
  created_at: string
  updated_at: string
}

export interface SnsVideo {
  id: string
  script_id: string | null
  script_number: string
  theme: string
  product: string
  status: 'pending' | 'rendering' | 'done' | 'error'
  json2video_project: string | null
  video_url: string | null
  caption: string | null
  error_message: string | null
  movie_definition: any
  render_status?: string
  created_at: string
  updated_at: string
}

export const PART_ORDER = ['hook', 'problem', 'step1', 'step2', 'step3', 'product', 'cta'] as const
export const PART_LABELS: Record<string, string> = {
  hook: 'フック',
  problem: '問題提起',
  step1: 'STEP1',
  step2: 'STEP2',
  step3: 'STEP3',
  product: '商品紹介',
  cta: 'CTA',
}

export const PRODUCT_OPTIONS: Record<string, string> = {
  wristwrap: 'リストラップ',
  powergrip: 'パワーグリップ',
  belt: 'トレーニングベルト',
  elbowsleeve: 'エルボースリーブ',
  kneesleeve: 'ニースリーブ',
}
