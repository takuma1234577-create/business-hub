// 合トレ仲間さがし（gotore）のDBテスト用ハーネス。
// PGlite に本番と同じ形の members 表を作り、本番と同じマイグレーションを流す。
// 時刻は gt_now() を差し替えてテストから動かす（本番の gt_now() は now() 固定）。
const fs = require('fs');
const path = require('path');

const MIGRATIONS = ['2026-10-16-gotore.sql', '2026-10-16b-gotore-line.sql', '2026-10-16c-gotore-shortlink.sql', '2026-10-17-gotore-overview.sql', '2026-10-17b-member-profiles.sql', '2026-10-17c-gotore-pulse.sql'].map((f) => path.join(__dirname, '../../../migrations', f));

// 本番 fajqnrqfjugonbssssts の members（2026-10-16 時点。テストに要る列だけ）
const EXISTING = `
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $$ begin
  create role anon; create role authenticated; create role service_role;
exception when duplicate_object then null; end $$;
create table members (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  line_user_id text unique,
  email text,
  nickname text,
  source text,
  created_at timestamptz default now()
);
grant all on all tables in schema public to anon, authenticated, service_role;
-- Supabase の auth.uid() の代わり（テストでは set_config('test.uid', …) で本人を決める）
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
`;

const TEST_CLOCK = `
create table test_clock (id int primary key default 1, at timestamptz not null);
insert into test_clock (at) values ('2026-10-16T03:00:00Z');
create or replace function gt_now() returns timestamptz language sql stable as $$ select at from test_clock where id = 1 $$;
`;

async function createDb() {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(EXISTING);
  for (const f of MIGRATIONS) await db.exec(fs.readFileSync(f, 'utf8'));
  await db.exec(TEST_CLOCK);

  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  let seq = 0;
  const h = {
    db,
    one,
    addDays: (n) => db.query(`update test_clock set at = at + $1::float8 * interval '1 day'`, [n]),
    addMinutes: (n) => db.query(`update test_clock set at = at + $1::float8 * interval '1 minute'`, [n]),
    async gym(handle = 'gym-a', name = 'ONE STEP', pref = '東京都', city = '渋谷区') {
      await db.query(`select gt_gym_upsert($1, $2, $3, $4)`, [handle, name, pref, city]);
      return handle;
    },
    // LINEでログイン済みの会員（line_user_id あり）
    async member() {
      seq += 1;
      return (await one(`insert into members (line_user_id) values ($1) returning id`, [`Uline${seq}`])).id;
    },
    // My FITPEAK アカウントのプロフィール（公開＋非公開）。合トレの表示名・性別・年代はここから来る
    async account(memberId, over = {}) {
      const a = { display_name: 'たろう', pref: '東京都', city: '渋谷区', age_band: '25-34', gender: 'male',
                  gyms: [{ kind: 'review', key: 'gym-a', name: 'ONE STEP' }], ...over };
      await call(db, 'mf_public_save', { p_member: memberId, p_display_name: a.display_name, p_pref: a.pref, p_city: a.city,
        p_age_band: a.age_band, p_gender: a.gender, p_gyms: JSON.stringify(a.gyms) });
      if (over.private !== false) {
        await db.query(`insert into member_private_profiles (member_id, last_name, first_name, last_name_kana, first_name_kana, email, purpose_agreed_at)
                        values ($1, '山田', '太郎', 'ヤマダ', 'タロウ', $2, now()) on conflict (member_id) do nothing`,
          [memberId, `real${memberId.slice(0, 8)}@example.com`]);
      }
    },
    // 合トレのプロフィール。nickname/gender/age_band はアカウントに入れてから合トレ側を保存する
    async profile(memberId, over = {}) {
      const { nickname, gender, age_band, ...rest } = over;
      await h.account(memberId, { ...(nickname !== undefined && { display_name: nickname }), ...(gender && { gender }), ...(age_band && { age_band }) });
      const p = { level: 'intermediate', bio: '', agree: true, ...rest };
      return call(db, 'gt_profile_save', { p_member: memberId, ...prefix(p) });
    },
    // auth.uid() を切り替えて本人用の関数を呼ぶ（null＝未ログイン）
    async asUser(authUserId, fn, args = {}) {
      await db.query(`select set_config('test.uid', $1, false)`, [authUserId || '']);
      try { return await call(db, fn, args); } finally { await db.query(`select set_config('test.uid', '', false)`); }
    },
    call: (fn, args) => call(db, fn, args),
  };
  return h;
}

function prefix(o) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [`p_${k}`, v]));
}

async function call(db, fn, args = {}) {
  const keys = Object.keys(args);
  const sql = `select ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
  return (await db.query(sql, keys.map((k) => args[k]))).rows[0].r;
}

// API層テスト用：supabase.rpc と同じ形（名前付き引数）で PGlite の関数を呼ぶ
function pgRpc(db) {
  return async (fn, args = {}) => {
    if (!/^(gt|mf)_[a-z_]+$/.test(fn)) throw new Error('bad fn');
    // supabase.rpc は配列・オブジェクトを JSON で送る。PGlite では jsonb 引数（オブジェクトを含むもの）を文字列にして渡す
    const a = Object.fromEntries(Object.entries(args).map(([k, v]) => [k,
      v && typeof v === 'object' && (!Array.isArray(v) || v.some((x) => x && typeof x === 'object')) ? JSON.stringify(v) : v]));
    return call(db, fn, a);
  };
}

async function rejects(promise, pattern) {
  try {
    await promise;
  } catch (e) {
    if (pattern && !pattern.test(String(e.message))) throw new Error(`想定と違うエラー: ${e.message}`);
    return e;
  }
  throw new Error('エラーになるはずが成功した');
}

module.exports = { createDb, pgRpc, rejects };
