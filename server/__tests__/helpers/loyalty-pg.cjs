// ログインポイント＋クレアショットチャレンジのDBテスト用ハーネス。
// PGlite（WASMの本物のPostgres）に本番と同じ形の既存表を作り、本番と同じマイグレーションを流す。
// 時刻だけは lp_now() を差し替えて、テストから自由に動かせるようにする（本番の lp_now() は now() 固定）。
const fs = require('fs');
const path = require('path');

const MIGRATION = path.join(__dirname, '../../../migrations/2026-10-14-login-points-challenge.sql');

// 本番 fajqnrqfjugonbssssts の既存表（2026-10-14 時点の列と制約を information_schema から写したもの）
const EXISTING = `
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $$ begin
  create role anon; create role authenticated; create role service_role;
exception when duplicate_object then null; end $$;

create table members (
  id uuid primary key default gen_random_uuid(),
  line_user_id text unique,
  email text,
  created_at timestamptz default now()
);
create table user_points (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  email text unique,
  line_user_id text,
  total_points integer default 0,
  available_points integer default 0,
  lifetime_points integer default 0,
  updated_at timestamptz default now(),
  created_at timestamptz default now(),
  member_id uuid references members(id) on delete set null
);
create table point_transactions (
  id uuid primary key default gen_random_uuid(),
  user_points_id uuid not null references user_points(id),
  type text not null check (type in ('earn','spend','expire','adjust')),
  amount integer not null,
  source text not null,
  description text,
  reference_id text,
  shopify_order_id text,
  created_at timestamptz default now()
);
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  shopify_contract_id text not null unique,
  email text not null default 'x@example.com',
  status text not null default 'pending_first_shipment'
    check (status in ('pending_first_shipment','awaiting_delivery','active','past_due','paused','cancelled')),
  member_id uuid references members(id) on delete set null,
  paused_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table subscription_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references subscriptions(id) on delete cascade,
  event_type text not null,
  actor text not null default 'system',
  payload jsonb,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);
grant all on all tables in schema public to anon, authenticated, service_role;
`;

// テスト専用：時刻を表で持ち、lp_now() がそれを返すようにする
const TEST_CLOCK = `
create table test_clock (id int primary key default 1, at timestamptz not null);
insert into test_clock (at) values ('2026-10-14T03:00:00Z');
create or replace function lp_now() returns timestamptz language sql stable as $$ select at from test_clock where id = 1 $$;
`;

async function createDb() {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(EXISTING);
  await db.exec(fs.readFileSync(MIGRATION, 'utf8'));
  await db.exec(TEST_CLOCK);
  await db.exec(`select lp_set_owner_pin('test-pin-1234')`);

  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  const h = {
    db,
    one,
    exec: (sql) => db.exec(sql),
    // 日本時間で指定した時刻に時計を合わせる（'2026-10-14 23:59:59'）
    setJst: (jst) => db.query(`update test_clock set at = ($1::timestamp at time zone 'Asia/Tokyo')`, [jst]),
    // 日本時間の日付（'2026-10-14'）の正午に合わせる
    setDay: (day) => db.query(`update test_clock set at = (($1::date + time '12:00') at time zone 'Asia/Tokyo')`, [day]),
    addDays: (n) => db.query(`update test_clock set at = at + $1::float8 * interval '1 day'`, [n]),
    async member(status = 'active') {
      const m = await one(`insert into members default values returning id`);
      let sub = null;
      if (status) {
        sub = await one(
          `insert into subscriptions (shopify_contract_id, status, member_id) values ($1, $2, $3) returning id`,
          ['gid://test/' + m.id, status, m.id],
        );
      }
      return { id: m.id, subId: sub && sub.id };
    },
    async setStatus(subId, status, eventType) {
      await db.query(`update subscriptions set status = $2 where id = $1`, [subId, status]);
      if (eventType) {
        await db.query(
          `insert into subscription_events (subscription_id, event_type, created_at) values ($1, $2, (select at from test_clock))`,
          [subId, eventType],
        );
      }
    },
    login: (memberId) => one(`select lp_daily_login($1) as r`, [memberId]).then((x) => x.r),
    balance: (memberId) =>
      one(`select coalesce((select available_points from user_points where member_id = $1), 0) as b`, [memberId]).then((x) => x.b),
    async loginDays(memberId, n) {
      let r;
      for (let i = 0; i < n; i++) {
        if (i > 0) await h.addDays(1);
        r = await h.login(memberId);
      }
      return r;
    },
    // service_role（アプリのサーバー権限）として実行
    async asRole(role, sql, params) {
      await db.exec(`set role ${role}`);
      try {
        return await db.query(sql, params);
      } finally {
        await db.exec(`reset role`);
      }
    },
  };
  return h;
}

async function rejects(promise, pattern) {
  try {
    await promise;
  } catch (e) {
    if (pattern && !pattern.test(String(e.message))) {
      throw new Error(`想定と違うエラー: ${e.message}`);
    }
    return e;
  }
  throw new Error('エラーになるはずが成功した');
}

module.exports = { createDb, rejects };
