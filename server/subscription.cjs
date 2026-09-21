/**
 * 定期購入（サブスクリプション）Module
 *
 * 設計の核: 課金タイミングの主導権をこちらが持つ。
 *   Shopify は「契約」と「決済」だけを担い、いつ課金するかは Supabase の
 *   subscriptions.next_billing_at を正として当モジュールの cron が決める。
 *   次回課金日 = 到着日 + interval_days − lead_days
 *   （到着日 = 配達完了イベント。来なければ 発送日 + delivery_fallback_days）
 *   これにより「予約販売（初回発送が数ヶ月後）」でも周期が破綻しない。
 *
 * 状態遷移:
 *   pending_first_shipment → awaiting_delivery → active
 *     ├ 課金失敗 → past_due →(リトライ上限)→ paused
 *     ├ スキップ → next_billing_at / next_delivery_at を +skip_days
 *     └ 解約 → cancelled
 *
 * 安全弁:
 *   subscription_settings.billing.cron_enabled が false の間は一切課金しない。
 *   本番投入前は false のままデプロイしておける。
 *
 * 認証:
 *   - 管理API (このrouter)      : business-hub の authMiddleware 配下
 *   - webhook / 顧客ポータルAPI : publicRouter（HMAC / Supabase JWT で個別に検証）
 *
 * DB: subscriptions / subscription_plans / subscription_cycles /
 *     subscription_events / cancel_reasons / subscription_settings
 *     いずれも RLS 有効・ポリシー無し = service role からのみ操作可能。
 *     SUPABASE_SERVICE_ROLE_KEY が未設定だと全操作が空振りするため /health で検知する。
 */

const express = require('express');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();
const publicRouter = express.Router();

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';
const BASE_URL = process.env.BUSINESS_HUB_URL || 'https://business-hub-beige.vercel.app';
const MY_FITPEAK_URL = process.env.MY_FITPEAK_URL || 'https://my.fitpeak.co';

// ===========================================================================
// Supabase（service role 専用）
// ===========================================================================

let _sb = null;
function db() {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です');
  _sb = createClient(url, key, { auth: { persistSession: false } });
  return _sb;
}

function hasServiceRole() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return false;
  // 新方式のシークレットキー（sb_secret_...）はJWTではない
  if (key.startsWith('sb_secret_')) return true;
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64').toString());
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

// 顧客JWT検証用（anonキーで十分）
function authClient() {
  return createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_ANON_KEY || '', {
    auth: { persistSession: false },
  });
}

// ===========================================================================
// 設定（subscription_settings: key/value(jsonb)）
// ===========================================================================

const DEFAULT_SETTINGS = {
  billing: { cron_enabled: false, billing_hour_jst: 9, retry_offsets_days: [3, 7], max_retries: 2, after_max_retries: 'paused' },
  delivery: { delivery_fallback_days: 2, delivered_wait_days: 5 },
  skip: { enabled: true, skip_days: 7, cutoff_hours_before: 24 },
  notification: { pre_billing_reminder_days: 3, email_enabled: true, line_enabled: false },
  cancel_flow: { offer_skip_first: true, retention_message: '1週間スキップして様子を見ることもできます。' },
};

async function getSettings() {
  const { data } = await db().from('subscription_settings').select('key, value');
  const merged = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  for (const row of data || []) {
    merged[row.key] = { ...(merged[row.key] || {}), ...(row.value || {}) };
  }
  return merged;
}

// ===========================================================================
// 日付ユーティリティ（JST基準）
// ===========================================================================

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function addDays(date, days) {
  return new Date(new Date(date).getTime() + days * 24 * 60 * 60 * 1000);
}

/** その日の JST hour 時ちょうど（UTCのDateとして返す） */
function atJstHour(date, hour) {
  const jst = new Date(new Date(date).getTime() + JST_OFFSET_MS);
  jst.setUTCHours(hour, 0, 0, 0);
  return new Date(jst.getTime() - JST_OFFSET_MS);
}

