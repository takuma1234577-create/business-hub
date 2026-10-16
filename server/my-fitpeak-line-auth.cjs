/**
 * My FITPEAK: LINEログイン（メール・パスワード不要）
 *
 * 流れ:
 *   [LINEアプリ内 / LIFF]
 *     フロント: liff.getIDToken() → POST /api/my-fitpeak/auth/line { idToken }
 *       → LINEでIDトークンを検証 → members を解決 → Supabaseユーザーを用意
 *       → マジックリンクの token_hash を返す → フロントが verifyOtp でログイン
 *
 *   [通常のブラウザ]
 *     GET /api/my-fitpeak/auth/line/start?redirect=/my-fitpeak
 *       → LINEの認可画面 → GET /api/my-fitpeak/auth/line/callback
 *       → 同じ処理 → /my-fitpeak/login#lt=<token_hash> へ戻す
 *
 * 必要な設定:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   （ユーザー作成・セッション発行に必須）
 *   LINE_LOGIN_CHANNEL_ID / LINE_LOGIN_CHANNEL_SECRET
 *     （Business-hubの「API設定」の line_login_channel_id / line_login_channel_secret が優先）
 *   MY_FITPEAK_BASE_URL  APIの場所（コールバック・LIFF）。既定 https://my.fitpeak.co
 *   MY_FITPEAK_APP_URL   画面の場所（ログイン後に戻す先）。既定 https://my.fitpeak.co
 *                        アプリプロキシへ切り替えるときは https://fitpeak.co/a（my-fitpeak-urls.cjs）
 *
 * LINE Developers 側に、コールバックURLの登録が必要:
 *   https://my.fitpeak.co/api/my-fitpeak/auth/line/callback
 */

const express = require('express');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();
const handoff = require('./my-fitpeak-login-handoff.cjs');

const LINE_VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';
const LINE_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/token';
const LINE_AUTHORIZE_URL = 'https://access.line.me/oauth2/v2.1/authorize';
// 友だち追加用LIFF（public/liff/add.html）。My FITPEAKのLINEログインにも ?mode=myfp で使う
const LIFF_ID = (process.env.MY_FITPEAK_LIFF_ID || '2006537445-rcvSBpCP').trim();

// APIの場所（コールバック）と画面の場所（成功・失敗の戻り先）は my-fitpeak-urls.cjs で分けている
const myfpUrls = require('./my-fitpeak-urls.cjs');
const callbackUrl = myfpUrls.lineCallbackUrl;

