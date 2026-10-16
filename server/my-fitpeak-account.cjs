/**
 * My FITPEAK アカウントのプロフィール（公開項目）と、通っているジムの検索。2026-10-17
 *
 *   GET  /api/my-fitpeak/account/public        本人の公開項目と「足りない項目名」
 *   PUT  /api/my-fitpeak/account/public        公開項目を保存（ジムは収録データと照合し、正式名で保存）
 *   GET  /api/my-fitpeak/account/gyms?q=&pref= ジムナビ収録のジム（店舗レビュー＋チェーン店舗など）を名前で検索
 *
 * 非公開項目（本名・カナ・メール・郵便番号・住所・電話）はこのサーバーを通らない。
 * ブラウザが本人のログインで DB 関数（mf_account_get / mf_private_save / mf_private_delete）を直接呼ぶ。
 * DB: migrations/2026-10-17b-member-profiles.sql
 */
const express = require('express');

function sendError(res, err) {
  const msg = String(err && err.message || err);
  if (/[ぁ-んァ-ヶ一-龠]/.test(msg)) return res.status(400).json({ error: msg });
  console.error('[account]', msg);
  return res.status(500).json({ error: 'エラーが発生しました。時間をおいてもう一度お試しください' });
}

const norm = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const storeKey = (pref, city, name) => `store:${pref}:${city}:${name}`;

// directory = { reviews: [{key,name,pref,city}], stores: [[pref, city, name]] }
function searchGyms(directory, q, pref, limit = 20) {
  const n = norm(q);
  if (!n) return [];
  const out = [];
  for (const r of directory.reviews || []) {
    if (pref && r.pref !== pref) continue;
    if (norm(r.name).includes(n)) out.push({ kind: 'review', key: r.key, name: r.name, pref: r.pref, city: r.city });
  }
  for (const [p, c, name] of directory.stores || []) {
    if (out.length >= limit) break;
    if (pref && p !== pref) continue;
    if (norm(name).includes(n)) out.push({ kind: 'store', key: storeKey(p, c, name), name, pref: p, city: c });
  }
  return out.slice(0, limit);
}

function resolveGym(directory, g) {
  if (!g || typeof g !== 'object') return null;
  if (g.kind === 'review') {
    const r = (directory.reviews || []).find((x) => x.key === g.key);
    return r ? { kind: 'review', key: r.key, name: r.name } : null;
  }
  if (g.kind === 'store') {
    const s = (directory.stores || []).find(([p, c, name]) => storeKey(p, c, name) === g.key);
    return s ? { kind: 'store', key: g.key, name: s[2] } : null;
  }
  if (g.kind === 'other') return { kind: 'other', name: String(g.name || '').slice(0, 80) };
  return null;
}

function createAccountRouter(deps) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    if (!req.fitpeakUser || !req.fitpeakUser.id) return res.status(401).json({ error: 'ログインが必要です' });
    try {
      req.memberId = await deps.findMemberIdByAuthUser(req.fitpeakUser.id);
      if (!req.memberId) return res.status(404).json({ error: '会員情報が見つかりません' });
      next();
    } catch (err) { sendError(res, err); }
  });

  router.get('/public', async (req, res) => {
    try {
      const r = await deps.rpc('mf_public_get', { p_member: req.memberId });
      res.set('Cache-Control', 'no-store');
      res.json({ public: r.public || null, missing: r.missing || [] });
    } catch (err) { sendError(res, err); }
  });

  router.put('/public', async (req, res) => {
    try {
      const b = req.body || {};
      const dir = await deps.directory();
      const list = Array.isArray(b.gyms) ? b.gyms.slice(0, 10) : [];
      const gyms = [];
      for (const g of list) {
        const r = resolveGym(dir, g);
        if (!r) return res.status(400).json({ error: '通っているジムは検索結果から選ぶか、「その他」で名前を入力してください' });
        gyms.push(r);
      }
      const r = await deps.rpc('mf_public_save', {
        p_member: req.memberId, p_display_name: b.display_name, p_pref: b.pref, p_city: b.city,
        p_age_band: b.age_band, p_gender: b.gender, p_gyms: gyms,
      });
      const pending = Array.isArray(r.pending_other) ? r.pending_other : [];
      if (pending.length && deps.notifyOwner) {
        // 運営の確認用。ジム名と地域だけ（会員の名前・連絡先は送らない）
        deps.notifyOwner(`【My FITPEAK】収録外のジムが登録されました（確認待ち）\n${pending.join('、')}\n地域: ${b.pref}${b.city}\n確認後 member_profiles.gyms の status を ok に`)
          .catch((e) => console.error('[account] owner notify failed:', e.message));
      }
      res.json({ ok: true, pending_other: pending });
    } catch (err) { sendError(res, err); }
  });

  router.get('/gyms', async (req, res) => {
    try {
      const dir = await deps.directory();
      res.json({ gyms: searchGyms(dir, String(req.query.q || '').slice(0, 40), String(req.query.pref || '')) });
    } catch (err) { sendError(res, err); }
  });

  return router;
}

function productionDeps(gotoreDeps) {
  let reviews = { at: 0, list: [] };
  let stores = null; // 使うときに読む（約0.4MB。scripts/build-gym-directory.cjs で作る）
  async function loadReviews() {
    if (Date.now() - reviews.at < 30 * 60 * 1000 && reviews.list.length) return reviews.list;
    try {
      const r = await fetch('https://fitpeak.co/blogs/gym-review?view=gym-index&page=1');
      if (r.ok) {
        const d = await r.json();
        const { parseArticleTitle } = require('./gotore.cjs');
        const list = [];
        for (const a of d.articles || []) {
          const t = parseArticleTitle(a.title);
          if (t) list.push({ key: a.handle, name: t.name, pref: t.pref, city: t.city });
        }
        if (list.length) reviews = { at: Date.now(), list };
      }
    } catch (e) { console.error('[account] gym-review index:', e.message); }
    return reviews.list;
  }
  return {
    rpc: gotoreDeps.rpc,
    findMemberIdByAuthUser: gotoreDeps.findMemberIdByAuthUser,
    notifyOwner: gotoreDeps.notifyOwner,
    directory: async () => ({ reviews: await loadReviews(), stores: stores || (stores = require('./data/gym-directory.json').stores) }),
  };
}

module.exports = { createAccountRouter, searchGyms, productionDeps };
