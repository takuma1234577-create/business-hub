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
const { getSupabase, getAnthropicClient } = require('./shared.cjs');

const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });
const VISION_MODEL = 'claude-sonnet-4-5';
const BASE_URL = process.env.BUSINESS_HUB_URL || 'https://business-hub-beige.vercel.app';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// ---------------------------------------------------------------------------
// 共通ヘルパー
// ---------------------------------------------------------------------------
function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

async function uploadImage(prefix, buffer, contentType) {
  const ext = (contentType && contentType.includes('png')) ? 'png' : 'jpg';
  const fileName = `review-submission/${prefix}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const { error } = await supabase.storage.from('chat-media').upload(fileName, buffer, {
    contentType: contentType || 'image/jpeg',
    upsert: true,
  });
  if (error) throw new Error(`画像アップロードに失敗しました: ${error.message}`);
  const { data } = supabase.storage.from('chat-media').getPublicUrl(fileName);
  return data.publicUrl;
}

function normalizeText(s) {
  if (!s) return '';
  return String(s).normalize('NFKC').toLowerCase().replace(/[\s　]/g, '').replace(/[。、,.!！?？「」『』\-_/|:：]/g, '');
}

// 下書き本文と投稿本文の一致度（緩め）: 連続一致の割合で判定
function textSimilarity(a, b) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  let matched = 0;
  for (let i = 0; i + 6 <= shorter.length; i += 6) {
    if (longer.includes(shorter.slice(i, i + 6))) matched += 6;
  }
  return shorter.length ? matched / shorter.length : 0;
}

// ---------------------------------------------------------------------------
// レビュー提出の作成（注文確認OKから呼ばれる）。token付きフォームURLを返す。
// ---------------------------------------------------------------------------
async function createReviewSubmission({ channelId, friendId, lineUserId, orderNumber, productName }) {
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

// 投稿スクショと下書きを照合して判定
function judgeReview(extracted, submission) {
  if (!extracted || !extracted.is_amazon_review || (typeof extracted.confidence === 'number' && extracted.confidence < 0.4)) {
    return { verify_status: 'unreadable', reason: 'Amazonレビュー画面と判定できませんでした' };
  }
  const reasons = [];
  // タイトル照合
  if (submission.draft_title && extracted.title) {
    if (textSimilarity(submission.draft_title, extracted.title) < 0.5) reasons.push('タイトルが下書きと一致しません');
  }
  // 本文照合
  if (submission.draft_body && extracted.body) {
    if (textSimilarity(submission.draft_body, extracted.body) < 0.5) reasons.push('本文が下書きと一致しません');
  }
  if (reasons.length > 0) return { verify_status: 'mismatch', reason: reasons.join(' / ') };
  return { verify_status: 'verified', reason: '投稿レビューと下書きが一致しました' };
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
      .select('token, product_name, order_number, status, draft_title, draft_body, draft_image_url, proof_image_url, verify_status, verify_reason')
      .eq('token', token)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'not found' });
    res.json({ submission: data });
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

    const imageUrl = await uploadImage('proof', req.file.buffer, req.file.mimetype);

    let extracted = null;
    let judged = { verify_status: 'error', reason: '解析に失敗しました' };
    try {
      extracted = await extractReviewFromImage(imageUrl);
      judged = judgeReview(extracted, sub);
    } catch (e) {
      judged = { verify_status: 'error', reason: e.message };
    }

    const nextStatus = judged.verify_status === 'verified' ? 'verified' : sub.status;
    const { error } = await supabase.from('review_submissions').update({
      proof_image_url: imageUrl,
      proof_submitted_at: new Date().toISOString(),
      verify_status: judged.verify_status,
      verify_reason: judged.reason,
      verify_result: extracted,
      status: nextStatus,
      updated_at: new Date().toISOString(),
    }).eq('id', sub.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, verify_status: judged.verify_status, reason: judged.reason });
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
