'use strict';
// yt-dlp の出力(TikTok/YouTube)を共通の動画データに揃える

function hashtagsOf(text) {
  if (!text) return [];
  const seen = new Map();
  for (const m of String(text).matchAll(/#+([^\s#]+)/gu)) {
    const tag = m[1].replace(/[.,!?、。]+$/u, '');
    const key = tag.toLowerCase();
    if (tag && !seen.has(key)) seen.set(key, tag);
  }
  return [...seen.values()];
}

function publishedAtOf(e) {
  if (e.timestamp) return new Date(e.timestamp * 1000).toISOString();
  if (/^\d{8}$/.test(e.upload_date || '')) {
    const d = e.upload_date;
    return new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T00:00:00Z`).toISOString();
  }
  return null;
}

function normalizeEntry(e, { platform, handle } = {}) {
  const text = [e.title, e.description].filter(Boolean).join('\n');
  if (platform === 'tiktok') {
    const h = handle || e.uploader || e.channel || '';
    return {
      platform,
      id: `tiktok:${e.id}`,
      url: e.url || e.webpage_url || `https://www.tiktok.com/@${h}/video/${e.id}`,
      title: e.description || e.title || '',
      creator: h ? `@${h}` : '',
      creatorId: h,
      views: e.view_count ?? null,
      likes: e.like_count ?? null,
      comments: e.comment_count ?? null,
      duration: e.duration ?? null,
      publishedAt: publishedAtOf(e),
      hashtags: hashtagsOf(text),
      thumbnail: e.thumbnails?.at?.(-1)?.url || e.thumbnail || null,
      isShort: true,
    };
  }
  const url = e.webpage_url || e.url || `https://www.youtube.com/watch?v=${e.id}`;
  return {
    platform: 'youtube',
    id: `youtube:${e.id}`,
    url,
    title: e.title || '',
    creator: e.channel || e.uploader || '',
    creatorId: e.channel_id || e.uploader_id || null,
    views: e.view_count ?? null,
    likes: e.like_count ?? null,
    comments: e.comment_count ?? null,
    duration: e.duration ?? null,
    publishedAt: publishedAtOf(e),
    hashtags: hashtagsOf(text),
    thumbnail: `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
    isShort: url.includes('/shorts/') || (e.duration != null && e.duration <= 180),
  };
}

// 入力されたアカウント指定(URL / @handle / UC… / yt:@handle)を判別する
function parseAccount(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/tiktok\.com\/@([\w.]+)/i))) {
    return { platform: 'tiktok', handle: m[1], url: `https://www.tiktok.com/@${m[1]}` };
  }
  if ((m = s.match(/youtube\.com\/(@[\w.\-]+)/i)) || (m = s.match(/^yt:(@[\w.\-]+)$/i))) {
    return { platform: 'youtube', handle: m[1], url: `https://www.youtube.com/${m[1]}` };
  }
  if ((m = s.match(/youtube\.com\/channel\/(UC[\w-]{22})/i)) || (m = s.match(/^(UC[\w-]{22})$/))) {
    return { platform: 'youtube', handle: m[1], url: `https://www.youtube.com/channel/${m[1]}` };
  }
  if ((m = s.match(/^@?([\w.]+)$/))) {
    return { platform: 'tiktok', handle: m[1], url: `https://www.tiktok.com/@${m[1]}` };
  }
  return null;
}

function toSeconds(ts) {
  const parts = ts.split(':').map(Number);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

// 字幕(VTT)から冒頭N秒ぶんの発話を取り出す。自動字幕の重複行は1回だけ使う
function firstSecondsOfVtt(vtt, seconds = 5) {
  const out = [];
  const seen = new Set();
  for (const block of String(vtt).split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const start = toSeconds(lines[i].split('-->')[0].trim().split(' ')[0]);
    if (start >= seconds) continue;
    for (const raw of lines.slice(i + 1)) {
      const line = raw.replace(/<[^>]+>/g, '').trim();
      if (line && !seen.has(line)) { seen.add(line); out.push(line); }
    }
  }
  return out.join(' ');
}

// 日本語の動画か(ひらがな・カタカナを含むか。漢字だけだと中国語と区別できないので数えない)
function isJapanese(text) {
  return /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(String(text || ''));
}

module.exports = { hashtagsOf, normalizeEntry, parseAccount, firstSecondsOfVtt, isJapanese };
