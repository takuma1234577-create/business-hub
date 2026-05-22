// LINE CRM TypeScript interfaces

export interface Tag {
  id: string
  name: string
  color: string
  created_at?: string
}

export interface Friend {
  id: string
  line_user_id: string
  display_name: string
  picture_url: string | null
  status_message: string | null
  status: 'active' | 'blocked' | 'unfollowed'
  custom_field_1?: string | null
  custom_field_2?: string | null
  custom_field_3?: string | null
  tags?: Tag[]
  created_at?: string
  updated_at?: string
}

export interface FriendWithTags extends Friend {
  friend_tags?: { tag: Tag }[]
}

export interface ChatMessage {
  id: string
  friend_id: string
  direction: 'incoming' | 'outgoing'
  message_type: 'text' | 'image' | 'sticker' | 'video' | 'audio' | 'file' | 'postback'
  content: string
  sent_at: string
  created_at?: string
}

export interface AutoResponse {
  id: string
  name: string
  keywords: string[]
  match_type: 'exact' | 'contains' | 'starts_with' | 'regex'
  response_messages: Array<{ type: string; text?: string } & Record<string, unknown>>
  is_active: boolean
  priority?: number
  created_at?: string
  updated_at?: string
}

export interface Broadcast {
  id: string
  name: string
  message_content: string
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed'
  target_tags: string[] | null
  target_filters: Record<string, unknown> | null
  sent_count: number
  scheduled_at: string | null
  created_at?: string
  updated_at?: string
}

export interface StepSequence {
  id: string
  name: string
  description: string | null
  trigger_type: string
  is_active: boolean
  created_at?: string
  updated_at?: string
}

export interface StepEnrollment {
  id: string
  friend_id: string
  sequence_id: string
  current_step: number
  status: 'active' | 'completed' | 'paused' | 'cancelled'
  created_at?: string
  updated_at?: string
}

export interface AiSettings {
  id: string
  is_active: boolean
  persona: string
  system_instructions: string
  model: string
  temperature: number
  created_at?: string
  updated_at?: string
}

export interface KnowledgeBase {
  id: string
  title: string
  content: string
  category: string
  created_at?: string
  updated_at?: string
}

export interface RichMenu {
  id: string
  name: string
  config: Record<string, unknown>
  is_active: boolean
  created_at?: string
  updated_at?: string
}

// API response types
export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export interface FriendListParams {
  search?: string
  tag_id?: string
  status?: string
  page?: number
  per_page?: number
}
