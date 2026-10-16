/**
 * 合トレナビ（My FITPEAK）
 *
 * fitpeak.co のジム店舗レビュー記事（blogs/gym-review）を読みに来た近所の人どうしを、ジム単位でつなぐ。
 *   公開   GET  /api/gotore/public/gym?handle=…   記事の枠に出す件数（ログイン不要・名前は出さない）
 *   会員   /api/my-fitpeak/gotore/…               本人の LINE ログインが必須（管理トークンでの代理操作は不可）
 *
 * 読み書きはすべて DB の gt_* 関数（migrations/2026-10-16-gotore.sql）。会員IDやLINEのIDは画面に返さない。
 * 相手への通知は DB が返す notify（LINEのID）にサーバーから送る。チャット本文は通知に載せない。
 */
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const SLOT_LABEL = { wd_am: '平日朝', wd_pm: '平日昼', wd_night: '平日夜', we_am: '土日朝', we_pm: '土日昼', we_night: '土日夜' };

function sendError(res, err) {
  const msg = String(err && err.message || err);
  // DB の raise exception は日本語の理由。それ以外（接続エラー等）は中身を見せない
  if (/[ぁ-んァ-ヶ一-龠]/.test(msg)) return res.status(400).json({ error: msg });
  console.error('[gotore]', msg);
  return res.status(500).json({ error: 'エラーが発生しました。時間をおいてもう一度お試しください' });
}

async function notifyAll(deps, list, text) {
  const ids = Array.isArray(list) ? list : [];
  const results = await Promise.allSettled(ids.map((to) => deps.pushLine(to, text)));
  results.forEach((r) => { if (r.status === 'rejected') console.error('[gotore] LINE push failed:', r.reason && r.reason.message); });
}

const strip = (o) => { if (o && typeof o === 'object') delete o.notify; return o; };

// 公開APIの簡易レート制限（IPごと・1分あたり）。Vercel では関数インスタンスごとの目安で、主な防御は CDN キャッシュ
function rateLimiter({ max = 60, windowMs = 60000 } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || 'unknown';
    let h = hits.get(ip);
    if (!h || now - h.start >= windowMs) { h = { start: now, n: 0 }; hits.set(ip, h); }
    h.n += 1;
    if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
    if (h.n > max) {
      res.set('Retry-After', String(Math.ceil((h.start + windowMs - now) / 1000)));
      return res.status(429).json({ error: 'too many requests' });
    }
    next();
  };
}

function createPublicRouter(deps) {
  const router = express.Router();
  router.use(rateLimiter(deps.rateLimit));

  // 合トレナビのトップ・エリアページ用の集計（件数・ジム名・エリア名・募集の大まかな条件だけ）
  const cache = new Map();
  const CACHE_MS = 60000;
  router.get('/overview', async (req, res) => {
    try {
      const pref = req.query.pref ? String(req.query.pref) : null;
      if (pref && !PREFS.includes(pref)) return res.status(400).json({ error: 'bad pref' });
      const key = pref || '';
      const hit = cache.get(key);
      let body = hit && Date.now() - hit.at < CACHE_MS ? hit.body : null;
      if (!body) {
        body = await deps.rpc('gt_public_overview', { p_pref: pref });
        cache.set(key, { at: Date.now(), body });
      }
      res.set('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=600');
      res.json(body);
    } catch (err) { sendError(res, err); }
  });

  router.get('/gym', async (req, res) => {
    try {
      const handle = String(req.query.handle || '');
      if (!handle || handle.length > 400 || handle.includes('/')) return res.status(400).json({ error: 'handle required' });
      let r = await deps.rpc('gt_gym_public', { p_handle: handle });
      if (!r.gym) {
        // 初めて見るジム：記事が実在するときだけ登録する（名前は記事の題名から取る。送られてきた名前は信用しない）
        const a = handle.startsWith('area:') ? parseAreaHandle(handle) : await deps.lookupArticle(handle);
        if (!a) return res.status(404).json({ error: 'not found' });
        await deps.rpc('gt_gym_upsert', { p_handle: handle, p_name: a.name, p_pref: a.pref, p_city: a.city });
        r = await deps.rpc('gt_gym_public', { p_handle: handle });
      }
      res.set('Cache-Control', 'public, max-age=60');
      res.json(r);
    } catch (err) { sendError(res, err); }
  });
  return router;
}

