/**
 * FITPEAK PRO（有料会員）拡張モジュール
 *
 * クレアショットと同じ定期購入エンジン（subscription.cjs）の上で、
 * 「配送のない会員プラン」を扱う。設計：プロジェクト文書 claude/my-fitpeak-pro-sekkei.md
 *
 *   1. Shopify セットアップ: 商品「FITPEAK PRO」の月額・年額バリエーションに
 *      Selling Plan Group を2つ作る。初回（＝14日間の無料期間）は100%OFF、2回目以降は通常価格。
 *   2. 契約作成時: 配送を待たずに active にし、次回課金日＝申込日＋無料期間。
 *      members.plan を 'pro' にして Shopify 顧客タグ fitpeak-pro を付ける（10%OFF・送料無料の判定に使う）。
 *   3. 課金成功: 次回課金日を interval_days 先へ。PRO期限を延長。
 *   4. 課金失敗: リトライ期間中はPROを維持。上限に達したらPROを外す。
 *   5. 解約: 支払い済みの期間（plan_expires_at）まではPROのまま。期限切れは cron で外す。
 *
 * 課金は subscription_settings.billing.cron_enabled が true のときだけ走る（エンジン共通の安全弁）。
 */

const express = require('express');
const crypto = require('crypto');

const adminRouter = express.Router();

const PRO_TAG = 'fitpeak-pro';
const MY_FITPEAK_URL = process.env.MY_FITPEAK_URL || 'https://my.fitpeak.co';
const DAY_MS = 24 * 60 * 60 * 1000;

let _core = null;
function core() {
  if (_core) return _core;
  _core = require('./subscription.cjs')._internal;
  return _core;
}
const db = () => core().db();

// ===========================================================================
// 設定・プラン
// ===========================================================================

async function getProSettings() {
  const settings = await core().getSettings();
  return {
    product_id: '8846485618823',
    lp_url: 'https://fitpeak.co/products/fitpeak-pro',
    customer_tag: PRO_TAG,
    grace_days: 1,
    welcome_line_enabled: true,
    welcome_email_enabled: true,
    ...(settings.fitpeak_pro || {}),
  };
}

function isMembershipPlan(plan) {
  return !!plan && plan.plan_kind === 'membership';
}

async function listProPlans() {
  const ps = await getProSettings();
  const { data } = await db()
    .from('subscription_plans')
    .select('*')
    .eq('shopify_product_id', String(ps.product_id))
    .eq('plan_kind', 'membership')
    .eq('is_active', true)
    .order('sort_order');
  return data || [];
}

async function loadPlan(planId) {
  if (!planId) return null;
  const { data } = await db().from('subscription_plans').select('*').eq('id', planId).maybeSingle();
  return data || null;
}

// ===========================================================================
// 1. Shopify セットアップ（管理API）
// ===========================================================================

const GROUP_DEFS = [
  { code: '1m', planCode: 'pro-1m', name: 'FITPEAK PRO 月額プラン', option: '月額プラン', merchantCode: 'fitpeak-pro-1m', interval: 'MONTH', position: 1 },
  { code: '12m', planCode: 'pro-12m', name: 'FITPEAK PRO 年額プラン', option: '年額プラン', merchantCode: 'fitpeak-pro-12m', interval: 'YEAR', position: 2 },
];

function planDescription(def, plan) {
  const price = Number(plan?.price || 0).toLocaleString('ja-JP');
  const trial = plan?.trial_days || 14;
  const every = def.interval === 'YEAR' ? '1年ごと' : '毎月';
  return `FITPEAK PRO（有料会員）の定期契約です。お申し込みから${trial}日間は無料で、無料期間の終了日に${price}円（税込）が決済され、以降は${every}同額が自動で決済されます。` +
    '回数の縛りはなく、次回決済日の前日までに My FITPEAK（my.fitpeak.co）からいつでも解約できます。無料期間中に解約すれば料金はかかりません。';
}

/**
 * 月額・年額の2つの Selling Plan Group を作成（既存なら再利用）し、プラン行に ID を書き込む。
 * 初回（無料期間）は100%OFF、2回目以降は割引なし（通常価格）。何度実行しても同じ結果になる。
 */
