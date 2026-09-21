/**
 * クレアショット定期購入 拡張モジュール
 *
 * subscription.cjs（汎用エンジン）の上に、クレアショット固有の機能を載せる。
 *   1. Shopify セットアップ: 6バリエーション（1日1本/2本 × 1・3・12ヶ月）に
 *      3つの Selling Plan Group を紐づけ、subscription_plans と同期する
 *   2. 顧客ポータル（My FITPEAK「クレアショット」画面）:
 *      - 残量から次回お届け日を再設定（休会）
 *      - 休会（再開日未定）／再開
 *      - プラン変更（Shopify: subscriptionContractProductChange）
 *      - 解約フロー（理由 → 引き止め提案の取得）
 *      - 毎日のLINEリマインダー設定
 *      - 「今日飲んだ」記録
 *   3. 購入後オンボーディング: 契約作成 → LINE連携済みならLINEで、
 *      未連携ならメールで「LINE登録 → My FITPEAK ログイン」を案内
 *   4. cron: リマインダー送信／休会の自動再開
 *
 * 認証は subscription.cjs と同じ（管理API = authMiddleware、ポータル = Supabase JWT）。
 */

const express = require('express');
const crypto = require('crypto');
const { google } = require('googleapis');
const { getLineCredentials, DEFAULT_CHANNEL_ID, getGoogleAuthClient } = require('./shared.cjs');

const adminRouter = express.Router();
const portalRouter = express.Router();

const MY_FITPEAK_URL = process.env.MY_FITPEAK_URL || 'https://my.fitpeak.co';
const GMAIL_SENDER = process.env.GMAIL_SENDER || 'FITPEAK <takuma1234577@gmail.com>';
const STICKS_PER_BAG = 28;

// subscription.cjs の内部関数は循環参照を避けるため遅延で取得する
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

async function getCreashotSettings() {
  const settings = await core().getSettings();
  return {
    product_id: '8556618743943',
    lp_url: 'https://fitpeak.co/products/持ち運びクレアチン-creashot',
    line_add_url: 'https://line.me/R/ti/p/@956iyppc',
    preorder_note: '初回お届け：2026年12月上旬予定',
    preorder_first_ship_date: null,
    reminder_default_time: '19:00',
    reminder_default_message: '今日のクレアショット、飲みましたか？ポケットの1本を、トレ前に。',
    onboarding_email_enabled: true,
    onboarding_line_enabled: true,
    ...(settings.creashot || {}),
  };
}

async function listCreashotPlans() {
  const cs = await getCreashotSettings();
  const { data } = await db()
    .from('subscription_plans')
    .select('*')
    .eq('shopify_product_id', String(cs.product_id))
    .eq('is_active', true)
    .order('sort_order');
  return data || [];
}

function planShape(p) {
  const bags = p.bags_per_cycle || 1;
  const price = Number(p.price || 0);
  return {
    id: p.id,
    plan_code: p.plan_code,
    display_name: p.display_name || p.name,
    sticks_per_day: p.sticks_per_day || 1,
    bags_per_cycle: bags,
    interval_days: p.interval_days,
    interval_label: p.interval_days >= 300 ? '12ヶ月ごと' : p.interval_days >= 80 ? '3ヶ月ごと' : '1ヶ月ごと',
    price,
    price_per_bag: bags ? Math.round(price / bags) : price,
    free_bags: p.plan_code === '1x-3m' ? 1 : p.plan_code === '1x-12m' ? 6 : 0,
    shopify_variant_id: p.shopify_variant_id,
    shopify_selling_plan_id: p.shopify_selling_plan_id,
  };
}

function isCreashotSub(sub, plan) {
  return !!(plan && plan.plan_code && String(plan.plan_code).match(/^\dx-\d+m$/));
}

// ===========================================================================
// 1. Shopify セットアップ（管理API）
// ===========================================================================

const GROUP_DEFS = [
  { code: '1m', months: 1, name: '定期購入（1ヶ月ごと）', option: '1ヶ月ごと', merchantCode: 'creashot-1m', position: 1 },
  { code: '3m', months: 3, name: '定期購入（3ヶ月ごと）', option: '3ヶ月ごと', merchantCode: 'creashot-3m', position: 2 },
  { code: '12m', months: 12, name: '定期購入（12ヶ月ごと）', option: '12ヶ月ごと', merchantCode: 'creashot-12m', position: 3 },
];

const PLAN_DESCRIPTION =
  '定期購入契約です。初回はご注文時に決済され、以降はお届け周期ごとに同額（送料無料）が次回お届け日の3日前に自動決済されます。' +
  '回数の縛りはなく、次回決済日の前日までに My FITPEAK（my.fitpeak.co）からいつでも休会・解約できます。';

