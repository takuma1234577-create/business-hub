const express = require('express');
const { getSupabase, getAnthropicClient } = require('./shared.cjs');
const router = express.Router();

const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });

// ===========================================================================
// Helper: Load return settings from DB
// ===========================================================================
async function loadSettings() {
  const { data, error } = await supabase
    .from('return_settings')
    .select('*')
    .eq('id', 'default')
    .single();

  if (error || !data) {
    // Return defaults if no settings found
    return {
      return_period_days: 30,
      extension_rule: 'none',
      extension_custom_days: 0,
      allowed_reasons: [
        'defective',
        'wrong_item',
        'size_color_mismatch',
      ],
      ai_strictness: 50,
      shopify_store_url: process.env.SHOPIFY_STORE_URL || '',
      shopify_admin_token: process.env.SHOPIFY_ADMIN_API_TOKEN || '',
      line_channel_token: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
      line_crm_api_url: process.env.LINE_CRM_API_URL || '',
      approve_template:
        '{customerName}様\n\nご注文番号 {orderId} の{requestType}申請が承認されました。\n\n理由: {reason}',
      deny_template:
        '{customerName}様\n\nご注文番号 {orderId} の{requestType}申請は承認されませんでした。\n\n理由: {reason}',
    };
  }
  return data;
}

// ===========================================================================
// Helper: Map reason code to label
// ===========================================================================
const REASON_MAP = {
  defective: '商品の初期不良（破損・傷など）',
  wrong_item: '届いた商品が注文と異なる（誤送品）',
  size_color_mismatch: 'サイズ・カラーが違う',
  changed_mind: '気が変わった',
  other: 'その他',
};

// ===========================================================================
// Helper: Calculate confidence threshold from strictness (0-100)
// ===========================================================================
function getConfidenceThreshold(strictness) {
  if (strictness === 0) return 0; // Auto-approve, no image check
  if (strictness <= 25) return 0.5;
  if (strictness <= 50) return 0.65;
  if (strictness <= 75) return 0.8;
  return 0.9; // High strictness
}

// ===========================================================================
// Helper: Fetch order info from Shopify
// ===========================================================================
async function fetchShopifyOrder(orderId, settings) {
  const storeUrl = settings.shopify_store_url;
  const token = settings.shopify_admin_token;

  if (!storeUrl || !token) {
    return { error: 'Shopify連携が未設定です' };
  }

  try {
    const axios = require('axios');
    // Search by order name (e.g., #1001)
    const searchUrl = `${storeUrl}/admin/api/2024-01/orders.json?name=${encodeURIComponent(orderId)}&status=any`;
    const resp = await axios.get(searchUrl, {
      headers: { 'X-Shopify-Access-Token': token },
    });

    const orders = resp.data.orders;
    if (!orders || orders.length === 0) {
      return { error: '注文が見つかりません' };
    }

    const order = orders[0];
    return {
      shopifyOrderId: order.id,
      orderDate: order.created_at,
      totalPrice: order.total_price,
      lineItems: order.line_items.map((item) => ({
        title: item.title,
        variantId: item.variant_id,
        sku: item.sku,
        quantity: item.quantity,
        price: item.price,
      })),
      transactions: order.transactions || [],
      shippingAddress: order.shipping_address,
    };
  } catch (err) {
    console.error('[ReturnReview] Shopify order fetch error:', err.message);
    return { error: `Shopify注文取得エラー: ${err.message}` };
  }
}

// ===========================================================================
// Helper: Check return period extension from LINE CRM
// ===========================================================================
async function checkReturnExtension(orderId, settings) {
  const crmUrl = settings.line_crm_api_url;
  if (!crmUrl) return { extended: false, extensionDays: 0 };

  try {
    const axios = require('axios');
    const resp = await axios.get(`${crmUrl}/return-extension`, {
      params: { orderId },
      headers: settings.line_channel_token
        ? { Authorization: `Bearer ${settings.line_channel_token}` }
        : {},
      timeout: 5000,
    });
    return {
      extended: resp.data.extended || false,
      extensionDays: resp.data.extensionDays || 0,
    };
  } catch {
    // CRM unavailable, fall back to settings-based extension
    if (settings.extension_rule === 'scratch_90') {
      return { extended: true, extensionDays: 90 };
    }
    if (settings.extension_rule === 'custom' && settings.extension_custom_days > 0) {
      return { extended: true, extensionDays: settings.extension_custom_days };
    }
    return { extended: false, extensionDays: 0 };
  }
}