async function setupProSellingPlans() {
  const { shopifyGraphQL, numericId, gid, logEvent } = core();
  const plans = await listProPlans();
  if (plans.length !== 2) throw new Error(`subscription_plans に FITPEAK PRO の2プランが必要です（現在 ${plans.length}件）`);

  const existing = await shopifyGraphQL(`
    query { sellingPlanGroups(first: 50) { nodes { id name merchantCode sellingPlans(first: 5) { nodes { id name } } } } }`);
  const groups = existing?.sellingPlanGroups?.nodes || [];

  const results = [];
  for (const def of GROUP_DEFS) {
    const plan = plans.find((p) => p.plan_code === def.planCode);
    if (!plan) throw new Error(`プラン ${def.planCode} が見つかりません`);
    const variantIds = [gid.variant(plan.shopify_variant_id)];
    let group = groups.find((g) => g.merchantCode === def.merchantCode);

    if (!group) {
      const data = await shopifyGraphQL(
        `mutation($input: SellingPlanGroupInput!, $resources: SellingPlanGroupResourceInput) {
          sellingPlanGroupCreate(input: $input, resources: $resources) {
            sellingPlanGroup { id name merchantCode sellingPlans(first: 5) { nodes { id name } } }
            userErrors { field message }
          }
        }`,
        {
          input: {
            name: def.name,
            merchantCode: def.merchantCode,
            options: ['お支払い'],
            position: def.position,
            description: 'FITPEAK PRO（有料会員）',
            sellingPlansToCreate: [{
              name: `${def.option}（最初の${plan.trial_days || 14}日間無料・いつでも解約可）`,
              options: [def.option],
              position: 1,
              category: 'SUBSCRIPTION',
              description: planDescription(def, plan),
              billingPolicy: { recurring: { interval: def.interval, intervalCount: 1 } },
              deliveryPolicy: { recurring: { interval: def.interval, intervalCount: 1, preAnchorBehavior: 'ASAP' } },
              inventoryPolicy: { reserve: 'ON_SALE' },
              pricingPolicies: [
                // 初回（申込時）＝無料期間。0円で契約し、支払方法だけ登録してもらう
                { fixed: { adjustmentType: 'PERCENTAGE', adjustmentValue: { percentage: 100 } } },
                // 2回目以降は通常価格
                { recurring: { afterCycle: 1, adjustmentType: 'PERCENTAGE', adjustmentValue: { percentage: 0 } } },
              ],
            }],
          },
          resources: { productVariantIds: variantIds },
        },
      );
      const node = data?.sellingPlanGroupCreate;
      const errs = node?.userErrors || [];
      if (errs.length) throw new Error(`sellingPlanGroupCreate(${def.code}): ${errs.map((e) => e.message).join(' / ')}`);
      group = node.sellingPlanGroup;
    } else {
      const data = await shopifyGraphQL(
        `mutation($id: ID!, $ids: [ID!]!) {
          sellingPlanGroupAddProductVariants(id: $id, productVariantIds: $ids) {
            sellingPlanGroup { id }
            userErrors { field message }
          }
        }`,
        { id: group.id, ids: variantIds },
      );
      const errs = data?.sellingPlanGroupAddProductVariants?.userErrors || [];
      if (errs.length && !/already/i.test(errs.map((e) => e.message).join(' '))) {
        throw new Error(`sellingPlanGroupAddProductVariants(${def.code}): ${errs.map((e) => e.message).join(' / ')}`);
      }
    }

    const sellingPlanId = numericId(group.sellingPlans?.nodes?.[0]?.id);
    const groupId = numericId(group.id);
    await db()
      .from('subscription_plans')
      .update({ shopify_selling_plan_group_id: groupId, shopify_selling_plan_id: sellingPlanId })
      .eq('id', plan.id);
    results.push({ code: def.code, group_id: groupId, selling_plan_id: sellingPlanId });
  }

  await logEvent(null, 'fitpeak_pro_setup', 'admin', { results });
  return results;
}

// ===========================================================================
// 2. 会員（members）と Shopify 顧客タグ
// ===========================================================================

