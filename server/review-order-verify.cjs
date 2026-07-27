/**
 * 注文確認システム（在宅ワーク案件ナビ / Amazonレビュー案件）
 *
 * 友だちが送った「注文完了画面」のスクショを:
 *   1) Claude Vision で解析し、注文番号・商品内容・合計金額を抽出
 *   2) Amazon SP-API (セラーセントラル) で当該注文を照会し、実在・金額・商品・ステータスを照合
 *   3) 合致 → 「注文完了」タグ付与＋次工程へ / 不一致・読取不可 → 再送依頼を自動返信
 *
 * 副作用（タグ付与・LINE返信・タグ連動配信）は line-crm.cjs 側で行う。
 * このモジュールは「解析＋照合＋ログ記録」を担い、判定結果を返す純粋な処理に寄せる。
 *
 * 環境: ANTHROPIC_API_KEY（DB優先）, Amazon SP-API（amazon_sp_accounts）, Supabase(SUPABASE_URL)
 */

const express = require('express');
const axios = require('axios');
const { getSupabase, getAnthropicClient } = require('./shared.cjs');
const { getAccessToken } = require('./amazon.cjs');
const { createReviewSubmission } = require('./review-submission.cjs');

const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });
const router = express.Router();

const VISION_MODEL = 'claude-sonnet-4-5';

// デフォルト返信文（configで上書き可能）。絵文字は使わない。
// success はプレースホルダ {order_number} {product} {amount} を実注文の値で差し込む。
const DEFAULTS = {
  success:
    'ご注文の確認が完了しました。ありがとうございます。\n\n' +
    '・注文番号：{order_number}\n' +
    '・商品名：{product}\n' +
    '・合計金額：{amount}\n\n' +
    '【次のステップ】\n' +
    '商品が届きましたら実際にお使いいただき、下記フォームから投稿予定のレビュー下書き（タイトル・本文・画像）をご提出ください。\n' +
    '{review_form_url}',
  // 確認NG（該当なし・不一致・読取不可・キャンセル）共通のチェックリスト文
  ng:
    '注文内容が確認できませんでした。\n' +
    '・注文番号：\n' +
    '・商品名：\n' +
    '・合計金額：\n\n' +
    '以下情報がスクショの中に入ってるか確認してください。',
};

// 円表示（¥3,980）
function fmtYen(v) {
  const n = parseYen(v);
  return n == null ? '' : '¥' + n.toLocaleString('ja-JP');
}

// テンプレートのプレースホルダを差し込む
function fillTemplate(tpl, { orderNumber, product, amount, reviewFormUrl }) {
  return String(tpl)
    .replace(/\{order_number\}/g, orderNumber || '')
    .replace(/\{product\}/g, product || '')
    .replace(/\{amount\}/g, amount || '')
    .replace(/\{review_form_url\}/g, reviewFormUrl || '');
}

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------
async function getConfig(channelId) {
  const { data } = await supabase
    .from('review_order_verify_config')
    .select('*')
    .eq('channel_id', channelId)
    .maybeSingle();
  return data || null;
}

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------
// Amazon JP の注文番号形式 DDD-DDDDDDD-DDDDDDD を抽出
function normalizeOrderNumber(raw) {
  if (!raw) return null;
  const m = String(raw).match(/\d{3}-\d{7}-\d{7}/);
  return m ? m[0] : null;
}

// 「¥3,980」「3980円」「3,980」「3980.00」等 → 整数(円)
// カンマは桁区切り、ドットは小数点として扱う（SP-APIは "3980.00" 形式で返す）。
function parseYen(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Math.round(v);
  const s = String(v).replace(/[,\s　¥￥円]/g, '');
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  return Math.round(parseFloat(m[0]));
}

// 商品名の緩い照合用に正規化（全角/半角・記号・空白を除去して小文字化）
function normalizeName(s) {
  if (!s) return '';
  return String(s)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　]/g, '')
    .replace(/[【】\[\]（）()、。,.\-_/|:：]/g, '');
}

