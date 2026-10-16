/**
 * My FITPEAK：旧 my-fitpeak（別アプリ）から移したアンケート／クーポン／紹介
 *
 * 会員向け: /api/my-fitpeak/*（my-fitpeak-auth.cjs の後ろ。本人は Supabase の JWT で確認済み）
 *   GET  /survey/status            自分のアンケート回答の有無（回答済みなら商品・評価・推薦文）
 *   POST /survey/submit            回答する（1人1回）
 *   POST /survey/coupon            回答の特典 2000円OFF を発行（1回答につき1枚・何度呼んでも同じ）
 *   POST /survey/track-click       Amazonレビューボタンを押した記録（自分の回答に付く）
 *   POST /survey/track-step        画面到達の記録（ファネル用）
 *   GET  /coupons                  自分のクーポン一覧
 *   GET  /referral                 紹介コードと紹介の件数
 *   POST /referral/issue-code      紹介コード＋専用URLを発行（1人1コード）
 *   POST /referral/bind            紹介された側が自分の購入を紐づける
 * 公開: /api/my-fitpeak/public/survey/track-open（LINE配信URL ?lu= を開いた記録。何も返さない）
 * Webhook: /api/webhook/shopify-order（Shopify orders/create。HMAC 必須）
 * Amazonレビュー特典（スクショ提出→無料プレゼント）は 2026-10-16 オーナー指示で廃止。
 *
 * 旧アプリとの違い（個人情報を守るため）:
 *   - 画面から送られた lineUserId / email / surveyId / claimId では誰のデータも読まない・書かない。
 *     「誰か」は必ずログインのセッション（members.auth_user_id → members.line_user_id）から決める。
 *   - クーポン・特典の発行はサーバーが本人の回答/申請に対してだけ行い、条件付き更新で二重発行しない。
 *   - スクショは公開バケットではなく非公開バケット（documents）に保存し、AI確認もサーバーがそこから読む。
 */
const crypto = require('crypto');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const SHOP_ORIGIN = 'https://fitpeak.co';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SURVEY_COUPON_AMOUNT = 2000;
const SURVEY_COUPON_HOURS = 24;
const REFERRAL_MIN_ORDER = 3000;
const REFERRAL_GIFT_AMOUNT = 500;
const LINE_USER_ID = /^U[0-9a-f]{32}$/;

// アンケートの商品（親ASIN）。画面の選択肢と同じ
const SURVEY_PRODUCTS = {
  'パワーグリップ': 'B0FSL6K37K',
  'リストラップ': 'B0F7HG9JCF',
  'ニースリーブ': 'B0DXFPMTWZ',
  'エルボースリーブ': 'B0FDLD6F5S',
  'トレーニングベルト（本牛革）': 'B0G12F9GYQ',
  'ナイロン トレーニングベルト': 'B0GWYRQNHZ',
  '可変式ダンベル 20kg': 'B0FL8RXNSZ',
  '筋トレギアセット': 'B0GCDCF1NF',
};
// 星4-5の推薦文を fitpeak.co の商品レビューにも載せる（旧アプリと同じ対応表）
const ASIN_TO_SHOPIFY = {
  B0FSL6K37K: '8264131772551',
  B0F7HG9JCF: '8089731563655',
  B0DXFPMTWZ: '8011377410183',
  B0FDLD6F5S: '8128854786183',
  B0G12F9GYQ: '8175971827847',
};

const TRACK_STEPS = new Set(['landing', 'questions', 'submitted', 'pre_review', 'review_cta', 'coupon', 'support_cta', 'completed', 'review_gift_offer', 'review_gift_submitted']);
const CLICK_ACTIONS = new Set(['amazon_review', 'amazon_review_pre', 'line_consultation']);

function randomCode(len) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}
const surveyCouponCode = () => `FITPEAK-${randomCode(6)}-${randomCode(4)}`;
const referralCode = () => `FP-${randomCode(6)}`;
const secretPass = () => randomCode(6);
const discountUrl = (code) => `${SHOP_ORIGIN}/discount/${encodeURIComponent(code)}?redirect=/`;

const isInternalEmail = (e) => /@line\.fitpeak\.co$/i.test(String(e || ''));
const isRealEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '')) && !isInternalEmail(e);
const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
const normName = (s) => String(s || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();

// 総当たり・連打対策（インスタンスごとのメモリ。Vercel では複数あるので「目安」）
function createLimiter(max, windowMs = 60 * 60 * 1000) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    return list.length > max;
  };
}

