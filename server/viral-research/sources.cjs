'use strict';
// yt-dlp を使ったデータ取得(無料・APIキー不要)
const { execFile } = require('node:child_process');
const { mkdir, readFile, writeFile, readdir, rm } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { normalizeEntry, firstSecondsOfVtt, isJapanese } = require('./normalize.cjs');
const { baselineOf, outlierScore, rankOutliers, tier } = require('./outlier.cjs');

const ROOT = join(__dirname, '..', '..');
// scripts/setup-viral-research.sh で作る専用の yt-dlp(curl_cffi を入れると TikTok が取れなくなるので別環境にしている)
const YTDLP = process.env.YTDLP_BIN || join(ROOT, '.venv-ytdlp/bin/yt-dlp');
const CACHE = join(process.env.VR_DATA_DIR || join(ROOT, 'data', 'viral-research'), 'cache');
const FEED_TTL_MS = 24 * 60 * 60 * 1000;
const DETAIL_TTL_MS = 6 * 60 * 60 * 1000;

function ytdlp(args, { timeout = 90_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(YTDLP, ['--no-warnings', '--ignore-config', ...args], { timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) return reject(new Error((stderr || err.message).split('\n').filter(Boolean).pop()));
      resolve(stdout);
    });
  });
}

async function ytdlpJson(args, opts) {
  const out = await ytdlp(['-J', ...args], opts);
  return JSON.parse(out);
}

async function cached(key, ttl, fn) {
  const file = join(CACHE, `${key.replace(/[^\w.-]+/g, '_').slice(0, 150)}.json`);
  try {
    const hit = JSON.parse(await readFile(file, 'utf8'));
    if (Date.now() - hit.at < ttl) return hit.value;
  } catch {}
  const value = await fn();
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, JSON.stringify({ at: Date.now(), value }));
  return value;
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch (e) { out[idx] = { error: e.message }; }
    }
  }));
  return out;
}

// 期間(sp パラメータ): 種類=動画, 長さ=4分未満, 投稿日=指定
// quarter(3か月)はYouTube側に絞り込みがないので「今年」で取ってから日数で絞る
const PERIOD = { any: 'EgQQARgB', week: 'EgYIAxABGAE=', month: 'EgYIBBABGAE=', quarter: 'EgYIBRABGAE=', year: 'EgYIBRABGAE=' };

async function youtubeKeywordSearch(query, { limit = 25, period = 'quarter' } = {}) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${encodeURIComponent(PERIOD[period] || PERIOD.month)}`;
  const d = await ytdlpJson([url, '--flat-playlist', '--playlist-end', String(limit), '--extractor-args', 'youtube:lang=ja']);
  return (d.entries || []).map((e) => normalizeEntry(e, { platform: 'youtube' }));
}

async function youtubeHashtagShorts(tag, { limit = 25 } = {}) {
  const clean = tag.replace(/^#/, '').replace(/\s+/g, '');
  if (!clean) return [];
  const d = await ytdlpJson([`https://www.youtube.com/hashtag/${encodeURIComponent(clean)}/shorts`, '--flat-playlist', '--playlist-end', String(limit)]);
  return (d.entries || []).map((e) => normalizeEntry({ ...e, url: e.url || `https://www.youtube.com/shorts/${e.id}` }, { platform: 'youtube' }));
}

// 1本の詳細(投稿日・チャンネル・説明文・タグ)
async function videoDetail(urlOrVideo) {
  const url = typeof urlOrVideo === 'string' ? urlOrVideo : urlOrVideo.url;
  const platform = url.includes('tiktok.com') ? 'tiktok' : 'youtube';
  return cached(`detail_${url}`, DETAIL_TTL_MS, async () => {
    const d = await ytdlpJson([url, '--skip-download', '--no-playlist']);
    const handle = platform === 'tiktok' ? (url.match(/@([\w.]+)/)?.[1] || d.uploader) : undefined;
    const v = normalizeEntry({ ...d, url }, { platform, handle });
    return { ...v, description: d.description || '', tags: d.tags || [], followers: d.channel_follower_count ?? null };
  });
}

// 投稿者の直近動画(普段の再生数を出すため)
async function creatorFeed(account, { limit = 30 } = {}) {
  return cached(`feed_${account.platform}_${account.handle}`, FEED_TTL_MS, async () => {
    if (account.platform === 'tiktok') {
      const d = await ytdlpJson([account.url, '--flat-playlist', '--playlist-end', String(limit)], { timeout: 120_000 });
      return { name: `@${account.handle}`, videos: (d.entries || []).map((e) => normalizeEntry(e, { platform: 'tiktok', handle: account.handle })) };
    }
    const base = account.url.replace(/\/$/, '');
    let d;
    try {
      // チャンネル一覧では lang 指定をすると再生数が取れなくなるので付けない
      d = await ytdlpJson([`${base}/shorts`, '--flat-playlist', '--playlist-end', String(limit)]);
    } catch {
      d = await ytdlpJson([`${base}/videos`, '--flat-playlist', '--playlist-end', String(limit)]);
    }
    const name = d.channel || d.uploader || account.handle;
    const videos = (d.entries || []).map((e) => normalizeEntry({ ...e, channel: name, channel_id: d.channel_id }, { platform: 'youtube' }));
    return { name, followers: d.channel_follower_count ?? null, videos };
  });
}

function accountOfVideo(v) {
  if (v.platform === 'tiktok') return { platform: 'tiktok', handle: v.creatorId, url: `https://www.tiktok.com/@${v.creatorId}` };
  if (v.creatorId) return { platform: 'youtube', handle: v.creatorId, url: `https://www.youtube.com/channel/${v.creatorId}` };
  return null;
}