// ===========================================================================
// Helper: Claude Vision AI review
// ===========================================================================
async function reviewWithAI(images, reason, reasonDetail, settings) {
  const strictness = settings.ai_strictness ?? 50;

  // If strictness is 0, skip AI review
  if (strictness === 0) {
    return {
      approved: true,
      confidence: 1.0,
      reason: 'AI審査スキップ（厳格度0）',
      flags: [],
    };
  }

  const anthropic = getAnthropicClient();
  const reasonLabel = REASON_MAP[reason] || reason;

  // Build image content blocks
  const imageContent = images.slice(0, 5).map((img) => {
    // Remove data URL prefix if present
    const base64Data = img.replace(/^data:image\/(jpeg|png|gif|webp);base64,/, '');
    const mediaType = img.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: base64Data,
      },
    };
  });

  const rulesJson = JSON.stringify({
    allowed_reasons: settings.allowed_reasons,
    strictness,
    threshold: getConfidenceThreshold(strictness),
  });

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: `あなたは返品審査AIです。以下のルールに従い、JSONのみで返答してください。前置き・バッククォート・説明は不要です。

審査対象：
- 申請された返品理由：${reasonLabel}
${reasonDetail ? `- 補足説明：${reasonDetail}` : ''}

審査タスク：
- 添付画像が返品理由と整合しているか評価してください
- 審査ルール設定：${rulesJson}

出力フォーマット（JSONのみ）：
{"approved": true/false, "confidence": 0.0〜1.0, "reason": "判定理由のテキスト", "flags": ["指摘事項の配列"]}`,
      messages: [
        {
          role: 'user',
          content: [
            ...imageContent,
            {
              type: 'text',
              text: `この画像は「${reasonLabel}」の証拠写真として提出されました。返品理由と画像の整合性を審査してください。`,
            },
          ],
        },
      ],
    });

    const text = response.content[0].text.trim();
    // Parse JSON response
    const parsed = JSON.parse(text);
    return {
      approved: !!parsed.approved,
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0)),
      reason: String(parsed.reason || ''),
      flags: Array.isArray(parsed.flags) ? parsed.flags : [],
    };
  } catch (err) {
    console.error('[ReturnReview] AI review error:', err.message);
    return {
      approved: false,
      confidence: 0,
      reason: `AI審査エラー: ${err.message}`,
      flags: ['AI_ERROR'],
    };
  }
}

// ===========================================================================
// Helper: Process Shopify refund
// ===========================================================================
async function processShopifyRefund(shopifyOrder, settings) {
  const storeUrl = settings.shopify_store_url;
  const token = settings.shopify_admin_token;
  if (!storeUrl || !token || !shopifyOrder.shopifyOrderId) {
    return { success: false, error: 'Shopify連携情報が不足しています' };
  }

  try {
    const axios = require('axios');
    // Get transactions to find parent_id
    const txResp = await axios.get(
      `${storeUrl}/admin/api/2024-01/orders/${shopifyOrder.shopifyOrderId}/transactions.json`,
      { headers: { 'X-Shopify-Access-Token': token } }
    );
    const transactions = txResp.data.transactions || [];
    const parentTx = transactions.find((t) => t.kind === 'sale' || t.kind === 'capture');

    if (!parentTx) {
      return { success: false, error: '返金対象のトランザクションが見つかりません' };
    }

    const refundResp = await axios.post(
      `${storeUrl}/admin/api/2024-01/orders/${shopifyOrder.shopifyOrderId}/refunds.json`,
      {
        refund: {
          notify: true,
          note: '返品審査システムによる自動返金（返送不要）',
          transactions: [
            {
              parent_id: parentTx.id,
              amount: shopifyOrder.totalPrice,
              kind: 'refund',
              gateway: parentTx.gateway,
            },
          ],
        },
      },
      { headers: { 'X-Shopify-Access-Token': token } }
    );

    return { success: true, refundId: refundResp.data.refund?.id };
  } catch (err) {
    console.error('[ReturnReview] Shopify refund error:', err.message);
    return { success: false, error: err.message };
  }
}

// ===========================================================================
// Helper: Process Shopify exchange (create new order)
// ===========================================================================
async function processShopifyExchange(shopifyOrder, shippingAddress, settings) {
  const storeUrl = settings.shopify_store_url;
  const token = settings.shopify_admin_token;
  if (!storeUrl || !token || !shopifyOrder.lineItems?.length) {
    return { success: false, error: 'Shopify連携情報が不足しています' };
  }

  try {
    const axios = require('axios');
    const lineItems = shopifyOrder.lineItems.map((item) => ({
      variant_id: item.variantId,
      quantity: item.quantity,
    }));

    const orderResp = await axios.post(
      `${storeUrl}/admin/api/2024-01/orders.json`,
      {
        order: {
          line_items: lineItems,
          shipping_address: { address1: shippingAddress },
          financial_status: 'paid',
          note: '交換対応のため新規発送（返品不要）- 返品審査システム',
        },
      },
      { headers: { 'X-Shopify-Access-Token': token } }
    );

    return { success: true, newOrderId: orderResp.data.order?.id };
  } catch (err) {
    console.error('[ReturnReview] Shopify exchange error:', err.message);
    return { success: false, error: err.message };
  }
}

