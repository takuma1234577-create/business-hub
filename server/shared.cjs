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

// ── Anthropic Claude (DB優先でキーを取得) ──
let _anthropic;
let _anthropicKeySource = null;
function getAnthropicClient() {
  // 環境変数にセットされていればそれを使う（DB経由でランタイム上書きも含む）
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey && _anthropic && _anthropicKeySource === apiKey) return _anthropic;
  if (apiKey) {
    const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
    _anthropic = new Anthropic({ apiKey });
    _anthropicKeySource = apiKey;
    return _anthropic;
  }
  throw new Error('ANTHROPIC_API_KEY が未設定です。API設定画面からClaude AIのAPIキーを設定してください。');
}

// 起動時にDBからAPIキーを読み込んで環境変数にセット
async function loadApiKeysFromDb() {
  try {
    const sb = getSupabase();
    const { data: keys } = await sb.from('api_keys').select('id, api_key_encrypted').eq('is_active', true);
    if (!keys || keys.length === 0) return;

    const crypto = require('crypto');
    const secret = process.env.BANK_CREDENTIAL_ENCRYPTION_KEY || process.env.SUPABASE_ANON_KEY || 'default-key';
    const key = crypto.scryptSync(secret, 'api-keys-salt', 32);

    const envMap = {
      anthropic: 'ANTHROPIC_API_KEY',
      google_client_id: 'GOOGLE_CLIENT_ID',
      google_client_secret: 'GOOGLE_CLIENT_SECRET',
      chatwork: 'CHATWORK_API_TOKEN',
      bank_encryption: 'BANK_CREDENTIAL_ENCRYPTION_KEY',
    };

    for (const row of keys) {
      const envVar = envMap[row.id];
      if (!envVar || process.env[envVar]) continue; // 環境変数が既にあれば上書きしない
      try {
        const { iv, data, tag } = JSON.parse(row.api_key_encrypted);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
        decipher.setAuthTag(Buffer.from(tag, 'hex'));
        let decrypted = decipher.update(data, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        process.env[envVar] = decrypted;
        console.log(`[API Keys] ${row.id} loaded from database`);
      } catch { /* skip invalid keys */ }
    }
  } catch { /* DB not ready yet */ }
}

// 非同期で起動時ロード
loadApiKeysFromDb().catch(() => {});

module.exports = {
  getSupabase,
  getGoogleOAuth2,
  getChatworkToken,
  getChatworkHeaders,
  getAnthropicClient,
  google, // re-export for google.gmail etc.
};
