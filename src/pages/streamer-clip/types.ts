export interface StreamerProfile {
  id: string
  display_name: string
  version: string
  config: ProfileConfig
  created_at: string
  updated_at: string
}

export interface ProfileConfig {
  source?: { platform?: string; channel_url?: string; language?: string; speech_pace?: string; content_type?: string }
  concept?: { channel_concept?: string; target_audience?: string; tone?: string; differentiation?: string }
  youtube?: { channel_id?: string; default_tags?: string[]; default_hashtags?: string[] }
  extraction?: { min_clip_duration_seconds?: number; max_clip_duration_seconds?: number; max_candidates_per_video?: number; min_score_threshold?: number; plugin?: string }
  plugin_config?: Record<string, unknown>
  video_style?: { layout?: string; resolution?: string; primary_color?: string; accent_color?: string }
  title_templates?: string[]
}

export interface StreamerJob {
  id: string
  profile_id: string
  video_filename: string
  video_url: string | null
  status: string
  created_at: string
  completed_at: string | null
  error_message: string | null
  total_cost_usd: number
  streamer_profiles?: { display_name: string; config: ProfileConfig }
  candidates?: StreamerCandidate[]
}

export interface StreamerCandidate {
  id: string
  job_id: string
  profile_id: string
  plugin_used: string
  start_seconds: number
  end_seconds: number
  score: number
  title_jp: string
  metadata: Record<string, unknown>
  status: string
  clip_url: string | null
  thumbnail_url: string | null
  youtube_video_id: string | null
  created_at: string
  reviewed_at: string | null
  published_at: string | null
}

export interface ProfileStats {
  profile_id: string
  total_jobs: number
  total_published: number
  total_cost_usd: number
  last_published_at: string | null
  streamer_profiles?: { display_name: string }
}
