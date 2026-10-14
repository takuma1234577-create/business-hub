/**
 * 毎日のログインポイント＋クレアショットチャレンジ（仕様書 v1・2026-10-13 宇良確定）
 *
 * 会員向け: /api/my-fitpeak/loyalty/*（my-fitpeak-auth.cjs の後ろ。本人は Supabase の JWT で確認済み）
 *   GET  /                         状態（残高・連続・未抽選のチャレンジ・履歴）
 *   POST /login                    今日のログインを記録してポイントを付ける（画面を開いたら呼ぶ）
 *   POST /challenges/:id/draw      クレアショットチャレンジを引く
 *   POST /link                     定期契約を紐づける（注文番号＋注文時のメール）
 * 管理: /api/loyalty/*（authMiddleware の後ろ）
 *   GET|POST /cron                 期限切れのチャレンジ・仮押さえ・ポイントの処理（daily-cron から）
 *
 * ポイント・抽選の結果はすべて DB 関数（migrations/2026-10-14-login-points-challenge.sql の lp_*）が決める。
 * ここは「誰の依頼か」を確かめて関数に渡すだけで、画面から来た会員ID・ポイント数・日付は一切使わない。
 */
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// DB 関数のエラー → 画面向けの状態コードと文言
const ERRORS = [
  [/challenge_not_found/, 404, 'チャレンジが見つかりません'],
  [/challenge_expired/, 410, 'チャレンジの期限（30日）が過ぎています'],
  [/not_eligible/, 403, 'クレアショット定期購入中の方が対象です'],
  [/member_not_found/, 404, '会員情報が見つかりません'],
  [/subscription_taken/, 409, 'この定期購入はすでに別のアカウントに紐づいています。心当たりがない場合はLINEでご連絡ください。'],
];

function sendError(res, err, where) {
  const msg = String(err && err.message);
  for (const [re, status, text] of ERRORS) {
    if (re.test(msg)) return res.status(status).json({ error: text, code: msg.match(re)[0] });
  }
  console.error(`[loyalty] ${where}:`, msg);
  return res.status(500).json({ error: '処理に失敗しました。時間をおいてお試しください。' });
}

// 紐づけの総当たり対策（1時間に10回まで）
function createAttemptLimiter(max = 10, windowMs = 60 * 60 * 1000) {
  const attempts = new Map();
  return (key) => {
    const now = Date.now();
    const list = (attempts.get(key) || []).filter((t) => now - t < windowMs);
    list.push(now);
    attempts.set(key, list);
    return list.length > max;
  };
}

