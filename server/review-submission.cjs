/**
 * レビュー管理システム（在宅ワーク案件ナビ / Amazonレビュー案件・工程2）
 *
 * 注文確認OK後に発行したトークン付きフォームで:
 *   1) 顧客がレビュー下書き(タイトル/本文/画像)を提出
 *   2) 実際にAmazonへ投稿後、反映された確認スクショをアップロード
 *   3) Claude Vision が投稿内容(投稿者名/星/タイトル/本文)を読み取り、下書きと一致するか照合
 * 管理画面(business-hub CRM)で一括管理する。
 *
 * ルーター構成:
 *   publicRouter … 認証不要（顧客フォーム）。index.cjs で authMiddleware より前に /api/public/review-submission にマウント
 *   router(admin) … 認証必須。/api/review-submission にマウント
 */

const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const axios = require('axios');
const { getSupabase, getAnthropicClient, getLineCredentials } = require('./shared.cjs');

const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });
const VISION_MODEL = 'claude-sonnet-4-5';
const BASE_URL = process.env.BUSINESS_HUB_URL || 'https://business-hub-beige.vercel.app';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// 請求先（自社）情報
const BILL_TO = {
  company: '合同会社SVPコーポレーション',
  address: '沖縄県沖縄市明道1-1-25',
  email: 'takuma1234577@gmail.com',
};
const INVOICE_SURCHARGE = 1000; // 商品代金に上乗せする額（円・税込）
const CLOUDWORKS_TAG_NAME = 'クラウドワークス経由';

// レビュー反映確認OK（クラウドワークス経由）→ 完了メッセージ
const CW_COMPLETE_MESSAGE_DEFAULT =
  'レビューのご投稿を確認いたしました。ご協力ありがとうございました。\n' +
  'クラウドワークス経由でのご対応のため、こちらでの手続きは以上で完了です。担当より順次ご連絡いたします。';

// レビュー反映確認OK（銀行振込）→ 請求書提出の依頼メッセージ
const INVOICE_REQUEST_MESSAGE_DEFAULT =
  'レビューのご投稿を確認いたしました。ありがとうございます。\n\n' +
  '最後に、お振込のための請求書（PDF）をご提出ください。下記の内容で作成し、フォームからアップロードをお願いします。\n\n' +
  '【請求書の内容】\n' +
  '・請求金額：{amount}（税込）※商品代金＋1,000円\n' +
  '・請求日付：作成日\n' +
  '・宛先（下記宛）：\n' +
  `　${BILL_TO.company}\n` +
  `　${BILL_TO.address}\n` +
  `　${BILL_TO.email}\n\n` +
  '・差出人（あなたの情報）：\n' +
  '　会社名または個人名／住所／メールアドレス／振込先情報\n\n' +
  '{invoice_form_url}\n\n' +
  'お手数をおかけしますが、よろしくお願いいたします。';

// 請求書の最終承認（振込手続き後）→ 完了メッセージ
const PAID_COMPLETE_MESSAGE_DEFAULT =
  '請求書を確認し、お振込の手続きを進めます。ご協力ありがとうございました。すべての工程が完了です。';

// 承認時にユーザーへ送るレビュー実行日の案内文（{review_date} と {review_form_url} を差し込む）
const APPROVAL_MESSAGE_DEFAULT =
  'レビュー下書きを確認いたしました。ありがとうございます。\n\n' +
  'あなたのレビュー投稿日は【{review_date}】です。\n' +
  'この日になりましたら、ご提出いただいた下書きの内容でAmazonにレビューをご投稿ください。\n\n' +
  '投稿が完了しましたら、投稿画面のスクリーンショットを下記フォームからアップロードしてください。\n' +
  '{review_form_url}\n\n' +
  '※指定日での投稿にご協力いただくことで、特典のご案内がスムーズになります。';

// ---------------------------------------------------------------------------
// 共通ヘルパー
// ---------------------------------------------------------------------------
function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