function createMemberRouter(deps) {
  const router = express.Router();
  const link = (path) => `${deps.baseUrl}/my-fitpeak/gotore${path}`;

  router.use(async (req, res, next) => {
    if (!req.fitpeakUser || !req.fitpeakUser.id) return res.status(401).json({ error: 'ログインが必要です' });
    try {
      req.memberId = await deps.findMemberIdByAuthUser(req.fitpeakUser.id);
      if (!req.memberId) return res.status(404).json({ error: '会員情報が見つかりません' });
      next();
    } catch (err) { sendError(res, err); }
  });

  const wrap = (fn) => async (req, res) => {
    try { res.json(strip(await fn(req, req.body || {}))); } catch (err) { sendError(res, err); }
  };
  const rpc = (fn, req, args) => deps.rpc(fn, { p_member: req.memberId, ...args });

  router.get('/me', wrap((req) => rpc('gt_me', req, {})));

  router.put('/profile', wrap((req, b) => rpc('gt_profile_save', req, {
    p_nickname: b.nickname, p_gender: b.gender, p_age_band: b.age_band, p_level: b.level, p_bio: b.bio || '', p_agree: !!b.agree,
  })));

  router.get('/gyms/:handle', wrap((req) => rpc('gt_gym_board', req, { p_handle: req.params.handle })));

  // LINEの案内の短いリンク（/my-fitpeak/gotore/b/<掲示板ID>）から掲示板のキーを引く
  router.get('/b/:id', async (req, res) => {
    try {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) return res.status(404).json({ error: '掲示板が見つかりません' });
      const handle = await deps.rpc('gt_gym_handle', { p_id: req.params.id });
      if (!handle) return res.status(404).json({ error: '掲示板が見つかりません' });
      res.json({ handle });
    } catch (err) { sendError(res, err); }
  });

  router.get('/area', wrap((req) => rpc('gt_area', req, { p_pref: String(req.query.pref || ''), p_city: req.query.city ? String(req.query.city) : null })));

  router.post('/gyms/:handle/watch', wrap((req, b) => rpc('gt_watch', req, { p_handle: req.params.handle, p_on: b.on !== false })));

  router.post('/posts', wrap(async (req, b) => {
    const r = await rpc('gt_post_create', req, {
      p_handle: b.handle, p_slots: b.slots || [], p_parts: b.parts || [], p_goals: b.goals || [],
      p_gender_pref: b.gender_pref === 'same' ? 'same' : 'any', p_note: b.note || '',
    });
    const slots = (b.slots || []).map((s) => SLOT_LABEL[s]).filter(Boolean).join('・');
    await notifyAll(deps, r.notify,
      `【合トレナビ】\n${r.gym_name}で新しい合トレ募集が出ました（${slots}）。\n\n募集を見る\n${link(`/gym/${encodeURIComponent(r.handle)}`)}`);
    return r;
  }));

  router.post('/posts/:id/close', wrap((req) => rpc('gt_post_close', req, { p_post: req.params.id })));

  router.post('/posts/:id/request', wrap(async (req, b) => {
    const r = await rpc('gt_request', req, { p_post: req.params.id, p_message: b.message || '' });
    await notifyAll(deps, r.notify,
      `【合トレナビ】\n${r.nickname}さんから、${r.gym_name}の募集に「合トレしたい」が届きました。\n\n申請を見る\n${link('')}`);
    return r;
  }));

  router.post('/requests/:id/answer', wrap(async (req, b) => {
    const r = await rpc('gt_request_answer', req, { p_request: req.params.id, p_accept: !!b.accept });
    if (r.match_id) {
      await notifyAll(deps, r.notify,
        `【合トレナビ】\n${r.nickname}さんが合トレを承認しました（${r.gym_name}）。チャットで日時を決めましょう。\n\nチャットを開く\n${link(`/chat/${r.match_id}`)}`);
    }
    return r;
  }));

  router.get('/matches/:id', wrap((req) => rpc('gt_match_messages', req, { p_match: req.params.id })));

  router.post('/matches/:id/messages', wrap(async (req, b) => {
    const r = await rpc('gt_message_send', req, { p_match: req.params.id, p_body: b.body || '' });
    await notifyAll(deps, r.notify,
      `【合トレナビ】\n${r.nickname}さんからメッセージが届きました。\n\nチャットを開く\n${link(`/chat/${req.params.id}`)}`);
    return r;
  }));

  router.post('/block', wrap((req, b) => rpc('gt_block', req, { p_match: b.match_id || null, p_post: b.post_id || null })));

  router.post('/report', wrap(async (req, b) => {
    const r = await rpc('gt_report', req, { p_post: b.post_id || null, p_match: b.match_id || null, p_reason: b.reason || '' });
    if (deps.notifyOwner) {
      deps.notifyOwner(`【合トレ】通報がありました${r.hidden ? '（2人以上のため募集を自動で非表示にしました）' : ''}\n理由: ${String(b.reason || '').slice(0, 200)}`)
        .catch((e) => console.error('[gotore] owner notify failed:', e.message));
    }
    return r;
  }));

  return router;
}