// 抽出商品名と実注文の商品タイトル群に共通性があるか（緩め判定）
function productMatches(extractedItems, orderTitles) {
  const names = (extractedItems || [])
    .map((it) => normalizeName(it && (it.name || it.title)))
    .filter((n) => n.length >= 2);
  if (names.length === 0) return true; // 抽出できなければ商品名では弾かない
  const titles = (orderTitles || []).map(normalizeName).filter(Boolean);
  if (titles.length === 0) return true;
  for (const n of names) {
    for (const t of titles) {
      if (t.includes(n) || n.includes(t)) return true;
      // 4文字以上の連続一致があれば同一商品とみなす
      for (let i = 0; i + 4 <= n.length; i++) {
        if (t.includes(n.slice(i, i + 4))) return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Claude Vision で注文完了画面を解析
// ---------------------------------------------------------------------------
async function extractFromImage(imageUrl) {
  const resp = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 20000 });
  let mediaType = resp.headers['content-type'] || 'image/jpeg';
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) mediaType = 'image/jpeg';
  const b64 = Buffer.from(resp.data).toString('base64');

  const anthropic = await getAnthropicClient();
  const prompt = [
    'あなたはAmazonの注文完了（注文内容）画面のスクリーンショットを読み取るアシスタントです。',
    '画像を読み取り、以下のJSONだけを厳密に返してください（前後に説明文やコードフェンスを付けない）。',
    '{',
    '  "is_order_screen": boolean,   // Amazonの注文完了/注文詳細/注文履歴の画面なら true',
    '  "order_number": string|null,  // 注文番号（例 249-1234567-1234567）。無ければ null',
    '  "items": [ { "name": string, "qty": number|null, "price": number|null } ],  // 商品名と数量・単価(円)',
    '  "total_amount": number|null,  // 合計金額(円、数値のみ)。「注文合計」「ご請求額」等',
    '  "currency": string|null,      // 通常 "JPY"',
    '  "confidence": number          // 読み取り確度 0.0〜1.0',
    '}',
    '注意: 金額は円の数値のみ（カンマや¥は除く）。読み取れない項目は null。推測で値を作らない。',
  ].join('\n');

  const message = await anthropic.messages.create({
    model: VISION_MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });

  const text = (message.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('')
    .trim();

  // コードフェンスや前後テキストが混ざっても拾えるように最初の {...} を抽出
  let jsonStr = text;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) jsonStr = fence[1].trim();
  const brace = jsonStr.match(/\{[\s\S]*\}/);
  if (brace) jsonStr = brace[0];

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { is_order_screen: false, order_number: null, items: [], total_amount: null, confidence: 0, _raw: text.slice(0, 500) };
  }
  parsed.items = Array.isArray(parsed.items) ? parsed.items : [];
  return parsed;
}

// ---------------------------------------------------------------------------
// SP-API で注文照会
// ---------------------------------------------------------------------------
function isSpNotFound(e) {
  if (e.response?.status === 404) return true;
  const body = JSON.stringify(e.response?.data || '') + ' ' + (e.message || '');
  return /not ?found|does not exist|invalid.*order|resourcenotfound/i.test(body);
}

async function lookupOrder(orderNumber) {
  const { token, endpoint } = await getAccessToken();
  const headers = { 'x-amz-access-token': token };
  let order;
  try {
    const r = await axios.get(`${endpoint}/orders/v0/orders/${orderNumber}`, { headers, timeout: 20000 });
    order = r.data?.payload;
  } catch (e) {
    if (isSpNotFound(e)) return { found: false };
    throw e;
  }
  // SP-APIは存在しない注文番号でも 200 で空オブジェクト {} を返すため、
  // 実在フィールド（AmazonOrderId / OrderStatus）が無ければ「該当なし」とみなす。
  if (!order || (!order.AmazonOrderId && !order.OrderStatus)) return { found: false };

  let items = [];
  try {
    const r2 = await axios.get(`${endpoint}/orders/v0/orders/${orderNumber}/orderItems`, { headers, timeout: 20000 });
    items = r2.data?.payload?.OrderItems || [];
  } catch {
    // 明細が取れなくても注文本体で照合は続行
  }
  return { found: true, order, items };
}