// ===========================================================================
// Helper: Send LINE CRM notification
// ===========================================================================
async function sendLineNotification(params, approved, settings) {
  const crmUrl = settings.line_crm_api_url;
  if (!crmUrl) return false;

  const template = approved ? settings.approve_template : settings.deny_template;
  const requestTypeLabel = params.requestType === 'return' ? '返品・返金' : '交換';
  const message = (template || '')
    .replace(/\{customerName\}/g, params.customerName)
    .replace(/\{orderId\}/g, params.orderId)
    .replace(/\{requestType\}/g, requestTypeLabel)
    .replace(/\{reason\}/g, params.aiReason || '');

  try {
    const axios = require('axios');
    await axios.post(
      `${crmUrl}/notifications/send`,
      { orderId: params.orderId, message, type: approved ? 'approved' : 'denied' },
      {
        headers: settings.line_channel_token
          ? { Authorization: `Bearer ${settings.line_channel_token}` }
          : {},
        timeout: 10000,
      }
    );
    return true;
  } catch (err) {
    console.error('[ReturnReview] LINE notification error:', err.message);
    return false;
  }
}

// ===========================================================================
// POST /review - Main review endpoint
// ===========================================================================
router.post('/review', async (req, res) => {
  try {
    const { orderId, customerName, requestType, reason, reasonDetail, shippingAddress, images } =
      req.body;

    // Validate required fields
    if (!orderId || !customerName || !requestType || !reason || !images?.length) {
      return res.status(400).json({ error: '必須項目が不足しています' });
    }

    if (!['return', 'exchange'].includes(requestType)) {
      return res.status(400).json({ error: '申請タイプが不正です' });
    }

    if (requestType === 'exchange' && !shippingAddress) {
      return res.status(400).json({ error: '交換の場合、配送先住所が必要です' });
    }

    if (images.length > 5) {
      return res.status(400).json({ error: '証拠写真は最大5枚までです' });
    }

    const settings = await loadSettings();

    // Step 1: Fetch Shopify order
    const shopifyOrder = await fetchShopifyOrder(orderId, settings);

    // Step 2: Check return period extension from LINE CRM
    const extension = await checkReturnExtension(orderId, settings);

    // Step 3: Rule checks
    let ruleCheckPassed = true;
    const ruleFailReasons = [];

    // Check 1: Return period
    if (shopifyOrder.orderDate) {
      const orderDate = new Date(shopifyOrder.orderDate);
      const now = new Date();
      const daysSinceOrder = Math.floor((now - orderDate) / (1000 * 60 * 60 * 24));
      const maxDays = settings.return_period_days + (extension.extensionDays || 0);
      if (daysSinceOrder > maxDays) {
        ruleCheckPassed = false;
        ruleFailReasons.push(
          `返品期限超過（購入から${daysSinceOrder}日経過、上限${maxDays}日）`
        );
      }
    } else if (shopifyOrder.error) {
      // Shopify order fetch failed - don't block, but flag it
      ruleFailReasons.push(`注文情報取得: ${shopifyOrder.error}`);
    }

    // Check 2: Allowed reasons
    const allowedReasons = settings.allowed_reasons || [];
    if (!allowedReasons.includes(reason)) {
      ruleCheckPassed = false;
      ruleFailReasons.push(`返品理由「${REASON_MAP[reason] || reason}」は許可されていません`);
    }

    // Step 4: AI image review
    const aiResult = await reviewWithAI(images, reason, reasonDetail, settings);
    const confidenceThreshold = getConfidenceThreshold(settings.ai_strictness ?? 50);

    // Check 3: AI approval
    if (!aiResult.approved || aiResult.confidence < confidenceThreshold) {
      ruleCheckPassed = false;
      ruleFailReasons.push(
        `AI審査: ${aiResult.reason} (確信度: ${(aiResult.confidence * 100).toFixed(0)}%, 閾値: ${(confidenceThreshold * 100).toFixed(0)}%)`
      );
    }

    const finalApproved = ruleCheckPassed;

    // Step 5: Execute Shopify actions if approved
    let shopifyResult = 'skipped';
    if (finalApproved && shopifyOrder.shopifyOrderId) {
      if (requestType === 'return') {
        const refundResult = await processShopifyRefund(shopifyOrder, settings);
        shopifyResult = refundResult.success ? 'success' : 'error';
      } else {
        const exchangeResult = await processShopifyExchange(
          shopifyOrder,
          shippingAddress,
          settings
        );
        shopifyResult = exchangeResult.success ? 'success' : 'error';
      }
    }

    // Step 6: Send LINE notification
    const lineNotified = await sendLineNotification(
      {
        orderId,
        customerName,
        requestType,
        aiReason: finalApproved ? aiResult.reason : ruleFailReasons.join('、'),
      },
      finalApproved,
      settings
    );

    // Step 7: Save to database
    const logEntry = {
      order_id: orderId,
      customer_name: customerName,
      request_type: requestType,
      reason,
      reason_detail: reasonDetail || null,
      shipping_address: requestType === 'exchange' ? shippingAddress : null,
      image_count: images.length,
      ai_approved: aiResult.approved,
      ai_confidence: aiResult.confidence,
      ai_reason: aiResult.reason,
      ai_flags: aiResult.flags,
      rule_check_passed: ruleCheckPassed,
      rule_fail_reasons: ruleFailReasons,
      final_result: finalApproved ? 'approved' : 'denied',
      shopify_result: shopifyResult,
      line_notified: lineNotified,
    };

    await supabase.from('return_reviews').insert(logEntry);

    // Step 8: Return response
    res.json({
      result: finalApproved ? 'approved' : 'denied',
      requestType,
      aiConfidence: aiResult.confidence,
      aiReason: finalApproved ? aiResult.reason : ruleFailReasons.join('。'),
      shopifyResult,
      lineNotified,
    });
  } catch (err) {
    console.error('[ReturnReview] Unexpected error:', err);
    res.status(500).json({ error: `審査処理エラー: ${err.message}` });
  }
});

