/**
 * My FITPEAK の URL の出どころを1か所にまとめる。
 *
 *   APIの場所   … API・LINEログインのコールバック・LIFF。my.fitpeak.co のまま（MY_FITPEAK_BASE_URL）
 *   画面の場所 … 会員ページ /my-fitpeak/... を見せる場所（MY_FITPEAK_APP_URL）
 *                 Shopify アプリプロキシへ切り替えるときは https://fitpeak.co/a にする。
 *                 未設定なら従来どおり https://my.fitpeak.co（＝何も変わらない）
 *   旧アプリ側 … /creashot など /my-fitpeak 以外の画面と、ワンタイムトークン付きリンク（MY_FITPEAK_URL）
 *                 トークン（?alt= / ?code=）は fitpeak.co のURLに載せない（Shopify側の計測やRefererに残さない）。
 */

const DEFAULT_ORIGIN = 'https://my.fitpeak.co';

// https のURLだけ（ローカル確認用に http://localhost は許す）。ユーザー名やパスワード付きは不可
function cleanBase(value, fallback) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  try {
    const u = new URL(raw);
    const local = u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
    if ((u.protocol !== 'https:' && !local) || u.username || u.password || u.search || u.hash) return fallback;
    return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
  } catch {
    return fallback;
  }
}

function myFitpeakApiBase() {
  return cleanBase(process.env.MY_FITPEAK_BASE_URL, DEFAULT_ORIGIN);
}

function myFitpeakAppBase() {
  return cleanBase(process.env.MY_FITPEAK_APP_URL, DEFAULT_ORIGIN);
}

function legacyBase() {
  return cleanBase(process.env.MY_FITPEAK_URL, myFitpeakApiBase());
}

// 画面が my.fitpeak.co 以外（fitpeak.co/a など）へ移っているか
function isAppMoved() {
  return myFitpeakAppBase() !== myFitpeakApiBase();
}

// ログイン後の戻り先。My FITPEAK の中のパスだけ（外部サイトへの転送に使わせない）
function safeNext(v) {
  const s = typeof v === 'string' ? v : '';
  if (!/^\/my-fitpeak(?:[/?#]|$)/.test(s)) return '/my-fitpeak';
  if (s.includes('//') || s.includes('\\') || /[\u0000-\u001f]/.test(s)) return '/my-fitpeak';
  return s;
}

// 会員向けの画面リンク（メール・LINEの本文用）
function myFitpeakPageUrl(path = '/my-fitpeak') {
  const p = String(path || '/');
  return /^\/my-fitpeak(?:[/?#]|$)/.test(p) ? `${myFitpeakAppBase()}${p}` : `${legacyBase()}${p}`;
}

// ワンタイムトークン付きのリンクは常に旧アプリ側（my.fitpeak.co）
function myFitpeakTokenLinkUrl(path, paramName, token) {
  return `${legacyBase()}${path}?${encodeURIComponent(paramName)}=${encodeURIComponent(token)}`;
}

function lineCallbackUrl() {
  return `${myFitpeakApiBase()}/api/my-fitpeak/auth/line/callback`;
}

// LINEログイン成功: token_hash はフラグメント(#)だけで渡す（サーバーのログ・Refererに残らない）
function lineLoginSuccessUrl(tokenHash, next) {
  const hash = new URLSearchParams({ lt: tokenHash, next: safeNext(next) }).toString();
  return `${myFitpeakAppBase()}/my-fitpeak/login#${hash}`;
}

function lineLoginFailUrl(message) {
  return `${myFitpeakAppBase()}/my-fitpeak/login?${new URLSearchParams({ line_error: message })}`;
}

module.exports = {
  myFitpeakApiBase,
  myFitpeakAppBase,
  isAppMoved,
  safeNext,
  myFitpeakPageUrl,
  myFitpeakTokenLinkUrl,
  lineCallbackUrl,
  lineLoginSuccessUrl,
  lineLoginFailUrl,
};