// ---------------------------------------------------------------------------
// メイン: スクショ1枚を解析して照合し、判定を返す（ログ記録もここで行う）
// 戻り値: { status, reason, replyText, autoReply, applyTagId, extracted, orderNumber }
//   status: verified | mismatch | not_found | cancelled | unreadable | not_order | disabled | error
// ---------------------------------------------------------------------------
async function verifyReviewOrderFromImage({ channelId, friendId, lineUserId, imageUrl, messageId }) {
  const config = await getConfig(channelId);
  if (!config || !config.enabled) {
    return { status: 'disabled', reason: 'この案件ナビでは注文確認が無効です', replyText: null, autoReply: false, applyTagId: null };
  }

  const record = {
    channel_id: channelId,
    friend_id: friendId || null,
    line_user_id: lineUserId || null,
    image_url: imageUrl || null,
    message_id: messageId || null,
  };

  let extracted = null;
  try {
    extracted = await extractFromImage(imageUrl);
  } catch (e) {
    await logResult({ ...record, status: 'error', reason: `解析失敗: ${e.message}`, extracted: null, order_data: null, order_number: null });
    // 解析エラーは自動返信せず（一時的な障害の可能性）、ログのみ
    return { status: 'error', reason: e.message, replyText: null, autoReply: false, applyTagId: null };
  }

  // 注文完了画面でない / 確度が低い
  if (!extracted.is_order_screen || (typeof extracted.confidence === 'number' && extracted.confidence < 0.4)) {
    await logResult({ ...record, status: 'not_order', reason: '注文完了画面と判定できず', extracted, order_data: null, order_number: null });
    return decide('not_order', '注文完了画面ではない', config, DEFAULTS.resend, extracted);
  }

  const orderNumber = normalizeOrderNumber(extracted.order_number);
  if (!orderNumber) {
    await logResult({ ...record, status: 'unreadable', reason: '注文番号を読み取れず', extracted, order_data: null, order_number: null });
    return decide('unreadable', '注文番号を読み取れず', config, DEFAULTS.resend, extracted);
  }

  // SP-APIで照会
  let lookup;
  try {
    lookup = await lookupOrder(orderNumber);
  } catch (e) {
    await logResult({ ...record, status: 'error', reason: `照会失敗: ${e.message}`, extracted, order_data: null, order_number: orderNumber });
    return { status: 'error', reason: e.message, replyText: null, autoReply: false, applyTagId: null, orderNumber };
  }

  if (!lookup.found) {
    await logResult({ ...record, status: 'not_found', reason: 'セラーセントラルに該当注文なし', extracted, order_data: null, order_number: orderNumber });
    return decide('not_found', '該当注文なし', config, DEFAULTS.resend, extracted, orderNumber);
  }

  const order = lookup.order;
  const items = lookup.items || [];
  const orderData = {
    order_status: order.OrderStatus,
    order_total: order.OrderTotal,
    purchase_date: order.PurchaseDate,
    items: items.map((i) => ({ asin: i.ASIN, title: i.Title, qty: i.QuantityOrdered, price: i.ItemPrice })),
  };

  // キャンセル注文
  if (String(order.OrderStatus).toLowerCase() === 'canceled' || String(order.OrderStatus).toLowerCase() === 'cancelled') {
    await logResult({ ...record, status: 'cancelled', reason: '注文がキャンセル済み', extracted, order_data: orderData, order_number: orderNumber });
    return decide('cancelled', '注文がキャンセル済み', config, DEFAULTS.cancelled, extracted, orderNumber, orderData);
  }

  // 照合チェックを積み上げ
  const reasons = [];

  // (1) 金額照合（スクショの合計が読めていれば必須）
  const shotTotal = parseYen(extracted.total_amount);
  const realTotal = parseYen(order.OrderTotal?.Amount);
  const tol = config.amount_tolerance || 0;
  if (shotTotal != null && realTotal != null) {
    if (Math.abs(shotTotal - realTotal) > tol) {
      reasons.push(`金額不一致（スクショ:${shotTotal} / 実注文:${realTotal}）`);
    }
  } else if (realTotal != null && shotTotal == null) {
    reasons.push('スクショの合計金額を読み取れず');
  }

  // (2) 商品照合（許可ASINがあれば必須、なければ自社注文＝OK、名前の緩い一致も確認）
  const orderTitles = items.map((i) => i.Title).filter(Boolean);
  const orderAsins = items.map((i) => i.ASIN).filter(Boolean);
  if (Array.isArray(config.allowed_asins) && config.allowed_asins.length > 0) {
    const ok = orderAsins.some((a) => config.allowed_asins.includes(a));
    if (!ok) reasons.push('対象商品（許可ASIN）ではない');
  }
  if (!productMatches(extracted.items, orderTitles)) {
    reasons.push('スクショの商品名が注文内容と一致せず');
  }

  // (3) 購入日が古すぎる（使い回し防止）
  const maxAge = config.max_order_age_days || 30;
  if (order.PurchaseDate) {
    const ageDays = (Date.now() - new Date(order.PurchaseDate).getTime()) / (24 * 3600 * 1000);
    if (ageDays > maxAge) reasons.push(`購入日が${maxAge}日より前`);
  }

  if (reasons.length > 0) {
    await logResult({ ...record, status: 'mismatch', reason: reasons.join(' / '), extracted, order_data: orderData, order_number: orderNumber });
    return decide('mismatch', reasons.join(' / '), config, DEFAULTS.mismatch, extracted, orderNumber, orderData);
  }

  // 照合OK: 実注文の値を差し込んだ完了メッセージ（＝次工程の案内も含む）を返す
  await logResult({ ...record, status: 'verified', reason: '照合OK', extracted, order_data: orderData, order_number: orderNumber });
  // 商品名: Amazonの正式名称は長すぎるため、読みやすい長さに丸める
  const rawProduct =
    orderTitles.join(' / ') ||
    (extracted.items || []).map((i) => i && (i.name || i.title)).filter(Boolean).join(' / ');
  const productName = rawProduct.length > 48 ? rawProduct.slice(0, 48) + '…' : rawProduct;

  // レビュー提出フォームのURLを発行（本人紐付けトークン付き）
  let reviewFormUrl = '';
  try {
    const link = await createReviewSubmission({ channelId, friendId, lineUserId, orderNumber, productName: rawProduct, purchaseDate: order.PurchaseDate || null });
    reviewFormUrl = link.url;
  } catch (e) {
    console.error('[review-order-verify] createReviewSubmission error:', e.message);
  }

  const successTpl = config.success_message || DEFAULTS.success;
  const replyText = fillTemplate(successTpl, {
    orderNumber,
    product: productName,
    amount: fmtYen(order.OrderTotal?.Amount),
    reviewFormUrl,
  });
  return {
    status: 'verified',
    reason: '照合OK',
    replyText,
    autoReply: !!config.auto_reply,
    applyTagId: config.tag_id || null,
    extracted,
    orderNumber,
    order: orderData,
  };
}

