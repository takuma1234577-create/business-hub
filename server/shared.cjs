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

// ── Anthropic Claude (singleton) ──
let _anthropic;
function getAnthropicClient() {
  if (!_anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY が未設定です');
    const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
    _anthropic = new Anthropic({ apiKey });
  }
  return _anthropic;
}

module.exports = {
  getSupabase,
  getGoogleOAuth2,
  getChatworkToken,
  getChatworkHeaders,
  getAnthropicClient,
  google, // re-export for google.gmail etc.
};