// service role クライアント（ユーザー作成とセッション発行に必要）
function getAdmin() {
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY が未設定のため、LINEログインを利用できません');
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// LINEログインチャネルの設定は line-login.cjs と共通のものを使う
// （Business-hubの「API設定」→ 環境変数の順で解決される）
async function getLoginConfig() {
  const { getLoginConfig: shared } = require('./line-login.cjs');
  return shared();
}

// LINEのIDトークン／アクセストークンを検証して { lineUserId, displayName, pictureUrl, email } を返す
// 検証の失敗理由はログに残す（/api/line-crm/liff/confirm と同じ方針）
async function verifyIdToken(idToken, channelId) {
  const resp = await fetch(LINE_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    console.error(`[my-fitpeak/auth/line] id_token verify failed ${resp.status} ${body.slice(0, 200)} expected=${channelId}`);
    throw new Error('LINEのIDトークン検証に失敗しました');
  }
  const claims = await resp.json();
  if (!claims.sub) throw new Error('LINEのIDトークンにユーザーIDがありません');
  return {
    lineUserId: claims.sub,
    displayName: claims.name || null,
    pictureUrl: claims.picture || null,
    email: claims.email || null,
  };
}

// LIFF の access_token（/api/line-crm/liff/confirm と同じ検証の流れ）
async function verifyAccessToken(accessToken, channelId) {
  const v = await fetch(`https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`);
  if (!v.ok) {
    const body = await v.text().catch(() => '');
    console.error(`[my-fitpeak/auth/line] access_token verify failed ${v.status} ${body.slice(0, 200)}`);
    throw new Error('LINEのトークン検証に失敗しました');
  }
  const vj = await v.json();
  if (channelId && String(vj.client_id) !== String(channelId)) {
    console.error(`[my-fitpeak/auth/line] channel mismatch client_id=${vj.client_id} expected=${channelId}`);
    throw new Error('LINEのチャネルが一致しません');
  }
  const profResp = await fetch('https://api.line.me/v2/profile', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!profResp.ok) {
    console.error(`[my-fitpeak/auth/line] profile failed ${profResp.status} scope=${vj.scope}`);
    throw new Error('LINEのプロフィールを取得できませんでした');
  }
  const prof = await profResp.json();
  return {
    lineUserId: prof.userId,
    displayName: prof.displayName || null,
    pictureUrl: prof.pictureUrl || null,
    email: null,
  };
}

// LINEユーザー → FITPEAK ID（members）→ Supabaseユーザー → ログイン用 token_hash
async function issueSessionForLineUser({ lineUserId, displayName, email }) {
  const admin = getAdmin();

  // 1) FITPEAK ID を解決（無ければ作る）。RLSの影響を受けないよう service role で読む
  const findMember = async () => {
    const { data } = await admin
      .from('members')
      .select('id, auth_user_id, email, nickname')
      .eq('line_user_id', lineUserId)
      .maybeSingle();
    return data || null;
  };

  let member = await findMember();

  if (!member) {
    const { data: created, error } = await admin
      .from('members')
      .insert({ line_user_id: lineUserId, nickname: displayName, email, source: 'line_login' })
      .select('id, auth_user_id, email, nickname')
      .single();
    if (error) {
      // 同時アクセスなどで既に作られていた場合は、その会員を使う
      member = await findMember();
      if (!member) throw new Error(`会員情報の作成に失敗しました: ${error.message}`);
    } else {
      member = created;
    }
  }

  // 2) Supabaseのログインユーザーを用意
  let authUserId = member.auth_user_id;
  let loginEmail = member.email || email || null;

  if (authUserId) {
    const { data: got } = await admin.auth.admin.getUserById(authUserId);
    if (got?.user?.email) loginEmail = got.user.email;
    else authUserId = null;
  }

  if (!authUserId) {
    // メールが分からない場合はLINE IDから内部用アドレスを作る（本人には見せない）
    if (!loginEmail) {
      const hash = crypto.createHash('sha256').update(lineUserId).digest('hex').slice(0, 32);
      loginEmail = `line_${hash}@line.fitpeak.co`;
    }
    const { data: createdUser, error: createErr } = await admin.auth.admin.createUser({
      email: loginEmail,
      email_confirm: true,
      user_metadata: { line_user_id: lineUserId, display_name: displayName || null, provider: 'line' },
    });
    if (createErr && !/already been registered|already registered/i.test(createErr.message)) {
      throw new Error(`ログインユーザーの作成に失敗しました: ${createErr.message}`);
    }
    if (createdUser?.user?.id) {
      authUserId = createdUser.user.id;
    } else {
      // 既に同じメールのユーザーがいる場合はそれを使う
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const found = (list?.users || []).find(u => (u.email || '').toLowerCase() === loginEmail.toLowerCase());
      if (!found) throw new Error('ログインユーザーを特定できませんでした');
      authUserId = found.id;
    }

    const { error: linkErr2 } = await admin.from('members').update({
      auth_user_id: authUserId,
      email: member.email || loginEmail,
      nickname: member.nickname || displayName || null,
    }).eq('id', member.id);
    if (linkErr2) {
      console.error(`[my-fitpeak/auth/line] members更新に失敗: ${linkErr2.message} member=${member.id}`);
    }
  }

  // 3) セッション発行用のリンクを作る（メールは送られない）
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: loginEmail,
  });
  if (linkErr) throw new Error(`ログイン用トークンの発行に失敗しました: ${linkErr.message}`);

  await admin.from('members').update({ last_seen_at: new Date().toISOString() }).eq('id', member.id);

  return {
    tokenHash: link?.properties?.hashed_token,
    email: loginEmail,
    memberId: member.id,
  };
}