function fail(res, status, error) { return res.status(status).json({ error }); }
function serverError(res, where, err) {
  // 個人情報やキーを含みうる詳細は画面に返さない
  console.error(`[my-fitpeak-survey] ${where}:`, err && err.message);
  return res.status(500).json({ error: '処理に失敗しました。時間をおいてお試しください。' });
}

// ログイン中の本人を決める。画面から来た識別子は一切使わない
async function resolveIdentity(deps, user) {
  const member = await deps.findMember(user.id);
  const lineUserId = member?.line_user_id || null;
  let email = isRealEmail(user.email) ? String(user.email).toLowerCase() : null;
  if (!email && member?.email && isRealEmail(member.email)) email = String(member.email).toLowerCase();
  if (!email && lineUserId) {
    const linked = await deps.verifiedLinkEmail(lineUserId);
    if (isRealEmail(linked)) email = String(linked).toLowerCase();
  }
  const verifiedEmail = isRealEmail(user.email) && user.email_confirmed_at ? String(user.email).toLowerCase() : null;
  const testEmails = (deps.testEmails || []).map((e) => e.toLowerCase());
  return {
    authUserId: user.id,
    lineUserId,
    email,
    verifiedEmail,
    // 旧データと同じ形の利用者キー（メール > LINE ID > 会員）
    userKey: email || lineUserId || `auth:${user.id}`,
    isTest: !!email && testEmails.includes(email),
  };
}

// ───────────── クーポン（アンケート特典） ─────────────

async function ensureShopifyDiscount(deps, coupon) {
  if (coupon.shopify_price_rule_id) return true;
  try {
    const r = await deps.createShopifyDiscount({
      code: coupon.coupon_code,
      amount: Number(coupon.discount_amount) || SURVEY_COUPON_AMOUNT,
      endsAt: coupon.expires_at,
    });
    await deps.updateCoupon(coupon.id, { shopify_price_rule_id: r.priceRuleId, shopify_discount_code_id: r.codeId || null });
    return true;
  } catch (err) {
    // 同じコードが既に Shopify にある＝前回作れていた
    if (/already|unique|taken/i.test(String(err.message))) {
      await deps.updateCoupon(coupon.id, { shopify_price_rule_id: 'existing' });
      return true;
    }
    console.error('[my-fitpeak-survey] Shopify割引の作成に失敗:', err.message);
    return false;
  }
}

async function issueSurveyCoupon(deps, identity) {
  const survey = await deps.findSurveyForIdentity(identity);
  if (!survey) return { status: 404, body: { error: 'アンケートの回答が見つかりません' } };

  let coupon = survey.coupon_id ? await deps.getCoupon(survey.coupon_id) : null;
  if (!coupon) {
    const expiresAt = new Date(Date.now() + SURVEY_COUPON_HOURS * 3600 * 1000).toISOString();
    const row = {
      user_id: identity.userKey,
      coupon_code: surveyCouponCode(),
      discount_amount: SURVEY_COUPON_AMOUNT,
      source: 'survey_reward',
      status: 'active',
      expires_at: expiresAt,
    };
    const { id } = await deps.insertCoupon(row);
    // 回答にクーポンを結びつけられた1枚だけが有効（同時に押されても1枚）
    const won = await deps.setSurveyCouponIfEmpty(survey.id, id);
    if (!won) {
      await deps.deleteCoupon(id);
      const fresh = await deps.findSurveyForIdentity(identity);
      coupon = fresh?.coupon_id ? await deps.getCoupon(fresh.coupon_id) : null;
      if (!coupon) return { status: 409, body: { error: 'もう一度お試しください' } };
    } else {
      coupon = { id, ...row, shopify_price_rule_id: null };
    }
  }

  const ok = await ensureShopifyDiscount(deps, coupon);
  if (!ok) return { status: 502, body: { error: 'クーポンの準備に失敗しました。少し時間をおいてもう一度お試しください。' } };
  return {
    status: 200,
    body: {
      couponCode: coupon.coupon_code,
      amount: Number(coupon.discount_amount) || SURVEY_COUPON_AMOUNT,
      expiresAt: coupon.expires_at,
      discountUrl: discountUrl(coupon.coupon_code),
    },
  };
}

// ───────────── 紹介 ─────────────