async function findOrCreateMember({ email, shopifyCustomerId, lineUserId }) {
  const m = db().from('members');
  let member = null;
  if (shopifyCustomerId) {
    const { data } = await m.select('*').eq('shopify_customer_id', String(shopifyCustomerId)).is('merged_into', null).limit(1).maybeSingle();
    member = data;
  }
  if (!member && email) {
    const { data } = await db().from('members').select('*').ilike('email', email).is('merged_into', null).limit(1).maybeSingle();
    member = data;
  }
  if (!member && lineUserId) {
    const { data } = await db().from('members').select('*').eq('line_user_id', lineUserId).is('merged_into', null).limit(1).maybeSingle();
    member = data;
  }
  if (member) {
    const patch = {};
    if (!member.shopify_customer_id && shopifyCustomerId) patch.shopify_customer_id = String(shopifyCustomerId);
    if (!member.email && email) patch.email = email;
    if (!member.line_user_id && lineUserId) patch.line_user_id = lineUserId;
    if (Object.keys(patch).length) {
      await db().from('members').update(patch).eq('id', member.id);
      member = { ...member, ...patch };
    }
    return member;
  }
  const { data: created, error } = await db()
    .from('members')
    .insert({ email: email || null, shopify_customer_id: shopifyCustomerId ? String(shopifyCustomerId) : null, line_user_id: lineUserId || null, source: 'fitpeak_pro' })
    .select()
    .single();
  if (error) throw new Error(`会員の作成に失敗: ${error.message}`);
  return created;
}

async function setCustomerTag(shopifyCustomerId, on) {
  if (!shopifyCustomerId) return;
  const { shopifyGraphQL } = core();
  const mutation = on ? 'tagsAdd' : 'tagsRemove';
  const data = await shopifyGraphQL(
    `mutation($id: ID!, $tags: [String!]!) { ${mutation}(id: $id, tags: $tags) { userErrors { field message } } }`,
    { id: `gid://shopify/Customer/${shopifyCustomerId}`, tags: [PRO_TAG] },
  );
  const errs = data?.[mutation]?.userErrors || [];
  if (errs.length) throw new Error(`${mutation}: ${errs.map((e) => e.message).join(' / ')}`);
}

/** PROを付与（期限つき）。期限は「次回課金日＋猶予」 */
async function grantPro(sub, expiresAt) {
  const member = await findOrCreateMember({ email: sub.email, shopifyCustomerId: sub.shopify_customer_id, lineUserId: sub.line_user_id });
  await db().from('members').update({ plan: 'pro', plan_expires_at: expiresAt, plan_subscription_id: sub.id }).eq('id', member.id);
  try { await setCustomerTag(sub.shopify_customer_id || member.shopify_customer_id, true); } catch (err) {
    console.error('[fitpeak-pro] 顧客タグ付与に失敗:', err.message);
  }
  await core().logEvent(sub.id, 'pro_granted', 'system', { member_id: member.id, expires_at: expiresAt });
  return member;
}

async function revokeProByMember(member, reason) {
  await db().from('members').update({ plan: 'free' }).eq('id', member.id);
  try { await setCustomerTag(member.shopify_customer_id, false); } catch (err) {
    console.error('[fitpeak-pro] 顧客タグ削除に失敗:', err.message);
  }
  await core().logEvent(member.plan_subscription_id || null, 'pro_revoked', 'system', { member_id: member.id, reason });
}

async function revokeProBySub(sub, reason) {
  const { data: member } = await db().from('members').select('*').eq('plan_subscription_id', sub.id).maybeSingle();
  if (member && member.plan === 'pro') await revokeProByMember(member, reason);
}

function expiryFor(nextBillingIso, graceDays) {
  return new Date(new Date(nextBillingIso).getTime() + (graceDays ?? 1) * DAY_MS).toISOString();
}

// ===========================================================================
// 3. エンジンから呼ばれるフック
// ===========================================================================

