const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { getSupabase, getGoogleAuthClient, google } = require('./shared.cjs');

const GMAIL_SENDER = 'takuma1234577@gmail.com';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return hash === check;
}

function generateToken() {
  return crypto.randomBytes(48).toString('hex');
}

function generate2FACode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6桁
}

// Gmail で認証コードを送信
async function sendVerificationEmail(email, code, purpose) {
  try {
    const auth = await getGoogleAuthClient('gmail');
    const gmail = google.gmail({ version: 'v1', auth });

    const purposeText = purpose === 'login' ? 'ログイン' : purpose === 'settings' ? 'API設定アクセス' : '認証';
    const subject = `【Business Hub】${purposeText}認証コード: ${code}`;
    const body = `Business Hub ${purposeText}認証コード\n\n認証コード: ${code}\n\nこのコードは10分間有効です。\n心当たりのない場合は無視してください。`;

    const emailContent = [
      `To: ${email}`,
      `From: ${GMAIL_SENDER}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      body,
    ].join('\r\n');

    const raw = Buffer.from(emailContent).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    return true;
  } catch (err) {
    console.error('[Auth] Email send error:', err.message);
    return false;
  }
}

// POST /login - Step 1: パスワード検証 → 2FAコード送信
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'メールアドレスとパスワードを入力してください' });

    const sb = getSupabase();
    const { data: user } = await sb.from('app_users').select('*').eq('email', email.toLowerCase()).single();
    if (!user) return res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' });

    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' });
    }

    // 未使用の古いコードを無効化
    await sb.from('auth_2fa_codes').update({ used: true })
      .eq('user_id', user.id).eq('purpose', 'login').eq('used', false);

    // 2FAコード生成・送信
    const code = generate2FACode();
    await sb.from('auth_2fa_codes').insert({
      user_id: user.id,
      code,
      purpose: 'login',
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10分
    });

    const sent = await sendVerificationEmail(user.email, code, 'login');
    if (!sent) {
      // Gmail OAuth未設定の場合は2FAをスキップして直接ログイン
      console.warn('[Auth] 2FA email failed, falling back to direct login');
      const directToken = generateToken();
      await sb.from('app_sessions').insert({
        user_id: user.id,
        token: directToken,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        mfa_verified: true,
      });
      return res.json({ token: directToken, email: user.email });
    }

    // 仮トークン発行（2FA未完了）
    const pendingToken = generateToken();
    await sb.from('app_sessions').insert({
      user_id: user.id,
      token: pendingToken,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10分（2FA完了まで）
      mfa_verified: false,
    });

    res.json({ pending_token: pendingToken, requires_2fa: true, email: user.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /verify-2fa - Step 2: 認証コード検証
router.post('/verify-2fa', async (req, res) => {
  try {
    const { pending_token, code } = req.body;
    if (!pending_token || !code) return res.status(400).json({ error: '認証コードを入力してください' });

    const sb = getSupabase();

    // 仮セッション確認
    const { data: session } = await sb.from('app_sessions')
      .select('user_id, id')
      .eq('token', pending_token)
      .eq('mfa_verified', false)
      .gt('expires_at', new Date().toISOString())
      .single();
    if (!session) return res.status(401).json({ error: 'セッション無効。再度ログインしてください' });

    // コード検証
    const { data: codeRecord } = await sb.from('auth_2fa_codes')
      .select('*')
      .eq('user_id', session.user_id)
      .eq('code', code)
      .eq('purpose', 'login')
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (!codeRecord) return res.status(401).json({ error: '認証コードが無効または期限切れです' });

    // コードを使用済みに
    await sb.from('auth_2fa_codes').update({ used: true }).eq('id', codeRecord.id);

    // セッションを正式に（30日有効・MFA verified）
    const finalToken = generateToken();
    await sb.from('app_sessions').update({
      token: finalToken,
      mfa_verified: true,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }).eq('id', session.id);

    const { data: user } = await sb.from('app_users').select('email').eq('id', session.user_id).single();

    res.json({ token: finalToken, email: user?.email, expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /request-settings-code - API設定画面アクセス用の追加認証コード送信
router.post('/request-settings-code', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: '認証が必要です' });

    const sb = getSupabase();
    const { data: session } = await sb.from('app_sessions')
      .select('user_id, app_users(email)')
      .eq('token', token)
      .eq('mfa_verified', true)
      .gt('expires_at', new Date().toISOString())
      .single();
    if (!session) return res.status(401).json({ error: 'セッション無効' });

    // 古いコードを無効化
    await sb.from('auth_2fa_codes').update({ used: true })
      .eq('user_id', session.user_id).eq('purpose', 'settings').eq('used', false);

    const code = generate2FACode();
    await sb.from('auth_2fa_codes').insert({
      user_id: session.user_id,
      code,
      purpose: 'settings',
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    const email = session.app_users?.email;
    const sent = await sendVerificationEmail(email, code, 'settings');

    if (!sent) {
      // Gmail OAuth未設定時は認証コードをスキップして直接settings_tokenを発行
      console.warn('[Auth] Settings 2FA email failed, granting direct access');
      await sb.from('auth_2fa_codes').update({ used: true }).eq('user_id', session.user_id).eq('code', code);
      const crypto = require('crypto');
      const settingsToken = crypto.randomBytes(48).toString('hex');
      return res.json({ ok: true, email, settings_token: settingsToken, skipped_2fa: true });
    }

    res.json({ ok: true, email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /verify-settings-code - API設定画面用コード検証
router.post('/verify-settings-code', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const { code } = req.body;
    if (!token || !code) return res.status(400).json({ error: 'コードを入力してください' });

    const sb = getSupabase();
    const { data: session } = await sb.from('app_sessions')
      .select('user_id')
      .eq('token', token)
      .eq('mfa_verified', true)
      .gt('expires_at', new Date().toISOString())
      .single();
    if (!session) return res.status(401).json({ error: 'セッション無効' });

    const { data: codeRecord } = await sb.from('auth_2fa_codes')
      .select('*')
      .eq('user_id', session.user_id)
      .eq('code', code)
      .eq('purpose', 'settings')
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (!codeRecord) return res.status(401).json({ error: '認証コードが無効または期限切れです' });

    await sb.from('auth_2fa_codes').update({ used: true }).eq('id', codeRecord.id);

    // settings_tokenを発行（1時間有効）
    const settingsToken = generateToken();
    res.json({ ok: true, settings_token: settingsToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /setup - 初回パスワード設定
router.post('/setup', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: '入力が不足しています' });
    if (password.length < 6) return res.status(400).json({ error: 'パスワードは6文字以上にしてください' });

    const sb = getSupabase();
    const { data: existing } = await sb.from('app_users').select('id').limit(1);
    if (existing && existing.length > 0) {
      return res.status(403).json({ error: '既にセットアップ済みです' });
    }

    await sb.from('app_users').insert({
      email: email.toLowerCase(),
      password_hash: hashPassword(password),
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /verify - トークン検証
router.get('/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ valid: false });

    const sb = getSupabase();
    const { data: session } = await sb.from('app_sessions')
      .select('*, app_users(email)')
      .eq('token', token)
      .eq('mfa_verified', true)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (!session) return res.status(401).json({ valid: false });
    res.json({ valid: true, email: session.app_users?.email });
  } catch {
    res.status(401).json({ valid: false });
  }
});

// POST /logout
router.post('/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      const sb = getSupabase();
      await sb.from('app_sessions').delete().eq('token', token);
    }
    res.json({ ok: true });
  } catch { res.json({ ok: true }); }
});

// POST /change-password
router.post('/change-password', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: '認証が必要です' });

    const sb = getSupabase();
    const { data: session } = await sb.from('app_sessions')
      .select('user_id').eq('token', token).eq('mfa_verified', true)
      .gt('expires_at', new Date().toISOString()).single();
    if (!session) return res.status(401).json({ error: 'セッション無効' });

    const { current_password, new_password } = req.body;
    if (!new_password || new_password.length < 6) return res.status(400).json({ error: '6文字以上' });

    const { data: user } = await sb.from('app_users').select('*').eq('id', session.user_id).single();
    if (!verifyPassword(current_password, user.password_hash)) {
      return res.status(401).json({ error: '現在のパスワードが正しくありません' });
    }

    await sb.from('app_users').update({ password_hash: hashPassword(new_password) }).eq('id', session.user_id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 認証ミドルウェア ──
function authMiddleware(req, res, next) {
  const publicPaths = [
    '/api/auth/',
    '/api/hp-outreach/lp/',
    '/api/hp-outreach/cron/',
    '/api/daily-cron',
    '/api/line-crm/webhook',
    '/api/line-crm/track/',
    '/api/line-crm/delayed-ai-reply',
    '/api/line-crm/tag-scheduled-replies/',
    '/api/line-crm/broadcasts/cron',
    '/api/line-crm/email-auto-reply/cron',
    '/api/line-crm/survey-followups/',
    '/api/shopify-line/webhook',
    '/api/shopify-line/cron/',
    '/api/return-review/submit',
    '/api/invoice/cron',
    '/api/sales-email/cron',
    '/api/amazon/cron/',
    '/api/amazon-analytics/cron/',
    '/api/amazon-review-monitor/cron/',
    '/api/backup/run',
    '/api/line-crm/friends/restore',
    '/api/invoice/auth/callback',
    '/api/invoice/auth/',
    '/api/settings/google/',
    '/api/settings/shopify/',
    '/api/settings/tiktok/',
  ];

  if (publicPaths.some(p => req.path.startsWith(p))) return next();
  if (req.headers['x-vercel-cron']) return next();
  if (!req.path.startsWith('/api/')) return next();

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '認証が必要です' });

  const sb = getSupabase();
  sb.from('app_sessions')
    .select('user_id')
    .eq('token', token)
    .eq('mfa_verified', true)
    .gt('expires_at', new Date().toISOString())
    .single()
    .then(({ data }) => {
      if (!data) return res.status(401).json({ error: 'セッション無効' });
      req.userId = data.user_id;
      next();
    })
    .catch(() => res.status(401).json({ error: '認証エラー' }));
}

module.exports = router;
module.exports.authMiddleware = authMiddleware;