async function issueReferralCode(deps, identity) {
  const domain = (await deps.storePublicDomain()) || 'fitpeak.co';
  const urlFor = (c) => `https://${domain}/discount/${encodeURIComponent(c)}?redirect=/`;
  const existing = await deps.findReferralCode({ email: identity.email, lineUserId: identity.lineUserId });
  if (existing) {
    const patch = {};
    if (!existing.shopify_discount_code) {
      try { await deps.createTrackingDiscount(existing.code); patch.shopify_discount_code = existing.code; }
      catch (e) { console.error('[my-fitpeak-survey] 紹介コード(既存)のShopify作成に失敗:', e.message); }
    }
    if (existing.share_url !== urlFor(existing.code)) patch.share_url = urlFor(existing.code);
    if (!existing.owner_line_user_id && identity.lineUserId) patch.owner_line_user_id = identity.lineUserId;
    if (!existing.owner_email && identity.email) patch.owner_email = identity.email;
    if (Object.keys(patch).length) await deps.updateReferralCode(existing.id, patch);
    return { code: existing.code, shareUrl: urlFor(existing.code), alreadyIssued: true };
  }
  const code = referralCode();
  let shopifyOk = false;
  try { await deps.createTrackingDiscount(code); shopifyOk = true; }
  catch (e) { console.error('[my-fitpeak-survey] 紹介コードのShopify作成に失敗:', e.message); }
  await deps.insertReferralCode({
    code,
    owner_email: identity.email,
    owner_line_user_id: identity.lineUserId,
    owner_user_id: identity.userKey,
    source: 'referral_program',
    shopify_discount_code: shopifyOk ? code : null,
    share_url: urlFor(code),
    is_active: true,
  });
  return { code, shareUrl: urlFor(code), shopifyLinked: shopifyOk };
}

function isSelfReferral(use, identity) {
  return (use.referrer_line_user_id && identity.lineUserId && use.referrer_line_user_id === identity.lineUserId) ||
    (use.referrer_email && identity.email && use.referrer_email.toLowerCase().trim() === identity.email);
}

// ───────────── ルーター ─────────────