function decide(status, reason, config, _defaultMsg, extracted, orderNumber, order) {
  // 確認NG（該当なし・不一致・読取不可・注文画面でない・キャンセル）は共通のNG文面。
  // configで個別上書き可能: 読取不可系は resend_message、不一致は mismatch_message を優先。
  let tpl = config.resend_message || config.mismatch_message || DEFAULTS.ng;
  if (status === 'mismatch') tpl = config.mismatch_message || config.resend_message || DEFAULTS.ng;
  const msg = fillTemplate(tpl, {
    orderNumber: orderNumber || '',
    product: (extracted && (extracted.items || []).map((i) => i && (i.name || i.title)).filter(Boolean).join(' / ')) || '',
    amount: (extracted && fmtYen(extracted.total_amount)) || '',
  });
  return {
    status,
    reason,
    replyText: msg,
    autoReply: !!config.auto_reply,
    applyTagId: null,
    extracted: extracted || null,
    orderNumber: orderNumber || null,
    order: order || null,
  };
}

async function logResult(row) {
  try {
    await supabase.from('review_order_verifications').insert({
      channel_id: row.channel_id,
      friend_id: row.friend_id,
      line_user_id: row.line_user_id,
      image_url: row.image_url,
      status: row.status,
      reason: row.reason,
      order_number: row.order_number,
      extracted: row.extracted,
      order_data: row.order_data,
      message_id: row.message_id,
    });
  } catch (e) {
    console.error('[review-order-verify] log insert error:', e.message);
  }
}

// ---------------------------------------------------------------------------
// 管理API
// ---------------------------------------------------------------------------
// GET /records?channel_id=&status=&limit=
router.get('/records', async (req, res) => {
  try {
    const channelId = req.query.channel_id;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    let q = supabase
      .from('review_order_verifications')
      .select('*, friend:friends(id, display_name, picture_url)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (channelId) q = q.eq('channel_id', channelId);
    if (req.query.status) q = q.eq('status', req.query.status);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /stats?channel_id=
router.get('/stats', async (req, res) => {
  try {
    const channelId = req.query.channel_id;
    let q = supabase.from('review_order_verifications').select('status');
    if (channelId) q = q.eq('channel_id', channelId);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    const counts = {};
    for (const r of data || []) counts[r.status] = (counts[r.status] || 0) + 1;
    res.json({ total: (data || []).length, counts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /config?channel_id=
router.get('/config', async (req, res) => {
  try {
    const channelId = req.query.channel_id;
    if (!channelId) return res.status(400).json({ error: 'channel_id is required' });
    const config = await getConfig(channelId);
    res.json({ config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /config?channel_id=
router.put('/config', async (req, res) => {
  try {
    const channelId = req.query.channel_id || req.body.channel_id;
    if (!channelId) return res.status(400).json({ error: 'channel_id is required' });
    const allowed = ['enabled', 'auto_reply', 'tag_id', 'allowed_asins', 'amount_tolerance', 'max_order_age_days', 'success_message', 'resend_message', 'mismatch_message'];
    const updates = { channel_id: channelId, updated_at: new Date().toISOString() };
    for (const k of allowed) if (k in req.body) updates[k] = req.body[k];
    const { data, error } = await supabase
      .from('review_order_verify_config')
      .upsert(updates, { onConflict: 'channel_id' })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ config: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.verifyReviewOrderFromImage = verifyReviewOrderFromImage;
module.exports.getConfig = getConfig;
module.exports.lookupOrder = lookupOrder;
module.exports.normalizeOrderNumber = normalizeOrderNumber;
module.exports.parseYen = parseYen;
module.exports.productMatches = productMatches;