// ── POST /auth/line （LIFF：LINEアプリ内） ──────────────────────────────────
router.post('/auth/line', async (req, res) => {
  try {
    const { idToken, accessToken } = req.body || {};
    if (!idToken && !accessToken) return res.status(400).json({ error: 'idToken or accessToken required' });

    const login = await getLoginConfig();
    // LIFFのIDトークンはLIFFアプリが属するチャネルで発行される
    const channelId = (req.body.channelId || login.channelId || '').trim();
    if (!channelId) return res.status(500).json({ error: 'LINEログインチャネルが未設定です' });

    const profile = idToken
      ? await verifyIdToken(idToken, channelId)
      : await verifyAccessToken(accessToken, channelId);
    const result = await issueSessionForLineUser(profile);
    if (!result.tokenHash) return res.status(500).json({ error: 'ログイン用トークンを取得できませんでした' });

    // appUrl: LIFF（public/liff/add.html）がログイン後に戻す画面の場所。サーバーの設定値だけを返す
    res.json({ tokenHash: result.tokenHash, email: result.email, appUrl: myfpUrls.myFitpeakAppBase() });
  } catch (err) {
    console.error('POST /api/my-fitpeak/auth/line error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /auth/line/start （通常のブラウザ） ─────────────────────────────────
router.get('/auth/line/start', async (req, res) => {
  try {
    const login = await getLoginConfig();
    if (!login.configured) return res.status(500).send('LINEログインチャネルが未設定です');

    const redirect = typeof req.query.redirect === 'string' ? req.query.redirect : '/my-fitpeak';

    // スマホでは、LINEのWeb画面（メール・パスワード入力）ではなくLINEアプリを直接開く。
    // LIFFのURLはユニバーサルリンクなので、LINEが入っていればアプリが起動する。
    // 失敗時は LIFF 側（public/liff/add.html）が ?web=1 付きでここへ戻す。
    const ua = String(req.headers['user-agent'] || '');
    const isMobile = /iPhone|iPad|iPod|Android/i.test(ua);
    if (isMobile && req.query.web !== '1' && LIFF_ID) {
      const safe = redirect.startsWith('/') ? redirect : '/my-fitpeak';
      const q = { mode: 'myfp', redirect: safe };
      // 元のブラウザへログインを引き渡すためのID（/auth/line/handoff で発行）
      if (typeof req.query.h === 'string' && /^[A-Za-z0-9_-]{10,64}$/.test(req.query.h)) q.h = req.query.h;
      return res.redirect(`https://liff.line.me/${LIFF_ID}?${new URLSearchParams(q)}`);
    }

    const state = Buffer.from(JSON.stringify({
      n: crypto.randomBytes(8).toString('hex'),
      r: redirect.startsWith('/') ? redirect : '/my-fitpeak',
    })).toString('base64url');

    const url = `${LINE_AUTHORIZE_URL}?${new URLSearchParams({
      response_type: 'code',
      client_id: login.channelId,
      redirect_uri: callbackUrl(),
      state,
      scope: 'openid profile',
      bot_prompt: 'aggressive',
    })}`;
    res.redirect(url);
  } catch (err) {
    console.error('GET /api/my-fitpeak/auth/line/start error:', err.message);
    res.status(500).send('LINEログインを開始できませんでした');
  }
});

// ── GET /auth/line/callback ────────────────────────────────────────────────
router.get('/auth/line/callback', async (req, res) => {
  const fail = (msg) => res.redirect(myfpUrls.lineLoginFailUrl(msg));
  try {
    const { code, state, error } = req.query || {};
    if (error || !code) return fail('LINEログインがキャンセルされました');

    let redirect = '/my-fitpeak';
    try {
      const st = JSON.parse(Buffer.from(String(state || ''), 'base64url').toString());
      if (st?.r && String(st.r).startsWith('/')) redirect = st.r;
    } catch { /* state が壊れていても既定値で続行 */ }

    const login = await getLoginConfig();
    if (!login.configured) return fail('LINEログインチャネルが未設定です');

    const tokenResp = await fetch(LINE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: callbackUrl(),
        client_id: login.channelId,
        client_secret: login.channelSecret,
      }),
    });
    if (!tokenResp.ok) return fail('LINEとの通信に失敗しました');
    const token = await tokenResp.json();
    if (!token.id_token) return fail('LINEからユーザー情報を取得できませんでした');

    const profile = await verifyIdToken(token.id_token, login.channelId);
    const result = await issueSessionForLineUser(profile);
    if (!result.tokenHash) return fail('ログイン処理に失敗しました');

    return res.redirect(myfpUrls.lineLoginSuccessUrl(result.tokenHash, redirect));
  } catch (err) {
    console.error('GET /api/my-fitpeak/auth/line/callback error:', err.message);
    return fail(err.message);
  }
});

// ── LINEアプリ→元のブラウザへのログイン引き渡し（my-fitpeak-login-handoff.cjs） ──
// スマホのブラウザで「LINEでログイン」→ LINEアプリでログイン → 元のブラウザもログイン状態にする

// 元のブラウザ: 引き渡しを始める
router.post('/auth/line/handoff', async (req, res) => {
  try {
    const admin = getAdmin();
    // 1日以上前のものは掃除（失敗しても続行）
    admin.from('myfp_login_handoffs').delete().lt('expires_at', new Date(Date.now() - 86400000).toISOString()).then(() => {}, () => {});
    const h = await handoff.createHandoff(handoff.supabaseStore(admin));
    res.json(h);
  } catch (err) {
    console.error('POST /api/my-fitpeak/auth/line/handoff error:', err.message);
    res.status(500).json({ error: 'ログインを開始できませんでした' });
  }
});

// LINEアプリ: 確認番号の表示
router.get('/auth/line/handoff/:id', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await handoff.describeHandoff(handoff.supabaseStore(getAdmin()), req.params.id));
  } catch (err) {
    console.error('GET /api/my-fitpeak/auth/line/handoff error:', err.message);
    res.status(500).json({ error: 'failed' });
  }
});

