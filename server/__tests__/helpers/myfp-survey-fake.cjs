// My FITPEAK アンケート・レビュー特典・紹介のテスト用：DB/Shopify/AI の代わりになるメモリ上の依存
const crypto = require('crypto');

function createFakeDeps() {
  const st = {
    members: [],
    links: [],
    friends: [],
    surveys: [],
    coupons: [],
    events: [],
    clicks: [],
    claims: [],
    files: {},
    kb: [],
    codes: [],
    uses: [],
    reviews: [],
    shopifyDiscounts: [],
    trackingDiscounts: [],
    draftOrders: [],
    shopifyFail: false,
    aiResult: { overall_verified: true, confidence: 90, reviewer_name: 'たろう', star_count: 5, review_title: 'よい', review_body: 'とてもよい', is_amazon: true, is_posted: true, has_title: true, has_body: true },
    aiCalls: 0,
  };
  const id = () => crypto.randomUUID();
  const now = () => new Date().toISOString();
  const lower = (s) => String(s || '').toLowerCase();

  const deps = {
    st,
    async findMember(authUserId) {
      return st.members.find((m) => m.auth_user_id === authUserId) || null;
    },
    async verifiedLinkEmail(lineUserId) {
      const l = st.links.find((x) => x.line_user_id === lineUserId && x.is_verified);
      return l ? l.shopify_email : null;
    },
    async shopifyLinkForLine(lineUserId) {
      const l = st.links.find((x) => x.line_user_id === lineUserId);
      return l ? { customerId: l.shopify_customer_id || null, email: l.shopify_email || null } : null;
    },
    async friendExists(lineUserId) {
      return st.friends.includes(lineUserId);
    },
    async upsertUrlClick(lineUserId) {
      const c = st.clicks.find((x) => x.line_user_id === lineUserId);
      if (c) c.clicked_at = now(); else st.clicks.push({ line_user_id: lineUserId, clicked_at: now() });
    },
    async insertSurveyEvent(row) { st.events.push({ ...row, created_at: now() }); },

    // アンケート
    async findSurveyForIdentity({ authUserId, lineUserId, email }) {
      const list = st.surveys.filter((s) =>
        (authUserId && s.auth_user_id === authUserId) ||
        (lineUserId && s.line_user_id === lineUserId) ||
        (email && lower(s.user_id) === lower(email)));
      return list.sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null;
    },
    async insertSurvey(row) {
      if (row.auth_user_id && st.surveys.some((s) => s.auth_user_id === row.auth_user_id)) {
        const e = new Error('duplicate key'); e.code = '23505'; throw e;
      }
      if (row.line_user_id && st.surveys.some((s) => s.line_user_id === row.line_user_id)) {
        const e = new Error('duplicate key'); e.code = '23505'; throw e;
      }
      const s = { id: id(), created_at: now(), coupon_id: null, amazon_button_clicked_at: null, ...row };
      st.surveys.push(s);
      return { id: s.id };
    },
    async setSurveyCouponIfEmpty(surveyId, couponId) {
      const s = st.surveys.find((x) => x.id === surveyId);
      if (!s || s.coupon_id) return false;
      s.coupon_id = couponId;
      return true;
    },
    async markSurveyClicked(surveyId) {
      const s = st.surveys.find((x) => x.id === surveyId);
      if (s && !s.amazon_button_clicked_at) s.amazon_button_clicked_at = now();
    },
    async postShopifyReview(row) { st.reviews.push(row); },

    // クーポン
    async insertCoupon(row) {
      const c = { id: id(), issued_at: now(), shopify_price_rule_id: null, ...row };
      st.coupons.push(c);
      return { id: c.id };
    },
    async deleteCoupon(couponId) { st.coupons = st.coupons.filter((c) => c.id !== couponId); },
    async getCoupon(couponId) { return st.coupons.find((c) => c.id === couponId) || null; },
    async updateCoupon(couponId, patch) { Object.assign(st.coupons.find((c) => c.id === couponId) || {}, patch); },
    async listCoupons({ userIds, couponIds }) {
      return st.coupons.filter((c) => userIds.includes(c.user_id) || couponIds.includes(c.id));
    },
    async surveyCouponIds(identity) {
      return st.surveys.filter((s) =>
        (identity.authUserId && s.auth_user_id === identity.authUserId) ||
        (identity.lineUserId && s.line_user_id === identity.lineUserId) ||
        (identity.email && lower(s.user_id) === lower(identity.email))).map((s) => s.coupon_id).filter(Boolean);
    },
    async createShopifyDiscount({ code, amount, endsAt }) {
      if (st.shopifyFail) throw new Error('shopify down');
      st.shopifyDiscounts.push({ code, amount, endsAt });
      return { priceRuleId: `gid://shopify/DiscountCodeNode/${st.shopifyDiscounts.length}`, codeId: 'x' };
    },

    // レビュー特典
    async uploadPrivate(path, buffer, contentType) { st.files[path] = { buffer, contentType }; },
    async downloadPrivate(path) {
      const f = st.files[path];
      if (!f) throw new Error('not found');
      return { data: f.buffer.toString('base64'), mediaType: f.contentType };
    },
    async activeKbReasons() { return st.kb; },
    async aiVerifyScreenshots() { st.aiCalls += 1; return st.aiResult; },
    async findOpenClaim({ lineUserId, userKey }) {
      return st.claims
        .filter((c) => c.verification_status !== 'rejected' && ((lineUserId && c.line_user_id === lineUserId) || (userKey && c.user_id === userKey)))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null;
    },
    async findLatestClaim({ lineUserId, userKey }) {
      return st.claims
        .filter((c) => (lineUserId && c.line_user_id === lineUserId) || (userKey && c.user_id === userKey))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null;
    },
    async getClaim(claimId) { return st.claims.find((c) => c.id === claimId) || null; },
    async insertClaim(row) {
      const dup = st.claims.some((c) => c.verification_status !== 'rejected' &&
        ((row.line_user_id && c.line_user_id === row.line_user_id) || (row.user_id && c.user_id === row.user_id)));
      if (dup) { const e = new Error('duplicate key'); e.code = '23505'; throw e; }
      const c = { id: id(), created_at: now(), verification_attempts: 0, shopify_invoice_url: null, ...row };
      st.claims.push(c);
      return { id: c.id };
    },
    async updateClaim(claimId, patch, onlyIf = {}) {
      const c = st.claims.find((x) => x.id === claimId);
      if (!c) return false;
      for (const [k, v] of Object.entries(onlyIf)) {
        if (v === null ? c[k] != null : c[k] !== v) return false;
      }
      Object.assign(c, patch);
      return true;
    },
    async resolveGiftVariant(choice) {
      return choice === 'wrist_wrap' ? { variantId: '111', price: '2980', productTitle: 'リストラップ' } : null;
    },
    async createDraftOrder(args) {
      if (st.shopifyFail) throw new Error('shopify down');
      st.draftOrders.push(args);
      return { draftOrderId: String(st.draftOrders.length), invoiceUrl: `https://fitpeak.co/invoice/${st.draftOrders.length}` };
    },

    // 紹介
    async findReferralCode({ email, lineUserId }) {
      return st.codes.find((c) => c.source === 'referral_program' &&
        ((email && lower(c.owner_email) === lower(email)) || (lineUserId && c.owner_line_user_id === lineUserId))) || null;
    },
    async insertReferralCode(row) { const c = { id: id(), created_at: now(), confirmed_referrals: 0, total_referrals: 0, ...row }; st.codes.push(c); return c; },
    async updateReferralCode(codeId, patch) { Object.assign(st.codes.find((c) => c.id === codeId) || {}, patch); },
    async findActiveCodeByDiscount(code) {
      return st.codes.find((c) => c.is_active && (c.shopify_discount_code === code || c.code === code)) || null;
    },
    async listUsesForCodes(codeIds) { return st.uses.filter((u) => codeIds.includes(u.referral_code_id)); },
    async listUsesForReferee({ lineUserId, email }) {
      return st.uses.filter((u) => (lineUserId && u.referred_line_user_id === lineUserId) || (email && lower(u.referred_email) === lower(email) && u.status !== 'pending_bind'));
    },
    async findPendingUses() { return st.uses.filter((u) => u.status === 'pending_bind' && !u.referred_line_user_id && !u.referee_bound_at); },
    async bindUseIfPending(useId, patch) {
      const u = st.uses.find((x) => x.id === useId);
      if (!u || u.status !== 'pending_bind' || u.referee_bound_at) return false;
      Object.assign(u, patch);
      return true;
    },
    async incrementReferralCounts(codeId) {
      const c = st.codes.find((x) => x.id === codeId);
      if (c) { c.total_referrals += 1; c.confirmed_referrals += 1; }
    },
    async findUseByOrder(orderId) { return st.uses.find((u) => u.shopify_order_id === orderId) || null; },
    async insertUse(row) { const u = { id: id(), created_at: now(), ...row }; st.uses.push(u); return u; },
    async storePublicDomain() { return 'fitpeak.co'; },
    async createTrackingDiscount(code) { st.trackingDiscounts.push(code); },
    verifyWebhookHmac(raw, header) {
      if (!raw || !header) return false;
      const h = crypto.createHmac('sha256', 'test-secret').update(raw).digest('base64');
      return h === header;
    },
    testEmails: ['owner-test@example.com'],
  };
  return deps;
}

module.exports = { createFakeDeps };