function createMemberRouter(deps) {
  const router = express.Router();
  const tooMany = createAttemptLimiter();

  // 本人の会員IDだけを使う。管理トークンでの代理操作も受け付けない
  async function requireMember(req, res) {
    const user = req.fitpeakUser;
    if (!user || !user.id) {
      res.status(401).json({ error: 'ログインが必要です' });
      return null;
    }
    const memberId = await deps.findMemberIdByAuthUser(user.id);
    if (!memberId) {
      res.status(404).json({ error: '会員情報が見つかりません' });
      return null;
    }
    // 確認済みのメールでログインしている人は、同じメールの定期契約を自動で紐づける
    if (user.email && user.email_confirmed_at) {
      await deps.rpc('lp_link_by_email', { p_member: memberId, p_email: user.email });
    }
    return memberId;
  }

  router.get('/', async (req, res) => {
    try {
      const memberId = await requireMember(req, res);
      if (!memberId) return;
      res.json(await deps.rpc('lp_status', { p_member: memberId }));
    } catch (err) { sendError(res, err, 'GET /'); }
  });

  router.post('/login', async (req, res) => {
    try {
      const memberId = await requireMember(req, res);
      if (!memberId) return;
      const login = await deps.rpc('lp_daily_login', { p_member: memberId });
      const status = await deps.rpc('lp_status', { p_member: memberId });
      res.json({ login, status });
    } catch (err) { sendError(res, err, 'POST /login'); }
  });

  router.post('/challenges/:id/draw', async (req, res) => {
    try {
      const memberId = await requireMember(req, res);
      if (!memberId) return;
      if (!UUID.test(req.params.id)) return res.status(400).json({ error: '不正なリクエストです' });
      res.json(await deps.rpc('lp_draw_challenge', { p_member: memberId, p_draw_id: req.params.id }));
    } catch (err) { sendError(res, err, 'POST /challenges/draw'); }
  });

  // 定期契約の紐づけ：注文番号＋注文時のメールアドレスの一致（仕様書 第12項）
  router.post('/link', async (req, res) => {
    try {
      const memberId = await requireMember(req, res);
      if (!memberId) return;
      if (tooMany(req.fitpeakUser.id)) {
        return res.status(429).json({ error: '試行回数が多すぎます。1時間ほど空けてお試しください。' });
      }
      const num = String(req.body?.orderNumber || '').replace(/\D/g, '');
      const email = String(req.body?.email || '').trim().toLowerCase();
      if (!num || !email) return res.status(400).json({ error: '注文番号とメールアドレスを入力してください' });

      const NOT_FOUND = { error: '注文が見つかりませんでした。注文番号と、注文時のメールアドレスをご確認ください。' };
      const order = await deps.findShopifyOrder(num);
      if (!order || String(order.email || '').trim().toLowerCase() !== email) return res.status(404).json(NOT_FOUND);

      const r = await deps.rpc('lp_link_subscription', {
        p_member: memberId,
        p_order_id: String(order.id),
        p_customer_id: order.customerId ? String(order.customerId) : null,
      });
      if (!r.linked) return res.status(404).json({ error: 'この注文に紐づく定期購入が見つかりませんでした' });
      res.json({ linked: r.linked });
    } catch (err) { sendError(res, err, 'POST /link'); }
  });

  return router;
}

function createAdminRouter(deps) {
  const router = express.Router();
  const cron = async (_req, res) => {
    try {
      const expiredChallenges = await deps.rpc('lp_expire_challenges');
      const releasedHolds = await deps.rpc('lp_release_expired_holds');
      const expiredPoints = await deps.rpc('lp_expire_points');
      res.json({ expiredChallenges, releasedHolds, expiredPoints });
    } catch (err) { sendError(res, err, 'cron'); }
  };
  router.get('/cron', cron);
  router.post('/cron', cron);
  return router;
}

// ── 本番の依存（Supabase・Shopify） ─────────────────────────
function productionDeps() {
  let client = null;
  const db = () => {
    if (client) return client;
    const url = (process.env.SUPABASE_URL || '').trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    // lp_* 関数は service_role にだけ実行権限がある。anon キーでの代用はしない
    if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
    client = createClient(url, key, { auth: { persistSession: false } });
    return client;
  };
  return {
    async rpc(fn, args = {}) {
      const { data, error } = await db().rpc(fn, args);
      if (error) throw new Error(error.message);
      return data;
    },
    async findMemberIdByAuthUser(authUserId) {
      const { data, error } = await db().from('members').select('id').eq('auth_user_id', authUserId).maybeSingle();
      if (error) throw new Error(error.message);
      return data?.id || null;
    },
    async findShopifyOrder(num) {
      const { shopifyGraphQL, numericId } = require('./subscription.cjs')._internal;
      const data = await shopifyGraphQL(
        `query($q: String!) { orders(first: 1, query: $q) { nodes { legacyResourceId name email customer { id } } } }`,
        { q: `name:#${num}` },
      );
      const o = data?.orders?.nodes?.[0];
      if (!o || o.name.replace(/\D/g, '') !== num) return null;
      return { id: String(o.legacyResourceId), name: o.name, email: o.email, customerId: numericId(o.customer?.id) };
    },
  };
}

module.exports = { createMemberRouter, createAdminRouter, productionDeps };
