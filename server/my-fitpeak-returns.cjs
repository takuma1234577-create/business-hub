/**
 * My FITPEAK 返品・交換（Shopify注文）
 * Business-hub の「返品・交換審査システム」（return-review.cjs）の審査ロジックをそのまま使い、
 * 会員本人の注文であることの確認と、二重返金の防止を加えたもの。
 */
const { getSupabase } = require('./shared.cjs');
const rr = require('./return-review.cjs').helpers;

const MAX_DENIED_ATTEMPTS = 3;

// この注文の申請状況（画面表示用）。最新の申請を返す
async function getReturnStatus(shopifyOrderId) {
  const { data } = await getSupabase()
    .from('return_reviews')
    .select('request_type, final_result, shopify_result, ai_reason, rule_fail_reasons, created_at')
    .eq('shopify_order_id', String(shopifyOrderId))
    .order('created_at', { ascending: false });
  const rows = data || [];
  const latest = rows[0] || null;
  const approved = rows.find((r) => r.final_result === 'approved') || null;
  return {
    latest: latest && {
      requestType: latest.request_type,
      result: latest.final_result,
      shopifyResult: latest.shopify_result,
      message: latest.final_result === 'approved' ? latest.ai_reason : (latest.rule_fail_reasons || []).join('。'),
      at: latest.created_at,
    },
    approved: !!approved,
    deniedCount: rows.filter((r) => r.final_result === 'denied').length,
  };
}

// 複数注文の申請状況をまとめて取る（注文一覧のバッジ用）
async function getReturnBadges(shopifyOrderIds) {
  if (!shopifyOrderIds.length) return {};
  const { data } = await getSupabase()
    .from('return_reviews')
    .select('shopify_order_id, request_type, final_result, created_at')
    .in('shopify_order_id', shopifyOrderIds.map(String))
    .order('created_at', { ascending: false });
  const out = {};
  for (const r of data || []) {
    if (!out[r.shopify_order_id]) out[r.shopify_order_id] = { requestType: r.request_type, result: r.final_result };
  }
  return out;
}

// 返品期限の残り日数（超過なら負）。設定と延長ルールを反映
async function returnDeadline(orderName, orderDate) {
  const settings = await rr.loadSettings();
  const ext = await rr.checkReturnExtension(orderName, settings);
  const maxDays = (settings.return_period_days || 30) + (ext.extensionDays || 0);
  const days = Math.floor((Date.now() - new Date(orderDate).getTime()) / 86400000);
  return { maxDays, daysSince: days, remaining: maxDays - days, allowedReasons: settings.allowed_reasons || [] };
}

/**
 * 会員本人の注文に対する返品・交換の申請を審査して実行する。
 * 呼び出し側（my-fitpeak.cjs）で「この注文は本人のもの」の確認を済ませておくこと。
 */
async function submitReturn({ user, order, requestType, reason, reasonDetail, shippingAddress, images }) {
  const err = (status, message) => Object.assign(new Error(message), { status });
  if (!['return', 'exchange'].includes(requestType)) throw err(400, '申請の種類が不正です');
  if (!reason) throw err(400, '理由を選んでください');
  if (!Array.isArray(images) || images.length === 0) throw err(400, '証拠写真を1枚以上添付してください');
  if (images.length > 5) throw err(400, '証拠写真は最大5枚までです');
  if (requestType === 'exchange' && !String(shippingAddress || '').trim()) throw err(400, '交換の場合は届け先住所が必要です');
  if (reason === 'other' && !String(reasonDetail || '').trim()) throw err(400, '「その他」の場合は補足説明が必要です');

  const status = await getReturnStatus(order.id);
  if (status.approved) throw err(409, 'この注文はすでに返品・交換の申請が承認されています。');
  if (status.deniedCount >= MAX_DENIED_ATTEMPTS) throw err(429, '申請できる回数の上限に達しました。LINEでお問い合わせください。');
  if (['refunded', 'partially_refunded'].includes(order.financial_status)) throw err(409, 'この注文はすでに返金済みです。');

  const settings = await rr.loadSettings();
  const shopifyOrder = await rr.fetchShopifyOrder(order.name, settings);
  if (shopifyOrder.error) throw err(502, '注文情報を取得できませんでした。時間をおいてお試しください。');
  if (String(shopifyOrder.shopifyOrderId) !== String(order.id)) throw err(409, '注文の照合に失敗しました。');

  const extension = await rr.checkReturnExtension(order.name, settings);
  const failReasons = [];
  const days = Math.floor((Date.now() - new Date(shopifyOrder.orderDate).getTime()) / 86400000);
  const maxDays = (settings.return_period_days || 30) + (extension.extensionDays || 0);
  if (days > maxDays) failReasons.push(`返品期限超過（購入から${days}日経過、上限${maxDays}日）`);
  if (!(settings.allowed_reasons || []).includes(reason)) {
    failReasons.push(`理由「${rr.REASON_MAP[reason] || reason}」は対象外です`);
  }

  const ai = await rr.reviewWithAI(images, reason, reasonDetail, settings);
  const threshold = rr.getConfidenceThreshold(settings.ai_strictness ?? 50);
  if (!ai.approved || ai.confidence < threshold) {
    failReasons.push(`写真の審査: ${ai.reason}`);
  }
  const approved = failReasons.length === 0;

  let shopifyResult = 'skipped';
  if (approved) {
    const r = requestType === 'return'
      ? await rr.processShopifyRefund(shopifyOrder, settings)
      : await rr.processShopifyExchange(shopifyOrder, shippingAddress, settings);
    shopifyResult = r.success ? 'success' : 'error';
  }

  const customerName = order.shipping_address?.name || order.customer?.first_name || user.email || '';
  const lineNotified = await rr.sendLineNotification(
    { orderId: order.name, customerName, requestType, aiReason: approved ? ai.reason : failReasons.join('、') },
    approved,
    settings
  );

  await getSupabase().from('return_reviews').insert({
    order_id: order.name,
    customer_name: customerName,
    request_type: requestType,
    reason,
    reason_detail: reasonDetail || null,
    shipping_address: requestType === 'exchange' ? shippingAddress : null,
    image_count: images.length,
    ai_approved: ai.approved,
    ai_confidence: ai.confidence,
    ai_reason: ai.reason,
    ai_flags: ai.flags,
    rule_check_passed: approved,
    rule_fail_reasons: failReasons,
    final_result: approved ? 'approved' : 'denied',
    shopify_result: shopifyResult,
    line_notified: lineNotified,
    auth_user_id: user.id,
    shopify_order_id: String(order.id),
    source: 'my-fitpeak',
  });

  return {
    result: approved ? 'approved' : 'denied',
    requestType,
    message: approved ? ai.reason : failReasons.join('。'),
    shopifyResult,
  };
}

module.exports = { getReturnStatus, getReturnBadges, returnDeadline, submitReturn };
