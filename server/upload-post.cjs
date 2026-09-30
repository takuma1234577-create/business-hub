/**
 * Upload-Post クライアント（1本の動画を TikTok / Instagram / YouTube Shorts へ投稿）
 *
 * TikTok・Instagram・YouTube の公式APIは、それぞれ審査と個別実装が必要になる。
 * Upload-Post は各SNSとの接続を代行してくれる中継サービスで、1本のAPIリクエストで
 * 同じ動画を各SNSへ投稿できる。動画は http(s) のURLを渡せばUpload-Post側が取得する
 * ため、こちらから動画本体を送り直す必要はない。
 *
 * 設定（Business-hubの「API設定」から入力。環境変数はフォールバック）:
 *   UPLOAD_POST_API_KEY   Upload-Postの管理画面で発行したAPIキー
 *   UPLOAD_POST_USER      Upload-Postで作成したプロフィール名（投稿先アカウントの束）
 *
 * 使うエンドポイント（https://docs.upload-post.com/）:
 *   POST /api/upload              動画投稿（multipart/form-data）
 *   GET  /api/uploadposts/status  request_id / job_id で投稿状況を確認
 *   GET  /api/uploadposts/users   プロフィールと接続済みSNSアカウントの一覧
 */

const API_BASE = 'https://api.upload-post.com/api';

// 対応プラットフォーム（Business-hub側のid → Upload-Post側のid）
const PLATFORM_IDS = {
  tiktok: 'tiktok',
  instagram: 'instagram',
  youtube: 'youtube',
};

// 投稿URLの判定に使うドメイン（レスポンスの中から「投稿できたURL」を拾うため）
const PLATFORM_HOSTS = {
  tiktok: ['tiktok.com'],
  instagram: ['instagram.com'],
  youtube: ['youtube.com', 'youtu.be'],
};

// 既定の公開設定。いずれも「公開」で投稿する（下書きにしたい場合は呼び出し側で上書き）
const DEFAULT_TIKTOK_PRIVACY = 'PUBLIC_TO_EVERYONE';
const DEFAULT_YOUTUBE_PRIVACY = 'public';

function supportsPlatform(platform) {
  return !!PLATFORM_IDS[platform];
}

// 設定はBusiness-hubの「API設定」（api_keysテーブル・暗号化）優先、無ければ環境変数
async function getConfig() {
  let getActiveApiKey = null;
  try { ({ getActiveApiKey } = require('./settings.cjs')); } catch { /* 起動順によっては未ロード */ }
  const pick = async (id, envVar) => {
    if (getActiveApiKey) { try { const v = await getActiveApiKey(id); if (v) return String(v).trim(); } catch { /* env へ */ } }
    const v = process.env[envVar];
    return v ? String(v).trim() : null;
  };
  return {
    apiKey: await pick('upload_post_api_key', 'UPLOAD_POST_API_KEY'),
    user: await pick('upload_post_user', 'UPLOAD_POST_USER'),
  };
}

async function isConfigured() {
  const c = await getConfig();
  return !!(c.apiKey && c.user);
}

// ── HTTP ──
async function apiFetch(path, { method = 'GET', query, body, headers = {} } = {}) {
  const { apiKey } = await getConfig();
  if (!apiKey) throw new Error('Upload-PostのAPIキーが未設定です（API設定 → Upload-Post APIキー）');

  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  // FormData を渡すときは Content-Type を自分で付けない（boundaryが壊れる）
  const resp = await fetch(url, {
    method,
    headers: { Authorization: `Apikey ${apiKey}`, ...headers },
    body,
  });

  const text = await resp.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }

  if (!resp.ok) {
    const detail = payload?.message || payload?.detail || payload?.error || text?.slice(0, 300) || '';
    throw new Error(`Upload-Post APIエラー (${resp.status}): ${detail}`);
  }
  return payload;
}

// プロフィールと接続済みSNSアカウントの一覧（API設定のテスト・接続確認に使う）
async function listProfiles() {
  const payload = await apiFetch('/uploadposts/users');
  return Array.isArray(payload?.profiles) ? payload.profiles : [];
}

/**
 * 動画を1プラットフォームへ投稿する。
 *
 * @param {object}  p
 * @param {string}  p.videoUrl        動画のURL（Upload-Post側が裏で取得する）
 * @param {string}  p.platform        'tiktok' | 'instagram' | 'youtube'
 * @param {string}  p.title           投稿本文（YouTubeのみ「タイトル」として使われる）
 * @param {string} [p.description]    YouTubeの説明欄に入れる本文
 * @param {string} [p.idempotencyKey] 再試行で二重投稿しないためのキー（24時間有効）
 * @param {string} [p.user]           プロフィール名（既定はAPI設定の値）
 */
