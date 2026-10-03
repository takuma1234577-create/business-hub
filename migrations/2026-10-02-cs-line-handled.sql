-- カスタマーサービス部門（AI組織）のLINE返信: 処理済みの記録。シャドー中の返信案、自動送信、人に回した、返信不要を区別する。
create table if not exists cs_line_handled (
  incoming_message_id uuid primary key,
  friend_id uuid,
  outcome text not null check (outcome in ('shadow', 'replied', 'handoff', 'skip')),
  draft text,
  reason text,
  at timestamptz not null default now()
);
create index if not exists idx_cs_line_handled_at on cs_line_handled(at desc);
alter table cs_line_handled enable row level security;
