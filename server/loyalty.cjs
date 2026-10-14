/**
 * 毎日のログインポイント＋クレアショットチャレンジ（仕様書 v1・2026-10-13 宇良確定）
 *
 * 会員向け: /api/my-fitpeak/loyalty/*（my-fitpeak-auth.cjs の後ろ。本人は Supabase の JWT で確認済み）
 *   GET  /                         状態（残高・連続・未抽選のチャレンジ・履歴）
 *   POST /login                    今日のログインを記録してポイントを付ける（画面を開いたら呼ぶ）
 *   POST /challenges/:id/draw      クレアショットチャレンジを引く
 *   POST /link                     定期契約を紐づける（注文番号＋注文時のメール）
 *   POST /redeem                   ポイントを使う：1回限りの割引コードを発行（仮押さえ）して fitpeak.co へ戻すURLを返す
 *   POST /redeem/:holdId/cancel    発行した割引コードをやめる（コードを消してからポイントを戻す）
 *   GET  /billing-prefs            定期の請求でポイントを使う設定
 *   PUT  /billing-prefs/:subId     同上を変更（none / all / fixed）
 * 管理: /api/loyalty/*（authMiddleware の後ろ）
 *   GET|POST /cron                 期限切れのチャレンジ・仮押さえ・ポイントの処理（daily-cron から）
 *   GET  /health                   割引コード発行に必要な Shopify の権限（write_discounts）があるか
 * Webhook・課金処理から呼ぶ（subscription.cjs）: onOrderCreated / onOrderRefunded /
 *   prepareBillingDiscount / onBillingSucceeded / onBillingExhausted / onSubscriptionCancelled
 *
 * ポイント・抽選の結果はすべて DB 関数（migrations/2026-10-14-login-points-challenge.sql の lp_*）が決める。
 * ここは「誰の依頼か」を確かめて関数に渡すだけで、画面から来た会員ID・ポイント数・日付は一切使わない。
 */
const crypto = require('crypto');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const SHOP_ORIGIN = 'https://fitpeak.co';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 見間違えやすい I O 0 1 は使わない
// 割引コードは仮押さえ（24時間）より先に切れるようにする。仮押さえが時間切れで戻ったあとにコードが使われないため
const CODE_EXPIRY_MARGIN_MS = 10 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// DB 関数のエラー → 画面向けの状態コードと文言
const ERRORS = [
  [/challenge_not_found/, 404, 'チャレンジが見つかりません'],
  [/challenge_expired/, 410, 'チャレンジの期限（30日）が過ぎています'],
  [/not_eligible/, 403, 'クレアショット定期購入中の方が対象です'],
  [/member_not_found/, 404, '会員情報が見つかりません'],
  [/insufficient_points/, 400, 'ポイントが足りません'],
  [/subscription_not_found/, 404, '定期購入が見つかりません'],
  [/invalid_mode|invalid_points/, 400, '設定の内容が正しくありません'],
  [/hold_not_found/, 404, '見つかりません'],
  [/not_held/, 409, 'すでに使われたか、取り消されています'],
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

  // ── ポイントを使う（購入時）：1回限りの割引コード ───────────────
  router.post('/redeem', async (req, res) => {
    try {
      const memberId = await requireMember(req, res);
      if (!memberId) return;
      const points = req.body?.points;
      if (!Number.isInteger(points) || points <= 0) return res.status(400).json({ error: '使うポイント数を正しく入力してください' });
      const redirect = safeRedirect(req.body?.redirect);
      const r = await issueCheckoutCode(deps, memberId, points);
      res.json({ ...r, url: `${SHOP_ORIGIN}/discount/${r.code}?redirect=${encodeURIComponent(redirect)}` });
    } catch (err) {
      if (err.shopify) return res.status(502).json({ error: '割引コードを作れませんでした。ポイントは戻しています。時間をおいてお試しください。' });
      sendError(res, err, 'POST /redeem');
    }
  });

  router.post('/redeem/:holdId/cancel', async (req, res) => {
    try {
      const memberId = await requireMember(req, res);
      if (!memberId) return;
      if (!UUID.test(req.params.holdId)) return res.status(400).json({ error: '不正なリクエストです' });
      const hold = await deps.findHoldById(req.params.holdId);
      if (!hold || hold.member_id !== memberId || hold.purpose !== 'checkout') return res.status(404).json({ error: '見つかりません' });
      if (hold.status !== 'held') return res.status(409).json({ error: 'すでに使われたか、取り消されています' });
      // 先にコードを消す。消せないままポイントだけ戻すと、コードとポイントの両方が使えてしまう
      if (hold.shopify_discount_id) await deleteDiscountCode(deps, hold.shopify_discount_id);
      await deps.rpc('lp_release_hold', { p_hold_id: hold.id, p_reason: 'cancelled_by_member' });
      res.json({ ok: true });
    } catch (err) {
      if (err.shopify) return res.status(502).json({ error: '取り消せませんでした。時間をおいてお試しください。' });
      sendError(res, err, 'POST /redeem/cancel');
    }
  });

  // ── ポイントを使う（定期の請求）：設定 ─────────────────────────
  router.get('/billing-prefs', async (req, res) => {
    try {
      const memberId = await requireMember(req, res);
      if (!memberId) return;
      res.json(await deps.rpc('lp_billing_prefs', { p_member: memberId }));
    } catch (err) { sendError(res, err, 'GET /billing-prefs'); }
  });

  router.put('/billing-prefs/:subId', async (req, res) => {
    try {
      const memberId = await requireMember(req, res);
      if (!memberId) return;
      if (!UUID.test(req.params.subId)) return res.status(400).json({ error: '不正なリクエストです' });
      const mode = String(req.body?.mode || '');
      const points = mode === 'fixed' ? req.body?.points : null;
      if (mode === 'fixed' && (!Number.isInteger(points) || points <= 0)) {
        return res.status(400).json({ error: '使うポイント数を正しく入力してください' });
      }
      await deps.rpc('lp_set_billing_pref', { p_member: memberId, p_subscription_id: req.params.subId, p_mode: mode, p_points: points });
      res.json({ ok: true });
    } catch (err) { sendError(res, err, 'PUT /billing-prefs'); }
  });

  return router;
}