// 各動画に「普段の再生数」と外れ値スコアをつける
async function scoreVideos(videos, { concurrency = 4 } = {}) {
  const accounts = new Map();
  for (const v of videos) {
    const a = accountOfVideo(v);
    if (a) accounts.set(`${a.platform}:${a.handle}`, a);
  }
  const feeds = new Map();
  const keys = [...accounts.keys()];
  const results = await pool(keys, concurrency, (k) => creatorFeed(accounts.get(k)));
  keys.forEach((k, i) => feeds.set(k, results[i]));
  return videos.map((v) => {
    const a = accountOfVideo(v);
    const feed = a && feeds.get(`${a.platform}:${a.handle}`);
    const baseline = feed?.videos ? baselineOf(feed.videos, v.id) : null;
    const score = outlierScore(v.views, baseline);
    return { ...v, followers: v.followers ?? feed?.followers ?? null, baseline, score, tier: tier(score) };
  });
}

function withinDays(v, days) {
  if (!days || !v.publishedAt) return true;
  return Date.now() - new Date(v.publishedAt).getTime() <= days * 86400_000;
}

// ニッチ検索: キーワード検索+ハッシュタグのショート → 詳細 → 外れ値スコア順
async function searchNiche(query, { period = 'quarter', limit = 20, lang = 'auto', onProgress = () => {} } = {}) {
  // 日本語(漢字含む)のキーワードなら日本語の動画だけに絞る
  const jaOnly = lang === 'ja' || (lang === 'auto' && /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(query));
  const days = { week: 7, month: 31, quarter: 92, year: 366 }[period] || null;
  onProgress(`「${query}」で候補を集めています`);
  const [kw, tag] = await Promise.all([
    youtubeKeywordSearch(query, { limit: 30, period }).catch(() => []),
    youtubeHashtagShorts(query, { limit: 30 }).catch(() => []),
  ]);
  const byId = new Map();
  for (const v of [...tag, ...kw]) if (!byId.has(v.id)) byId.set(v.id, v);
  const candidates = [...byId.values()].filter((v) => !jaOnly || !v.title || isJapanese(`${v.title} ${v.creator}`)).sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, Math.max(limit + 10, 30));
  onProgress(`${candidates.length}本の詳細を確認しています`);
  const detailed = (await pool(candidates, 6, (v) => videoDetail(v).then((d) => ({ ...v, ...d, url: v.url, views: d.views ?? v.views }))))
    .filter((v) => v && !v.error && withinDays(v, days) && (!jaOnly || isJapanese(`${v.title} ${v.description} ${v.creator}`)));
  onProgress(`${detailed.length}本の投稿者の普段の再生数を調べています`);
  const scored = rankOutliers(await scoreVideos(detailed));
  // 1人の投稿者で埋まらないよう、1人あたり最大3本
  const perCreator = new Map();
  return scored.filter((v) => {
    const n = (perCreator.get(v.creator) || 0) + 1;
    perCreator.set(v.creator, n);
    return n <= 3;
  }).slice(0, limit);
}

// 登録アカウントの最新動画を外れ値スコアつきで
async function accountOutliers(account, { limit = 30 } = {}) {
  const feed = await creatorFeed(account, { limit });
  return {
    name: feed.name,
    followers: feed.followers ?? null,
    videos: feed.videos.map((v) => {
      const baseline = baselineOf(feed.videos, v.id);
      const score = outlierScore(v.views, baseline);
      return { ...v, baseline, score, tier: tier(score) };
    }),
  };
}

async function refreshAccount(account) {
  const key = join(CACHE, `feed_${account.platform}_${account.handle}`.replace(/[^\w.-]+/g, '_').slice(0, 150) + '.json');
  if (existsSync(key)) await rm(key);
  return accountOutliers(account);
}

// 冒頭N秒の発話(フック)を字幕から取る。字幕がなければ null
async function transcript(url, { seconds = 6, full = false } = {}) {
  return cached(`subs_${url}_${full ? 'full' : seconds}`, DETAIL_TTL_MS * 4, async () => {
    const dir = join(tmpdir(), `vc-subs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(dir, { recursive: true });
    try {
      await ytdlp([url, '--skip-download', '--no-playlist', '--write-subs', '--write-auto-subs', '--sub-langs', 'ja.*,ja,en.*,en', '--sub-format', 'vtt', '-o', join(dir, 's.%(ext)s')]).catch(() => {});
      const files = (await readdir(dir)).filter((f) => f.endsWith('.vtt'));
      const pick = files.find((f) => /\.ja/.test(f)) || files[0];
      if (!pick) return null;
      const vtt = await readFile(join(dir, pick), 'utf8');
      return firstSecondsOfVtt(vtt, full ? 1e9 : seconds) || null;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

// 複数キーワードをまとめて検索し、重複を除いてスコア順に並べ直す
async function searchMany(queries, { period = 'quarter', limit = 20, lang = 'auto', onProgress = () => {} } = {}) {
  const lists = [];
  for (const q of queries) lists.push(await searchNiche(q, { period, limit, lang, onProgress }).catch(() => []));
  const byId = new Map();
  for (const v of lists.flat()) if (!byId.has(v.id)) byId.set(v.id, v);
  const perCreator = new Map();
  return rankOutliers([...byId.values()]).filter((v) => {
    const n = (perCreator.get(v.creator) || 0) + 1;
    perCreator.set(v.creator, n);
    return n <= 3;
  }).slice(0, limit);
}

module.exports = { pool, videoDetail, creatorFeed, scoreVideos, searchNiche, accountOutliers, refreshAccount, transcript, searchMany };
