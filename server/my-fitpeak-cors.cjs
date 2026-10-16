/**
 * My FITPEAK 会員API（/api/my-fitpeak/*）の CORS。
 * 認証は Authorization: Bearer（Cookieは使わない）なので * でも他サイトから本人データは読めないが、
 * 念のため読めるサイトを fitpeak.co（アプリプロキシの画面）と my.fitpeak.co（従来の画面）に限る。
 * 追加が必要なら MYFP_CORS_ORIGINS（カンマ区切り）。credentials は許可しない。
 */

const cors = require('cors');

const DEFAULT_ORIGINS = ['https://fitpeak.co', 'https://my.fitpeak.co'];

function allowedOrigins() {
  const extra = String(process.env.MYFP_CORS_ORIGINS || '')
    .split(',').map((s) => s.trim().replace(/\/+$/, '')).filter((s) => /^https:\/\/[a-z0-9.-]+$/i.test(s));
  return new Set([...DEFAULT_ORIGINS, ...extra]);
}

function myFitpeakCors() {
  return cors({
    origin: (origin, cb) => cb(null, !!origin && allowedOrigins().has(origin)),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: false,
    maxAge: 600,
  });
}

function isMyFitpeakApiPath(p) {
  return /^\/api\/my-fitpeak(?:\/|$)/.test(String(p || ''));
}

module.exports = { myFitpeakCors, isMyFitpeakApiPath, DEFAULT_ORIGINS };
