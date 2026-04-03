export interface Customer {
  id: number;
  name: string;
  chatwork_room_id?: string;
  business_description?: string;
  contract_type?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: number;
  customer_id?: number;
  customer_name?: string;
  title: string;
  description?: string;
  source: string;
  source_ref?: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'done';
  due_date?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface MeetingNote {
  id: number;
  customer_id?: number;
  customer_name?: string;
  title: string;
  content: string;
  meeting_date?: string;
  file_path?: string;
  file_type?: string;
  action_items?: string;
  summary?: string;
  created_at: string;
}

export interface GmailMessage {
  id: number;
  gmail_id: string;
  thread_id?: string;
  from_address?: string;
  from_name?: string;
  subject?: string;
  body_snippet?: string;
  received_at?: string;
  importance?: 'high' | 'medium' | 'low';
  category?: string;
  summary?: string;
  recommended_action?: string;
  is_read: number;
  cached_at: string;
}

export interface ExtractedTask {
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  customer_name?: string;
  source: string;
  due_hint?: string;
}

export interface DailyReport {
  tasks: ExtractedTask[];
  summary: string;
  cached?: boolean;
  chatwork_rooms?: number;
}