// ===========================================================================
// GET /logs - Review logs list
// ===========================================================================
router.get('/logs', async (req, res) => {
  try {
    const {
      page = '1',
      pageSize = '20',
      result,
      requestType,
      dateFrom,
      dateTo,
    } = req.query;

    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.max(1, Math.min(100, parseInt(pageSize, 10) || 20));
    const from = (currentPage - 1) * size;
    const to = from + size - 1;

    let query = supabase
      .from('return_reviews')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (result && result !== 'all') {
      query = query.eq('final_result', result);
    }
    if (requestType && requestType !== 'all') {
      query = query.eq('request_type', requestType);
    }
    if (dateFrom) {
      query = query.gte('created_at', dateFrom);
    }
    if (dateTo) {
      query = query.lte('created_at', `${dateTo}T23:59:59`);
    }

    const { data, error, count } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({
      data: data || [],
      pagination: {
        page: currentPage,
        pageSize: size,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / size),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// GET /settings - Load settings
// ===========================================================================
router.get('/settings', async (_req, res) => {
  try {
    const settings = await loadSettings();
    // Mask sensitive tokens for frontend
    res.json({
      ...settings,
      shopify_admin_token: settings.shopify_admin_token ? '••••••••' : '',
      line_channel_token: settings.line_channel_token ? '••••••••' : '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// PUT /settings - Save settings
// ===========================================================================
router.put('/settings', async (req, res) => {
  try {
    const {
      return_period_days,
      extension_rule,
      extension_custom_days,
      allowed_reasons,
      ai_strictness,
      shopify_store_url,
      shopify_admin_token,
      line_channel_token,
      line_crm_api_url,
      approve_template,
      deny_template,
    } = req.body;

    // Build update payload, skip masked tokens
    const payload = {
      id: 'default',
      return_period_days: return_period_days ?? 30,
      extension_rule: extension_rule ?? 'none',
      extension_custom_days: extension_custom_days ?? 0,
      allowed_reasons: allowed_reasons ?? ['defective', 'wrong_item', 'size_color_mismatch'],
      ai_strictness: ai_strictness ?? 50,
      shopify_store_url: shopify_store_url ?? '',
      line_crm_api_url: line_crm_api_url ?? '',
      approve_template: approve_template ?? '',
      deny_template: deny_template ?? '',
      updated_at: new Date().toISOString(),
    };

    // Only update tokens if they are not masked
    if (shopify_admin_token && !shopify_admin_token.includes('••••')) {
      payload.shopify_admin_token = shopify_admin_token;
    }
    if (line_channel_token && !line_channel_token.includes('••••')) {
      payload.line_channel_token = line_channel_token;
    }

    const { error } = await supabase
      .from('return_settings')
      .upsert(payload, { onConflict: 'id' });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