// 購入日 + 10〜15日（ユーザーごとにランダム）でレビュー実行日を算出
function computeReviewDate(purchaseDate) {
  const base = purchaseDate ? new Date(purchaseDate) : new Date();
  const days = 10 + Math.floor(Math.random() * 6); // 10〜15
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

// 2026年8月10日（月） 形式
function formatJpDate(d) {
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${w}）`;
}

// YYYY-MM-DD（DBのdate列用）
function toDateOnly(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 日本時間での「今日」の YYYY-MM-DD（サーバーはUTCのため+9h）
function jstToday() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// 友だちへLINEプッシュ送信
async function pushLine(channelId, lineUserId, text) {
  if (!lineUserId) return false;
  const { accessToken } = await getLineCredentials(channelId);
  if (!accessToken) return false;
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text }] }),
  });
  return res.ok;
}

function extForType(contentType) {
  if (contentType && contentType.includes('pdf')) return 'pdf';
  if (contentType && contentType.includes('png')) return 'png';
  return 'jpg';
}

async function uploadImage(prefix, buffer, contentType) {
  const ext = extForType(contentType);
  const fileName = `review-submission/${prefix}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const { error } = await supabase.storage.from('chat-media').upload(fileName, buffer, {
    contentType: contentType || 'image/jpeg',
    upsert: true,
  });
  if (error) throw new Error(`ファイルのアップロードに失敗しました: ${error.message}`);
  const { data } = supabase.storage.from('chat-media').getPublicUrl(fileName);
  return data.publicUrl;
}

function normalizeText(s) {
  if (!s) return '';
  return String(s).normalize('NFKC').toLowerCase().replace(/[\s　]/g, '').replace(/[。、,.!！?？「」『』\-_/|:：]/g, '');
}

// 下書きと投稿の一致度（緩め）: 完全一致・包含・n文字窓の一致割合で判定
function textSimilarity(a, b) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (longer.includes(shorter)) return 1; // 短い方が丸ごと含まれる
  const win = Math.min(4, shorter.length);
  if (win < 2) return 0;
  let matched = 0;
  let total = 0;
  for (let i = 0; i + win <= shorter.length; i++) {
    total++;
    if (longer.includes(shorter.slice(i, i + win))) matched++;
  }
  return total ? matched / total : 0;
}

// ---------------------------------------------------------------------------
// レビュー提出の作成（注文確認OKから呼ばれる）。token付きフォームURLを返す。
// ---------------------------------------------------------------------------
async function createReviewSubmission({ channelId, friendId, lineUserId, orderNumber, productName, purchaseDate, orderTotal }) {
  // 同一注文で未完了の提出が既にあれば再利用（重複発行を防ぐ）
  if (orderNumber) {
    const { data: existing } = await supabase
      .from('review_submissions')
      .select('id, token, status')
      .eq('channel_id', channelId)
      .eq('order_number', orderNumber)
      .neq('status', 'rejected')
      .maybeSingle();
    if (existing) return { token: existing.token, url: `${BASE_URL}/review-form?t=${existing.token}`, reused: true };
  }
  const token = newToken();
  const { error } = await supabase.from('review_submissions').insert({
    channel_id: channelId,
    friend_id: friendId || null,
    line_user_id: lineUserId || null,
    token,
    order_number: orderNumber || null,
    product_name: productName || null,
    purchase_date: purchaseDate || null,
    order_total: (orderTotal != null ? Math.round(orderTotal) : null),
    status: 'awaiting_draft',
  });
  if (error) throw new Error(error.message);
  return { token, url: `${BASE_URL}/review-form?t=${token}`, reused: false };
}

// ---------------------------------------------------------------------------
// Claude Vision: 投稿後の確認スクショから投稿レビューを読み取る
// ---------------------------------------------------------------------------
async function extractReviewFromImage(imageUrl) {
  const resp = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 20000 });
  let mediaType = resp.headers['content-type'] || 'image/jpeg';
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) mediaType = 'image/jpeg';
  const b64 = Buffer.from(resp.data).toString('base64');
  const anthropic = await getAnthropicClient();
  const prompt = [
    'あなたはAmazonのカスタマーレビュー画面のスクリーンショットを読み取るアシスタントです。',
    '画像を読み取り、以下のJSONだけを厳密に返してください（前後に説明やコードフェンスを付けない）。',
    '{',
    '  "is_amazon_review": boolean,  // Amazonに投稿されたレビュー（またはレビュー投稿完了）画面なら true',
    '  "reviewer_name": string|null, // 投稿者名',
    '  "star_rating": number|null,   // 星の数 1〜5',
    '  "title": string|null,         // レビュータイトル',
    '  "body": string|null,          // レビュー本文',
    '  "confidence": number          // 読み取り確度 0.0〜1.0',
    '}',
    '読み取れない項目は null。推測で値を作らない。',
  ].join('\n');
  const message = await anthropic.messages.create({
    model: VISION_MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
      { type: 'text', text: prompt },
    ] }],
  });
  const text = (message.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
  let jsonStr = text;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) jsonStr = fence[1].trim();
  const brace = jsonStr.match(/\{[\s\S]*\}/);
  if (brace) jsonStr = brace[0];
  try {
    return JSON.parse(jsonStr);
  } catch {
    return { is_amazon_review: false, confidence: 0 };
  }
}