function createMemberRouter(deps) {
  const router = express.Router();
  const limits = {
    submit: createLimiter(10),
    coupon: createLimiter(30),
    upload: createLimiter(20),
    gift: createLimiter(10),
    bind: createLimiter(10),
    track: createLimiter(200),
  };

  // 本人確認（管理トークンでの代理操作も受け付けない）
  async function me(req, res) {
    const user = req.fitpeakUser;
    if (!user || !user.id) { fail(res, 401, 'ログインが必要です'); return null; }
    return resolveIdentity(deps, user);
  }
  function limited(res, kind, identity) {
    if (limits[kind](identity.authUserId)) { fail(res, 429, '操作が多すぎます。しばらく時間をおいてお試しください。'); return true; }
    return false;
  }

  // ── アンケート
  router.get('/survey/status', async (req, res) => {
    try {
      const identity = await me(req, res); if (!identity) return;
      const s = await deps.findSurveyForIdentity(identity);
      res.json({
        // テスト用アカウントは回答済みでも、もう一度回答できる
        completed: !!s && !identity.isTest,
        survey: s ? { rating: s.rating, productName: s.product_name || '', productAsin: s.product_asin || '', recommendationText: s.recommendation_text || '' } : null,
      });
    } catch (err) { serverError(res, 'GET /survey/status', err); }
  });

  router.post('/survey/submit', async (req, res) => {
    try {
      const identity = await me(req, res); if (!identity) return;
      if (limited(res, 'submit', identity)) return;
      const a = (req.body && req.body.answers) || {};
      const rating = Number(a.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) return fail(res, 400, '評価は1〜5で選んでください');
      const productAsin = SURVEY_PRODUCTS[a.product];
      if (!productAsin) return fail(res, 400, '商品を選んでください');
      const recommendation = clip(a.recommendation_text, 400);
      if (!recommendation || !recommendation.trim()) return fail(res, 400, '紹介の言葉を入力してください');
      const points = Array.isArray(a.positive_points) ? a.positive_points.filter((p) => typeof p === 'string').slice(0, 12).map((p) => p.slice(0, 60)) : [];

      if (!identity.isTest) {
        const existing = await deps.findSurveyForIdentity(identity);
        if (existing) return fail(res, 409, '既に回答済みです');
      }

      const detail = {};
      for (const k of ['purchase_reason', 'usage_duration', 'usage_frequency', 'size_fit', 'material_quality', 'compared_products', 'support_preference']) {
        if (typeof a[k] === 'string') detail[k] = a[k].slice(0, 100);
      }
      if (typeof a.expectation_gap === 'string') detail.expectation_gap = a.expectation_gap.slice(0, 300);
      if (Array.isArray(a.specific_issues)) detail.specific_issues = a.specific_issues.filter((x) => typeof x === 'string').slice(0, 12).map((x) => x.slice(0, 60));

      const routedTo = rating >= 4 ? 'amazon_review' : 'amazon_support';
      let inserted;
      try {
        inserted = await deps.insertSurvey({
          user_id: identity.userKey,
          // テスト用アカウントは何度でも回答できるよう、一意の列は埋めない
          auth_user_id: identity.isTest ? null : identity.authUserId,
          line_user_id: identity.isTest ? null : identity.lineUserId,
          product_asin: productAsin,
          product_name: a.product,
          rating,
          positive_points: points,
          usage_scene: clip(a.usage_scene, 400),
          improvement_text: clip(a.improvement_text, 400),
          recommendation_text: recommendation,
          answers: detail,
          routed_to: routedTo,
          coupon_id: null,
        });
      } catch (err) {
        if (err.code === '23505') return fail(res, 409, '既に回答済みです');
        throw err;
      }

      if (rating >= 4 && ASIN_TO_SHOPIFY[productAsin]) {
        try {
          await deps.postShopifyReview({
            shopify_product_id: ASIN_TO_SHOPIFY[productAsin],
            product_title: a.product,
            author_name: '購入者',
            author_email: identity.email,
            rating,
            body: recommendation,
            source: 'survey',
            source_id: inserted.id,
            verified_purchase: true,
            status: 'approved',
          });
        } catch (e) { console.error('[my-fitpeak-survey] 商品レビュー転載に失敗:', e.message); }
      }
      res.json({ ok: true, rating, routedTo, productAsin, productName: a.product, reviewText: recommendation });
    } catch (err) { serverError(res, 'POST /survey/submit', err); }
  });

  router.post('/survey/coupon', async (req, res) => {
    try {
      const identity = await me(req, res); if (!identity) return;
      if (limited(res, 'coupon', identity)) return;
      const r = await issueSurveyCoupon(deps, identity);
      res.status(r.status).json(r.body);
    } catch (err) { serverError(res, 'POST /survey/coupon', err); }
  });

  router.post('/survey/track-click', async (req, res) => {
    try {
      const identity = await me(req, res); if (!identity) return;
      if (limited(res, 'track', identity)) return;
      const action = String((req.body && req.body.action) || '');
      if (!CLICK_ACTIONS.has(action)) return res.json({ ok: true });
      const s = await deps.findSurveyForIdentity(identity);
      if (s && action.startsWith('amazon_review')) await deps.markSurveyClicked(s.id);
      res.json({ ok: true });
    } catch (err) { serverError(res, 'POST /survey/track-click', err); }
  });

  router.post('/survey/track-step', async (req, res) => {
    try {
      const identity = await me(req, res); if (!identity) return;
      if (limited(res, 'track', identity)) return;
      const step = String((req.body && req.body.step) || '');
      if (!TRACK_STEPS.has(step)) return res.json({ ok: true });
      const s = await deps.findSurveyForIdentity(identity);
      await deps.insertSurveyEvent({ step, survey_id: s?.id || null, line_user_id: identity.lineUserId, user_id: identity.userKey });
      res.json({ ok: true });
    } catch (err) { serverError(res, 'POST /survey/track-step', err); }
  });

  // ── クーポン一覧
  router.get('/coupons', async (req, res) => {
    try {
      const identity = await me(req, res); if (!identity) return;
      const userIds = [identity.userKey, identity.email, identity.lineUserId, `auth:${identity.authUserId}`].filter(Boolean);
      const couponIds = await deps.surveyCouponIds(identity);
      const list = await deps.listCoupons({ userIds: [...new Set(userIds)], couponIds });
      const seen = new Set();
      const coupons = list
        .filter((c) => (seen.has(c.id) ? false : seen.add(c.id)))
        .sort((a, b) => String(b.issued_at || '').localeCompare(String(a.issued_at || '')))
        .map((c) => ({
          id: c.id,
          coupon_code: c.coupon_code || c.code,
          discount_amount: Number(c.discount_amount) || 0,
          status: c.status || 'active',
          issued_at: c.issued_at,
          expires_at: c.expires_at,
          used_at: c.used_at || null,
          discountUrl: (c.coupon_code || c.code) ? discountUrl(c.coupon_code || c.code) : null,
        }));
      res.json({ coupons });
    } catch (err) { serverError(res, 'GET /coupons', err); }
  });

  // ── 紹介
  router.get('/referral', async (req, res) => {
    try {
      const identity = await me(req, res); if (!identity) return;
      const code = await deps.findReferralCode({ email: identity.email, lineUserId: identity.lineUserId });
      const uses = code ? await deps.listUsesForCodes([code.id]) : [];
      const mine = await deps.listUsesForReferee({ lineUserId: identity.lineUserId, email: identity.verifiedEmail });
      // 相手のメール・氏名・注文番号・合言葉は出さない（状態と日付だけ）
      res.json({
        code: code ? { code: code.code, shareUrl: code.share_url || null } : null,
        confirmedCount: uses.filter((u) => u.status === 'confirmed' || u.status === 'completed' || u.referrer_gift_sent_at).length,
        pendingCount: uses.filter((u) => u.status === 'pending_bind').length,
        referrals: uses.map((u) => ({ status: u.status, createdAt: u.created_at, giftSent: !!u.referrer_gift_sent_at })),
        asReferee: mine.map((u) => ({ status: u.status, boundAt: u.referee_bound_at || null, giftSent: !!u.referred_gift_sent_at, giftAmount: u.gift_amount || REFERRAL_GIFT_AMOUNT })),
      });
    } catch (err) { serverError(res, 'GET /referral', err); }
  });

  router.post('/referral/issue-code', async (req, res) => {
    try {
      const identity = await me(req, res); if (!identity) return;
      res.json(await issueReferralCode(deps, identity));
    } catch (err) { serverError(res, 'POST /referral/issue-code', err); }
  });

  router.post('/referral/bind', async (req, res) => {
    try {
      const identity = await me(req, res); if (!identity) return;
      if (limited(res, 'bind', identity)) return;
      const { secretPass: pass, orderNumber, name } = req.body || {};
      const pending = await deps.findPendingUses();

      let use = null;
      let method = null;
      if (pass) {
        const p = String(pass).toUpperCase().trim();
        use = pending.find((u) => u.secret_pass && u.secret_pass === p) || null;
        if (use) method = 'secret_pass';
      }
      if (!use && orderNumber && name) {
        const num = String(orderNumber).replace(/\D/g, '');
        const nm = normName(name);
        use = pending.find((u) => {
          const un = String(u.order_number || '').replace(/\D/g, '');
          if (!un || un !== num || !nm) return false;
          const rn = normName(u.referred_name);
          // 姓名の順が逆でも一致とみなす（部分一致はしない）
          const rev = normName(String(u.referred_name || '').trim().split(/\s+/).reverse().join(''));
          return rn && (rn === nm || rev === nm);
        }) || null;
        if (use) method = 'order_name';
      }
      // 確認済みのメールでログインしている人だけ、メールで自動照合
      if (!use && identity.verifiedEmail) {
        use = pending.find((u) => String(u.referred_email || '').toLowerCase() === identity.verifiedEmail) || null;
        if (use) method = 'auto_email';
      }
      if (!use) return fail(res, 404, '該当する購入が見つかりませんでした。注文番号とお名前をご確認ください。');
      if (isSelfReferral(use, identity)) return fail(res, 400, 'ご自身の紹介コードは対象外です。');

      const ok = await deps.bindUseIfPending(use.id, {
        referred_line_user_id: identity.lineUserId,
        referred_email: use.referred_email || identity.email,
        referee_bound_at: new Date().toISOString(),
        bind_method: method,
        status: 'confirmed',
      });
      if (!ok) return fail(res, 404, '該当する購入が見つかりませんでした。');
      await deps.incrementReferralCounts(use.referral_code_id);
      res.json({ success: true, giftAmount: use.gift_amount || REFERRAL_GIFT_AMOUNT, bindMethod: method });
    } catch (err) { serverError(res, 'POST /referral/bind', err); }
  });

  return router;
}

