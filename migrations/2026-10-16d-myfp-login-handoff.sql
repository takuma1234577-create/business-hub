-- My FITPEAK: スマホのブラウザ→LINEアプリでログインしたとき、元のブラウザへログインを引き渡す
-- server/my-fitpeak-login-handoff.cjs が service_role で読み書きする。画面側(anon/authenticated)からは触れない
create table if not exists public.myfp_login_handoffs (
  id text primary key,
  poll_hash text not null,          -- 元のブラウザだけが持つ合言葉の sha256
  code text not null,               -- LINEの画面と元のブラウザに出す確認番号
  status text not null default 'pending' check (status in ('pending','approved','used')),
  line_user_id text,
  display_name text,
  email text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  approved_at timestamptz,
  used_at timestamptz
);
create index if not exists myfp_login_handoffs_expires_idx on public.myfp_login_handoffs (expires_at);
alter table public.myfp_login_handoffs enable row level security;
revoke all on public.myfp_login_handoffs from anon, authenticated;