async function uploadVideo({ videoUrl, platform, title, description, idempotencyKey, user }) {
  const cfg = await getConfig();
  const profile = user || cfg.user;
  if (!profile) throw new Error('Upload-Postのプロフィール名が未設定です（API設定 → Upload-Post プロフィール名）');
  if (!videoUrl) throw new Error('動画URLがありません');
  if (!supportsPlatform(platform)) throw new Error(`Upload-Postでは未対応のプラットフォームです: ${platform}`);

  const form = new FormData();
  form.append('video', videoUrl);
  form.append('user', profile);
  form.append('platform[]', PLATFORM_IDS[platform]);
  form.append('title', title || '');
  // 大きい動画でもリクエストがタイムアウトしないよう、Upload-Post側で非同期処理させる。
  // レスポンスは request_id が返るだけなので、あとでステータスを見て確定させる。
  form.append('async_upload', 'true');

  if (platform === 'tiktok') {
    form.append('privacy_level', DEFAULT_TIKTOK_PRIVACY);
  } else if (platform === 'instagram') {
    form.append('media_type', 'REELS'); // 縦動画はリールとして投稿
  } else if (platform === 'youtube') {
    form.append('privacyStatus', DEFAULT_YOUTUBE_PRIVACY);
    if (description) form.append('youtube_description', description);
  }

  const headers = idempotencyKey ? { 'Idempotency-Key': String(idempotencyKey) } : {};
  return apiFetch('/upload', { method: 'POST', body: form, headers });
}

// 非同期投稿（request_id）／予約投稿（job_id）の状況確認
async function getStatus({ requestId, jobId }) {
  if (!requestId && !jobId) throw new Error('request_id か job_id が必要です');
  return apiFetch('/uploadposts/status', { query: { request_id: requestId, job_id: jobId } });
}

// ── レスポンスの読み取り ──
// 同期／非同期／プラットフォームでレスポンスの形が変わるため、必要な情報だけを緩く探す。

const URL_KEY = /(^|_)(url|permalink|link)$/i;
const MESSAGE_KEY = /^(error|message|detail|reason)$/i;

function collectStrings(node, keyPattern, out = [], depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return out;
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string' && v && keyPattern.test(k)) out.push(v);
    else if (v && typeof v === 'object') collectStrings(v, keyPattern, out, depth + 1);
  }
  return out;
}

// 投稿先SNSのドメインを含むURLだけを「投稿URL」として採用する
// （元動画のURLを投稿URLと誤認しないため）
function pickPostUrl(payload, platform) {
  const hosts = PLATFORM_HOSTS[platform] || [];
  const urls = collectStrings(payload, URL_KEY).filter((u) => /^https?:\/\//.test(u));
  return urls.find((u) => hosts.some((h) => u.includes(h))) || null;
}

function pickMessage(payload) {
  const messages = [...new Set(collectStrings(payload, MESSAGE_KEY))];
  return messages.length ? messages.join(' / ').slice(0, 900) : null;
}

const DONE_STATUSES = ['completed', 'complete', 'done', 'success', 'succeeded', 'posted', 'published'];
const FAILED_STATUSES = ['error', 'failed', 'failure', 'cancelled', 'canceled'];

/**
 * 投稿レスポンス／ステータスレスポンスを { state, postUrl, error, requestId, jobId } に整える。
 * state: 'posted'（確定）| 'failed'（失敗）| 'pending'（Upload-Post側で処理中）
 */
function readResult(payload, platform) {
  const requestId = payload?.request_id || payload?.data?.request_id || null;
  const jobId = payload?.job_id || payload?.data?.job_id || null;
  const base = { requestId, jobId };

  const platformNode = payload?.results?.[platform] ?? payload?.data?.results?.[platform] ?? null;
  if (platformNode && platformNode.success === false) {
    return { ...base, state: 'failed', error: pickMessage(platformNode) || '投稿に失敗しました' };
  }

  const status = String(payload?.status || payload?.data?.status || '').toLowerCase();
  if (payload?.success === false || FAILED_STATUSES.includes(status)) {
    return { ...base, state: 'failed', error: pickMessage(payload) || '投稿に失敗しました' };
  }

  const postUrl = pickPostUrl(payload, platform);
  if (postUrl) return { ...base, state: 'posted', postUrl };
  if (DONE_STATUSES.includes(status)) return { ...base, state: 'posted', postUrl: null };

  return { ...base, state: 'pending' };
}

module.exports = {
  supportsPlatform,
  getConfig,
  isConfigured,
  listProfiles,
  uploadVideo,
  getStatus,
  readResult,
  PLATFORM_IDS,
};