function createPublicRouter(deps) {
  const router = express.Router();
  const perIp = createLimiter(60, 10 * 60 * 1000);
  // LINE配信URL（?lu=）を開いた記録。返事はいつも同じで、誰の情報も返さない
  router.post('/survey/track-open', async (req, res) => {
    try {
      const lu = String((req.body && req.body.lu) || '');
      if (!perIp(req.ip || 'x') && LINE_USER_ID.test(lu) && await deps.friendExists(lu)) {
        await deps.upsertUrlClick(lu);
        await deps.insertSurveyEvent({ step: 'landing', survey_id: null, line_user_id: lu, user_id: null });
      }
    } catch (err) { console.error('[my-fitpeak-survey] track-open:', err.message); }
    res.json({ ok: true });
  });
  return router;
}

// Shopify orders/create（紹介の記録）。旧アプリは署名を見ていなかった
function createWebhookHandler(deps) {
  return async (req, res) => {
    try {
      if (!deps.verifyWebhookHmac(req.rawBody, req.get('X-Shopify-Hmac-Sha256') || '')) {
        return res.status(401).json({ error: 'invalid hmac' });
      }
      const order = req.body || {};
      if (!order.id) return res.json({ ok: true });
      const orderId = String(order.id);
      const subtotal = parseFloat(order.subtotal_price || order.current_subtotal_price || order.total_price || '0');
      const buyerEmail = String(order.customer?.email || order.email || '').toLowerCase().trim();
      const buyerName = `${order.customer?.last_name || ''} ${order.customer?.first_name || ''}`.trim();
      for (const dc of order.discount_codes || []) {
        const code = String(dc.code || '').toUpperCase().trim();
        if (!code) continue;
        const ref = await deps.findActiveCodeByDiscount(code);
        if (!ref) continue;
        if (subtotal < REFERRAL_MIN_ORDER) break;
        if (buyerEmail && ref.owner_email && buyerEmail === ref.owner_email.toLowerCase().trim()) break;
        if (await deps.findUseByOrder(orderId)) break;
        await deps.insertUse({
          referral_code_id: ref.id,
          referral_code: ref.code,
          referrer_line_user_id: ref.owner_line_user_id || null,
          referrer_email: ref.owner_email || null,
          referred_email: buyerEmail || null,
          referred_name: buyerName || null,
          shopify_order_id: orderId,
          order_number: order.name || (order.order_number ? `#${order.order_number}` : orderId),
          order_total: subtotal,
          secret_pass: secretPass(),
          min_amount_met: true,
          min_order_amount: REFERRAL_MIN_ORDER,
          gift_amount: REFERRAL_GIFT_AMOUNT,
          referrer_confirmed_at: new Date().toISOString(),
          status: 'pending_bind',
        });
        break;
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('[my-fitpeak-survey] webhook:', err.message);
      res.status(500).json({ error: 'failed' });
    }
  };
}

// ───────────── 本番の依存（Supabase・Shopify・Claude） ─────────────

function productionDeps() {
  let client = null;
  const db = () => {
    if (client) return client;
    const url = (process.env.SUPABASE_URL || '').trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    // 非公開バケットの読み書きと会員の解決に service role が要る。anon キーでの代用はしない
    if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
    client = createClient(url, key, { auth: { persistSession: false } });
    return client;
  };
  const must = ({ data, error }) => { if (error) { const e = new Error(error.message); e.code = error.code; throw e; } return data; };
  const shopify = (q, v) => require('./subscription.cjs')._internal.shopifyGraphQL(q, v);
  let storeCache = null;
  const store = async () => {
    if (storeCache) return storeCache;
    const { data } = await db().from('channel_stores').select('shop_domain, access_token').eq('channel', 'SHOPIFY').eq('is_active', true).limit(1).maybeSingle();
    storeCache = data || null;
    return storeCache;
  };
  // surveys.auth_user_id（2026-10-16 マイグレーション）がまだ無いDBでも動くようにする
  let surveysHaveAuthCol = true;
  const surveyOr = ({ authUserId, lineUserId, email }) => {
    const parts = [];
    if (authUserId && surveysHaveAuthCol) parts.push(`auth_user_id.eq.${authUserId}`);
    if (lineUserId && LINE_USER_ID.test(lineUserId)) parts.push(`line_user_id.eq.${lineUserId}`);
    if (email && isRealEmail(email) && !/[,()"]/.test(email)) parts.push(`user_id.ilike.${email}`);
    return parts.join(',');
  };
  const missingCol = (err) => /auth_user_id/.test(String(err && err.message)) && /column|schema/i.test(String(err && err.message));

  const shopifyDiscountCreate = async (variables) => {
    const data = await shopify(
      `mutation($d: DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount: $d) {
        codeDiscountNode { id codeDiscount { ... on DiscountCodeBasic { codes(first:1) { nodes { id } } } } }
        userErrors { field message } } }`,
      { d: variables },
    );
    const r = data?.discountCodeBasicCreate;
    if (r?.userErrors?.length) throw new Error(r.userErrors.map((e) => e.message).join(', '));
    return { priceRuleId: r?.codeDiscountNode?.id || '', codeId: r?.codeDiscountNode?.codeDiscount?.codes?.nodes?.[0]?.id || '' };
  };

  return {
    testEmails: (process.env.SURVEY_TEST_EMAILS || 'takuma1234577@gmail.com').split(',').map((s) => s.trim()).filter(Boolean),
    async findMember(authUserId) {
      return must(await db().from('members').select('id, line_user_id, email').eq('auth_user_id', authUserId).maybeSingle());
    },
    async verifiedLinkEmail(lineUserId) {
      const d = must(await db().from('line_shopify_links').select('shopify_email').eq('line_user_id', lineUserId).eq('is_verified', true).maybeSingle());
      return d?.shopify_email || null;
    },
    async shopifyLinkForLine(lineUserId) {
      const d = must(await db().from('line_shopify_links').select('shopify_customer_id, shopify_email').eq('line_user_id', lineUserId).maybeSingle());
      return d ? { customerId: d.shopify_customer_id || null, email: d.shopify_email || null } : null;
    },
    async friendExists(lineUserId) {
      const d = must(await db().from('friends').select('line_user_id').eq('line_user_id', lineUserId).maybeSingle());
      return !!d;
    },
    async upsertUrlClick(lineUserId) {
      must(await db().from('survey_url_clicks').upsert({ line_user_id: lineUserId, clicked_at: new Date().toISOString() }, { onConflict: 'line_user_id' }));
    },
    async insertSurveyEvent(row) { must(await db().from('survey_events').insert(row)); },

    async findSurveyForIdentity(identity) {
      const or = surveyOr(identity);
      if (!or) return null;
      const r = await db().from('surveys').select('id, rating, product_name, product_asin, recommendation_text, coupon_id, created_at').or(or).order('created_at', { ascending: false }).limit(1);
      if (r.error && missingCol(r.error) && surveysHaveAuthCol) { surveysHaveAuthCol = false; return this.findSurveyForIdentity(identity); }
      return must(r)[0] || null;
    },
    async insertSurvey(row) {
      const payload = { ...row };
      if (!surveysHaveAuthCol) delete payload.auth_user_id;
      const r = await db().from('surveys').insert(payload).select('id').single();
      if (r.error && missingCol(r.error) && surveysHaveAuthCol) { surveysHaveAuthCol = false; return this.insertSurvey(row); }
      return must(r);
    },
    async setSurveyCouponIfEmpty(surveyId, couponId) {
      const d = must(await db().from('surveys').update({ coupon_id: couponId }).eq('id', surveyId).is('coupon_id', null).select('id'));
      return (d || []).length === 1;
    },
    async markSurveyClicked(surveyId) {
      must(await db().from('surveys').update({ amazon_button_clicked_at: new Date().toISOString() }).eq('id', surveyId).is('amazon_button_clicked_at', null));
    },
    async postShopifyReview(row) {
      must(await db().from('shopify_reviews').insert(row));
      const reviews = must(await db().from('shopify_reviews').select('rating').eq('shopify_product_id', row.shopify_product_id).eq('status', 'approved')) || [];
      if (!reviews.length) return;
      const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      let sum = 0;
      for (const r of reviews) { counts[r.rating] = (counts[r.rating] || 0) + 1; sum += r.rating; }
      must(await db().from('shopify_review_stats').upsert({
        shopify_product_id: row.shopify_product_id,
        product_title: row.product_title,
        average_rating: Math.round((sum / reviews.length) * 10) / 10,
        total_count: reviews.length,
        rating_1: counts[1], rating_2: counts[2], rating_3: counts[3], rating_4: counts[4], rating_5: counts[5],
        updated_at: new Date().toISOString(),
      }, { onConflict: 'shopify_product_id' }));
    },

    async insertCoupon(row) { return must(await db().from('coupons').insert(row).select('id').single()); },
    async deleteCoupon(id) { must(await db().from('coupons').delete().eq('id', id).is('shopify_price_rule_id', null)); },
    async getCoupon(id) { return must(await db().from('coupons').select('*').eq('id', id).maybeSingle()); },
    async updateCoupon(id, patch) { must(await db().from('coupons').update(patch).eq('id', id)); },
    async listCoupons({ userIds, couponIds }) {
      const cols = 'id, code, coupon_code, discount_amount, status, issued_at, expires_at, used_at, user_id';
      const a = userIds.length ? must(await db().from('coupons').select(cols).in('user_id', userIds)) : [];
      const b = couponIds.length ? must(await db().from('coupons').select(cols).in('id', couponIds)) : [];
      return [...(a || []), ...(b || [])];
    },
    async surveyCouponIds(identity) {
      const or = surveyOr(identity);
      if (!or) return [];
      const r = await db().from('surveys').select('coupon_id').or(or).not('coupon_id', 'is', null);
      if (r.error && missingCol(r.error)) { surveysHaveAuthCol = false; return this.surveyCouponIds(identity); }
      return (must(r) || []).map((s) => s.coupon_id);
    },
    async createShopifyDiscount({ code, amount, endsAt }) {
      return shopifyDiscountCreate({
        title: `Survey Reward - ${code}`,
        code,
        startsAt: new Date().toISOString(),
        endsAt,
        usageLimit: 1,
        appliesOncePerCustomer: true,
        customerSelection: { all: true },
        customerGets: { value: { discountAmount: { amount: String(amount), appliesOnEachItem: false } }, items: { all: true } },
      });
    },

    async findReferralCode({ email, lineUserId }) {
      if (email) {
        const d = must(await db().from('referral_codes').select('*').ilike('owner_email', email).eq('source', 'referral_program').limit(1));
        if (d && d[0]) return d[0];
      }
      if (lineUserId) {
        const d = must(await db().from('referral_codes').select('*').eq('owner_line_user_id', lineUserId).eq('source', 'referral_program').limit(1));
        if (d && d[0]) return d[0];
      }
      return null;
    },
    async insertReferralCode(row) { return must(await db().from('referral_codes').insert(row).select('*').single()); },
    async updateReferralCode(id, patch) { must(await db().from('referral_codes').update(patch).eq('id', id)); },
    async findActiveCodeByDiscount(code) {
      let d = must(await db().from('referral_codes').select('*').eq('shopify_discount_code', code).eq('is_active', true).limit(1));
      if (!d || !d[0]) d = must(await db().from('referral_codes').select('*').eq('code', code).eq('is_active', true).limit(1));
      return (d || [])[0] || null;
    },
    async listUsesForCodes(ids) {
      return must(await db().from('referral_uses').select('status, created_at, referrer_gift_sent_at').in('referral_code_id', ids).order('created_at', { ascending: false })) || [];
    },
    async listUsesForReferee({ lineUserId, email }) {
      const out = [];
      const cols = 'id, status, referee_bound_at, referred_gift_sent_at, gift_amount';
      if (lineUserId) out.push(...(must(await db().from('referral_uses').select(cols).eq('referred_line_user_id', lineUserId)) || []));
      if (email) out.push(...(must(await db().from('referral_uses').select(cols).ilike('referred_email', email).neq('status', 'pending_bind')) || []));
      const seen = new Set();
      return out.filter((u) => (seen.has(u.id) ? false : seen.add(u.id)));
    },
    async findPendingUses() {
      return must(await db().from('referral_uses').select('*').eq('status', 'pending_bind').is('referred_line_user_id', null).is('referee_bound_at', null).limit(1000)) || [];
    },
    async bindUseIfPending(id, patch) {
      const d = must(await db().from('referral_uses').update(patch).eq('id', id).eq('status', 'pending_bind').is('referee_bound_at', null).select('id'));
      return (d || []).length === 1;
    },
    async incrementReferralCounts(codeId) {
      const rc = must(await db().from('referral_codes').select('total_referrals, confirmed_referrals').eq('id', codeId).maybeSingle());
      must(await db().from('referral_codes').update({
        total_referrals: (rc?.total_referrals || 0) + 1,
        confirmed_referrals: (rc?.confirmed_referrals || 0) + 1,
      }).eq('id', codeId));
    },
    async findUseByOrder(orderId) { return must(await db().from('referral_uses').select('id').eq('shopify_order_id', orderId).maybeSingle()); },
    async insertUse(row) { return must(await db().from('referral_uses').insert(row).select('id').single()); },
    async storePublicDomain() {
      if (process.env.STORE_PUBLIC_DOMAIN) return process.env.STORE_PUBLIC_DOMAIN;
      return 'fitpeak.co';
    },
    async createTrackingDiscount(code) {
      await shopifyDiscountCreate({
        title: `Referral tracking - ${code}`,
        code,
        startsAt: new Date().toISOString(),
        appliesOncePerCustomer: true,
        customerSelection: { all: true },
        minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: String(REFERRAL_MIN_ORDER) } },
        customerGets: { value: { percentage: 0.0 }, items: { all: true } },
      });
    },
    verifyWebhookHmac(raw, header) {
      const secret = process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_CLIENT_SECRET;
      if (!secret || !raw || !header) return false;
      const a = Buffer.from(crypto.createHmac('sha256', secret).update(raw).digest('base64'));
      const b = Buffer.from(String(header));
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    },
  };
}

module.exports = {
  createMemberRouter,
  createPublicRouter,
  createWebhookHandler,
  productionDeps,
  SURVEY_PRODUCTS,
};
