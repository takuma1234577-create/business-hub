/**
 * My FITPEAK の画面を my.fitpeak.co → fitpeak.co/a（Shopifyアプリプロキシ）へ移すときの引っ越し。
 *
 *   GET  /api/my-fitpeak/auth/app-location  … 画面の場所（誰でも可・個人情報なし）
 *   POST /api/my-fitpeak/auth/migrate       … my.fitpeak.co でログイン中の本人に、新しい場所で
 *                                              ログインするための1回限りの token_hash を出す
 *
 * 守ること:
 *   - 本人は Authorization: Bearer の Supabase セッションだけで決める。body の email / member_id /
 *     line_user_id 等は読まない。社内の管理トークンでは出さない
 *   - token_hash はURLのフラグメント(#)にだけ載せる（クエリ・サーバーログ・Refererに残らない）
 *   - Supabase のマジックリンクの token_hash は検証で消費される1回限りのもの。毎回作り直す
 *   - 応答・ログにメール・LINE ID・トークンを出さない
 *   - 画面がまだ my.fitpeak.co のままなら何も出さない（409）
 */

const express = require('express');
const urls = require('./my-fitpeak-urls.cjs');

function bearer(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer ([A-Za-z0-9._~+/=-]{1,4096})$/.exec(h);
  return m ? m[1] : null;
}

function createMigrateRouter(deps = {}) {
  const d = { ...productionDeps(), ...deps };
  const router = express.Router();

  router.get('/auth/app-location', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    const appUrl = d.appBase();
    res.json({ moved: appUrl !== d.apiBase(), appUrl });
  });

  router.post('/auth/migrate', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const token = bearer(req);
      if (!token) return res.status(401).json({ error: 'unauthorized' });
      let user = null;
      try { user = await d.getUserFromToken(token); } catch { user = null; }
      if (!user || !user.id || !user.email) return res.status(401).json({ error: 'unauthorized' });

      const appUrl = d.appBase();
      if (appUrl === d.apiBase()) return res.status(409).json({ error: 'not_moved' });

      const tokenHash = await d.issueTokenHash(user.email);
      if (!tokenHash) throw new Error('no token');
      const next = urls.safeNext((req.body || {}).next);
      const hash = new URLSearchParams({ lt: tokenHash, next }).toString();
      return res.json({ url: `${appUrl}/my-fitpeak/login#${hash}` });
    } catch {
      // 詳細（メール等が含まれうる）はログにも応答にも出さない
      console.error('[my-fitpeak/auth/migrate] failed');
      return res.status(500).json({ error: 'failed' });
    }
  });

  return router;
}

function productionDeps() {
  return {
    appBase: urls.myFitpeakAppBase,
    apiBase: urls.myFitpeakApiBase,
    async getUserFromToken(token) {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient((process.env.SUPABASE_URL || '').trim(), (process.env.SUPABASE_ANON_KEY || '').trim());
      const { data, error } = await supabase.auth.getUser(token);
      if (error) return null;
      return data?.user || null;
    },
    async issueTokenHash(email) {
      const { createClient } = require('@supabase/supabase-js');
      const url = (process.env.SUPABASE_URL || '').trim();
      const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
      if (!url || !key) throw new Error('service role missing');
      const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
      const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
      if (error) throw new Error('generateLink failed');
      return data?.properties?.hashed_token || null;
    },
  };
}

module.exports = { createMigrateRouter };
