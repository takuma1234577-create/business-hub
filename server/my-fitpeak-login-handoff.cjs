/**
 * My FITPEAK: LINEログインの引き渡し
 *
 * スマホのブラウザ（Safari・Googleアプリなど）で「LINEでログイン」を押すと、LINEアプリが開いて
 * ログインはLINEアプリの中で終わる。元のブラウザはログインされないまま残っていた。
 *
 * 流れ:
 *   元のブラウザ: createHandoff → { id, pollKey, code } を受け取り、id だけをLINEへ渡す
 *   LINEアプリ  : describeHandoff で番号(code)を表示 → 本人が「ログインする」を押す → approveHandoff
 *   元のブラウザ: claimHandoff(id, pollKey) を繰り返し確認 → 承認済みならログイン用トークンを受け取る
 *
 * 安全のため:
 *   - 受け取りには pollKey が必要（元のブラウザにだけある。DBには sha256 だけ保存）
 *   - 承認は本人がLINEの画面で番号を確かめて押したときだけ。1回限り・10分で失効
 *   - 受け取りも1回限り
 */

const crypto = require('crypto');

const TTL_MS = 10 * 60 * 1000;
const TABLE = 'myfp_login_handoffs';

const rand = (bytes) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const iso = (ms) => new Date(ms).toISOString();

function expired(row, now) {
  return Date.parse(row.expires_at) <= now;
}

async function createHandoff(store, now = Date.now()) {
  const id = rand(18);
  const pollKey = rand(32);
  const code = String(crypto.randomInt(10, 100));
  await store.insert({
    id,
    poll_hash: sha256(pollKey),
    code,
    status: 'pending',
    created_at: iso(now),
    expires_at: iso(now + TTL_MS),
  });
  return { id, pollKey, code };
}

// LINEの画面に出す情報（番号だけ。誰のログインかは出さない）
async function describeHandoff(store, id, now = Date.now()) {
  const row = id ? await store.get(String(id)) : null;
  if (!row) return { status: 'invalid' };
  if (row.status === 'pending' && expired(row, now)) return { status: 'expired' };
  if (row.status !== 'pending') return { status: 'done' };
  return { status: 'pending', code: row.code };
}

async function approveHandoff(store, id, profile, now = Date.now()) {
  if (!id || !profile?.lineUserId) return { ok: false };
  const row = await store.transition(String(id), 'pending', {
    status: 'approved',
    line_user_id: profile.lineUserId,
    display_name: profile.displayName || null,
    email: profile.email || null,
    approved_at: iso(now),
  }, iso(now));
  return { ok: !!row };
}

async function claimHandoff(store, id, pollKey, now = Date.now()) {
  const row = id ? await store.get(String(id)) : null;
  if (!row || !pollKey || row.poll_hash !== sha256(pollKey)) return { status: 'invalid' };
  if (row.status === 'pending') return expired(row, now) ? { status: 'expired' } : { status: 'pending' };
  if (row.status !== 'approved') return { status: 'invalid' };
  if (expired(row, now)) return { status: 'expired' };
  const used = await store.transition(row.id, 'approved', { status: 'used', used_at: iso(now) }, iso(now));
  if (!used) return { status: 'invalid' };
  return {
    status: 'approved',
    profile: { lineUserId: row.line_user_id, displayName: row.display_name, email: row.email || null },
  };
}

// ── 保存先 ────────────────────────────────────────────────────────────────
// transition(id, from, patch, nowIso): status が from かつ期限内のときだけ更新し、更新後の行を返す（無ければ null）

function supabaseStore(admin) {
  return {
    async insert(row) {
      const { error } = await admin.from(TABLE).insert(row);
      if (error) throw new Error(`ログインの準備に失敗しました: ${error.message}`);
    },
    async get(id) {
      const { data } = await admin.from(TABLE).select('*').eq('id', id).maybeSingle();
      return data || null;
    },
    async transition(id, from, patch, nowIso) {
      const { data, error } = await admin.from(TABLE).update(patch)
        .eq('id', id).eq('status', from).gt('expires_at', nowIso)
        .select('*');
      if (error) throw new Error(error.message);
      return (data && data[0]) || null;
    },
  };
}

function memoryStore() {
  const rows = new Map();
  return {
    async insert(row) { rows.set(row.id, { ...row }); },
    async get(id) { const r = rows.get(id); return r ? { ...r } : null; },
    async transition(id, from, patch, nowIso) {
      const r = rows.get(id);
      if (!r || r.status !== from || Date.parse(r.expires_at) <= Date.parse(nowIso)) return null;
      Object.assign(r, patch);
      return { ...r };
    },
  };
}

module.exports = { createHandoff, describeHandoff, approveHandoff, claimHandoff, supabaseStore, memoryStore, TTL_MS };