// Claude で請求書(PDF/画像)を読み取る
async function extractInvoice(fileUrl, contentType) {
  const resp = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 25000 });
  const b64 = Buffer.from(resp.data).toString('base64');
  const isPdf = (contentType && contentType.includes('pdf')) || fileUrl.toLowerCase().endsWith('.pdf');
  const anthropic = await getAnthropicClient();
  const prompt = [
    'あなたは請求書(インボイス)を読み取るアシスタントです。次のJSONだけを厳密に返してください（前後に説明やコードフェンスを付けない）。',
    '{',
    '  "is_invoice": boolean,        // 請求書なら true',
    '  "total_amount": number|null,  // 請求金額(円、数値のみ)',
    '  "invoice_date": string|null,  // 請求日付',
    '  "bill_to": { "company": string|null, "address": string|null, "email": string|null } | null, // 宛先(請求先)',
    '  "sender": { "name": string|null, "address": string|null, "email": string|null, "bank_info": string|null } | null, // 差出人(請求元)と振込先',
    '  "confidence": number          // 0.0〜1.0',
    '}',
    '振込先(bank_info)は銀行名・支店・口座種別・口座番号・名義などの記載があればまとめて入れる。読み取れない項目は null。',
  ].join('\n');
  const content = isPdf
    ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }, { type: 'text', text: prompt }]
    : [{ type: 'image', source: { type: 'base64', media_type: /png/.test(contentType || '') ? 'image/png' : 'image/jpeg', data: b64 } }, { type: 'text', text: prompt }];
  const message = await anthropic.messages.create({ model: VISION_MODEL, max_tokens: 1500, messages: [{ role: 'user', content }] });
  const text = (message.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
  let jsonStr = text;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) jsonStr = fence[1].trim();
  const brace = jsonStr.match(/\{[\s\S]*\}/);
  if (brace) jsonStr = brace[0];
  try { return JSON.parse(jsonStr); } catch { return { is_invoice: false, confidence: 0 }; }
}

// 請求書の内容を照合（金額＝商品代金+1000、宛先＝自社、差出人＋振込先の記載）
function judgeInvoice(extracted, submission) {
  if (!extracted || !extracted.is_invoice || (typeof extracted.confidence === 'number' && extracted.confidence < 0.4)) {
    return { verify_status: 'unreadable', reason: '請求書として読み取れませんでした' };
  }
  const reasons = [];
  const expected = (submission.order_total || 0) + INVOICE_SURCHARGE;
  const amt = extracted.total_amount != null ? Math.round(Number(String(extracted.total_amount).replace(/[^\d.]/g, ''))) : null;
  if (amt == null) reasons.push('請求金額を読み取れません');
  else if (amt !== expected) reasons.push(`請求金額が違います（請求書:${amt} / 正しくは:${expected}）`);

  const billCompany = normalizeText(extracted.bill_to && extracted.bill_to.company);
  if (!billCompany.includes(normalizeText(BILL_TO.company))) reasons.push('宛先が合同会社SVPコーポレーションではありません');

  const s = extracted.sender || {};
  if (!s.name) reasons.push('差出人の会社名/氏名がありません');
  if (!s.address) reasons.push('差出人の住所がありません');
  if (!s.email) reasons.push('差出人のメールアドレスがありません');
  if (!s.bank_info) reasons.push('振込先情報がありません');

  if (reasons.length > 0) return { verify_status: 'mismatch', reason: reasons.join(' / ') };
  return { verify_status: 'verified', reason: '請求書の内容を確認しました' };
}

// 投稿スクショと下書きを照合して判定
function judgeReview(extracted, submission) {
  if (!extracted || !extracted.is_amazon_review || (typeof extracted.confidence === 'number' && extracted.confidence < 0.4)) {
    return { verify_status: 'unreadable', reason: 'Amazonレビュー画面と判定できませんでした' };
  }
  const reasons = [];
  // 星5の確認
  if (extracted.star_rating == null) {
    reasons.push('星の数を読み取れません');
  } else if (Number(extracted.star_rating) !== 5) {
    reasons.push(`星5ではありません（星${extracted.star_rating}）`);
  }
  // タイトル照合
  if (submission.draft_title && extracted.title) {
    if (textSimilarity(submission.draft_title, extracted.title) < 0.5) reasons.push('タイトルが下書きと一致しません');
  }
  // 本文照合
  if (submission.draft_body && extracted.body) {
    if (textSimilarity(submission.draft_body, extracted.body) < 0.5) reasons.push('本文が下書きと一致しません');
  }
  if (reasons.length > 0) return { verify_status: 'mismatch', reason: reasons.join(' / ') };
  return { verify_status: 'verified', reason: '星5・投稿レビューと下書きが一致しました' };
}

