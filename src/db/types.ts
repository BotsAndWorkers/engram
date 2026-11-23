export interface MessageRow {
  id: number;
  chat_id: number;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls_json: string | null;
  tool_call_id: string | null;
  created_at: number;
}

export interface NoteRow {
  id: number;
  user_id: number;
  title: string;
  content: string;
  tags: string;
  created_at: number;
  updated_at: number;
}

export interface ReminderRow {
  id: number;
  user_id: number;
  chat_id: number;
  text: string;
  due_at: number;
  repeat_interval_minutes: number | null;
  status: 'pending' | 'done' | 'cancelled';
  created_at: number;
  sent_at: number | null;
}

export interface MemoryRow {
  id: number;
  user_id: number;
  key: string;
  value: string;
  updated_at: number;
}

export interface UserSettingsRow {
  user_id: number;
  timezone: string | null;
  model_override: string | null;
  briefing_hour: number | null;
  last_briefing_date: string | null;
  chat_id: number | null;
  quiet_start: number | null;
  quiet_end: number | null;
  checkin_hour: number | null;
  last_checkin_date: string | null;
  voice_mode: 'off' | 'voice' | 'always' | null;
  updated_at: number;
}

export interface DocumentRow {
  id: number;
  user_id: number;
  file_name: string;
  mime_type: string;
  telegram_file_id: string;
  content: string;
  created_at: number;
}

export interface TrackerEntryRow {
  id: number;
  user_id: number;
  category: string;
  label: string;
  amount: number | null;
  unit: string | null;
  note: string | null;
  created_at: number;
}

export interface ListItemRow {
  id: number;
  user_id: number;
  list_name: string;
  text: string;
  done: number;
  created_at: number;
}

export interface ChatSummaryRow {
  chat_id: number;
  summary: string;
  updated_at: number;
}

export interface ConversationEpisodeRow {
  id: number;
  chat_id: number;
  user_id: number;
  topic: string;
  summary: string;
  created_at: number;
}