// LINEアプリ: 本人が「ログインする」を押した
router.post('/auth/line/handoff/:id/approve', async (req, res) => {
  try {
    const { idToken, accessToken } = req.body || {};
    if (!idToken && !accessToken) return res.status(400).json({ error: 'idToken or accessToken required' });
    const login = await getLoginConfig();
    const channelId = (login.channelId || '').trim();
    if (!channelId) return res.status(500).json({ error: 'LINEログインチャネルが未設定です' });
    const profile = idToken ? await verifyIdToken(idToken, channelId) : await verifyAccessToken(accessToken, channelId);
    const r = await handoff.approveHandoff(handoff.supabaseStore(getAdmin()), req.params.id, profile);
    if (!r.ok) return res.status(410).json({ error: '時間切れか、すでに完了しています' });
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/my-fitpeak/auth/line/handoff/approve error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 元のブラウザ: 承認されたか確認し、承認済みならログイン用トークンを受け取る
router.post('/auth/line/handoff/:id/claim', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const r = await handoff.claimHandoff(handoff.supabaseStore(getAdmin()), req.params.id, (req.body || {}).pollKey);
    if (r.status !== 'approved') return res.json({ status: r.status });
    const result = await issueSessionForLineUser(r.profile);
    if (!result.tokenHash) return res.status(500).json({ error: 'ログイン用トークンを取得できませんでした' });
    res.json({ status: 'approved', tokenHash: result.tokenHash });
  } catch (err) {
    console.error('POST /api/my-fitpeak/auth/line/handoff/claim error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.issueSessionForLineUser = issueSessionForLineUser;