// 友だちが「クラウドワークス経由」タグを持つか
async function hasCloudWorksTag(friendId) {
  if (!friendId) return false;
  const { data } = await supabase.from('friend_tags').select('tags(name)').eq('friend_id', friendId);
  return (data || []).some((r) => r.tags && r.tags.name === CLOUDWORKS_TAG_NAME);
}

// レビュー反映確認OK後の分岐: クラウドワークス経由=完了 / それ以外=請求書依頼
// 戻り値: 新しい status
async function advanceAfterReview(sub) {
  const isCW = await hasCloudWorksTag(sub.friend_id);
  if (isCW) {
    await supabase.from('review_submissions').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('id', sub.id);
    try { await pushLine(sub.channel_id, sub.line_user_id, CW_COMPLETE_MESSAGE_DEFAULT); } catch (e) { console.error('[review-submission] CW complete notify error:', e.message); }
    return 'completed';
  }
  await supabase.from('review_submissions').update({ status: 'awaiting_invoice', updated_at: new Date().toISOString() }).eq('id', sub.id);
  try {
    const amount = (sub.order_total || 0) + INVOICE_SURCHARGE;
    const msg = INVOICE_REQUEST_MESSAGE_DEFAULT
      .replace(/\{amount\}/g, '¥' + amount.toLocaleString('ja-JP'))
      .replace(/\{invoice_form_url\}/g, `${BASE_URL}/review-form?t=${sub.token}`);
    await pushLine(sub.channel_id, sub.line_user_id, msg);
  } catch (e) {
    console.error('[review-submission] invoice request notify error:', e.message);
  }
  return 'awaiting_invoice';
}

// ===========================================================================
// 顧客向け（認証不要）
// ===========================================================================
const publicRouter = express.Router();