/** 契約作成直後（subscription.cjs の syncContract から）。会員プランでなければ何もしない */
async function onContractCreated(sub, plan, contract) {
  if (!isMembershipPlan(plan)) return null;
  const { getSettings, atJstHour, addDays, setShopifyNextBillingDate, logEvent } = core();
  const settings = await getSettings();
  const ps = await getProSettings();
  const startedAt = contract?.createdAt || new Date().toISOString();
  const firstDays = plan.trial_days > 0 ? plan.trial_days : plan.interval_days;
  const nextBillingAt = atJstHour(addDays(startedAt, firstDays), settings?.billing?.billing_hour_jst ?? 9).toISOString();

  const patch = {
    status: 'active',
    next_billing_at: nextBillingAt,
    next_delivery_at: null,
    amount: Number(plan.price || 0), // 初回は0円。2回目以降の請求額を持っておく
  };
  await db().from('subscriptions').update(patch).eq('id', sub.id);
  try {
    await setShopifyNextBillingDate(sub.shopify_contract_id, nextBillingAt);
  } catch (err) {
    console.error('[fitpeak-pro] 次回課金日の設定に失敗:', err.message);
  }
  const fresh = { ...sub, ...patch };
  await grantPro(fresh, expiryFor(nextBillingAt, ps.grace_days));
  await logEvent(sub.id, 'pro_trial_started', 'system', { trial_days: plan.trial_days, next_billing_at: nextBillingAt });

  try { await sendWelcome(fresh, plan); } catch (err) { console.error('[fitpeak-pro] ウェルカム送信失敗:', err.message); }
  return fresh;
}

/** 課金成功（handleBillingSuccess から）。次回課金日を interval_days 先へ */
async function onBillingSuccess(sub, plan) {
  if (!isMembershipPlan(plan)) return null;
  const { getSettings, atJstHour, addDays, setShopifyNextBillingDate } = core();
  const settings = await getSettings();
  const ps = await getProSettings();
  const base = sub.next_billing_at && new Date(sub.next_billing_at).getTime() > Date.now() - 30 * DAY_MS
    ? sub.next_billing_at
    : new Date().toISOString();
  const nextBillingAt = atJstHour(addDays(base, plan.interval_days), settings?.billing?.billing_hour_jst ?? 9).toISOString();
  const patch = { status: 'active', next_billing_at: nextBillingAt, next_delivery_at: null, paused_at: null };
  await db().from('subscriptions').update(patch).eq('id', sub.id);
  try { await setShopifyNextBillingDate(sub.shopify_contract_id, nextBillingAt); } catch (err) {
    console.error('[fitpeak-pro] 次回課金日の同期に失敗:', err.message);
  }
  await grantPro({ ...sub, ...patch }, expiryFor(nextBillingAt, ps.grace_days));
  return patch;
}

/** 課金失敗（handleBillingFailure から）。リトライ中はPRO維持、上限でPROを外す */
async function onBillingFailure(sub, plan, { exhausted, nextRetryAt }) {
  if (!isMembershipPlan(plan)) return null;
  if (exhausted) {
    await revokeProBySub(sub, 'billing_failed');
    return 'revoked';
  }
  if (nextRetryAt) {
    await db().from('members').update({ plan_expires_at: expiryFor(nextRetryAt, 1) }).eq('plan_subscription_id', sub.id);
  }
  return 'kept';
}

// ===========================================================================
// 4. cron: 期限切れのPROを外す（解約後の支払い済み期間が終わった人など）
// ===========================================================================

async function runProExpiryCron() {
  const now = new Date().toISOString();
  const { data: expired } = await db()
    .from('members')
    .select('*')
    .eq('plan', 'pro')
    .lt('plan_expires_at', now)
    .limit(100);
  const results = [];
  for (const m of expired || []) {
    // 有効な契約が残っていれば外さない（課金待ちのずれ対策）
    if (m.plan_subscription_id) {
      const { data: sub } = await db().from('subscriptions').select('status, next_billing_at').eq('id', m.plan_subscription_id).maybeSingle();
      if (sub && sub.status === 'active' && sub.next_billing_at && new Date(sub.next_billing_at).getTime() > Date.now()) {
        results.push({ member_id: m.id, skipped: 'still_active' });
        continue;
      }
    }
    try {
      await revokeProByMember(m, 'expired');
      results.push({ member_id: m.id, revoked: true });
    } catch (err) {
      results.push({ member_id: m.id, error: err.message });
    }
  }
  return { processed: results.length, results };
}

