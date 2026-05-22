/**
 * Shared API Clients
 *
 * 共通API:
 *   - Supabase (DB)
 *   - Google OAuth2 (Gmail, Calendar, Sheets, Drive)
 *   - Chatwork
 *   - Anthropic Claude
 *
 * 環境変数:
 *   SUPABASE_URL, SUPABASE_ANON_KEY
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *   CHATWORK_API_TOKEN
 *   ANTHROPIC_API_KEY
 */

const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');

// ── Supabase (singleton) ──
let _supabase;
function getSupabase() {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY が未設定です');
    _supabase = createClient(url, key);
  }
  return _supabase;
}

// ── Google OAuth2 (factory) ──
function getGoogleOAuth2(redirectUri) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// ── Chatwork ──
function getChatworkToken() {
  const token = process.env.CHATWORK_API_TOKEN;
  if (!token) throw new Error('CHATWORK_API_TOKEN が未設定です');
  return token;
}

function getChatworkHeaders() {
  return { 'X-ChatWorkToken': getChatworkToken() };
}

// ── Anthropic Claude (毎回DBから最新キーを取得) ──
let _anthropic;
let _anthropicKeySource = null;

// DBからAPIキーを復号する共通関数
function _decryptApiKey(encrypted) {
  const crypto = require('crypto');
  const secret = process.env.BANK_CREDENTIAL_ENCRYPTION_KEY || process.env.SUPABASE_ANON_KEY || 'default-key';
  const key = crypto.scryptSync(secret, 'api-keys-salt', 32);
  const { iv, data, tag } = JSON.parse(encrypted);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function getAnthropicClient() {
  // 常にDBから最新のキーを取得
  try {
    const sb = getSupabase();
    const { data: row } = await sb.from('api_keys').select('api_key_encrypted').eq('id', 'anthropic').eq('is_active', true).single();
    if (row && row.api_key_encrypted) {
      const apiKey = _decryptApiKey(row.api_key_encrypted);
      if (apiKey) {
        if (_anthropic && _anthropicKeySource === apiKey) return _anthropic;
        const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
        _anthropic = new Anthropic({ apiKey });
        _anthropicKeySource = apiKey;
        process.env.ANTHROPIC_API_KEY = apiKey;
        return _anthropic;
      }
    }
  } catch (e) {
    console.error('[getAnthropicClient] DB lookup failed:', e.message);
  }

  // DBから取れなかった場合は環境変数にフォールバック
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    if (_anthropic && _anthropicKeySource === apiKey) return _anthropic;
    const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
    _anthropic = new Anthropic({ apiKey });
    _anthropicKeySource = apiKey;
    return _anthropic;
  }
  throw new Error('ANTHROPIC_API_KEY が未設定です。API設定画面からClaude AIのAPIキーを設定してください。');
}

// 起動時にDBからAPIキーを読み込んで環境変数にセット（初期ロード用）
async function loadApiKeysFromDb() {
  try {
    const sb = getSupabase();
    const { data: keys } = await sb.from('api_keys').select('id, api_key_encrypted').eq('is_active', true);
    if (!keys || keys.length === 0) return;

    const envMap = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      gemini: 'GEMINI_API_KEY',
      google_client_id: 'GOOGLE_CLIENT_ID',
      google_client_secret: 'GOOGLE_CLIENT_SECRET',
      chatwork: 'CHATWORK_API_TOKEN',
      slack_webhook: 'SLACK_WEBHOOK_URL',
      slack_bot_token: 'SLACK_BOT_TOKEN',
      slack_signing_secret: 'SLACK_SIGNING_SECRET',
      slack_channel_id: 'SLACK_CHANNEL_ID',
      bank_encryption: 'BANK_CREDENTIAL_ENCRYPTION_KEY',
    };

    for (const row of keys) {
      const envVar = envMap[row.id];
      if (!envVar) continue;
      try {
        const decrypted = _decryptApiKey(row.api_key_encrypted);
        process.env[envVar] = decrypted;
        console.log(`[API Keys] ${row.id} loaded from database`);
      } catch { /* skip invalid keys */ }
    }
  } catch { /* DB not ready yet */ }
}

// 非同期で起動時ロード
loadApiKeysFromDb().catch(() => {});

/**
 * Google OAuth認証済みクライアントを取得（トークン自動リフレッシュ付き）
 * @param {string} serviceId - 'gmail', 'calendar', 'sheets', 'drive'
 * @returns {Promise<import('googleapis').Common.OAuth2Client>}
 */
async function getGoogleAuthClient(serviceId = 'gmail') {
  const sb = getSupabase();
  const { data } = await sb.from('oauth_tokens').select('*').eq('id', serviceId).single();
  if (!data) throw new Error(`${serviceId} の認証トークンが見つかりません。API設定から再認証してください。`);
  if (!data.refresh_token) throw new Error(`${serviceId} のリフレッシュトークンがありません。再認証してください。`);

  const oauth2Client = getGoogleOAuth2();
  if (!oauth2Client) throw new Error('Google OAuth未設定 (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)');

  oauth2Client.setCredentials({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry_date: data.expiry_date ? Number(data.expiry_date) : undefined,
  });

  // トークンが期限切れ or 5分以内に期限切れなら明示的にリフレッシュ
  const now = Date.now();
  const expiryDate = data.expiry_date ? Number(data.expiry_date) : 0;
  if (!data.access_token || expiryDate < now + 5 * 60 * 1000) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);
      await sb.from('oauth_tokens').update({
        access_token: credentials.access_token,
        expiry_date: credentials.expiry_date,
        updated_at: new Date().toISOString(),
      }).eq('id', serviceId);
    } catch (err) {
      console.error(`[getGoogleAuthClient] ${serviceId} token refresh failed:`, err.message);
      throw new Error(`${serviceId} のトークン更新に失敗しました。再認証してください。`);
    }
  }

  return oauth2Client;
}

module.exports = {
  getSupabase,
  getGoogleOAuth2,
  getGoogleAuthClient,
  getChatworkToken,
  getChatworkHeaders,
  getAnthropicClient,
  google, // re-export for google.gmail etc.
};
