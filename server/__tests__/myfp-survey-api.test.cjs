// My FITPEAK：旧 my-fitpeak から移したアンケート／クーポン／レビュー特典／紹介 API のテスト
// 一番大事なのは「他人の識別子を送っても、他人のデータは読めない・書けない」こと。
// 実行: node --test server/__tests__/myfp-survey-api.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const { createFakeDeps } = require('./helpers/myfp-survey-fake.cjs');
const { createMemberRouter, createPublicRouter, createWebhookHandler, issueReviewGift } = require('../my-fitpeak-survey.cjs');

let deps, base, server;

test.beforeEach(async () => {
  deps = createFakeDeps();
  const app = express();
  app.use(express.json({ limit: '20mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.post('/webhook/shopify-order', createWebhookHandler(deps));
  app.use('/public', createPublicRouter(deps));
  // my-fitpeak-auth.cjs の代わり：テストではヘッダーで本人を決める（本番は Supabase の JWT 検証）
  app.use((req, _res, next) => {
    const u = req.headers['x-test-user'];
    if (u) req.fitpeakUser = JSON.parse(u);
    next();
  });
  app.use('/m', createMemberRouter(deps));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterEach(() => new Promise((r) => server.close(r)));

let seq = 0;
function lineCustomer(extra = {}) {
  seq += 1;
  const authId = crypto.randomUUID();
  const lineUserId = `U${String(seq).padStart(32, '0')}`;
  deps.st.members.push({ id: crypto.randomUUID(), auth_user_id: authId, line_user_id: lineUserId, email: `line_x${seq}@line.fitpeak.co` });
  deps.st.friends.push(lineUserId);
  return { lineUserId, user: { id: authId, email: `line_x${seq}@line.fitpeak.co`, ...extra } };
}
function emailCustomer(email) {
  const authId = crypto.randomUUID();
  deps.st.members.push({ id: crypto.randomUUID(), auth_user_id: authId, line_user_id: null, email });
  return { lineUserId: null, user: { id: authId, email, email_confirmed_at: '2026-10-01T00:00:00Z' } };
}

function call(method, path, user, body, headers = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (user) h['x-test-user'] = JSON.stringify(user);
  return fetch(base + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
}

const ANSWERS = { product: 'パワーグリップ', rating: 5, positive_points: ['滑りにくい'], recommendation_text: '握力が弱くても重量が伸びました' };
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');

// ───────────── アンケート ─────────────

test('ログインしていなければ会員APIはすべて 401', async () => {
  for (const [m, p] of [['GET', '/m/survey/status'], ['POST', '/m/survey/submit'], ['POST', '/m/survey/coupon'], ['GET', '/m/coupons'],
    ['GET', '/m/review-gift/status'], ['POST', '/m/review-gift/upload'], ['POST', '/m/review-gift/submit'], ['GET', '/m/referral'],
    ['POST', '/m/referral/issue-code'], ['POST', '/m/referral/bind'], ['POST', '/m/survey/track-click'], ['POST', '/m/survey/track-step']]) {
    assert.equal((await call(m, p, null, m === 'GET' ? undefined : {})).status, 401, `${m} ${p}`);
  }
});

test('回答はログイン中の本人に紐づく。画面から送られた lineUserId / email / surveyId は使わない', async () => {
  const a = lineCustomer();
  const b = lineCustomer();
  const r = await call('POST', '/m/survey/submit', a.user, { answers: ANSWERS, lineUserId: b.lineUserId, email: 'victim@example.com' });
  assert.equal(r.status, 200);
  const s = deps.st.surveys[0];
  assert.equal(s.line_user_id, a.lineUserId);
  assert.equal(s.auth_user_id, a.user.id);
  assert.notEqual(s.user_id, 'victim@example.com');
  // 他人(b)の状態は未回答のまま
  const sb = await call('GET', '/m/survey/status', b.user);
  assert.equal(sb.body.completed, false);
  assert.equal(sb.body.survey, null);
});

test('同じ人の2回目の回答は 409（1人1回）', async () => {
  const a = lineCustomer();
  assert.equal((await call('POST', '/m/survey/submit', a.user, { answers: ANSWERS })).status, 200);
  assert.equal((await call('POST', '/m/survey/submit', a.user, { answers: ANSWERS })).status, 409);
  assert.equal(deps.st.surveys.length, 1);
});

test('回答の中身を検証する（評価は1〜5、商品は一覧から、文字数の上限）', async () => {
  const a = lineCustomer();
  assert.equal((await call('POST', '/m/survey/submit', a.user, { answers: { ...ANSWERS, rating: 9 } })).status, 400);
  assert.equal((await call('POST', '/m/survey/submit', a.user, { answers: { ...ANSWERS, product: '<script>' } })).status, 400);
  const long = await call('POST', '/m/survey/submit', a.user, { answers: { ...ANSWERS, recommendation_text: 'あ'.repeat(5000) } });
  assert.equal(long.status, 200);
  assert.ok(deps.st.surveys[0].recommendation_text.length <= 400);
});

test('クーポンは本人の回答に対して1枚だけ。何度呼んでも同じコード、Shopifyにも1回だけ作る', async () => {
  const a = lineCustomer();
  await call('POST', '/m/survey/submit', a.user, { answers: ANSWERS });
  const r1 = await call('POST', '/m/survey/coupon', a.user, {});
  assert.equal(r1.status, 200);
  assert.match(r1.body.couponCode, /^FITPEAK-[A-Z2-9]{6}-[A-Z2-9]{4}$/);
  assert.equal(r1.body.discountUrl, `https://fitpeak.co/discount/${r1.body.couponCode}?redirect=/`);
  const r2 = await call('POST', '/m/survey/coupon', a.user, {});
  assert.equal(r2.body.couponCode, r1.body.couponCode);
  assert.equal(deps.st.coupons.length, 1);
  assert.equal(deps.st.shopifyDiscounts.length, 1);
  assert.equal(deps.st.shopifyDiscounts[0].amount, 2000);
});

test('同時に何度押してもクーポンは1枚', async () => {
  const a = lineCustomer();
  await call('POST', '/m/survey/submit', a.user, { answers: ANSWERS });
  const rs = await Promise.all(Array.from({ length: 5 }, () => call('POST', '/m/survey/coupon', a.user, {})));
  const codes = new Set(rs.map((r) => r.body.couponCode));
  assert.equal(codes.size, 1);
  assert.equal(deps.st.surveys[0].coupon_id != null, true);
  assert.equal(deps.st.coupons.length, 1);
});

test('他人の surveyId を送っても、他人のクーポンは発行も表示もされない', async () => {
  const a = lineCustomer();
  const b = lineCustomer();
  await call('POST', '/m/survey/submit', a.user, { answers: ANSWERS });
  const r = await call('POST', '/m/survey/coupon', b.user, { surveyId: deps.st.surveys[0].id });
  assert.equal(r.status, 404);
  assert.equal(r.body.couponCode, undefined);
  assert.equal(deps.st.coupons.length, 0);
});

test('Shopifyで作れなかったらコードは見せず、次に押したときに作り直す', async () => {
  const a = lineCustomer();
  await call('POST', '/m/survey/submit', a.user, { answers: ANSWERS });
  deps.st.shopifyFail = true;
  const r1 = await call('POST', '/m/survey/coupon', a.user, {});
  assert.equal(r1.status, 502);
  assert.equal(r1.body.couponCode, undefined);
  deps.st.shopifyFail = false;
  const r2 = await call('POST', '/m/survey/coupon', a.user, {});
  assert.equal(r2.status, 200);
  assert.equal(deps.st.coupons.length, 1);
  assert.equal(deps.st.shopifyDiscounts.length, 1);
});

test('クーポン一覧は本人の分だけ（?email= で他人の分は出ない）', async () => {
  const a = lineCustomer();
  const b = emailCustomer('b@example.com');
  deps.st.coupons.push({ id: crypto.randomUUID(), user_id: 'b@example.com', coupon_code: 'B-CODE', discount_amount: 2000, status: 'active', issued_at: new Date().toISOString() });
  deps.st.coupons.push({ id: crypto.randomUUID(), user_id: a.lineUserId, coupon_code: 'A-CODE', discount_amount: 2000, status: 'active', issued_at: new Date().toISOString() });
  const ra = await call('GET', '/m/coupons?email=b@example.com', a.user);
  assert.deepEqual(ra.body.coupons.map((c) => c.coupon_code), ['A-CODE']);
  const rb = await call('GET', '/m/coupons', b.user);
  assert.deepEqual(rb.body.coupons.map((c) => c.coupon_code), ['B-CODE']);
});

test('テスト用アカウントは何度でも回答できる（本番の確認用）', async () => {
  const t = emailCustomer('owner-test@example.com');
  assert.equal((await call('POST', '/m/survey/submit', t.user, { answers: ANSWERS })).status, 200);
  assert.equal((await call('POST', '/m/survey/submit', t.user, { answers: ANSWERS })).status, 200);
  assert.equal(deps.st.surveys.every((s) => s.auth_user_id == null), true);
});

test('Amazonボタンのクリック記録は本人の回答にだけ付く', async () => {
  const a = lineCustomer();
  const b = lineCustomer();
  await call('POST', '/m/survey/submit', a.user, { answers: ANSWERS });
  await call('POST', '/m/survey/track-click', b.user, { surveyId: deps.st.surveys[0].id, action: 'amazon_review' });
  assert.equal(deps.st.surveys[0].amazon_button_clicked_at, null);
  await call('POST', '/m/survey/track-click', a.user, { action: 'amazon_review' });
  assert.ok(deps.st.surveys[0].amazon_button_clicked_at);
});

test('LINEから開いた記録(track-open)は公開だが、何も返さず、友だちにいないIDは記録しない', async () => {
  const a = lineCustomer();
  const r1 = await call('POST', '/public/survey/track-open', null, { lu: a.lineUserId });
  const r2 = await call('POST', '/public/survey/track-open', null, { lu: 'U' + 'f'.repeat(32) });
  const r3 = await call('POST', '/public/survey/track-open', null, { lu: "x' or 1=1" });
  for (const r of [r1, r2, r3]) assert.deepEqual(r.body, { ok: true });
  assert.deepEqual(deps.st.clicks.map((c) => c.line_user_id), [a.lineUserId]);
});

// ───────────── レビュー特典 ─────────────

async function uploadAs(user) {
  const r = await call('POST', '/m/review-gift/upload', user, { contentType: 'image/png', data: PNG });
  assert.equal(r.status, 200);
  return r.body.fileId;
}

test('スクショは非公開の場所に本人のフォルダで保存し、公開URLは返さない', async () => {
  const a = lineCustomer();
  const r = await call('POST', '/m/review-gift/upload', a.user, { contentType: 'image/png', data: PNG });
  assert.equal(r.status, 200);
  assert.ok(r.body.fileId.startsWith(`review-gift/${a.user.id}/`));
  assert.equal(JSON.stringify(r.body).includes('http'), false);
  const bad = await call('POST', '/m/review-gift/upload', a.user, { contentType: 'text/html', data: PNG });
  assert.equal(bad.status, 400);
});

test('他人のスクショ(fileId)や外部URLでは申請できない', async () => {
  const a = lineCustomer();
  const b = lineCustomer();
  const fa = await uploadAs(a.user);
  const r1 = await call('POST', '/m/review-gift/submit', b.user, { productChoice: 'wrist_wrap', proofFileId: fa });
  assert.equal(r1.status, 400);
  const r2 = await call('POST', '/m/review-gift/submit', b.user, { productChoice: 'wrist_wrap', proofFileId: 'http://169.254.169.254/latest' });
  assert.equal(r2.status, 400);
  assert.equal(deps.st.claims.length, 0);
});

test('申請→AI確認→本人に1回だけ発行。2回目は 409、状態は本人の分だけ見える', async () => {
  const a = lineCustomer();
  const b = lineCustomer();
  const f = await uploadAs(a.user);
  const r = await call('POST', '/m/review-gift/submit', a.user, { productChoice: 'wrist_wrap', proofFileId: f, lineUserId: b.lineUserId });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'issued');
  assert.ok(r.body.invoiceUrl);
  assert.equal(deps.st.claims[0].line_user_id, a.lineUserId);
  assert.equal(deps.st.draftOrders.length, 1);
  const again = await call('POST', '/m/review-gift/submit', a.user, { productChoice: 'wrist_wrap', proofFileId: await uploadAs(a.user) });
  assert.equal(again.status, 409);
  const sb = await call('GET', '/m/review-gift/status', b.user);
  assert.equal(sb.body.claim, null);
  const sa = await call('GET', '/m/review-gift/status', a.user);
  assert.equal(sa.body.claim.status, 'issued');
  assert.equal(JSON.stringify(sa.body).includes('review-gift/'), false);
});

test('AIが確認できなければ発行しない。再提出は本人の却下済み申請だけ', async () => {
  const a = lineCustomer();
  const b = lineCustomer();
  deps.st.aiResult = { overall_verified: false, confidence: 30, reason: '投稿前の画面です' };
  const r = await call('POST', '/m/review-gift/submit', a.user, { productChoice: 'wrist_wrap', proofFileId: await uploadAs(a.user) });
  assert.equal(r.body.status, 'rejected');
  assert.equal(deps.st.draftOrders.length, 0);
  // b は a の申請を再提出できない
  const rb = await call('POST', '/m/review-gift/resubmit', b.user, { claimId: deps.st.claims[0].id, proofFileId: await uploadAs(b.user) });
  assert.equal(rb.status, 404);
  deps.st.aiResult = { overall_verified: true, confidence: 90 };
  const ra = await call('POST', '/m/review-gift/resubmit', a.user, { proofFileId: await uploadAs(a.user) });
  assert.equal(ra.body.status, 'issued');
  assert.equal(deps.st.draftOrders.length, 1);
});

test('管理画面からの発行(issueReviewGift)は確認済みの申請だけ・1回だけ', async () => {
  const a = lineCustomer();
  deps.st.aiResult = { overall_verified: false, confidence: 30 };
  await call('POST', '/m/review-gift/submit', a.user, { productChoice: 'wrist_wrap', proofFileId: await uploadAs(a.user) });
  const claimId = deps.st.claims[0].id;
  const r0 = await issueReviewGift(deps, claimId);
  assert.equal(r0.ok, false);
  deps.st.claims[0].verification_status = 'verified';
  const r1 = await issueReviewGift(deps, claimId);
  const r2 = await issueReviewGift(deps, claimId);
  assert.equal(r1.invoiceUrl, r2.invoiceUrl);
  assert.equal(deps.st.draftOrders.length, 1);
});

// ───────────── 紹介 ─────────────

test('紹介コードはログイン中の本人名義で発行。body の email/lineUserId は使わない', async () => {
  const a = emailCustomer('a@example.com');
  const r = await call('POST', '/m/referral/issue-code', a.user, { email: 'victim@example.com', lineUserId: 'Uvictim' });
  assert.equal(r.status, 200);
  assert.equal(deps.st.codes[0].owner_email, 'a@example.com');
  assert.equal(deps.st.codes[0].owner_line_user_id, null);
  assert.equal(r.body.shareUrl, `https://fitpeak.co/discount/${r.body.code}?redirect=/`);
  const again = await call('POST', '/m/referral/issue-code', a.user, {});
  assert.equal(again.body.code, r.body.code);
});

test('紹介状況には相手のメール・氏名・注文番号・合言葉を出さない', async () => {
  const a = emailCustomer('a@example.com');
  const issued = await call('POST', '/m/referral/issue-code', a.user, {});
  const code = deps.st.codes[0];
  deps.st.uses.push({ id: crypto.randomUUID(), referral_code_id: code.id, referral_code: issued.body.code, referred_email: 'friend@example.com', referred_name: '山田 花子', order_number: '#1234', secret_pass: 'ABCDEF', status: 'pending_bind', created_at: new Date().toISOString() });
  const r = await call('GET', '/m/referral?email=other@example.com', a.user);
  assert.equal(r.status, 200);
  assert.equal(r.body.pendingCount, 1);
  const s = JSON.stringify(r.body);
  for (const secret of ['friend@example.com', '山田', '#1234', 'ABCDEF']) assert.equal(s.includes(secret), false, secret);
});

test('紹介の紐づけ：合言葉で本人に紐づく。自分のコードは不可。氏名は完全一致', async () => {
  const owner = emailCustomer('owner@example.com');
  await call('POST', '/m/referral/issue-code', owner.user, {});
  const code = deps.st.codes[0];
  const use = { id: crypto.randomUUID(), referral_code_id: code.id, referrer_email: 'owner@example.com', referred_email: 'buyer@example.com', referred_name: '山田 花子', order_number: '#1234', secret_pass: 'ABCDEF', status: 'pending_bind', created_at: new Date().toISOString() };
  deps.st.uses.push(use);

  // 紹介者本人は自分の紹介に紐づけられない
  const self = await call('POST', '/m/referral/bind', owner.user, { secretPass: 'ABCDEF' });
  assert.equal(self.status, 400);
  // 氏名の一部だけでは一致しない
  const buyer = lineCustomer();
  const partial = await call('POST', '/m/referral/bind', buyer.user, { orderNumber: '1234', name: '山' });
  assert.equal(partial.status, 404);
  // 合言葉で成立。紐づく LINE は本人のもの（body の lineUserId は無視）
  const ok = await call('POST', '/m/referral/bind', buyer.user, { secretPass: 'abcdef', lineUserId: 'Uattacker' });
  assert.equal(ok.status, 200);
  assert.equal(use.referred_line_user_id, buyer.lineUserId);
  assert.equal(use.status, 'confirmed');
  assert.equal(code.confirmed_referrals, 1);
  // 2回目は成立済みなので見つからない
  const twice = await call('POST', '/m/referral/bind', lineCustomer().user, { secretPass: 'ABCDEF' });
  assert.equal(twice.status, 404);
});

test('紹介の紐づけは総当たりできない（1時間に10回まで）', async () => {
  const buyer = lineCustomer();
  let last;
  for (let i = 0; i < 11; i++) last = await call('POST', '/m/referral/bind', buyer.user, { orderNumber: String(1000 + i), name: 'たろう' });
  assert.equal(last.status, 429);
});

test('Shopify注文webhookは署名が正しいときだけ紹介を記録し、同じ注文は1回だけ', async () => {
  const owner = emailCustomer('owner@example.com');
  const issued = await call('POST', '/m/referral/issue-code', owner.user, {});
  const order = { id: 555, name: '#1555', subtotal_price: '4000', email: 'buyer@example.com', customer: { first_name: '花子', last_name: '山田' }, discount_codes: [{ code: issued.body.code }] };
  const raw = JSON.stringify(order);
  const sig = crypto.createHmac('sha256', 'test-secret').update(raw).digest('base64');
  const send = (h) => fetch(base + '/webhook/shopify-order', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: raw }).then((r) => r.status);
  assert.equal(await send({}), 401);
  assert.equal(await send({ 'X-Shopify-Hmac-Sha256': 'bad' }), 401);
  assert.equal(deps.st.uses.length, 0);
  assert.equal(await send({ 'X-Shopify-Hmac-Sha256': sig }), 200);
  assert.equal(await send({ 'X-Shopify-Hmac-Sha256': sig }), 200);
  assert.equal(deps.st.uses.length, 1);
  assert.equal(deps.st.uses[0].status, 'pending_bind');
  assert.match(deps.st.uses[0].secret_pass, /^[A-Z2-9]{6}$/);
});

test('紹介：自分のコードでの購入・3000円未満は記録しない', async () => {
  const owner = emailCustomer('owner@example.com');
  const issued = await call('POST', '/m/referral/issue-code', owner.user, {});
  const mk = (o) => { const raw = JSON.stringify(o); return fetch(base + '/webhook/shopify-order', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Hmac-Sha256': crypto.createHmac('sha256', 'test-secret').update(raw).digest('base64') }, body: raw }); };
  await mk({ id: 1, name: '#1', subtotal_price: '5000', email: 'OWNER@example.com', discount_codes: [{ code: issued.body.code }] });
  await mk({ id: 2, name: '#2', subtotal_price: '2999', email: 'x@example.com', discount_codes: [{ code: issued.body.code }] });
  assert.equal(deps.st.uses.length, 0);
});