/**
 * 3つの Selling Plan Group を作成（既存なら再利用）し、各プラン行に group/plan ID を書き込む。
 * 何度実行しても同じ結果になる。
 */
async function setupShopifySellingPlans() {
  const { shopifyGraphQL, numericId, gid, logEvent } = core();
  const plans = await listCreashotPlans();
  if (plans.length !== 6) throw new Error(`subscription_plans にクレアショットの6プランが必要です（現在 ${plans.length}件）`);

  const existing = await shopifyGraphQL(`
    query { sellingPlanGroups(first: 50) { nodes { id name merchantCode sellingPlans(first: 5) { nodes { id name } } } } }`);
  const groups = existing?.sellingPlanGroups?.nodes || [];

  const results = [];
  for (const def of GROUP_DEFS) {
    const targetPlans = plans.filter((p) => String(p.plan_code || '').endsWith(`-${def.code}`));
    const variantIds = targetPlans.map((p) => gid.variant(p.shopify_variant_id));
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
            options: ['お届け周期'],
            position: def.position,
            description: `クレアショット ${def.option}の定期購入`,
            sellingPlansToCreate: [{
              name: `${def.option}にお届け（いつでも解約可）`,
              options: [def.option],
              position: 1,
              category: 'SUBSCRIPTION',
              description: PLAN_DESCRIPTION,
              billingPolicy: { recurring: { interval: 'MONTH', intervalCount: def.months } },
              deliveryPolicy: { recurring: { interval: 'MONTH', intervalCount: def.months, preAnchorBehavior: 'ASAP' } },
              inventoryPolicy: { reserve: 'ON_SALE' },
              pricingPolicies: [],
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
      // 既存グループ: バリエーションの紐づけだけ揃える
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
    // 1日1本／1日2本 の2行が同じ Selling Plan を共有する（契約→プランの解決は variant_id で行う）
    for (const p of targetPlans) {
      await db()
        .from('subscription_plans')
        .update({ shopify_selling_plan_group_id: groupId, shopify_selling_plan_id: sellingPlanId })
        .eq('id', p.id);
    }
    results.push({ code: def.code, group_id: groupId, selling_plan_id: sellingPlanId, variants: variantIds.length });
  }

  await logEvent(null, 'creashot_setup', 'admin', { results });
  return results;
}

adminRouter.post('/setup', async (_req, res) => {
  try {
    res.json({ ok: true, groups: await setupShopifySellingPlans() });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

adminRouter.get('/plans', async (_req, res) => {
  try {
    const plans = await listCreashotPlans();
    res.json({ plans: plans.map(planShape), raw: plans });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

adminRouter.get('/settings', async (_req, res) => {
  try { res.json(await getCreashotSettings()); } catch (err) { res.status(400).json({ error: err.message }); }
});

adminRouter.put('/settings', async (req, res) => {
  try {
    const current = await getCreashotSettings();
    const value = { ...current, ...(req.body || {}) };
    await db().from('subscription_settings').upsert(
      { key: 'creashot', value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    // 予約情報はプラン行にも反映（My FITPEAK の表示に使う）
    if (req.body?.preorder_note !== undefined || req.body?.preorder_first_ship_date !== undefined) {
      await db().from('subscription_plans')
        .update({ preorder_note: value.preorder_note || null, preorder_first_ship_date: value.preorder_first_ship_date || null })
        .eq('shopify_product_id', String(value.product_id));
    }
    res.json(value);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// 汎用 Shopify GraphQL（管理者のみ。運用時の調査・修正用）
adminRouter.post('/shopify-graphql', async (req, res) => {
  try {
    const { query, variables } = req.body || {};
    if (!query) return res.status(400).json({ error: 'query は必須です' });
    res.json(await core().shopifyGraphQL(query, variables || {}));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// リマインダー一覧（運用確認用）
adminRouter.get('/reminders', async (_req, res) => {
  const { data } = await db().from('creashot_reminders').select('*').order('updated_at', { ascending: false }).limit(200);
  res.json({ reminders: data || [] });
});

adminRouter.get('/onboarding', async (_req, res) => {
  const { data } = await db().from('creashot_onboarding').select('*').order('created_at', { ascending: false }).limit(200);
  res.json({ onboarding: data || [] });
});

// ===========================================================================
// 共通: 顧客認証（subscription.cjs と同じ方式）
// ===========================================================================

async function requireCustomer(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw Object.assign(new Error('ログインが必要です'), { status: 401 });
  const { createClient } = require('@supabase/supabase-js');
  const auth = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_ANON_KEY || '', { auth: { persistSession: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data?.user?.email) throw Object.assign(new Error('セッションが無効です'), { status: 401 });
  return { email: data.user.email, userId: data.user.id };
}

async function loadCustomerSub(id, email) {
  const { data } = await db().from('subscriptions').select('*, subscription_plans(*)').eq('id', id).maybeSingle();
  if (!data) throw Object.assign(new Error('見つかりません'), { status: 404 });
  if ((data.email || '').toLowerCase() !== email.toLowerCase()) throw Object.assign(new Error('権限がありません'), { status: 403 });
  return data;
}

async function findLineUserId(email) {
  const { data } = await db().from('line_shopify_links').select('line_user_id').ilike('shopify_email', email).limit(1);
  return data?.[0]?.line_user_id || null;
}

// ===========================================================================
// 残量の見積もり
// ===========================================================================

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
function jstToday() {
  return new Date(Date.now() + JST_OFFSET_MS).toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

/**
 * 直近のお届けからの経過日数 × 1日の本数 で残本数を見積もる。
 * 「今日飲んだ」記録があれば、その日数分を優先して差し引く（記録の無い日は見積もりで補う）。
 */
async function estimateRemaining(sub, plan, email) {
  if (!sub.last_delivered_at) return null;
  const perDay = plan?.sticks_per_day || 1;
  const bags = plan?.bags_per_cycle || 1;
  const total = bags * STICKS_PER_BAG;
  const elapsed = Math.max(0, daysBetween(sub.last_delivered_at, new Date()));
  const { data: logs } = await db()
    .from('creashot_intake_logs')
    .select('taken_on, sticks')
    .ilike('email', email)
    .gte('taken_on', core().jstDate(sub.last_delivered_at));
  const logged = (logs || []).reduce((a, l) => a + (l.sticks || 1), 0);
  const estimated = elapsed * perDay;
  const consumed = Math.max(logged, estimated);
  const remaining = Math.max(0, total - consumed);
  return {
    total_sticks: total,
    consumed_sticks: consumed,
    remaining_sticks: remaining,
    remaining_days: Math.floor(remaining / perDay),
    runs_out_on: new Date(Date.now() + Math.floor(remaining / perDay) * 86400000 + JST_OFFSET_MS).toISOString().slice(0, 10),
    logged_days: (logs || []).length,
  };
}

// ===========================================================================
// 2. 顧客ポータル
// ===========================================================================

function extendPortalShape(base, sub, plan, extra) {
  return {
    ...base,
    plan_code: plan?.plan_code || null,
    sticks_per_day: plan?.sticks_per_day || 1,
    bags_per_cycle: plan?.bags_per_cycle || 1,
    price: plan?.price != null ? Number(plan.price) : base.amount,
    paused_until: sub.paused_until ? core().jstDate(sub.paused_until) : null,
    can_reschedule: ['active', 'past_due', 'paused'].includes(sub.status),
    can_pause: ['active', 'past_due'].includes(sub.status),
    can_resume: sub.status === 'paused',
    can_change_plan: ['active', 'past_due', 'paused', 'pending_first_shipment', 'awaiting_delivery'].includes(sub.status),
    ...extra,
  };
}

/** クレアショットの契約一覧＋残量＋リマインダー＋プラン一覧をまとめて返す */
portalRouter.get('/', async (req, res) => {
  try {
    const { email } = await requireCustomer(req);
    const settings = await core().getSettings();
    const cs = await getCreashotSettings();
    const { data: subs } = await db()
      .from('subscriptions')
      .select('*, subscription_plans(*)')
      .ilike('email', email)
      .order('created_at', { ascending: false });

    const list = [];
    for (const s of subs || []) {
      const plan = s.subscription_plans;
      if (!isCreashotSub(s, plan)) continue;
      const base = core().toPortalShape ? core().toPortalShape(s, settings) : {};
      const remaining = await estimateRemaining(s, plan, email);
      list.push(extendPortalShape(base, s, plan, { remaining }));
    }

    const lineUserId = await findLineUserId(email);
    const { data: reminder } = await db().from('creashot_reminders').select('*').ilike('email', email).maybeSingle();
    const plans = (await listCreashotPlans()).map(planShape);
    const { data: reasons } = await db()
      .from('cancel_reasons').select('id, label, retention_action, retention_message').eq('is_active', true).order('sort_order');

    // My FITPEAK にログインした事実をオンボーディングに記録
    if (list.length) {
      await db().from('creashot_onboarding')
        .update({ myfitpeak_logged_in_at: new Date().toISOString(), ...(lineUserId ? { line_linked_at: new Date().toISOString() } : {}) })
        .in('subscription_id', list.map((s) => s.id))
        .is('myfitpeak_logged_in_at', null);
    }

    res.json({
      subscriptions: list,
      plans,
      line_linked: !!lineUserId,
      line_add_url: cs.line_add_url,
      reminder: reminder
        ? { enabled: reminder.enabled, time_jst: reminder.time_jst, days_of_week: reminder.days_of_week, message: reminder.message }
        : { enabled: false, time_jst: cs.reminder_default_time, days_of_week: [1, 2, 3, 4, 5, 6, 7], message: '' },
      reminder_default_message: cs.reminder_default_message,
      cancel_reasons: reasons || [],
      cancel_flow: settings.cancel_flow,
      today: jstToday(),
    });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

/**
 * 休会設定: 残りの本数を入力 → 飲み切る日に次のお届けが来るように再設定する。
 * 次回お届け日 = 今日 + ceil(残本数 / 1日の本数)
 * 次回課金日   = 次回お届け日 − lead_days（最短でも明日9時）
 */
portalRouter.post('/:id/reschedule', async (req, res) => {
  try {
    const { email } = await requireCustomer(req);
    const sub = await loadCustomerSub(req.params.id, email);
    const plan = sub.subscription_plans;
    if (!['active', 'past_due', 'paused'].includes(sub.status)) {
      return res.status(400).json({ error: '初回お届け前、または解約済みの定期購入は変更できません' });
    }
    const remaining = Number(req.body?.remaining_sticks);
    if (!Number.isFinite(remaining) || remaining < 0 || remaining > 1000) {
      return res.status(400).json({ error: '残りの本数を0以上で入力してください' });
    }
    const perDay = plan?.sticks_per_day || 1;
    const lead = plan?.lead_days ?? 3;
    const settings = await core().getSettings();
    const hour = settings.billing?.billing_hour_jst ?? 9;
    const days = Math.ceil(remaining / perDay);

    const { addDays, atJstHour, setShopifyNextBillingDate, activateShopifyContract, logEvent, jstDate } = core();
    const nextDelivery = atJstHour(addDays(new Date(), Math.max(days, lead)), 12);
    let nextBilling = atJstHour(addDays(nextDelivery, -lead), hour);
    const earliest = atJstHour(addDays(new Date(), 1), hour);
    if (nextBilling.getTime() < earliest.getTime()) nextBilling = earliest;

    const patch = {
      status: 'active',
      next_delivery_at: nextDelivery.toISOString(),
      next_billing_at: nextBilling.toISOString(),
      paused_until: null,
      pause_reason: null,
      paused_at: null,
    };
    if (sub.status === 'paused') await activateShopifyContract(sub.shopify_contract_id).catch((e) => console.error('[creashot] activate失敗:', e.message));
    await db().from('subscriptions').update(patch).eq('id', sub.id);
    await setShopifyNextBillingDate(sub.shopify_contract_id, patch.next_billing_at).catch((e) => console.error('[creashot] nextBillingDate同期失敗:', e.message));
    await logEvent(sub.id, 'rescheduled_by_stock', 'customer', { remaining_sticks: remaining, days, ...patch });

    res.json({ ok: true, next_delivery_date: jstDate(patch.next_delivery_at), next_billing_date: jstDate(patch.next_billing_at) });
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});

/** 休会（再開日未定）。課金を止める。 */
portalRouter.post('/:id/pause', async (req, res) => {
  try {
    const { email } = await requireCustomer(req);
    const sub = await loadCustomerSub(req.params.id, email);
    if (!['active', 'past_due'].includes(sub.status)) return res.status(400).json({ error: 'この定期購入は現在休会できません' });
    const { pauseShopifyContract, logEvent, addDays, atJstHour, jstDate } = core();
    const resumeDate = req.body?.resume_date ? new Date(req.body.resume_date) : null;
    const pausedUntil = resumeDate && !Number.isNaN(resumeDate.getTime()) ? atJstHour(resumeDate, 9) : null;
    await pauseShopifyContract(sub.shopify_contract_id).catch((e) => console.error('[creashot] pause失敗:', e.message));
    await db().from('subscriptions').update({
      status: 'paused', paused_at: new Date().toISOString(),
      paused_until: pausedUntil ? pausedUntil.toISOString() : null,
      pause_reason: req.body?.reason || null,
      next_billing_at: null,
    }).eq('id', sub.id);
    await logEvent(sub.id, 'paused', 'customer', { paused_until: pausedUntil, reason: req.body?.reason || null });
    res.json({ ok: true, paused_until: pausedUntil ? jstDate(pausedUntil) : null, min_resume: jstDate(addDays(new Date(), 1)) });
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});

/** 再開: 次回お届けを最短（明日+lead）に */
portalRouter.post('/:id/resume', async (req, res) => {
  try {
    const { email } = await requireCustomer(req);
    const sub = await loadCustomerSub(req.params.id, email);
    if (sub.status !== 'paused') return res.status(400).json({ error: '休会中の定期購入ではありません' });
    req.body = { remaining_sticks: 0 };
    // 残量0として再スケジュール（最短でお届け）
    const plan = sub.subscription_plans;
    const lead = plan?.lead_days ?? 3;
    const settings = await core().getSettings();
    const hour = settings.billing?.billing_hour_jst ?? 9;
    const { addDays, atJstHour, setShopifyNextBillingDate, activateShopifyContract, logEvent, jstDate } = core();
    const nextBilling = atJstHour(addDays(new Date(), 1), hour);
    const nextDelivery = atJstHour(addDays(nextBilling, lead), 12);
    await activateShopifyContract(sub.shopify_contract_id).catch((e) => console.error('[creashot] activate失敗:', e.message));
    await db().from('subscriptions').update({
      status: 'active', paused_at: null, paused_until: null, pause_reason: null,
      next_billing_at: nextBilling.toISOString(), next_delivery_at: nextDelivery.toISOString(),
    }).eq('id', sub.id);
    await setShopifyNextBillingDate(sub.shopify_contract_id, nextBilling.toISOString()).catch(() => {});
    await logEvent(sub.id, 'resumed', 'customer', { next_billing_at: nextBilling.toISOString() });
    res.json({ ok: true, next_delivery_date: jstDate(nextDelivery), next_billing_date: jstDate(nextBilling) });
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});

/**
 * プラン変更。Shopify 側は契約の商品ラインを新しいバリエーションに差し替える。
 * 課金周期はこちらの subscriptions.plan_id（interval_days）が正なので、Shopify の
 * billingPolicy は変更しない（次回課金日は当エンジンが毎回明示的に設定する）。
 */
portalRouter.post('/:id/change-plan', async (req, res) => {
  try {
    const { email } = await requireCustomer(req);
    const sub = await loadCustomerSub(req.params.id, email);
    if (sub.status === 'cancelled') return res.status(400).json({ error: '解約済みの定期購入は変更できません' });
    const code = String(req.body?.plan_code || '');
    const plans = await listCreashotPlans();
    const target = plans.find((p) => p.plan_code === code);
    if (!target) return res.status(400).json({ error: 'プランが見つかりません' });
    if (sub.plan_id === target.id) return res.json({ ok: true, unchanged: true });

    const { shopifyGraphQL, fetchContract, gid, numericId, logEvent } = core();
    const contract = await fetchContract(sub.shopify_contract_id);
    const line = contract?.lines?.nodes?.[0];
    if (!line) throw new Error('契約の商品情報が取得できませんでした');

    // lineId は fetchContract の lines に含まれないため、ここで取り直す
    const lineData = await shopifyGraphQL(
      `query($id: ID!) { subscriptionContract(id: $id) { lines(first: 5) { nodes { id variantId } } } }`,
      { id: gid.contract(sub.shopify_contract_id) },
    );
    const lineId = lineData?.subscriptionContract?.lines?.nodes?.[0]?.id;
    if (!lineId) throw new Error('契約ラインが取得できませんでした');

    const data = await shopifyGraphQL(
      `mutation($id: ID!, $lineId: ID!, $input: SubscriptionContractProductChangeInput!) {
        subscriptionContractProductChange(subscriptionContractId: $id, lineId: $lineId, input: $input) {
          contract { id }
          lineUpdated { id variantId }
          userErrors { field message }
        }
      }`,
      {
        id: gid.contract(sub.shopify_contract_id),
        lineId,
        input: { productVariantId: gid.variant(target.shopify_variant_id), currentPrice: String(Number(target.price)) },
      },
    );
    const errs = data?.subscriptionContractProductChange?.userErrors || [];
    if (errs.length) throw new Error(`プラン変更に失敗しました: ${errs.map((e) => e.message).join(' / ')}`);

    await db().from('subscriptions').update({
      plan_id: target.id, amount: Number(target.price), plan_changed_at: new Date().toISOString(),
    }).eq('id', sub.id);
    await logEvent(sub.id, 'plan_changed', 'customer', {
      from_plan_id: sub.plan_id, to_plan_id: target.id, to_plan_code: code, line_id: numericId(lineId),
    });
    res.json({ ok: true, plan: planShape(target) });
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});

/**
 * 解約フロー: 理由を受け取り、引き止め提案（休会／安いプラン／1日1本へ）を返す。
 * 実際の解約は subscription.cjs の /portal/:id/cancel を呼ぶ。
 */
portalRouter.post('/:id/cancel-options', async (req, res) => {
  try {
    const { email } = await requireCustomer(req);
    const sub = await loadCustomerSub(req.params.id, email);
    const plan = sub.subscription_plans;
    const { data: reason } = await db().from('cancel_reasons').select('*').eq('id', req.body?.reason_id || '').maybeSingle();
    if (!reason) return res.status(400).json({ error: '解約の理由を選択してください' });

    const plans = (await listCreashotPlans()).map(planShape);
    const cur = plan ? planShape(plan) : null;
    const offers = [];
    const canOperate = ['active', 'past_due', 'paused'].includes(sub.status);

    if (reason.retention_action === 'pause' && canOperate) {
      offers.push({ type: 'reschedule', title: '残りを飲み切ってから、次を届ける', message: reason.retention_message });
      offers.push({ type: 'pause', title: '再開するまで休会にする', message: '休会中は課金されません。My FITPEAKからいつでも再開できます。' });
    }
    if (reason.retention_action === 'cheaper' && cur) {
      const sameSticks = plans.filter((p) => p.sticks_per_day === cur.sticks_per_day && p.price_per_bag < cur.price_per_bag);
      for (const p of sameSticks) {
        offers.push({
          type: 'change_plan', plan_code: p.plan_code,
          title: `${p.interval_label}に変更（1袋あたり¥${p.price_per_bag.toLocaleString('ja-JP')}）`,
          message: reason.retention_message,
          plan: p,
        });
      }
      if (cur.sticks_per_day === 2) {
        const down = plans.find((p) => p.sticks_per_day === 1 && p.interval_days === cur.interval_days);
        if (down) offers.push({ type: 'change_plan', plan_code: down.plan_code, title: '1日1本のプランに変更する', message: '本数を減らして続ける選択肢です。', plan: down });
      }
    }
    if (reason.retention_action === 'downgrade' && cur && cur.sticks_per_day === 2) {
      const down = plans.find((p) => p.sticks_per_day === 1 && p.interval_days === cur.interval_days);
      if (down) offers.push({ type: 'change_plan', plan_code: down.plan_code, title: '1日1本のプランに変更する', message: reason.retention_message, plan: down });
    }
    // 予約中（初回未発送）は自動解約せず、運営対応にする（初回注文の返金が絡むため）
    const contactRequired = sub.status === 'pending_first_shipment';

    await core().logEvent(sub.id, 'cancel_reason_selected', 'customer', { reason_id: reason.id, label: reason.label, offers: offers.map((o) => o.type) });
    res.json({ reason: { id: reason.id, label: reason.label }, offers, contact_required: contactRequired });
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});

/** リマインダー設定 */
portalRouter.put('/reminder', async (req, res) => {
  try {
    const { email } = await requireCustomer(req);
    const lineUserId = await findLineUserId(email);
    const body = req.body || {};
    const enabled = !!body.enabled;
    if (enabled && !lineUserId) {
      return res.status(409).json({ error: 'LINE通知を使うには、先に公式LINEとMy FITPEAKの連携が必要です', line_required: true });
    }
    const time = String(body.time_jst || '19:00');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return res.status(400).json({ error: '時刻は HH:MM 形式で入力してください' });
    let days = Array.isArray(body.days_of_week) ? body.days_of_week.map(Number).filter((d) => d >= 1 && d <= 7) : [1, 2, 3, 4, 5, 6, 7];
    if (!days.length) days = [1, 2, 3, 4, 5, 6, 7];
    const row = {
      email, line_user_id: lineUserId, enabled, time_jst: time, days_of_week: days,
      message: body.message ? String(body.message).slice(0, 300) : null,
      updated_at: new Date().toISOString(),
    };
    const { data: existing } = await db().from('creashot_reminders').select('id').ilike('email', email).maybeSingle();
    if (existing) await db().from('creashot_reminders').update(row).eq('id', existing.id);
    else await db().from('creashot_reminders').insert(row);
    res.json({ ok: true, reminder: { enabled, time_jst: time, days_of_week: days, message: row.message } });
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});

/** 「今日飲んだ」記録 */
portalRouter.post('/intake', async (req, res) => {
  try {
    const { email } = await requireCustomer(req);
    const date = String(req.body?.date || jstToday());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '日付の形式が不正です' });
    const sticks = Math.max(1, Math.min(4, Number(req.body?.sticks || 1)));
    const { error } = await db().from('creashot_intake_logs').upsert(
      { email, taken_on: date, sticks, source: 'portal' }, { onConflict: 'email,taken_on' });
    if (error) throw new Error(error.message);
    res.json({ ok: true, date, sticks });
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});

// ===========================================================================
// 3. 購入後オンボーディング（契約作成時に subscription.cjs から呼ばれる）
// ===========================================================================

async function pushLine(lineUserId, messages) {
  const { accessToken } = await getLineCredentials(DEFAULT_CHANNEL_ID);
  if (!accessToken) throw new Error('LINEアクセストークンが未設定です');
  const r = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ to: lineUserId, messages: Array.isArray(messages) ? messages : [messages] }),
  });
  if (!r.ok) throw new Error(`LINE push ${r.status}: ${await r.text().catch(() => '')}`);
}

async function sendGmail({ to, subject, body }) {
  const auth = await getGoogleAuthClient('gmail');
  const gmail = google.gmail({ version: 'v1', auth });
  const content = [
    `To: ${to}`,
    `From: ${GMAIL_SENDER}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body,
  ].join('\r\n');
  const raw = Buffer.from(content).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
}

/** 自動ログインURL（30分有効） */
async function makeAutoLoginUrl(email, lineUserId, path = '/creashot') {
  const token = crypto.randomBytes(32).toString('hex');
  await db().from('auto_login_tokens').insert({
    token, email: email || '', line_user_id: lineUserId || null,
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  });
  return `${MY_FITPEAK_URL}${path}?alt=${token}`;
}

/**
 * 契約作成直後に呼ぶ。
 *  LINE連携済み → LINEで My FITPEAK（クレアショット画面）の自動ログインリンクを送る
 *  未連携       → メールで「①公式LINE登録 → ②My FITPEAK登録」を案内
 */
async function onContractCreated(sub) {
  try {
    const { data: plan } = sub.plan_id
      ? await db().from('subscription_plans').select('*').eq('id', sub.plan_id).maybeSingle()
      : { data: null };
    if (!isCreashotSub(sub, plan)) return;
    const cs = await getCreashotSettings();
    const email = sub.email;
    const lineUserId = sub.line_user_id || (await findLineUserId(email));

    await db().from('creashot_onboarding').upsert({
      subscription_id: sub.id, email, shopify_order_id: sub.first_order_id || null,
      line_linked_at: lineUserId ? new Date().toISOString() : null,
    }, { onConflict: 'subscription_id' });

    const planLabel = plan?.display_name || 'クレアショット定期購入';
    const note = plan?.preorder_note || cs.preorder_note || '';

    if (lineUserId && cs.onboarding_line_enabled !== false) {
      const url = await makeAutoLoginUrl(email, lineUserId, '/creashot');
      const text = [
        'クレアショットのご予約、ありがとうございます。FITPEAK代表のTakuです。',
        '',
        `プラン：${planLabel}`,
        note ? `${note}` : '',
        '',
        'お届け日の調整・休会・毎日の「飲むタイミング通知」は、My FITPEAKのクレアショット画面から設定できます。',
        '下のリンクはタップするだけでログインできます（30分有効）。',
        url,
        '',
        '通知をONにしておくと、毎日決めた時間にこのLINEでお知らせします。飲み忘れ防止に使ってください。',
      ].filter((l) => l !== null).join('\n');
      await pushLine(lineUserId, { type: 'text', text });
      await db().from('creashot_onboarding').update({ line_notified_at: new Date().toISOString() }).eq('subscription_id', sub.id);
      await core().logEvent(sub.id, 'onboarding_line_sent', 'system', {});
      return;
    }

    if (cs.onboarding_email_enabled !== false && email) {
      const url = await makeAutoLoginUrl(email, null, '/creashot');
      const body = [
        'クレアショットのご予約、ありがとうございます。FITPEAK代表のTakuです。',
        '',
        `プラン：${planLabel}`,
        note ? note : '',
        '',
        '定期購入の管理は、次の2ステップで準備が整います（合計1分）。',
        '',
        `① FITPEAK公式LINEを友だち追加`,
        `   ${cs.line_add_url}`,
        '   追加後、メニューの「会員登録」からご注文時のメールアドレスを入力してください。',
        '   → お届け予定・発送・毎日の「飲むタイミング通知」がLINEに届くようになります。',
        '',
        `② My FITPEAK にログイン（下のリンクはクリックするだけでログインできます・30分有効）`,
        `   ${url}`,
        '   → お届け日の調整（残りの本数を入れるだけ）、休会、プラン変更、解約がいつでもできます。',
        '',
        '─────────────────',
        'FITPEAK（合同会社SVPコーポレーション）',
        '本メールは定期購入のご案内です。ご不明点はこのメールにご返信ください。',
      ].join('\n');
      await sendGmail({ to: email, subject: '【FITPEAK】クレアショット定期購入のご案内（LINE登録とMy FITPEAKについて）', body });
      await db().from('creashot_onboarding').update({ email_notified_at: new Date().toISOString() }).eq('subscription_id', sub.id);
      await core().logEvent(sub.id, 'onboarding_email_sent', 'system', {});
    }
  } catch (err) {
    console.error('[creashot] onboarding失敗:', err.message);
    await core().logEvent(sub.id, 'onboarding_error', 'system', { error: err.message });
  }
}

// ===========================================================================
// 4. cron
// ===========================================================================

/** 設定時刻（JST・10分幅）に LINE リマインダーを送る。同じ日には1回だけ。 */
async function runReminderCron() {
  const cs = await getCreashotSettings();
  const nowJst = new Date(Date.now() + JST_OFFSET_MS);
  const today = nowJst.toISOString().slice(0, 10);
  const minutes = nowJst.getUTCHours() * 60 + nowJst.getUTCMinutes();
  const isoDow = ((nowJst.getUTCDay() + 6) % 7) + 1; // 1=月 … 7=日

  const { data: rows } = await db().from('creashot_reminders').select('*').eq('enabled', true).limit(500);
  const results = [];
  for (const r of rows || []) {
    try {
      if (!r.line_user_id) continue;
      if (r.last_sent_date === today) continue;
      if (Array.isArray(r.days_of_week) && r.days_of_week.length && !r.days_of_week.includes(isoDow)) continue;
      const [h, m] = String(r.time_jst || '19:00').split(':').map(Number);
      const target = h * 60 + m;
      // 設定時刻から 20分以内（cronは10分間隔）
      if (minutes < target || minutes - target > 20) continue;

      // 解約済みだけの顧客には送らない
      const { data: subs } = await db().from('subscriptions').select('status').ilike('email', r.email).neq('status', 'cancelled').limit(1);
      if (!subs || !subs.length) continue;

      const text = (r.message && r.message.trim()) || cs.reminder_default_message;
      await pushLine(r.line_user_id, {
        type: 'text',
        text,
        quickReply: {
          items: [
            { type: 'action', action: { type: 'uri', label: '飲んだ！を記録', uri: `${MY_FITPEAK_URL}/creashot?intake=1` } },
            { type: 'action', action: { type: 'uri', label: '通知時間を変える', uri: `${MY_FITPEAK_URL}/creashot#reminder` } },
          ],
        },
      });
      await db().from('creashot_reminders').update({ last_sent_date: today }).eq('id', r.id);
      results.push({ id: r.id, sent: true });
    } catch (err) {
      console.error('[creashot] reminder失敗:', r.id, err.message);
      results.push({ id: r.id, error: err.message });
    }
  }
  return { processed: results.length, results };
}

/** 休会（再開日つき）の自動再開 */
async function runPauseResumeCron() {
  const now = new Date().toISOString();
  const { data: subs } = await db()
    .from('subscriptions').select('*, subscription_plans(*)')
    .eq('status', 'paused').not('paused_until', 'is', null).lte('paused_until', now).limit(50);
  const results = [];
  for (const sub of subs || []) {
    try {
      const plan = sub.subscription_plans;
      const lead = plan?.lead_days ?? 3;
      const settings = await core().getSettings();
      const hour = settings.billing?.billing_hour_jst ?? 9;
      const { addDays, atJstHour, setShopifyNextBillingDate, activateShopifyContract, logEvent } = core();
      const nextBilling = atJstHour(addDays(new Date(), 1), hour);
      const nextDelivery = atJstHour(addDays(nextBilling, lead), 12);
      await activateShopifyContract(sub.shopify_contract_id).catch(() => {});
      await db().from('subscriptions').update({
        status: 'active', paused_at: null, paused_until: null,
        next_billing_at: nextBilling.toISOString(), next_delivery_at: nextDelivery.toISOString(),
      }).eq('id', sub.id);
      await setShopifyNextBillingDate(sub.shopify_contract_id, nextBilling.toISOString()).catch(() => {});
      await logEvent(sub.id, 'resumed', 'system', { auto: true });
      results.push({ id: sub.id });
    } catch (err) {
      results.push({ id: sub.id, error: err.message });
    }
  }
  return { processed: results.length, results };
}

adminRouter.get('/cron/reminders', async (_req, res) => {
  try { res.json(await runReminderCron()); } catch (err) { res.status(500).json({ error: err.message }); }
});
adminRouter.get('/cron/resume', async (_req, res) => {
  try { res.json(await runPauseResumeCron()); } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = {
  adminRouter,
  portalRouter,
  onContractCreated,
  runReminderCron,
  runPauseResumeCron,
  setupShopifySellingPlans,
  getCreashotSettings,
  listCreashotPlans,
};
