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
 *   MY_FITPEAK_BASE_URL  既定 https://my.fitpeak.co
 *
 * LINE Developers 側に、コールバックURLの登録が必要:
 *   https://my.fitpeak.co/api/my-fitpeak/auth/line/callback
 */

const express = require('express');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

const LINE_VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';
const LINE_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/token';
const LINE_AUTHORIZE_URL = 'https://access.line.me/oauth2/v2.1/authorize';

function myFitpeakBase() {
  return (process.env.MY_FITPEAK_BASE_URL || 'https://my.fitpeak.co').replace(/\/$/, '');
}
function callbackUrl() {
  return `${myFitpeakBase()}/api/my-fitpeak/auth/line/callback`;
}

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

    res.json({ tokenHash: result.tokenHash, email: result.email });
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
  const fail = (msg) => res.redirect(`${myFitpeakBase()}/my-fitpeak/login?line_error=${encodeURIComponent(msg)}`);
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

    const hash = new URLSearchParams({ lt: result.tokenHash, next: redirect }).toString();
    return res.redirect(`${myFitpeakBase()}/my-fitpeak/login#${hash}`);
  } catch (err) {
    console.error('GET /api/my-fitpeak/auth/line/callback error:', err.message);
    return fail(err.message);
  }
});

module.exports = router;
module.exports.issueSessionForLineUser = issueSessionForLineUser;