/** 顧客表示用の JST 日付 (YYYY-MM-DD) */
function jstDate(date) {
  if (!date) return null;
  return new Date(new Date(date).getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 到着日から次回の課金日・お届け予定日を求める
 *   次回お届け予定日 = 到着日 + interval_days
 *   次回課金日       = 次回お届け予定日 − lead_days（= 到着日 + interval − lead）
 */
function computeSchedule(deliveredAt, plan, settings) {
  const interval = plan?.interval_days ?? 28;
  const lead = plan?.lead_days ?? 3;
  const hour = settings?.billing?.billing_hour_jst ?? 9;
  const nextDelivery = addDays(deliveredAt, interval);
  const nextBilling = atJstHour(addDays(deliveredAt, interval - lead), hour);
  return { nextBillingAt: nextBilling.toISOString(), nextDeliveryAt: nextDelivery.toISOString() };
}

// ===========================================================================
// Shopify Admin API
// ===========================================================================

async function getStore() {
  const { data, error } = await db()
    .from('channel_stores')
    .select('shop_domain, access_token')
    .eq('channel', 'SHOPIFY')
    .eq('is_active', true)
    .limit(1)
    .single();
  if (error || !data) throw new Error('Shopifyストアが連携されていません');
  return data;
}

async function shopifyGraphQL(query, variables = {}) {
  const store = await getStore();
  const res = await fetch(`https://${store.shop_domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': store.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  if (json.errors) throw new Error(`Shopify GraphQL: ${JSON.stringify(json.errors).slice(0, 400)}`);
  return json.data;
}

/** mutation の userErrors をまとめて例外にする */
function throwUserErrors(node, label) {
  const errs = node?.userErrors || [];
  if (errs.length) throw new Error(`${label}: ${errs.map((e) => `${(e.field || []).join('.')} ${e.message}`).join(' / ')}`);
  return node;
}

const gid = {
  product: (id) => (String(id).startsWith('gid://') ? id : `gid://shopify/Product/${id}`),
  variant: (id) => (String(id).startsWith('gid://') ? id : `gid://shopify/ProductVariant/${id}`),
  contract: (id) => (String(id).startsWith('gid://') ? id : `gid://shopify/SubscriptionContract/${id}`),
  order: (id) => (String(id).startsWith('gid://') ? id : `gid://shopify/Order/${id}`),
  fulfillment: (id) => (String(id).startsWith('gid://') ? id : `gid://shopify/Fulfillment/${id}`),
  sellingPlan: (id) => (String(id).startsWith('gid://') ? id : `gid://shopify/SellingPlan/${id}`),
};

function numericId(gidStr) {
  if (!gidStr) return null;
  const s = String(gidStr);
  return s.startsWith('gid://') ? s.split('/').pop() : s;
}

// ===========================================================================
// イベントログ（冪等化キー付き）
// ===========================================================================

async function logEvent(subscriptionId, eventType, actor, payload, idempotencyKey = null) {
  const row = {
    subscription_id: subscriptionId,
    event_type: eventType,
    actor,
    payload: payload || null,
    idempotency_key: idempotencyKey,
  };
  const { error } = await db().from('subscription_events').insert(row);
  if (error) {
    // 23505 = unique violation（webhook重複配信）。呼び出し側で処理済み扱いにする
    if (error.code === '23505') return { duplicate: true };
    console.error('[subscription] logEvent error:', error.message);
  }
  return { duplicate: false };
}

// ===========================================================================
// 契約の同期（Shopify → Supabase）
// ===========================================================================

const CONTRACT_QUERY = `
query($id: ID!) {
  subscriptionContract(id: $id) {
    id
    status
    nextBillingDate
    createdAt
    currencyCode
    customer { id email firstName lastName }
    customerPaymentMethod { id }
    originOrder { id name }
    lines(first: 20) {
      nodes {
        title
        quantity
        variantId
        productId
        sellingPlanId
        sellingPlanName
        currentPrice { amount }
      }
    }
  }
}`;

async function fetchContract(contractId) {
  const data = await shopifyGraphQL(CONTRACT_QUERY, { id: gid.contract(contractId) });
  return data?.subscriptionContract || null;
}

/** selling_plan_id からプランを引く。無ければ商品IDで引く */
async function resolvePlan(contract) {
  const line = contract?.lines?.nodes?.[0];
  if (!line) return null;
  // バリエーションで一意に決まる（クレアショットは1日1本/1日2本が同じ Selling Plan を共有するため、まず variant で引く）
  const variantId = numericId(line.variantId);
  if (variantId) {
    const { data } = await db()
      .from('subscription_plans')
      .select('*')
      .eq('shopify_variant_id', variantId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (data) return data;
  }
  const sellingPlanId = numericId(line.sellingPlanId);
  if (sellingPlanId) {
    const { data } = await db()
      .from('subscription_plans')
      .select('*')
      .eq('shopify_selling_plan_id', sellingPlanId)
      .maybeSingle();
    if (data) return data;
  }
  const productId = numericId(line.productId);
  if (productId) {
    const { data } = await db()
      .from('subscription_plans')
      .select('*')
      .eq('shopify_product_id', productId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (data) return data;
  }
  return null;
}

/** LINE連携済みなら line_user_id を補完する */
async function resolveLineUserId(email, shopifyCustomerId) {
  if (!email && !shopifyCustomerId) return null;
  let q = db().from('line_shopify_links').select('line_user_id, shopify_email, shopify_customer_id');
  if (email) q = q.ilike('shopify_email', email);
  const { data } = await q.limit(1);
  if (data && data[0]?.line_user_id) return data[0].line_user_id;
  if (shopifyCustomerId) {
    const { data: byId } = await db()
      .from('line_shopify_links')
      .select('line_user_id')
      .eq('shopify_customer_id', String(shopifyCustomerId))
      .limit(1);
    if (byId && byId[0]?.line_user_id) return byId[0].line_user_id;
  }
  return null;
}

/**
 * 契約を作成/更新する。
 * 新規作成時は Shopify 側の nextBillingDate を「十分先の仮日付」に飛ばし、
 * Shopify 起点で勝手に課金されないようにする（課金は必ず当モジュールの billingAttempt）。
 */
async function syncContract(contractId, { origin = 'regular' } = {}) {
  const contract = await fetchContract(contractId);
  if (!contract) throw new Error(`契約が取得できません: ${contractId}`);

  const numericContractId = numericId(contract.id);
  const plan = await resolvePlan(contract);
  const line = contract.lines?.nodes?.[0];
  const email = contract.customer?.email || '';
  const shopifyCustomerId = numericId(contract.customer?.id);
  const lineUserId = await resolveLineUserId(email, shopifyCustomerId);
  const amount = line ? Number(line.currentPrice?.amount || 0) * (line.quantity || 1) : null;

  const { data: existing } = await db()
    .from('subscriptions')
    .select('*')
    .eq('shopify_contract_id', numericContractId)
    .maybeSingle();

  if (existing) {
    const patch = {
      plan_id: plan?.id || existing.plan_id,
      email: email || existing.email,
      shopify_customer_id: shopifyCustomerId || existing.shopify_customer_id,
      line_user_id: lineUserId || existing.line_user_id,
      amount: amount ?? existing.amount,
      currency: contract.currencyCode || existing.currency,
    };
    // Shopify側でキャンセルされていたらこちらも合わせる
    if (contract.status === 'CANCELLED' && existing.status !== 'cancelled') {
      patch.status = 'cancelled';
      patch.cancelled_at = new Date().toISOString();
    }
    await db().from('subscriptions').update(patch).eq('id', existing.id);
    return { ...existing, ...patch };
  }

  const row = {
    shopify_contract_id: numericContractId,
    plan_id: plan?.id || null,
    shopify_customer_id: shopifyCustomerId,
    email,
    line_user_id: lineUserId,
    status: 'pending_first_shipment',
    cycle_count: 1, // 初回はチェックアウトで課金済み
    first_order_id: numericId(contract.originOrder?.id),
    origin: plan?.is_preorder ? 'preorder' : origin,
    amount,
    currency: contract.currencyCode || 'JPY',
  };
  const { data: inserted, error } = await db().from('subscriptions').insert(row).select().single();
  if (error) throw new Error(`契約の保存に失敗: ${error.message}`);

  // 初回サイクル（チェックアウトで課金済み）
  await db().from('subscription_cycles').insert({
    subscription_id: inserted.id,
    cycle_no: 1,
    scheduled_at: contract.createdAt || new Date().toISOString(),
    shopify_order_id: numericId(contract.originOrder?.id),
    amount,
    status: 'billed',
    billed_at: contract.createdAt || new Date().toISOString(),
  });

  // Shopify の自動課金を封じる（仮日付を1年先へ）
  try {
    await setShopifyNextBillingDate(numericContractId, addDays(new Date(), 365).toISOString());
  } catch (err) {
    console.error('[subscription] 仮日付の設定に失敗:', err.message);
  }

  await logEvent(inserted.id, 'created', 'shopify', { contract_id: numericContractId, origin: row.origin });

  // クレアショット: 購入後オンボーディング（LINE / メールで My FITPEAK へ誘導）
  try {
    await require('./creashot-subscription.cjs').onContractCreated(inserted);
  } catch (err) {
    console.error('[subscription] onboarding hook error:', err.message);
  }
  return inserted;
}

// ===========================================================================
// Shopify ミューテーション
// ===========================================================================

async function setShopifyNextBillingDate(contractId, isoDate) {
  const data = await shopifyGraphQL(
    `mutation($contractId: ID!, $date: DateTime!) {
      subscriptionContractSetNextBillingDate(contractId: $contractId, date: $date) {
        contract { id nextBillingDate }
        userErrors { field message }
      }
    }`,
    { contractId: gid.contract(contractId), date: isoDate },
  );
  return throwUserErrors(data?.subscriptionContractSetNextBillingDate, 'setNextBillingDate');
}

async function createBillingAttempt(contractId, idempotencyKey) {
  const data = await shopifyGraphQL(
    `mutation($contractId: ID!, $input: SubscriptionBillingAttemptInput!) {
      subscriptionBillingAttemptCreate(subscriptionContractId: $contractId, subscriptionBillingAttemptInput: $input) {
        subscriptionBillingAttempt { id ready errorMessage errorCode order { id } }
        userErrors { field message }
      }
    }`,
    { contractId: gid.contract(contractId), input: { idempotencyKey } },
  );
  return throwUserErrors(data?.subscriptionBillingAttemptCreate, 'billingAttemptCreate');
}

async function cancelShopifyContract(contractId) {
  const data = await shopifyGraphQL(
    `mutation($id: ID!) {
      subscriptionContractCancel(subscriptionContractId: $id) {
        contract { id status }
        userErrors { field message }
      }
    }`,
    { id: gid.contract(contractId) },
  );
  return throwUserErrors(data?.subscriptionContractCancel, 'contractCancel');
}

async function pauseShopifyContract(contractId) {
  const data = await shopifyGraphQL(
    `mutation($id: ID!) {
      subscriptionContractPause(subscriptionContractId: $id) {
        contract { id status }
        userErrors { field message }
      }
    }`,
    { id: gid.contract(contractId) },
  );
  return throwUserErrors(data?.subscriptionContractPause, 'contractPause');
}

async function activateShopifyContract(contractId) {
  const data = await shopifyGraphQL(
    `mutation($id: ID!) {
      subscriptionContractActivate(subscriptionContractId: $id) {
        contract { id status }
        userErrors { field message }
      }
    }`,
    { id: gid.contract(contractId) },
  );
  return throwUserErrors(data?.subscriptionContractActivate, 'contractActivate');
}

async function sendPaymentUpdateEmail(contractId) {
  const contract = await fetchContract(contractId);
  const pmId = contract?.customerPaymentMethod?.id;
  if (!pmId) throw new Error('支払方法が取得できませんでした');
  const data = await shopifyGraphQL(
    `mutation($id: ID!) {
      customerPaymentMethodSendUpdateEmail(customerPaymentMethodId: $id) {
        customer { id }
        userErrors { field message }
      }
    }`,
    { id: pmId },
  );
  return throwUserErrors(data?.customerPaymentMethodSendUpdateEmail, 'sendUpdateEmail');
}

/** fulfillment から注文IDを引く（webhookに order_id が無い場合のフォールバック） */
async function resolveOrderIdFromFulfillment(fulfillmentId) {
  try {
    const data = await shopifyGraphQL(
      `query($id: ID!) { fulfillment(id: $id) { id order { id } } }`,
      { id: gid.fulfillment(fulfillmentId) },
    );
    return numericId(data?.fulfillment?.order?.id);
  } catch {
    return null;
  }
}

// ===========================================================================
// Selling Plan（定期プラン）の Shopify 同期
// ===========================================================================

async function syncSellingPlan(plan) {
  const planName = plan.display_name || plan.name;
  const optionLabel = `${plan.interval_days}日ごと`;
  const sellingPlanInput = {
    name: `${optionLabel}にお届け（${Number(plan.discount_percent)}%OFF）`,
    options: optionLabel,
    category: 'SUBSCRIPTION',
    description: plan.description || null,
    billingPolicy: { recurring: { interval: 'DAY', intervalCount: plan.interval_days } },
    deliveryPolicy: { recurring: { interval: 'DAY', intervalCount: plan.interval_days, preAnchorBehavior: 'ASAP' } },
    pricingPolicies: [
      { fixed: { adjustmentType: 'PERCENTAGE', adjustmentValue: { percentage: Number(plan.discount_percent) } } },
    ],
    inventoryPolicy: { reserve: 'ON_SALE' },
  };

  if (plan.shopify_selling_plan_group_id) {
    const updateInput = {
      name: planName,
      merchantCode: 'subscribe-and-save',
      options: ['お届け周期'],
      description: plan.description || null,
    };
    if (plan.shopify_selling_plan_id) {
      updateInput.sellingPlansToUpdate = [{ id: gid.sellingPlan(plan.shopify_selling_plan_id), ...sellingPlanInput }];
    } else {
      updateInput.sellingPlansToCreate = [sellingPlanInput];
    }
    const data = await shopifyGraphQL(
      `mutation($id: ID!, $input: SellingPlanGroupInput!) {
        sellingPlanGroupUpdate(id: $id, input: $input) {
          sellingPlanGroup { id sellingPlans(first: 10) { nodes { id name } } }
          userErrors { field message }
        }
      }`,
      { id: `gid://shopify/SellingPlanGroup/${plan.shopify_selling_plan_group_id}`, input: updateInput },
    );
    const group = throwUserErrors(data?.sellingPlanGroupUpdate, 'sellingPlanGroupUpdate').sellingPlanGroup;
    const spId = numericId(group?.sellingPlans?.nodes?.[0]?.id);
    await db().from('subscription_plans').update({ shopify_selling_plan_id: spId }).eq('id', plan.id);
    return { groupId: numericId(group.id), sellingPlanId: spId };
  }

  const data = await shopifyGraphQL(
    `mutation($input: SellingPlanGroupInput!, $resources: SellingPlanGroupResourceInput) {
      sellingPlanGroupCreate(input: $input, resources: $resources) {
        sellingPlanGroup { id sellingPlans(first: 10) { nodes { id name } } }
        userErrors { field message }
      }
    }`,
    {
      input: {
        name: planName,
        merchantCode: 'subscribe-and-save',
        options: ['お届け周期'],
        position: 1,
        description: plan.description || null,
        sellingPlansToCreate: [sellingPlanInput],
      },
      resources: plan.shopify_product_id ? { productIds: [gid.product(plan.shopify_product_id)] } : {},
    },
  );
  const group = throwUserErrors(data?.sellingPlanGroupCreate, 'sellingPlanGroupCreate').sellingPlanGroup;
  const groupId = numericId(group.id);
  const sellingPlanId = numericId(group?.sellingPlans?.nodes?.[0]?.id);
  await db()
    .from('subscription_plans')
    .update({ shopify_selling_plan_group_id: groupId, shopify_selling_plan_id: sellingPlanId })
    .eq('id', plan.id);
  return { groupId, sellingPlanId };
}

// ===========================================================================
// 配達完了 → 次回スケジュール確定
// ===========================================================================

/**
 * 到着を記録し、次回課金日・次回お届け予定日を確定して active にする。
 * source: 'webhook'（配達完了イベント） / 'fallback'（発送+N日） / 'manual'（管理画面）
 */
async function markDelivered(subscription, deliveredAt, source, cycle = null) {
  const settings = await getSettings();
  const { data: plan } = subscription.plan_id
    ? await db().from('subscription_plans').select('*').eq('id', subscription.plan_id).maybeSingle()
    : { data: null };

  const { nextBillingAt, nextDeliveryAt } = computeSchedule(deliveredAt, plan, settings);

  const patch = {
    status: 'active',
    last_delivered_at: deliveredAt,
    next_billing_at: nextBillingAt,
    next_delivery_at: nextDeliveryAt,
    consecutive_skips: 0,
  };
  if (!subscription.first_delivered_at) patch.first_delivered_at = deliveredAt;

  await db().from('subscriptions').update(patch).eq('id', subscription.id);

  const targetCycle = cycle || (await latestCycle(subscription.id));
  if (targetCycle) {
    await db()
      .from('subscription_cycles')
      .update({ status: 'delivered', delivered_at: deliveredAt, delivered_source: source })
      .eq('id', targetCycle.id);
  }

  // Shopify 側にも次回課金日を反映（表示の整合。課金自体はこちらのcronが行う）
  try {
    await setShopifyNextBillingDate(subscription.shopify_contract_id, nextBillingAt);
  } catch (err) {
    console.error('[subscription] nextBillingDate同期失敗:', err.message);
  }

  await logEvent(subscription.id, 'delivered', source === 'manual' ? 'admin' : 'system', {
    delivered_at: deliveredAt,
    source,
    next_billing_at: nextBillingAt,
    next_delivery_at: nextDeliveryAt,
  });

  return { ...subscription, ...patch };
}

async function latestCycle(subscriptionId) {
  const { data } = await db()
    .from('subscription_cycles')
    .select('*')
    .eq('subscription_id', subscriptionId)
    .order('cycle_no', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function findBySubContractId(contractId) {
  const { data } = await db()
    .from('subscriptions')
    .select('*')
    .eq('shopify_contract_id', numericId(contractId))
    .maybeSingle();
  return data;
}

async function findByOrderId(orderId) {
  const id = numericId(orderId);
  const { data: cycle } = await db()
    .from('subscription_cycles')
    .select('*')
    .eq('shopify_order_id', id)
    .maybeSingle();
  if (!cycle) return { subscription: null, cycle: null };
  const { data: subscription } = await db()
    .from('subscriptions')
    .select('*')
    .eq('id', cycle.subscription_id)
    .maybeSingle();
  return { subscription, cycle };
}

// ===========================================================================
// スキップ・解約（顧客/管理 共通ロジック）
// ===========================================================================

async function skipSubscription(subscription, actor) {
  const settings = await getSettings();
  if (!settings.skip.enabled) throw new Error('スキップは現在受け付けていません');
  if (!['active', 'past_due'].includes(subscription.status)) {
    throw new Error('この定期購入は現在スキップできません');
  }
  const { data: plan } = subscription.plan_id
    ? await db().from('subscription_plans').select('*').eq('id', subscription.plan_id).maybeSingle()
    : { data: null };
  const maxSkips = plan?.max_consecutive_skips ?? 4;
  if (subscription.consecutive_skips >= maxSkips) {
    throw new Error(`連続でスキップできるのは${maxSkips}回までです`);
  }
  if (!subscription.next_billing_at) throw new Error('次回課金日がまだ確定していません');

  const cutoffMs = (settings.skip.cutoff_hours_before ?? 24) * 60 * 60 * 1000;
  if (new Date(subscription.next_billing_at).getTime() - Date.now() < cutoffMs) {
    throw new Error('次回課金日が近いため、スキップの受付を終了しました');
  }

  const days = settings.skip.skip_days ?? 7;
  const nextBillingAt = addDays(subscription.next_billing_at, days).toISOString();
  const nextDeliveryAt = subscription.next_delivery_at
    ? addDays(subscription.next_delivery_at, days).toISOString()
    : null;

  const patch = {
    next_billing_at: nextBillingAt,
    next_delivery_at: nextDeliveryAt,
    consecutive_skips: subscription.consecutive_skips + 1,
    total_skips: subscription.total_skips + 1,
  };
  await db().from('subscriptions').update(patch).eq('id', subscription.id);

  try {
    await setShopifyNextBillingDate(subscription.shopify_contract_id, nextBillingAt);
  } catch (err) {
    console.error('[subscription] skip時のnextBillingDate同期失敗:', err.message);
  }

  await logEvent(subscription.id, 'skipped', actor, {
    days,
    next_billing_at: nextBillingAt,
    next_delivery_at: nextDeliveryAt,
    consecutive_skips: patch.consecutive_skips,
  });
  return { ...subscription, ...patch };
}

async function cancelSubscription(subscription, actor, reasonId = null, note = null) {
  if (subscription.status === 'cancelled') return subscription;
  try {
    await cancelShopifyContract(subscription.shopify_contract_id);
  } catch (err) {
    // Shopify側が既にキャンセル済みでもこちらの状態は合わせる
    console.error('[subscription] Shopify解約エラー:', err.message);
    if (!/already|cancelled/i.test(err.message)) throw err;
  }
  const patch = {
    status: 'cancelled',
    cancelled_at: new Date().toISOString(),
    cancel_reason_id: reasonId || null,
    cancel_note: note || null,
    next_billing_at: null,
  };
  await db().from('subscriptions').update(patch).eq('id', subscription.id);
  await logEvent(subscription.id, 'cancelled', actor, { reason_id: reasonId, note, cycle_count: subscription.cycle_count });
  return { ...subscription, ...patch };
}

// ===========================================================================
// Webhook
// ===========================================================================

function verifyShopifyHmac(rawBody, hmacHeader) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_CLIENT_SECRET;
  if (!secret || !hmacHeader || !rawBody) return false;
  const hash = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(hash);
  const b = Buffer.from(hmacHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const WEBHOOK_TOPICS = [
  'SUBSCRIPTION_CONTRACTS_CREATE',
  'SUBSCRIPTION_CONTRACTS_UPDATE',
  'SUBSCRIPTION_BILLING_ATTEMPTS_SUCCESS',
  'SUBSCRIPTION_BILLING_ATTEMPTS_FAILURE',
  'SUBSCRIPTION_BILLING_ATTEMPTS_CHALLENGED',
  'ORDERS_CREATE',
  'FULFILLMENTS_CREATE',
  'FULFILLMENTS_UPDATE',
  'FULFILLMENT_EVENTS_CREATE',
];

async function handleWebhook(topic, body) {
  switch (topic) {
    case 'subscription_contracts/create':
      await syncContract(body.admin_graphql_api_id || body.id);
      return 'contract_created';

    case 'subscription_contracts/update': {
      const sub = await findBySubContractId(body.admin_graphql_api_id || body.id);
      if (sub) await syncContract(sub.shopify_contract_id);
      return 'contract_updated';
    }

    case 'subscription_billing_attempts/success':
      return handleBillingSuccess(body);

    case 'subscription_billing_attempts/failure':
    case 'subscription_billing_attempts/challenged':
      return handleBillingFailure(body);

    case 'fulfillments/create':
    case 'fulfillments/update':
      return handleFulfillment(body);

    case 'fulfillment_events/create':
      return handleFulfillmentEvent(body);

    case 'orders/create':
      return 'ignored';

    default:
      return 'unhandled';
  }
}

async function handleBillingSuccess(body) {
  const contractId = numericId(body.admin_graphql_api_subscription_contract_id || body.subscription_contract_id);
  const subscription = await findBySubContractId(contractId);
  if (!subscription) return 'no_subscription';

  const orderId = numericId(body.admin_graphql_api_order_id || body.order_id);
  const attemptId = numericId(body.admin_graphql_api_id || body.id);

  // 対象サイクル: billing_attempt_id 一致 → 未課金の最新
  let { data: cycle } = await db()
    .from('subscription_cycles')
    .select('*')
    .eq('subscription_id', subscription.id)
    .eq('billing_attempt_id', attemptId)
    .maybeSingle();

  if (!cycle) {
    const { data: pending } = await db()
      .from('subscription_cycles')
      .select('*')
      .eq('subscription_id', subscription.id)
      .in('status', ['scheduled', 'failed', 'retrying'])
      .order('cycle_no', { ascending: false })
      .limit(1)
      .maybeSingle();
    cycle = pending;
  }

  if (cycle) {
    await db()
      .from('subscription_cycles')
      .update({
        status: 'billed',
        billed_at: new Date().toISOString(),
        shopify_order_id: orderId,
        billing_attempt_id: attemptId,
        failure_reason: null,
      })
      .eq('id', cycle.id);
  } else {
    // Shopify側起点の課金（想定外）でもサイクルを残す
    await db().from('subscription_cycles').insert({
      subscription_id: subscription.id,
      cycle_no: subscription.cycle_count + 1,
      scheduled_at: new Date().toISOString(),
      billing_attempt_id: attemptId,
      shopify_order_id: orderId,
      amount: subscription.amount,
      status: 'billed',
      billed_at: new Date().toISOString(),
    });
  }

  await db()
    .from('subscriptions')
    .update({
      status: 'awaiting_delivery',
      cycle_count: subscription.cycle_count + 1,
      consecutive_skips: 0,
    })
    .eq('id', subscription.id);

  await logEvent(subscription.id, 'billing_success', 'shopify', { order_id: orderId, attempt_id: attemptId });
  return 'billed';
}

async function handleBillingFailure(body) {
  const contractId = numericId(body.admin_graphql_api_subscription_contract_id || body.subscription_contract_id);
  const subscription = await findBySubContractId(contractId);
  if (!subscription) return 'no_subscription';

  const settings = await getSettings();
  const attemptId = numericId(body.admin_graphql_api_id || body.id);
  const reason = body.error_message || body.error_code || '課金に失敗しました';

  const cycle = await latestCycle(subscription.id);
  const retryCount = (cycle?.retry_count || 0) + 1;
  const offsets = settings.billing.retry_offsets_days || [3, 7];
  const maxRetries = settings.billing.max_retries ?? offsets.length;
  const exhausted = retryCount > maxRetries;
  const nextRetryAt = exhausted ? null : addDays(new Date(), offsets[retryCount - 1] ?? 3).toISOString();

  if (cycle) {
    await db()
      .from('subscription_cycles')
      .update({
        status: exhausted ? 'failed' : 'retrying',
        failure_reason: reason,
        retry_count: retryCount,
        next_retry_at: nextRetryAt,
        billing_attempt_id: attemptId,
      })
      .eq('id', cycle.id);
  }

  await db()
    .from('subscriptions')
    .update({
      status: exhausted ? (settings.billing.after_max_retries === 'cancelled' ? 'cancelled' : 'paused') : 'past_due',
      paused_at: exhausted ? new Date().toISOString() : null,
    })
    .eq('id', subscription.id);

  // 支払方法の更新リンクをShopifyからメール送信
  try {
    await sendPaymentUpdateEmail(subscription.shopify_contract_id);
  } catch (err) {
    console.error('[subscription] 支払方法更新メール送信失敗:', err.message);
  }

  await logEvent(subscription.id, 'billing_failed', 'shopify', {
    reason, retry_count: retryCount, next_retry_at: nextRetryAt, exhausted,
  });
  return exhausted ? 'paused' : 'past_due';
}

async function handleFulfillment(body) {
  const { subscription, cycle } = await findByOrderId(body.order_id);
  if (!subscription) return 'no_subscription';

  const shippedAt = body.created_at || new Date().toISOString();
  if (cycle && !cycle.shipped_at) {
    await db().from('subscription_cycles').update({ status: 'shipped', shipped_at: shippedAt }).eq('id', cycle.id);
  }
  const patch = { last_shipped_at: shippedAt };
  if (subscription.status === 'pending_first_shipment' || subscription.status === 'awaiting_delivery') {
    patch.status = 'awaiting_delivery';
  }
  await db().from('subscriptions').update(patch).eq('id', subscription.id);
  await logEvent(subscription.id, 'shipped', 'shopify', { order_id: numericId(body.order_id), fulfillment_id: body.id });

  // 配達完了イベントが webhook で来る場合はそちらが優先。ここでは状態だけ進める
  if (String(body.shipment_status || '').toLowerCase() === 'delivered') {
    const fresh = await findBySubContractId(subscription.shopify_contract_id);
    await markDelivered(fresh, shippedAt, 'webhook', cycle);
    return 'delivered';
  }
  return 'shipped';
}

async function handleFulfillmentEvent(body) {
  const status = String(body.status || '').toLowerCase();
  if (status !== 'delivered') return 'ignored';

  let orderId = numericId(body.order_id);
  if (!orderId && body.fulfillment_id) orderId = await resolveOrderIdFromFulfillment(body.fulfillment_id);
  if (!orderId) return 'no_order';

  const { subscription, cycle } = await findByOrderId(orderId);
  if (!subscription) return 'no_subscription';
  if (subscription.status === 'cancelled') return 'cancelled';

  const deliveredAt = body.happened_at || new Date().toISOString();
  await markDelivered(subscription, deliveredAt, 'webhook', cycle);
  return 'delivered';
}

publicRouter.post('/webhooks/shopify', async (req, res) => {
  const topic = req.get('X-Shopify-Topic') || '';
  const webhookId = req.get('X-Shopify-Webhook-Id') || null;
  const hmac = req.get('X-Shopify-Hmac-Sha256') || '';

  if (!verifyShopifyHmac(req.rawBody, hmac)) {
    console.error('[subscription] webhook HMAC不一致:', topic);
    return res.status(401).json({ error: 'invalid hmac' });
  }

  // Shopifyへは即座に200を返す（5秒でタイムアウトするため）
  res.json({ ok: true });

  const body = req.body || {};
  const run = async () => {
    // 冪等化: X-Shopify-Webhook-Id で重複配信を弾く
    const { duplicate } = await logEvent(null, `webhook:${topic}`, 'shopify', body, webhookId);
    if (duplicate) {
      console.log('[subscription] webhook重複のためスキップ:', topic, webhookId);
      return;
    }
    try {
      const result = await handleWebhook(topic, body);
      console.log(`[subscription] webhook ${topic} -> ${result}`);
    } catch (err) {
      console.error(`[subscription] webhook ${topic} 失敗:`, err.message);
      await logEvent(null, 'webhook_error', 'system', { topic, error: err.message, body });
    }
  };

  try {
    const { waitUntil } = require('@vercel/functions');
    waitUntil(run());
  } catch {
    run();
  }
});

// ===========================================================================
// cron（/api/daily-cron から10分毎に内部実行される）
// ===========================================================================

/** 課金予定の契約に billingAttempt を作る */
async function runBillingCron() {
  const settings = await getSettings();
  if (!settings.billing.cron_enabled) return { skipped: 'cron_disabled' };

  const now = new Date().toISOString();
  const { data: due } = await db()
    .from('subscriptions')
    .select('*')
    .eq('status', 'active')
    .not('next_billing_at', 'is', null)
    .lte('next_billing_at', now)
    .limit(50);

  const results = [];
  for (const sub of due || []) {
    try {
      const cycleNo = sub.cycle_count + 1;
      // 既に同じサイクルを作っていれば二重課金しない
      const { data: existing } = await db()
        .from('subscription_cycles')
        .select('*')
        .eq('subscription_id', sub.id)
        .eq('cycle_no', cycleNo)
        .maybeSingle();
      if (existing && ['billed', 'shipped', 'delivered'].includes(existing.status)) {
        results.push({ id: sub.id, skipped: 'already_billed' });
        continue;
      }

      const idempotencyKey = `sub-${sub.id}-cycle-${cycleNo}`;
      if (!existing) {
        await db().from('subscription_cycles').insert({
          subscription_id: sub.id,
          cycle_no: cycleNo,
          scheduled_at: sub.next_billing_at,
          amount: sub.amount,
          status: 'scheduled',
        });
      }

      const attempt = await createBillingAttempt(sub.shopify_contract_id, idempotencyKey);
      const attemptId = numericId(attempt?.subscriptionBillingAttempt?.id);
      await db()
        .from('subscription_cycles')
        .update({ billing_attempt_id: attemptId })
        .eq('subscription_id', sub.id)
        .eq('cycle_no', cycleNo);

      await logEvent(sub.id, 'billing_attempted', 'system', { cycle_no: cycleNo, attempt_id: attemptId });
      results.push({ id: sub.id, cycle_no: cycleNo, attempt_id: attemptId });
    } catch (err) {
      console.error('[subscription] 課金失敗:', sub.id, err.message);
      await logEvent(sub.id, 'billing_error', 'system', { error: err.message });
      results.push({ id: sub.id, error: err.message });
    }
  }
  return { processed: results.length, results };
}

/** 課金失敗のリトライ */
async function runRetryCron() {
  const settings = await getSettings();
  if (!settings.billing.cron_enabled) return { skipped: 'cron_disabled' };

  const now = new Date().toISOString();
  const { data: cycles } = await db()
    .from('subscription_cycles')
    .select('*')
    .eq('status', 'retrying')
    .not('next_retry_at', 'is', null)
    .lte('next_retry_at', now)
    .limit(30);

  const results = [];
  for (const cycle of cycles || []) {
    try {
      const { data: sub } = await db().from('subscriptions').select('*').eq('id', cycle.subscription_id).maybeSingle();
      if (!sub || sub.status === 'cancelled') continue;

      const idempotencyKey = `sub-${sub.id}-cycle-${cycle.cycle_no}-retry-${cycle.retry_count}`;
      const attempt = await createBillingAttempt(sub.shopify_contract_id, idempotencyKey);
      const attemptId = numericId(attempt?.subscriptionBillingAttempt?.id);
      await db()
        .from('subscription_cycles')
        .update({ billing_attempt_id: attemptId, next_retry_at: null })
        .eq('id', cycle.id);
      await logEvent(sub.id, 'billing_retried', 'system', { cycle_no: cycle.cycle_no, retry: cycle.retry_count });
      results.push({ id: sub.id, cycle_no: cycle.cycle_no });
    } catch (err) {
      console.error('[subscription] リトライ失敗:', cycle.id, err.message);
      results.push({ cycle_id: cycle.id, error: err.message });
    }
  }
  return { processed: results.length, results };
}

/** 配達完了イベントが来ない契約を「発送+N日」で前に進める */
async function runDeliveryFallbackCron() {
  const settings = await getSettings();
  const fallbackDays = settings.delivery.delivery_fallback_days ?? 2;

  const { data: waiting } = await db()
    .from('subscriptions')
    .select('*')
    .eq('status', 'awaiting_delivery')
    .not('last_shipped_at', 'is', null)
    .limit(50);

  const results = [];
  for (const sub of waiting || []) {
    const { data: plan } = sub.plan_id
      ? await db().from('subscription_plans').select('delivery_fallback_days').eq('id', sub.plan_id).maybeSingle()
      : { data: null };
    const days = plan?.delivery_fallback_days ?? fallbackDays;
    const assumedDelivery = addDays(sub.last_shipped_at, days);
    if (assumedDelivery.getTime() > Date.now()) continue;
    try {
      await markDelivered(sub, assumedDelivery.toISOString(), 'fallback');
      results.push({ id: sub.id, delivered_at: assumedDelivery.toISOString() });
    } catch (err) {
      console.error('[subscription] fallback失敗:', sub.id, err.message);
      results.push({ id: sub.id, error: err.message });
    }
  }
  return { processed: results.length, results };
}

router.get('/cron', async (_req, res) => {
  try {
    const creashot = require('./creashot-subscription.cjs');
    const [billing, retry, fallback, reminders, resume] = await Promise.all([
      runBillingCron().catch((e) => ({ error: e.message })),
      runRetryCron().catch((e) => ({ error: e.message })),
      runDeliveryFallbackCron().catch((e) => ({ error: e.message })),
      creashot.runReminderCron().catch((e) => ({ error: e.message })),
      creashot.runPauseResumeCron().catch((e) => ({ error: e.message })),
    ]);
    res.json({ ok: true, billing, retry, fallback, reminders, resume });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/cron/billing', async (_req, res) => {
  try { res.json(await runBillingCron()); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/cron/retry', async (_req, res) => {
  try { res.json(await runRetryCron()); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/cron/delivery-fallback', async (_req, res) => {
  try { res.json(await runDeliveryFallbackCron()); } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===========================================================================
// 管理API（authMiddleware 配下）
// ===========================================================================

router.get('/health', async (_req, res) => {
  const checks = { service_role_key: hasServiceRole(), shopify_store: false, shopify_scopes: [], missing_scopes: [], db: false };
  try {
    const { error } = await db().from('subscriptions').select('id').limit(1);
    checks.db = !error;
    if (error) checks.db_error = error.message;
  } catch (err) { checks.db_error = err.message; }
  try {
    const store = await getStore();
    checks.shopify_store = store.shop_domain;
    const r = await fetch(`https://${store.shop_domain}/admin/oauth/access_scopes.json`, {
      headers: { 'X-Shopify-Access-Token': store.access_token },
    });
    const j = await r.json();
    checks.shopify_scopes = (j.access_scopes || []).map((s) => s.handle);
    // write_customer_payment_methods は Shopify に存在しないスコープ（2026-09時点で
    // Customer Payment Methods は read のみ）。支払方法の更新メールは read + 契約の write で送る。
    const required = [
      'read_own_subscription_contracts', 'write_own_subscription_contracts',
      'read_customer_payment_methods',
      'read_customers', 'write_products', 'read_products', 'read_orders', 'read_fulfillments',
    ];
    checks.missing_scopes = required.filter((s) => !checks.shopify_scopes.includes(s));
  } catch (err) { checks.shopify_error = err.message; }
  const settings = await getSettings().catch(() => null);
  checks.billing_cron_enabled = settings?.billing?.cron_enabled ?? null;
  checks.ready = checks.db && checks.service_role_key && checks.missing_scopes.length === 0;
  res.json(checks);
});

router.get('/stats', async (_req, res) => {
  try {
    const { data: subs } = await db().from('subscriptions').select('status, amount, next_billing_at, cancelled_at, cycle_count');
    const list = subs || [];
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const in30 = addDays(now, 30).toISOString();
    const weekAgo = addDays(now, -7).toISOString();

    const active = list.filter((s) => ['active', 'awaiting_delivery', 'pending_first_shipment'].includes(s.status));
    const upcoming = list.filter((s) => s.status === 'active' && s.next_billing_at && s.next_billing_at <= in30);
    res.json({
      active_count: active.length,
      pending_first_shipment: list.filter((s) => s.status === 'pending_first_shipment').length,
      awaiting_delivery: list.filter((s) => s.status === 'awaiting_delivery').length,
      past_due: list.filter((s) => s.status === 'past_due').length,
      paused: list.filter((s) => s.status === 'paused').length,
      cancelled_total: list.filter((s) => s.status === 'cancelled').length,
      cancelled_this_month: list.filter((s) => s.cancelled_at && s.cancelled_at >= monthStart).length,
      cancelled_this_week: list.filter((s) => s.cancelled_at && s.cancelled_at >= weekAgo).length,
      upcoming_30d_count: upcoming.length,
      upcoming_30d_amount: upcoming.reduce((sum, s) => sum + Number(s.amount || 0), 0),
      mrr_estimate: active.reduce((sum, s) => sum + Number(s.amount || 0), 0),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/list', async (req, res) => {
  try {
    const { status, q, limit = '100' } = req.query;
    let query = db()
      .from('subscriptions')
      .select('*, subscription_plans(name, display_name, interval_days), cancel_reasons(label)')
      .order('created_at', { ascending: false })
      .limit(Number(limit));
    if (status && status !== 'all') query = query.eq('status', status);
    if (q) query = query.or(`email.ilike.%${q}%,shopify_contract_id.eq.${String(q).replace(/\D/g, '') || 0}`);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    res.json({ subscriptions: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/detail/:id', async (req, res) => {
  try {
    const { data: subscription } = await db()
      .from('subscriptions')
      .select('*, subscription_plans(*), cancel_reasons(label)')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!subscription) return res.status(404).json({ error: '見つかりません' });
    const { data: cycles } = await db()
      .from('subscription_cycles')
      .select('*')
      .eq('subscription_id', subscription.id)
      .order('cycle_no', { ascending: false });
    const { data: events } = await db()
      .from('subscription_events')
      .select('*')
      .eq('subscription_id', subscription.id)
      .order('created_at', { ascending: false })
      .limit(100);
    res.json({ subscription, cycles: cycles || [], events: events || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function loadSub(id) {
  const { data } = await db().from('subscriptions').select('*').eq('id', id).maybeSingle();
  if (!data) throw new Error('契約が見つかりません');
  return data;
}

router.post('/:id/skip', async (req, res) => {
  try { res.json({ subscription: await skipSubscription(await loadSub(req.params.id), 'admin') }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/cancel', async (req, res) => {
  try {
    const sub = await loadSub(req.params.id);
    res.json({ subscription: await cancelSubscription(sub, 'admin', req.body?.reason_id, req.body?.note) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/pause', async (req, res) => {
  try {
    const sub = await loadSub(req.params.id);
    await pauseShopifyContract(sub.shopify_contract_id).catch((e) => console.error(e.message));
    await db().from('subscriptions').update({ status: 'paused', paused_at: new Date().toISOString() }).eq('id', sub.id);
    await logEvent(sub.id, 'paused', 'admin', {});
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/resume', async (req, res) => {
  try {
    const sub = await loadSub(req.params.id);
    await activateShopifyContract(sub.shopify_contract_id).catch((e) => console.error(e.message));
    const status = sub.next_billing_at ? 'active' : 'awaiting_delivery';
    await db().from('subscriptions').update({ status, paused_at: null }).eq('id', sub.id);
    await logEvent(sub.id, 'resumed', 'admin', { status });
    res.json({ ok: true, status });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/set-next-billing', async (req, res) => {
  try {
    const sub = await loadSub(req.params.id);
    const { date } = req.body || {};
    if (!date) return res.status(400).json({ error: 'date は必須です' });
    const settings = await getSettings();
    const iso = atJstHour(new Date(date), settings.billing.billing_hour_jst ?? 9).toISOString();
    await db().from('subscriptions').update({ next_billing_at: iso }).eq('id', sub.id);
    await setShopifyNextBillingDate(sub.shopify_contract_id, iso).catch((e) => console.error(e.message));
    await logEvent(sub.id, 'next_date_set', 'admin', { next_billing_at: iso });
    res.json({ ok: true, next_billing_at: iso });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/mark-delivered', async (req, res) => {
  try {
    const sub = await loadSub(req.params.id);
    const deliveredAt = req.body?.delivered_at ? new Date(req.body.delivered_at).toISOString() : new Date().toISOString();
    const updated = await markDelivered(sub, deliveredAt, 'manual');
    res.json({ subscription: updated });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/bill-now', async (req, res) => {
  try {
    const sub = await loadSub(req.params.id);
    const cycleNo = sub.cycle_count + 1;
    const { data: existing } = await db()
      .from('subscription_cycles').select('*').eq('subscription_id', sub.id).eq('cycle_no', cycleNo).maybeSingle();
    if (!existing) {
      await db().from('subscription_cycles').insert({
        subscription_id: sub.id, cycle_no: cycleNo,
        scheduled_at: new Date().toISOString(), amount: sub.amount, status: 'scheduled',
      });
    }
    const attempt = await createBillingAttempt(sub.shopify_contract_id, `sub-${sub.id}-cycle-${cycleNo}-manual-${Date.now()}`);
    const attemptId = numericId(attempt?.subscriptionBillingAttempt?.id);
    await db().from('subscription_cycles').update({ billing_attempt_id: attemptId })
      .eq('subscription_id', sub.id).eq('cycle_no', cycleNo);
    await logEvent(sub.id, 'billing_attempted', 'admin', { cycle_no: cycleNo, attempt_id: attemptId, manual: true });
    res.json({ ok: true, attempt_id: attemptId });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/sync', async (req, res) => {
  try {
    const sub = await loadSub(req.params.id);
    res.json({ subscription: await syncContract(sub.shopify_contract_id) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/payment-update-email', async (req, res) => {
  try {
    const sub = await loadSub(req.params.id);
    await sendPaymentUpdateEmail(sub.shopify_contract_id);
    await logEvent(sub.id, 'payment_update_email_sent', 'admin', {});
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── 設定 ──
router.get('/settings', async (_req, res) => {
  try { res.json(await getSettings()); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/settings', async (req, res) => {
  try {
    const updates = req.body || {};
    for (const [key, value] of Object.entries(updates)) {
      await db().from('subscription_settings').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    }
    await logEvent(null, 'settings_updated', 'admin', updates);
    res.json(await getSettings());
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── プラン ──
router.get('/plans', async (_req, res) => {
  try {
    const { data } = await db().from('subscription_plans').select('*').order('created_at');
    res.json({ plans: data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/plans', async (req, res) => {
  try {
    const { data, error } = await db().from('subscription_plans').insert(req.body || {}).select().single();
    if (error) throw new Error(error.message);
    await logEvent(null, 'plan_created', 'admin', { plan_id: data.id, name: data.name });
    res.json({ plan: data });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/plans/:id', async (req, res) => {
  try {
    const patch = { ...req.body };
    delete patch.id; delete patch.created_at;
    const { data, error } = await db().from('subscription_plans').update(patch).eq('id', req.params.id).select().single();
    if (error) throw new Error(error.message);
    await logEvent(null, 'plan_updated', 'admin', { plan_id: data.id, patch });
    res.json({ plan: data });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/plans/:id/sync-shopify', async (req, res) => {
  try {
    const { data: plan } = await db().from('subscription_plans').select('*').eq('id', req.params.id).maybeSingle();
    if (!plan) return res.status(404).json({ error: 'プランが見つかりません' });
    const result = await syncSellingPlan(plan);
    await logEvent(null, 'plan_synced', 'admin', { plan_id: plan.id, ...result });
    res.json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Shopify商品一覧（プラン設定の商品選択用）
router.get('/shopify-products', async (_req, res) => {
  try {
    const data = await shopifyGraphQL(`
      query { products(first: 50, sortKey: UPDATED_AT, reverse: true) {
        nodes { id title status featuredImage { url }
          variants(first: 5) { nodes { id title price } } }
      } }`);
    res.json({
      products: (data?.products?.nodes || []).map((p) => ({
        id: numericId(p.id),
        title: p.title,
        status: p.status,
        image: p.featuredImage?.url || null,
        variants: (p.variants?.nodes || []).map((v) => ({ id: numericId(v.id), title: v.title, price: v.price })),
      })),
    });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── 解約理由マスタ ──
router.get('/cancel-reasons', async (_req, res) => {
  const { data } = await db().from('cancel_reasons').select('*').order('sort_order');
  res.json({ reasons: data || [] });
});

router.post('/cancel-reasons', async (req, res) => {
  try {
    const { data, error } = await db().from('cancel_reasons').insert(req.body || {}).select().single();
    if (error) throw new Error(error.message);
    res.json({ reason: data });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/cancel-reasons/:id', async (req, res) => {
  try {
    const patch = { ...req.body }; delete patch.id;
    const { data, error } = await db().from('cancel_reasons').update(patch).eq('id', req.params.id).select().single();
    if (error) throw new Error(error.message);
    res.json({ reason: data });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── webhook登録 ──
router.post('/setup-webhooks', async (_req, res) => {
  try {
    const callbackUrl = `${BASE_URL}/api/public/subscription/webhooks/shopify`;
    const existing = await shopifyGraphQL(`
      query { webhookSubscriptions(first: 100) { nodes { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } } } }`);
    const nodes = existing?.webhookSubscriptions?.nodes || [];
    const results = [];
    for (const topic of WEBHOOK_TOPICS) {
      const already = nodes.find((n) => n.topic === topic && n.endpoint?.callbackUrl === callbackUrl);
      if (already) { results.push({ topic, status: 'exists' }); continue; }
      try {
        const data = await shopifyGraphQL(
          `mutation($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
            webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
              webhookSubscription { id }
              userErrors { field message }
            }
          }`,
          { topic, sub: { callbackUrl, format: 'JSON' } },
        );
        throwUserErrors(data?.webhookSubscriptionCreate, `webhook:${topic}`);
        results.push({ topic, status: 'created' });
      } catch (err) {
        results.push({ topic, status: 'error', error: err.message });
      }
    }
    await logEvent(null, 'webhooks_registered', 'admin', { callbackUrl, results });
    res.json({ callbackUrl, results });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── 分析 ──
router.get('/analytics', async (_req, res) => {
  try {
    const [{ data: subs }, { data: cycles }, { data: reasons }] = await Promise.all([
      db().from('subscriptions').select('id, status, origin, cycle_count, created_at, cancelled_at, cancel_reason_id, total_skips'),
      db().from('subscription_cycles').select('subscription_id, cycle_no, status'),
      db().from('cancel_reasons').select('id, label'),
    ]);
    const list = subs || [];
    const cyc = cycles || [];
    const reasonLabel = Object.fromEntries((reasons || []).map((r) => [r.id, r.label]));

    const billedByCycle = {};
    for (const c of cyc) {
      if (['billed', 'shipped', 'delivered'].includes(c.status)) {
        billedByCycle[c.cycle_no] = (billedByCycle[c.cycle_no] || 0) + 1;
      }
    }
    const firstBillers = billedByCycle[1] || 0;
    const secondBillers = billedByCycle[2] || 0;

    // コホート（初回課金月別に、n回目到達率）
    const cohorts = {};
    for (const s of list) {
      const month = (s.created_at || '').slice(0, 7);
      if (!month) continue;
      cohorts[month] = cohorts[month] || { month, total: 0, reached: {} };
      cohorts[month].total += 1;
      for (let n = 1; n <= Math.max(1, s.cycle_count); n += 1) {
        if (n <= s.cycle_count) cohorts[month].reached[n] = (cohorts[month].reached[n] || 0) + 1;
      }
    }

    const cancelBreakdown = {};
    for (const s of list.filter((x) => x.status === 'cancelled')) {
      const label = reasonLabel[s.cancel_reason_id] || '未回答';
      cancelBreakdown[label] = (cancelBreakdown[label] || 0) + 1;
    }

    const cancelled = list.filter((s) => s.status === 'cancelled');
    const activeCount = list.filter((s) => s.status !== 'cancelled').length;
    const skippedCycles = cyc.filter((c) => c.status === 'skipped').length;
    const failedCycles = cyc.filter((c) => c.status === 'failed').length;

    const byOrigin = ['preorder', 'regular'].map((origin) => {
      const group = list.filter((s) => s.origin === origin);
      const groupCancelled = group.filter((s) => s.status === 'cancelled');
      return {
        origin,
        total: group.length,
        active: group.filter((s) => !['cancelled'].includes(s.status)).length,
        avg_cycles: group.length ? group.reduce((a, s) => a + s.cycle_count, 0) / group.length : 0,
        cancel_rate: group.length ? groupCancelled.length / group.length : 0,
      };
    });

    res.json({
      first_to_second_rate: firstBillers ? secondBillers / firstBillers : null,
      first_billers: firstBillers,
      second_billers: secondBillers,
      active_count: activeCount,
      cancelled_count: cancelled.length,
      cancel_rate: list.length ? cancelled.length / list.length : 0,
      avg_cycles_at_cancel: cancelled.length ? cancelled.reduce((a, s) => a + s.cycle_count, 0) / cancelled.length : 0,
      skip_rate: cyc.length ? skippedCycles / cyc.length : 0,
      billing_failure_rate: cyc.length ? failedCycles / cyc.length : 0,
      cancel_breakdown: cancelBreakdown,
      cohorts: Object.values(cohorts).sort((a, b) => a.month.localeCompare(b.month)),
      by_origin: byOrigin,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===========================================================================
// 顧客ポータルAPI（My FITPEAK から呼ぶ / Supabase の JWT で本人確認）
// ===========================================================================

/**
 * Authorization: Bearer <supabase access token> を検証して本人のメールを返す。
 * ※既存 my-fitpeak API のように email クエリを信用する方式は採らない
 *   （他人の契約を解約できてしまうため）。
 */
async function requireCustomer(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw Object.assign(new Error('ログインが必要です'), { status: 401 });
  const { data, error } = await authClient().auth.getUser(token);
  if (error || !data?.user?.email) throw Object.assign(new Error('セッションが無効です'), { status: 401 });
  return { email: data.user.email, userId: data.user.id };
}

/** 本人の契約だけを取り出す */
async function loadCustomerSub(id, email) {
  const { data } = await db().from('subscriptions').select('*, subscription_plans(*)').eq('id', id).maybeSingle();
  if (!data) throw Object.assign(new Error('見つかりません'), { status: 404 });
  if ((data.email || '').toLowerCase() !== email.toLowerCase()) {
    throw Object.assign(new Error('権限がありません'), { status: 403 });
  }
  return data;
}

const STATUS_LABEL = {
  pending_first_shipment: '初回お届け準備中',
  awaiting_delivery: 'お届け中',
  active: 'ご利用中',
  past_due: 'お支払い確認中',
  paused: '一時停止中',
  cancelled: '解約済み',
};

function toPortalShape(sub, settings) {
  const plan = sub.subscription_plans || null;
  return {
    id: sub.id,
    status: sub.status,
    status_label: STATUS_LABEL[sub.status] || sub.status,
    plan_name: plan?.display_name || plan?.name || '定期購入',
    interval_days: plan?.interval_days ?? 28,
    amount: sub.amount,
    currency: sub.currency,
    cycle_count: sub.cycle_count,
    next_delivery_date: jstDate(sub.next_delivery_at),
    next_billing_date: jstDate(sub.next_billing_at),
    first_delivered_date: jstDate(sub.first_delivered_at),
    consecutive_skips: sub.consecutive_skips,
    max_consecutive_skips: plan?.max_consecutive_skips ?? 4,
    can_skip:
      (settings?.skip?.enabled ?? true) &&
      ['active', 'past_due'].includes(sub.status) &&
      !!sub.next_billing_at &&
      sub.consecutive_skips < (plan?.max_consecutive_skips ?? 4),
    can_cancel: !['cancelled'].includes(sub.status),
    is_preorder: sub.origin === 'preorder',
    preorder_note: plan?.preorder_note || null,
    preorder_first_ship_date: plan?.preorder_first_ship_date || null,
    // 初回発送前は「次回課金は初回到着後に確定」と伝える
    schedule_pending: sub.status === 'pending_first_shipment' || !sub.next_billing_at,
  };
}

publicRouter.get('/portal/settings', async (_req, res) => {
  try {
    const settings = await getSettings();
    const { data: reasons } = await db().from('cancel_reasons').select('id, label, retention_action, retention_message').eq('is_active', true).order('sort_order');
    res.json({
      skip: { enabled: settings.skip.enabled, days: settings.skip.skip_days },
      cancel_flow: settings.cancel_flow,
      cancel_reasons: reasons || [],
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

publicRouter.get('/portal/list', async (req, res) => {
  try {
    const { email } = await requireCustomer(req);
    const settings = await getSettings();
    const { data } = await db()
      .from('subscriptions')
      .select('*, subscription_plans(*)')
      .ilike('email', email)
      .order('created_at', { ascending: false });
    res.json({ subscriptions: (data || []).map((s) => toPortalShape(s, settings)) });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

publicRouter.get('/portal/detail/:id', async (req, res) => {
  try {
    const { email } = await requireCustomer(req);
    const sub = await loadCustomerSub(req.params.id, email);
    const settings = await getSettings();
    const { data: cycles } = await db()
      .from('subscription_cycles')
      .select('cycle_no, status, billed_at, shipped_at, delivered_at, amount, scheduled_at')
      .eq('subscription_id', sub.id)
      .order('cycle_no', { ascending: false });
    res.json({
      subscription: toPortalShape(sub, settings),
      history: (cycles || []).map((c) => ({
        cycle_no: c.cycle_no,
        status: c.status,
        billed_date: jstDate(c.billed_at),
        shipped_date: jstDate(c.shipped_at),
        delivered_date: jstDate(c.delivered_at),
        scheduled_date: jstDate(c.scheduled_at),
        amount: c.amount,
      })),
    });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

publicRouter.post('/portal/:id/skip', async (req, res) => {
  try {
    const { email } = await requireCustomer(req);
    const sub = await loadCustomerSub(req.params.id, email);
    const updated = await skipSubscription(sub, 'customer');
    const settings = await getSettings();
    res.json({ subscription: toPortalShape({ ...sub, ...updated }, settings) });
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});

publicRouter.post('/portal/:id/cancel', async (req, res) => {
  try {
    const { email } = await requireCustomer(req);
    const sub = await loadCustomerSub(req.params.id, email);
    const { reason_id, note } = req.body || {};
    if (!reason_id) return res.status(400).json({ error: '解約理由を選択してください' });
    // 予約販売の初回未発送は自動解約せず、運営対応に回す（初回注文の返金が絡むため）
    if (sub.status === 'pending_first_shipment') {
      await logEvent(sub.id, 'cancel_requested_preorder', 'customer', { reason_id, note });
      return res.status(409).json({
        error: '初回お届け前の解約は個別対応となります。お手数ですが公式LINEまたはメールでご連絡ください。',
        contact_required: true,
      });
    }
    const updated = await cancelSubscription(sub, 'customer', reason_id, note);
    const settings = await getSettings();
    res.json({ subscription: toPortalShape({ ...sub, ...updated }, settings) });
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});

publicRouter.post('/portal/:id/payment-update', async (req, res) => {
  try {
    const { email } = await requireCustomer(req);
    const sub = await loadCustomerSub(req.params.id, email);
    await sendPaymentUpdateEmail(sub.shopify_contract_id);
    await logEvent(sub.id, 'payment_update_email_sent', 'customer', {});
    res.json({ ok: true, sent_to: sub.email });
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});

/**
 * 注文番号での紐づけ（チェックアウトのメールと My FITPEAK のログインメールが違う場合）
 */
publicRouter.post('/portal/claim', async (req, res) => {
  try {
    const { email } = await requireCustomer(req);
    const orderNumber = String(req.body?.order_number || '').trim().replace(/^#/, '');
    if (!orderNumber) return res.status(400).json({ error: '注文番号を入力してください' });

    const data = await shopifyGraphQL(
      `query($q: String!) { orders(first: 5, query: $q) { nodes { id name customer { id email } } } }`,
      { q: `name:${orderNumber}` },
    );
    const order = (data?.orders?.nodes || [])[0];
    if (!order) return res.status(404).json({ error: '注文が見つかりませんでした' });

    const customerId = numericId(order.customer?.id);
    const { data: candidates } = await db()
      .from('subscriptions')
      .select('id, email, shopify_customer_id, first_order_id')
      .or(`first_order_id.eq.${numericId(order.id)},shopify_customer_id.eq.${customerId || 0}`);

    if (!candidates || candidates.length === 0) {
      return res.status(404).json({ error: 'この注文に紐づく定期購入が見つかりませんでした' });
    }
    for (const c of candidates) {
      await db().from('subscriptions').update({ email }).eq('id', c.id);
      await logEvent(c.id, 'claimed', 'customer', { order_number: orderNumber, new_email: email, old_email: c.email });
    }
    res.json({ ok: true, linked: candidates.length });
  } catch (err) { res.status(err.status || 400).json({ error: err.message }); }
});

// ── クレアショット拡張（管理: /api/subscription/creashot/*、顧客: /api/public/subscription/portal/creashot/*） ──
{
  const creashot = require('./creashot-subscription.cjs');
  router.use('/creashot', creashot.adminRouter);
  publicRouter.use('/portal/creashot', creashot.portalRouter);
}

module.exports = router;
module.exports.publicRouter = publicRouter;
module.exports.runBillingCron = runBillingCron;
module.exports.runRetryCron = runRetryCron;
module.exports.runDeliveryFallbackCron = runDeliveryFallbackCron;
module.exports._internal = {
  db, hasServiceRole, getSettings, computeSchedule, atJstHour, jstDate, addDays,
  shopifyGraphQL, syncContract, fetchContract, setShopifyNextBillingDate, createBillingAttempt,
  cancelShopifyContract, pauseShopifyContract, activateShopifyContract, sendPaymentUpdateEmail,
  resolveOrderIdFromFulfillment, syncSellingPlan, logEvent, numericId, gid,
  markDelivered, skipSubscription, cancelSubscription, handleWebhook, verifyShopifyHmac,
  WEBHOOK_TOPICS, toPortalShape, requireCustomer, loadCustomerSub,
};