// GET /context?t=token — フォーム表示用の状態を返す
publicRouter.get('/context', async (req, res) => {
  try {
    const token = req.query.t;
    if (!token) return res.status(400).json({ error: 'token required' });
    const { data, error } = await supabase
      .from('review_submissions')
      .select('token, product_name, order_number, status, draft_title, draft_body, draft_image_url, proof_image_url, verify_status, verify_reason, review_date, order_total, invoice_verify_status, invoice_verify_reason')
      .eq('token', token)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'not found' });
    const bill_amount = data.order_total != null ? data.order_total + INVOICE_SURCHARGE : null;
    res.json({ submission: data, bill_amount, bill_to: BILL_TO });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /draft — 下書き提出（multipart: t, title, body, image?）
publicRouter.post('/draft', upload.single('image'), async (req, res) => {
  try {
    const { t: token, title, body } = req.body;
    if (!token) return res.status(400).json({ error: 'token required' });
    const { data: sub } = await supabase.from('review_submissions').select('id, status').eq('token', token).maybeSingle();
    if (!sub) return res.status(404).json({ error: 'not found' });
    if (sub.status === 'rejected') return res.status(400).json({ error: 'この案件は受付を終了しています' });

    let imageUrl = null;
    if (req.file) imageUrl = await uploadImage('draft', req.file.buffer, req.file.mimetype);

    const updates = {
      draft_title: title || null,
      draft_body: body || null,
      draft_submitted_at: new Date().toISOString(),
      status: 'draft_received',
      updated_at: new Date().toISOString(),
    };
    if (imageUrl) updates.draft_image_url = imageUrl;
    const { error } = await supabase.from('review_submissions').update(updates).eq('id', sub.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, status: 'draft_received' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /proof — 投稿後の確認スクショ提出（multipart: t, image） → AI照合
publicRouter.post('/proof', upload.single('image'), async (req, res) => {
  try {
    const { t: token } = req.body;
    if (!token) return res.status(400).json({ error: 'token required' });
    if (!req.file) return res.status(400).json({ error: 'image required' });
    const { data: sub } = await supabase.from('review_submissions').select('*').eq('token', token).maybeSingle();
    if (!sub) return res.status(404).json({ error: 'not found' });

    // 承認前・下書き未提出はアップロード不可
    if (sub.status !== 'approved' && sub.status !== 'verified') {
      return res.status(400).json({ error: 'まだアップロードできません。担当者の承認後にアップロード可能になります。' });
    }
    // レビュー投稿日（実行日）を過ぎるまではアップロード不可
    if (sub.review_date && jstToday() < sub.review_date) {
      const disp = formatJpDate(new Date(sub.review_date + 'T00:00:00'));
      return res.status(400).json({ error: `レビュー投稿日（${disp}）になりましたらアップロードできます。` });
    }

    const imageUrl = await uploadImage('proof', req.file.buffer, req.file.mimetype);

    let extracted = null;
    let judged = { verify_status: 'error', reason: '解析に失敗しました' };
    try {
      extracted = await extractReviewFromImage(imageUrl);
      judged = judgeReview(extracted, sub);
    } catch (e) {
      judged = { verify_status: 'error', reason: e.message };
    }

    const { error } = await supabase.from('review_submissions').update({
      proof_image_url: imageUrl,
      proof_submitted_at: new Date().toISOString(),
      verify_status: judged.verify_status,
      verify_reason: judged.reason,
      verify_result: extracted,
      updated_at: new Date().toISOString(),
    }).eq('id', sub.id);
    if (error) return res.status(500).json({ error: error.message });

    // 星5＋下書き一致でOK → 自動で次工程へ（クラウドワークス経由=完了 / それ以外=請求書依頼）
    if (judged.verify_status === 'verified') {
      const newStatus = await advanceAfterReview(sub);
      return res.json({ ok: true, verify_status: 'verified', status: newStatus, reason: judged.reason });
    }
    res.json({ ok: true, verify_status: judged.verify_status, status: sub.status, reason: judged.reason });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /invoice — 請求書(PDF/画像)提出（multipart: t, file） → AI検証
publicRouter.post('/invoice', upload.single('file'), async (req, res) => {
  try {
    const { t: token } = req.body;
    if (!token) return res.status(400).json({ error: 'token required' });
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const { data: sub } = await supabase.from('review_submissions').select('*').eq('token', token).maybeSingle();
    if (!sub) return res.status(404).json({ error: 'not found' });
    if (sub.status !== 'awaiting_invoice' && sub.status !== 'invoice_submitted') {
      return res.status(400).json({ error: 'まだ請求書を提出できる段階ではありません。' });
    }

    const fileUrl = await uploadImage('invoice', req.file.buffer, req.file.mimetype);

    let extracted = null;
    let judged = { verify_status: 'error', reason: '解析に失敗しました' };
    try {
      extracted = await extractInvoice(fileUrl, req.file.mimetype);
      judged = judgeInvoice(extracted, sub);
    } catch (e) {
      judged = { verify_status: 'error', reason: e.message };
    }

    // 検証OKなら最終承認待ち(invoice_submitted)、NGなら請求書待ちのまま(再提出)
    const nextStatus = judged.verify_status === 'verified' ? 'invoice_submitted' : 'awaiting_invoice';
    const { error } = await supabase.from('review_submissions').update({
      invoice_url: fileUrl,
      invoice_submitted_at: new Date().toISOString(),
      invoice_verify_status: judged.verify_status,
      invoice_verify_reason: judged.reason,
      invoice_result: extracted,
      status: nextStatus,
      updated_at: new Date().toISOString(),
    }).eq('id', sub.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, verify_status: judged.verify_status, status: nextStatus, reason: judged.reason });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// 管理向け（認証必須）
// ===========================================================================
const router = express.Router();

router.get('/submissions', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 300);
    let q = supabase
      .from('review_submissions')
      .select('*, friend:friends(id, display_name, picture_url)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (req.query.channel_id) q = q.eq('channel_id', req.query.channel_id);
    if (req.query.status) q = q.eq('status', req.query.status);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats', async (req, res) => {
  try {
    let q = supabase.from('review_submissions').select('status, verify_status');
    if (req.query.channel_id) q = q.eq('channel_id', req.query.channel_id);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    const counts = {};
    for (const r of data || []) counts[r.status] = (counts[r.status] || 0) + 1;
    res.json({ total: (data || []).length, counts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ステータス・メモの更新（承認/却下など）
router.patch('/submissions/:id', async (req, res) => {
  try {
    const allowed = ['status', 'admin_note'];
    const updates = { updated_at: new Date().toISOString() };
    for (const k of allowed) if (k in req.body) updates[k] = req.body[k];
    const { data, error } = await supabase.from('review_submissions').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ submission: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 下書きを承認 → レビュー実行日(購入日+10〜15日ランダム)を確定し、ユーザーへLINE通知
router.post('/submissions/:id/approve', async (req, res) => {
  try {
    const { data: sub, error: e1 } = await supabase.from('review_submissions').select('*').eq('id', req.params.id).maybeSingle();
    if (e1) return res.status(500).json({ error: e1.message });
    if (!sub) return res.status(404).json({ error: 'not found' });

    // 購入日: 提出に無ければ注文確認ログ(review_order_verifications)から補完
    let purchaseDate = sub.purchase_date;
    if (!purchaseDate && sub.order_number) {
      const { data: ov } = await supabase
        .from('review_order_verifications')
        .select('order_data')
        .eq('order_number', sub.order_number)
        .eq('status', 'verified')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      purchaseDate = ov?.order_data?.purchase_date || null;
    }

    const rd = computeReviewDate(purchaseDate);
    const reviewDateStr = toDateOnly(rd);

    const { data: updated, error: e2 } = await supabase.from('review_submissions').update({
      status: 'approved',
      review_date: reviewDateStr,
      purchase_date: purchaseDate || sub.purchase_date,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', sub.id).select().single();
    if (e2) return res.status(500).json({ error: e2.message });

    // ユーザーへレビュー実行日を通知
    let notified = false;
    try {
      const msg = APPROVAL_MESSAGE_DEFAULT
        .replace(/\{review_date\}/g, formatJpDate(rd))
        .replace(/\{review_form_url\}/g, `${BASE_URL}/review-form?t=${sub.token}`);
      notified = await pushLine(sub.channel_id, sub.line_user_id, msg);
    } catch (err) {
      console.error('[review-submission] approve notify error:', err.message);
    }

    res.json({ submission: updated, review_date: reviewDateStr, notified });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 却下
router.post('/submissions/:id/reject', async (req, res) => {
  try {
    const { data, error } = await supabase.from('review_submissions')
      .update({ status: 'rejected', admin_note: req.body?.admin_note || null, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ submission: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// レビュー反映確認を手動でOKにして次工程へ（AI判定が付かない場合の救済）
router.post('/submissions/:id/advance', async (req, res) => {
  try {
    const { data: sub, error } = await supabase.from('review_submissions').select('*').eq('id', req.params.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!sub) return res.status(404).json({ error: 'not found' });
    if (sub.status !== 'approved') return res.status(400).json({ error: 'この段階では実行できません' });
    const newStatus = await advanceAfterReview(sub);
    res.json({ status: newStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 請求書を最終承認 → 完了（振込は手動）。ユーザーへ完了通知。
router.post('/submissions/:id/complete', async (req, res) => {
  try {
    const { data: sub, error } = await supabase.from('review_submissions').select('*').eq('id', req.params.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!sub) return res.status(404).json({ error: 'not found' });
    const { data: updated, error: e2 } = await supabase.from('review_submissions')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', sub.id).select().single();
    if (e2) return res.status(500).json({ error: e2.message });
    let notified = false;
    try { notified = await pushLine(sub.channel_id, sub.line_user_id, PAID_COMPLETE_MESSAGE_DEFAULT); } catch (e) { console.error('[review-submission] complete notify error:', e.message); }
    res.json({ submission: updated, notified });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 管理者が手動で発行（テスト/個別対応用）
router.post('/issue', async (req, res) => {
  try {
    const { channel_id, friend_id, line_user_id, order_number, product_name } = req.body;
    if (!channel_id) return res.status(400).json({ error: 'channel_id required' });
    const r = await createReviewSubmission({ channelId: channel_id, friendId: friend_id, lineUserId: line_user_id, orderNumber: order_number, productName: product_name });
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.publicRouter = publicRouter;
module.exports.createReviewSubmission = createReviewSubmission;
module.exports.extractReviewFromImage = extractReviewFromImage;
module.exports.judgeReview = judgeReview;
module.exports.textSimilarity = textSimilarity;
module.exports.computeReviewDate = computeReviewDate;
module.exports.formatJpDate = formatJpDate;
module.exports.toDateOnly = toDateOnly;
module.exports.extractInvoice = extractInvoice;
module.exports.judgeInvoice = judgeInvoice;
module.exports.advanceAfterReview = advanceAfterReview;