// 戻り先は fitpeak.co の中のパスだけ（外部サイトへの転送に使われないように）
function safeRedirect(v) {
  const s = String(v || '');
  return /^\/(?![\/\\])[A-Za-z0-9\-._~\/?=&%]*$/.test(s) ? s : '/cart';
}

function randomCode() {
  let s = 'MFP';
  for (let i = 0; i < 16; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s;
}

const gidOf = (type, id) => (String(id).startsWith('gid://') ? String(id) : `gid://shopify/${type}/${id}`);

function shopifyError(err) {
  return Object.assign(new Error(`Shopify: ${err.message}`), { shopify: true });
}

function userErrors(payload, label) {
  const errs = payload?.userErrors || [];
  if (errs.length) throw new Error(`${label}: ${errs.map((e) => e.message).join(' / ')}`);
  return payload;
}

async function issueCheckoutCode(deps, memberId, points) {
  const code = randomCode();
  const holdId = await deps.rpc('lp_hold_points', {
    p_member: memberId, p_amount: points, p_purpose: 'checkout', p_discount_code: code, p_subscription_id: null, p_cycle_no: null,
  });
  const hold = await deps.findHoldById(holdId);
  const endsAt = new Date(new Date(hold.expires_at).getTime() - CODE_EXPIRY_MARGIN_MS).toISOString();
  const customerId = await deps.memberShopifyCustomerId(memberId);
  let discountId;
  try {
    const data = await deps.shopify(
      `mutation($input: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $input) { codeDiscountNode { id } userErrors { field message } }
      }`,
      {
        input: {
          title: `My FITPEAKポイント ${points}pt（${holdId}）`,
          code,
          startsAt: new Date().toISOString(),
          endsAt,
          usageLimit: 1,
          // 本人の Shopify 顧客が分かればその人専用にする
          context: customerId ? { customers: { add: [gidOf('Customer', customerId)] } } : { all: 'ALL' },
          customerGets: {
            value: { discountAmount: { amount: String(points), appliesOnEachItem: false } },
            items: { all: true },
            appliesOnOneTimePurchase: true,
            appliesOnSubscription: true,
          },
          // 定期購入に使ったときは初回の1回だけ割り引く（2回目以降は請求ごとの設定で使う）
          recurringCycleLimit: 1,
        },
      },
    );
    discountId = userErrors(data?.discountCodeBasicCreate, 'discountCodeBasicCreate').codeDiscountNode.id;
  } catch (err) {
    console.error('[loyalty] 割引コード作成失敗:', err.message);
    await deps.rpc('lp_release_hold', { p_hold_id: holdId, p_reason: 'shopify_error' });
    throw shopifyError(err);
  }
  await deps.rpc('lp_set_hold_discount', { p_hold_id: holdId, p_discount_id: discountId });
  return { code, hold_id: holdId, points, expires_at: endsAt };
}

async function deleteDiscountCode(deps, discountId) {
  try {
    const data = await deps.shopify(
      `mutation($id: ID!) { discountCodeDelete(id: $id) { deletedCodeDiscountId userErrors { field message } } }`,
      { id: discountId },
    );
    userErrors(data?.discountCodeDelete, 'discountCodeDelete');
  } catch (err) {
    throw shopifyError(err);
  }
}

// ── 注文作成 Webhook：使われた割引コードの仮押さえを確定 ─────────────
async function onOrderCreated(deps, order) {
  const results = [];
  for (const dc of order?.discount_codes || []) {
    const code = String(dc.code || '').trim().toUpperCase();
    if (!/^MFP[A-Z0-9]{16}$/.test(code)) continue;
    const hold = await deps.findHoldByCode(code);
    if (!hold) continue;
    const applied = Math.round(Number(dc.amount));
    try {
      results.push(await deps.rpc('lp_confirm_hold', { p_hold_id: hold.id, p_shopify_order_id: String(order.id), p_discount_amount: applied }));
    } catch (err) {
      console.error('[loyalty] 仮押さえの確定失敗:', code, err.message);
      await deps.notify(`【ポイント】注文 ${order.id} の割引コード確定に失敗しました（${err.message}）。割引額 ${dc.amount} 円。帳簿と注文を確認してください。`);
    }
  }
  return results;
}

// 返金・キャンセルで戻すポイント（累計）。キャンセルは全額、それ以外はお金の返金割合（全額ポイント払いなら返品個数の割合）
function computeRefundTarget(order, used) {
  if (!order || !used) return 0;
  if (order.cancelledAt) return used;
  const total = Number(order.totalPriceSet?.shopMoney?.amount || 0);
  const refunded = Number(order.totalRefundedSet?.shopMoney?.amount || 0);
  if (total > 0) return Math.floor(used * Math.min(1, refunded / total));
  const lines = order.lineItems?.nodes || [];
  const qty = lines.reduce((a, l) => a + (l.quantity || 0), 0);
  const left = lines.reduce((a, l) => a + (l.refundableQuantity || 0), 0);
  return qty > 0 ? Math.floor((used * (qty - left)) / qty) : 0;
}

// 返金・キャンセル Webhook。累計の目標値まで戻す（同じ目標値は二度戻さない＝再配信・順不同に強い）
async function onOrderRefunded(deps, orderId) {
  const holds = await deps.findUsedHoldsByOrder(String(orderId));
  if (!holds.length) return [];
  const data = await deps.shopify(
    `query($id: ID!) { order(id: $id) {
      cancelledAt
      totalPriceSet { shopMoney { amount } }
      totalRefundedSet { shopMoney { amount } }
      lineItems(first: 100) { nodes { quantity refundableQuantity } }
    } }`,
    { id: gidOf('Order', orderId) },
  );
  const results = [];
  for (const hold of holds) {
    const used = hold.used_amount || hold.amount;
    const target = computeRefundTarget(data?.order, used);
    const delta = target - (hold.refunded || 0);
    if (delta <= 0) continue;
    results.push(await deps.rpc('lp_refund_points', {
      p_hold_id: hold.id, p_amount: delta, p_idempotency_key: `refund:${hold.id}:${target}`,
    }));
  }
  return results;
}

// ── 定期の請求 ─────────────────────────────────────────
const billingTitle = (holdId) => `My FITPEAKポイント（${holdId}）`;

async function contractDraft(deps, contractId) {
  const data = await deps.shopify(
    `mutation($id: ID!) { subscriptionContractUpdate(contractId: $id) { draft { id } userErrors { field message } } }`,
    { id: gidOf('SubscriptionContract', contractId) },
  );
  return userErrors(data?.subscriptionContractUpdate, 'subscriptionContractUpdate').draft.id;
}

async function commitDraft(deps, draftId) {
  const data = await deps.shopify(
    `mutation($id: ID!) { subscriptionDraftCommit(draftId: $id) { contract { id } userErrors { field message } } }`,
    { id: draftId },
  );
  userErrors(data?.subscriptionDraftCommit, 'subscriptionDraftCommit');
}

async function removeContractDiscount(deps, contractId, discountId) {
  const draftId = await contractDraft(deps, contractId);
  const data = await deps.shopify(
    `mutation($draftId: ID!, $discountId: ID!) {
      subscriptionDraftDiscountRemove(draftId: $draftId, discountId: $discountId) { discountRemoved { id } userErrors { field message } }
    }`,
    { draftId, discountId },
  );
  userErrors(data?.subscriptionDraftDiscountRemove, 'subscriptionDraftDiscountRemove');
  await commitDraft(deps, draftId);
}

/**
 * 請求の直前に呼ぶ。設定があればポイントを仮押さえして、契約に1回限りの割引を付ける。
 * 失敗しても請求は止めない（割引を付ける前ならポイントを戻し、通常の金額で請求させる）。
 */
async function prepareBillingDiscount(deps, sub, cycleNo) {
  const price = Math.floor(Number(sub.amount) || 0);
  const r = await deps.rpc('lp_hold_for_billing', { p_subscription_id: sub.id, p_cycle_no: cycleNo, p_price: price });
  if (!r || r.status !== 'held' || r.discount_id) return r || null;

  let committed = false;
  try {
    // 前回、割引は付いたのに記録に失敗していたら、それを使う（二重に付けない）
    const found = await deps.shopify(
      `query($id: ID!) { subscriptionContract(id: $id) { discounts(first: 50) { nodes { id title } } } }`,
      { id: gidOf('SubscriptionContract', sub.shopify_contract_id) },
    );
    const existing = (found?.subscriptionContract?.discounts?.nodes || []).find((d) => d.title === billingTitle(r.hold_id));
    let discountId = existing?.id;
    if (!discountId) {
      const draftId = await contractDraft(deps, sub.shopify_contract_id);
      const added = await deps.shopify(
        `mutation($draftId: ID!, $input: SubscriptionManualDiscountInput!) {
          subscriptionDraftDiscountAdd(draftId: $draftId, input: $input) { discountAdded { id } userErrors { field message } }
        }`,
        {
          draftId,
          input: {
            title: billingTitle(r.hold_id),
            value: { fixedAmount: { amount: r.amount, appliesOnEachItem: false } },
            recurringCycleLimit: 1,
          },
        },
      );
      discountId = userErrors(added?.subscriptionDraftDiscountAdd, 'subscriptionDraftDiscountAdd').discountAdded.id;
      await commitDraft(deps, draftId);
    }
    committed = true;
    await deps.rpc('lp_set_hold_discount', { p_hold_id: r.hold_id, p_discount_id: discountId });
    return { ...r, discount_id: discountId };
  } catch (err) {
    console.error('[loyalty] 請求の割引を付けられませんでした:', sub.id, err.message);
    if (!committed) {
      await deps.rpc('lp_release_hold', { p_hold_id: r.hold_id, p_reason: 'shopify_error' });
      return null;
    }
    // 割引は付いた（記録だけ失敗）。ポイントを戻すと割引だけ効いてしまうので、仮押さえは残す
    await deps.notify(`【ポイント】契約 ${sub.shopify_contract_id} の割引IDの記録に失敗しました（${err.message}）。次の処理で契約の割引から記録し直します。`);
    return r;
  }
}

async function onBillingSucceeded(deps, sub, cycleNo, orderId) {
  const hold = await deps.findBillingHold(sub.id, cycleNo);
  if (!hold || hold.status !== 'held') return null;
  const data = await deps.shopify(
    `query($id: ID!) { order(id: $id) { totalDiscountsSet { shopMoney { amount } } } }`,
    { id: gidOf('Order', orderId) },
  );
  const applied = Math.min(hold.amount, Math.floor(Number(data?.order?.totalDiscountsSet?.shopMoney?.amount || 0)));
  if (applied <= 0) {
    // 割引が効かずに請求された：契約の割引を外してからポイントを戻す
    await deps.notify(`【ポイント】契約 ${sub.shopify_contract_id} の請求（注文 ${orderId}）にポイント割引が反映されていませんでした。ポイントは戻します。`);
    return onBillingExhausted(deps, sub, cycleNo);
  }
  return deps.rpc('lp_confirm_billing_hold', { p_subscription_id: sub.id, p_cycle_no: cycleNo, p_order_id: String(orderId), p_applied: applied });
}

// 課金が最終的に失敗：契約の割引を外してからポイントを戻す（外せなければ戻さない＝割引だけ効くのを防ぐ）
async function onBillingExhausted(deps, sub, cycleNo) {
  const hold = await deps.findBillingHold(sub.id, cycleNo);
  if (!hold || hold.status !== 'held') return null;
  if (hold.shopify_discount_id) await removeContractDiscount(deps, sub.shopify_contract_id, hold.shopify_discount_id);
  return deps.rpc('lp_release_billing_hold', { p_subscription_id: sub.id, p_cycle_no: cycleNo, p_reason: 'billing_failed' });
}

// 解約：契約はもう請求されないので先にポイントを戻し、割引の取り外しは可能なら行う
async function onSubscriptionCancelled(deps, sub) {
  const ids = await deps.rpc('lp_release_subscription_holds', { p_subscription_id: sub.id, p_reason: 'subscription_cancelled' });
  for (const id of ids || []) {
    try {
      await removeContractDiscount(deps, sub.shopify_contract_id, id);
    } catch (err) {
      console.error('[loyalty] 解約後の割引取り外し失敗（契約は解約済み）:', err.message);
    }
  }
  return ids;
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
  router.get('/health', async (_req, res) => {
    try {
      const data = await deps.shopify('{ currentAppInstallation { accessScopes { handle } } }');
      const scopes = (data?.currentAppInstallation?.accessScopes || []).map((s) => s.handle);
      res.json({ write_discounts: scopes.includes('write_discounts'), write_own_subscription_contracts: scopes.includes('write_own_subscription_contracts') });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
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
    async shopify(query, variables) {
      return require('./subscription.cjs')._internal.shopifyGraphQL(query, variables);
    },
    async findHoldById(id) {
      const { data, error } = await db().from('point_holds').select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async findHoldByCode(code) {
      const { data, error } = await db().from('point_holds').select('*').eq('discount_code', code).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async findUsedHoldsByOrder(orderId) {
      const { data, error } = await db().from('point_holds').select('*').eq('shopify_order_id', orderId).eq('status', 'used');
      if (error) throw new Error(error.message);
      return data || [];
    },
    async findBillingHold(subId, cycleNo) {
      const { data, error } = await db().from('point_holds').select('*').eq('subscription_id', subId).eq('cycle_no', cycleNo).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async memberShopifyCustomerId(memberId) {
      const { data } = await db().from('members').select('shopify_customer_id').eq('id', memberId).maybeSingle();
      return data?.shopify_customer_id || null;
    },
    async notify(text) {
      try {
        await require('./owner-notify.cjs').notifyOwner({ kind: 'info', text: String(text).slice(0, 900) });
      } catch (err) {
        console.error('[loyalty] 通知失敗:', err.message);
      }
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

// subscription.cjs（Webhook・課金処理）から呼ぶ入口。本番の依存を1つだけ作って使い回す
let hooksCache = null;
function hooks() {
  if (hooksCache) return hooksCache;
  const deps = productionDeps();
  hooksCache = {
    onOrderCreated: (order) => onOrderCreated(deps, order),
    onOrderRefunded: (orderId) => onOrderRefunded(deps, orderId),
    prepareBillingDiscount: (sub, cycleNo) => prepareBillingDiscount(deps, sub, cycleNo),
    onBillingSucceeded: (sub, cycleNo, orderId) => onBillingSucceeded(deps, sub, cycleNo, orderId),
    onBillingExhausted: (sub, cycleNo) => onBillingExhausted(deps, sub, cycleNo),
    onSubscriptionCancelled: (sub) => onSubscriptionCancelled(deps, sub),
  };
  return hooksCache;
}

module.exports = {
  createMemberRouter, createAdminRouter, productionDeps, hooks,
  onOrderCreated, onOrderRefunded, computeRefundTarget,
  prepareBillingDiscount, onBillingSucceeded, onBillingExhausted, onSubscriptionCancelled,
};