// ===========================================================================
// 5. ウェルカム案内（LINE連携済みならLINE、未連携ならメール）
// ===========================================================================

async function makeAutoLoginUrl(email, lineUserId, path) {
  const token = crypto.randomBytes(32).toString('hex');
  await db().from('auto_login_tokens').insert({
    token, email: email || '', line_user_id: lineUserId || null,
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  });
  return `${MY_FITPEAK_URL}${path}?alt=${token}`;
}

function jstLabel(iso) {
  return new Date(iso).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric' });
}

async function sendWelcome(sub, plan) {
  const ps = await getProSettings();
  const trialEnd = sub.next_billing_at ? jstLabel(sub.next_billing_at) : '';
  const price = Number(plan.price || 0).toLocaleString('ja-JP');
  const lines = [
    'FITPEAK PRO へのご登録、ありがとうございます。FITPEAK代表のTakuです。',
    '',
    `プラン：${plan.display_name || plan.name}`,
    trialEnd ? `無料期間：${trialEnd}まで（この日に${price}円が決済されます）` : '',
    '',
    '・ギア10%OFFと送料無料は、fitpeak.coで同じメールアドレスのアカウントにログインして購入すると自動で適用されます',
    '・特典とポイントは My FITPEAK で確認できます',
    '・無料期間中に解約すれば料金はかかりません（My FITPEAK からいつでも解約できます）',
  ].filter((l) => l !== '');

  const creashot = require('./creashot-subscription.cjs');
  const lineUserId = sub.line_user_id;
  if (lineUserId && ps.welcome_line_enabled) {
    const url = await makeAutoLoginUrl(sub.email, lineUserId, '/my-fitpeak');
    const { getLineCredentials, DEFAULT_CHANNEL_ID } = require('./shared.cjs');
    const { accessToken } = await getLineCredentials(DEFAULT_CHANNEL_ID);
    if (accessToken) {
      await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text: [...lines, '', '▼My FITPEAK（タップでログイン・30分有効）', url].join('\n') }] }),
      });
      await core().logEvent(sub.id, 'pro_welcome_line_sent', 'system', {});
      return;
    }
  }
  if (sub.email && ps.welcome_email_enabled && typeof creashot.sendGmail === 'function') {
    await creashot.sendGmail({
      to: sub.email,
      subject: '【FITPEAK PRO】ご登録ありがとうございます',
      body: [...lines, '', '▼My FITPEAK', `${MY_FITPEAK_URL}/my-fitpeak`, '', '――', 'FITPEAK（合同会社SVPコーポレーション）', 'このメールはFITPEAK PROのご登録に関する大切なお知らせです。'].join('\n'),
    });
    await core().logEvent(sub.id, 'pro_welcome_email_sent', 'system', {});
  }
}

// ===========================================================================
// 管理API（/api/subscription/pro/*）
// ===========================================================================

adminRouter.post('/setup', async (_req, res) => {
  try { res.json({ ok: true, groups: await setupProSellingPlans() }); } catch (err) { res.status(400).json({ error: err.message }); }
});

adminRouter.get('/plans', async (_req, res) => {
  try { res.json({ plans: await listProPlans() }); } catch (err) { res.status(400).json({ error: err.message }); }
});

adminRouter.get('/members', async (_req, res) => {
  try {
    const { data } = await db().from('members').select('id, email, nickname, plan, plan_expires_at, plan_subscription_id').eq('plan', 'pro').order('plan_expires_at');
    res.json({ members: data || [] });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

adminRouter.get('/cron/expiry', async (_req, res) => {
  try { res.json(await runProExpiryCron()); } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = {
  adminRouter,
  isMembershipPlan,
  loadPlan,
  onContractCreated,
  onBillingSuccess,
  onBillingFailure,
  runProExpiryCron,
  setupProSellingPlans,
  getProSettings,
  listProPlans,
};