const PREFS = '北海道,青森県,岩手県,宮城県,秋田県,山形県,福島県,茨城県,栃木県,群馬県,埼玉県,千葉県,東京都,神奈川県,新潟県,富山県,石川県,福井県,山梨県,長野県,岐阜県,静岡県,愛知県,三重県,滋賀県,京都府,大阪府,兵庫県,奈良県,和歌山県,鳥取県,島根県,岡山県,広島県,山口県,徳島県,香川県,愛媛県,高知県,福岡県,佐賀県,長崎県,熊本県,大分県,宮崎県,鹿児島県,沖縄県'.split(',');

// 地域別ランキング記事のエリア掲示板「area:東京都:渋谷区」（市区町村は空でもよい＝都道府県全体）
function parseAreaHandle(handle) {
  const m = String(handle).match(/^area:([^:]+):([^:]*)$/);
  if (!m || !PREFS.includes(m[1])) return null;
  const city = m[2];
  if (city && !/^[ぁ-んァ-ヶ一-龠々ヶー]{1,15}[市区町村郡]$/.test(city) && !/^[ぁ-んァ-ヶ一-龠々ヶー]{1,10}市[ぁ-んァ-ヶ一-龠々ヶー]{1,6}区$/.test(city)) return null;
  return { name: `${city || m[1]}のジム（エリア全体）`, pref: m[1], city: city || null };
}

// fitpeak.co の記事の題名「店名（都道府県市区町村）の評価は…」から店名と所在地を取る
function parseArticleTitle(title) {
  const m = String(title || '').match(/^(.+?)（([^（）]+?)）の評価/);
  if (!m) return null;
  const loc = m[2].match(/^(.+?[都道府県])(.*)$/);
  return { name: m[1].trim(), pref: loc ? loc[1] : null, city: loc ? loc[2] || null : null };
}

function productionDeps() {
  let client = null;
  const db = () => {
    if (client) return client;
    const url = (process.env.SUPABASE_URL || '').trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    // gt_* 関数は service_role にだけ実行権限がある
    if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
    client = createClient(url, key, { auth: { persistSession: false } });
    return client;
  };
  return {
    // 通知のリンクは画面の場所（MY_FITPEAK_APP_URL。未設定なら my.fitpeak.co）
    baseUrl: require('./my-fitpeak-urls.cjs').myFitpeakAppBase(),
    async rpc(fn, args = {}) {
      const { data, error } = await db().rpc(fn, args);
      if (error) throw new Error(error.message);
      return data;
    },
    async findMemberIdByAuthUser(authUserId) {
      const { data, error } = await db().from('members').select('id').eq('auth_user_id', authUserId).maybeSingle();
      if (error) throw new Error(error.message);
      return data?.id || null;
    },
    async lookupArticle(handle) {
      const r = await fetch(`https://fitpeak.co/blogs/gym-review/${encodeURIComponent(handle)}`, { redirect: 'manual' });
      if (r.status !== 200) return null;
      const html = await r.text();
      const t = html.match(/<meta property="og:title" content="([^"]+)"/) || html.match(/<title>([^<]+)<\/title>/);
      return t ? parseArticleTitle(t[1].replace(/&amp;/g, '&').trim()) : null;
    },
    async pushLine(to, text) {
      const { getLineCredentials, DEFAULT_CHANNEL_ID } = require('./shared.cjs');
      const { accessToken } = await getLineCredentials(DEFAULT_CHANNEL_ID);
      if (!accessToken) throw new Error('LINEアクセストークンが未設定です');
      const r = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
      });
      if (!r.ok) throw new Error(`LINE push ${r.status}: ${await r.text().catch(() => '')}`);
    },
    async notifyOwner(text) {
      const { notifyOwner } = require('./owner-notify.cjs');
      return notifyOwner({ kind: 'info', text: String(text).slice(0, 900) });
    },
  };
}

module.exports = { createPublicRouter, createMemberRouter, productionDeps, parseArticleTitle, parseAreaHandle };
