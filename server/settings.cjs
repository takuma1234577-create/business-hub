const express = require('express');
const router = express.Router();
const { getSupabase, getGoogleOAuth2, google } = require('./shared.cjs');

const supabase = getSupabase();

// === OAuth Tokens (shared across all tools) ===

// List all connected services
router.get('/connections', async (req, res) => {
  try {
    const { data: tokens } = await supabase
      .from('oauth_tokens')
      .select('id, scope, token_type, expiry_date, updated_at')
      .order('id');

    const connections = (tokens || []).map(t => ({
      id: t.id,
      scope: t.scope,
      tokenType: t.token_type,
      expiryDate: t.expiry_date,
      updatedAt: t.updated_at,
      isExpired: t.expiry_date ? Date.now() > Number(t.expiry_date) : false,
    }));

    // Check env-based credentials
    const envStatus = {
      google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      supabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
      chatwork: !!process.env.CHATWORK_API_TOKEN,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      amazonSupabase: !!(process.env.AMAZON_SUPABASE_URL && process.env.AMAZON_SUPABASE_KEY),
      linecrmSupabase: !!(process.env.LINECRM_SUPABASE_URL && process.env.LINECRM_SUPABASE_KEY),
    };

    res.json({ connections, envStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Google OAuth - initiate login with configurable scopes
const GOOGLE_SCOPES = {
  gmail: [
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
  ],
  calendar: [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events',
  ],
  sheets: [
    'https://www.googleapis.com/auth/spreadsheets',
  ],
  drive: [
    'https://www.googleapis.com/auth/drive.readonly',
  ],
};

// Reuse the invoice callback URL that's already registered in Google Cloud Console
const getCallbackUrl = (req) => `${req.protocol}://${req.get('host')}/api/invoice/auth/callback`;

router.get('/google/login', (req, res) => {
  const serviceId = req.query.service || 'gmail';
  const callbackUrl = getCallbackUrl(req);
  const oauth2Client = getGoogleOAuth2(callbackUrl);
  if (!oauth2Client) return res.status(400).json({ error: 'Google OAuth未設定 (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)' });

  const scopes = GOOGLE_SCOPES[serviceId] || GOOGLE_SCOPES.gmail;
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
    state: serviceId,
  });
  res.json({ url });
});

router.get('/google/callback', async (req, res) => {
  const { code, state } = req.query;
  const serviceId = state || 'gmail';
  const callbackUrl = getCallbackUrl(req);
  const oauth2Client = getGoogleOAuth2(callbackUrl);
  if (!oauth2Client) return res.status(400).send('Google OAuth未設定');

  try {
    const { tokens } = await oauth2Client.getToken(code);
    await supabase.from('oauth_tokens').upsert({
      id: serviceId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope,
      token_type: tokens.token_type,
      expiry_date: tokens.expiry_date,
      updated_at: new Date().toISOString(),
    });
    res.send(`<html><body><script>window.opener && window.opener.postMessage({type:'oauth_complete',service:'${serviceId}'},'*');window.close();</script><p>認証成功！ このウィンドウを閉じてください。</p></body></html>`);
  } catch (err) {
    res.status(500).send('認証エラー: ' + err.message);
  }
});

// Disconnect a service
router.delete('/connections/:id', async (req, res) => {
  try {
    await supabase.from('oauth_tokens').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Force refresh a token
router.post('/connections/:id/refresh', async (req, res) => {
  try {
    const { data } = await supabase.from('oauth_tokens').select('*').eq('id', req.params.id).single();
    if (!data) return res.status(404).json({ error: 'Token not found' });

    const oauth2Client = getGoogleOAuth2();
    if (!oauth2Client) return res.status(400).json({ error: 'Google OAuth未設定' });

    oauth2Client.setCredentials({
      refresh_token: data.refresh_token,
    });

    const { credentials } = await oauth2Client.refreshAccessToken();

    await supabase.from('oauth_tokens').update({
      access_token: credentials.access_token,
      expiry_date: credentials.expiry_date,
      updated_at: new Date().toISOString(),
    }).eq('id', req.params.id);

    res.json({ success: true, expiryDate: credentials.expiry_date });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Amazon SP-API Accounts ===

// List Amazon accounts
router.get('/amazon/accounts', async (req, res) => {
  try {
    const { data } = await supabase
      .from('amazon_sp_accounts')
      .select('id, account_name, seller_id, marketplace_id, endpoint, is_active, last_synced_at, created_at')
      .order('created_at', { ascending: false });
    res.json({ accounts: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add Amazon account
router.post('/amazon/accounts', async (req, res) => {
  try {
    const { account_name, seller_id, marketplace_id, refresh_token, client_id, client_secret, endpoint } = req.body;
    if (!account_name || !seller_id || !refresh_token || !client_id || !client_secret) {
      return res.status(400).json({ error: '必須項目が不足しています' });
    }

    // Validate by trying to get access token
    const axios = require('axios');
    try {
      await axios.post('https://api.amazon.com/auth/o2/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token,
          client_id,
          client_secret,
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
    } catch (authErr) {
      return res.status(400).json({ error: 'Amazon API認証に失敗しました。認証情報を確認してください。' });
    }

    const { data, error } = await supabase.from('amazon_sp_accounts').insert({
      account_name,
      seller_id,
      marketplace_id: marketplace_id || 'A1VC38T7YXB528',
      refresh_token,
      client_id,
      client_secret,
      endpoint: endpoint || 'https://sellingpartnerapi-fe.amazon.com',
      is_active: true,
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, account: { id: data.id, account_name: data.account_name, seller_id: data.seller_id } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Amazon account
router.delete('/amazon/accounts/:id', async (req, res) => {
  try {
    await supabase.from('amazon_sp_accounts').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test Amazon connection
router.post('/amazon/accounts/:id/test', async (req, res) => {
  try {
    const { data } = await supabase.from('amazon_sp_accounts').select('*').eq('id', req.params.id).single();
    if (!data) return res.status(404).json({ error: 'Account not found' });

    const axios = require('axios');
    const tokenRes = await axios.post('https://api.amazon.com/auth/o2/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: data.refresh_token,
        client_id: data.client_id,
        client_secret: data.client_secret,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    await supabase.from('amazon_sp_accounts').update({ last_synced_at: new Date().toISOString() }).eq('id', req.params.id);
    res.json({ success: true, expires_in: tokenRes.data.expires_in });
  } catch (err) {
    res.status(500).json({ error: 'Amazon API接続テスト失敗: ' + (err.response?.data?.error_description || err.message) });
  }
});

module.exports = router;
