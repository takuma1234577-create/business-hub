/**
 * FITPEAK SNS動画自動生成 API
 *
 * エンドポイント:
 *   GET    /api/fitpeak-sns/assets          素材一覧
 *   POST   /api/fitpeak-sns/assets/upload   素材アップロード
 *   DELETE /api/fitpeak-sns/assets/:id      素材削除
 *   GET    /api/fitpeak-sns/scripts         台本一覧
 *   POST   /api/fitpeak-sns/scripts         台本作成
 *   PUT    /api/fitpeak-sns/scripts/:id     台本更新
 *   DELETE /api/fitpeak-sns/scripts/:id     台本削除
 *   GET    /api/fitpeak-sns/videos          動画一覧
 *   POST   /api/fitpeak-sns/videos/render   動画レンダリング開始
 *   GET    /api/fitpeak-sns/videos/:id/poll 動画ステータス確認
 *   GET    /api/fitpeak-sns/config          商品マスタ等の設定取得
 */

const express = require('express');
const router = express.Router();
const { getSupabase } = require('./shared.cjs');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

// ── 商品マスタ ──
const PRODUCTS = {
  wristwrap:    { name: 'FITPEAK リストラップ',         subtitle: 'FITPEAK リストラップ' },
  powergrip:    { name: 'FITPEAK パワーグリップ',       subtitle: 'FITPEAK パワーグリップ' },
  belt:         { name: 'FITPEAK 本牛革トレーニングベルト', subtitle: 'FITPEAK 本革ベルト' },
  elbowsleeve:  { name: 'FITPEAK エルボースリーブ',     subtitle: 'FITPEAK エルボースリーブ' },
  kneesleeve:   { name: 'FITPEAK ニースリーブ',         subtitle: 'FITPEAK ニースリーブ' },
};

const PART_ORDER = ['hook', 'problem', 'step1', 'step2', 'step3', 'product', 'cta'];
const PART_DURATIONS = { hook: 3, problem: 6, step1: 6, step2: 6, step3: 5, product: 8, cta: 4 };
const BRAND_COLOR_RED = '#D72638';
const BRAND_COLOR_WHITE = '#FFFFFF';

// ── 設定取得 ──
router.get('/config', (_req, res) => {
  res.json({ products: PRODUCTS, partOrder: PART_ORDER, partDurations: PART_DURATIONS });
});

// ── APIキー取得ヘルパー ──
async function getSnsApiKeys() {
  const sb = getSupabase();
  const { data: keys } = await sb.from('api_keys').select('id, api_key_encrypted').eq('is_active', true);
  const result = {};
  if (!keys) return result;

  const crypto = require('crypto');
  const secret = process.env.BANK_CREDENTIAL_ENCRYPTION_KEY || process.env.SUPABASE_ANON_KEY || 'default-key';
  const key = crypto.scryptSync(secret, 'api-keys-salt', 32);

  for (const row of keys) {
    if (['json2video', 'elevenlabs_voice_id', 'elevenlabs_connection_id', 'pexels'].includes(row.id)) {
      try {
        const { iv, data, tag } = JSON.parse(row.api_key_encrypted);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
        decipher.setAuthTag(Buffer.from(tag, 'hex'));
        let dec = decipher.update(data, 'hex', 'utf8');
        dec += decipher.final('utf8');
        result[row.id] = dec;
      } catch { /* skip */ }
    }
  }
  return result;
}

// ── 素材一覧 ──
router.get('/assets', async (_req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('sns_assets').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 素材アップロード ──
router.post('/assets/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'ファイルが選択されていません' });

    const { category, product_key } = req.body;
    if (!category) return res.status(400).json({ error: 'categoryが必要です' });

    const sb = getSupabase();
    const ext = req.file.originalname.split('.').pop();
    const fileName = `${category}/${product_key ? product_key + '/' : ''}${Date.now()}.${ext}`;

    const { error: uploadErr } = await sb.storage
      .from('sns-assets')
      .upload(fileName, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
    if (uploadErr) throw uploadErr;

    const { data: urlData } = sb.storage.from('sns-assets').getPublicUrl(fileName);
    const fileUrl = urlData.publicUrl;

    const { data, error } = await sb.from('sns_assets').insert({
      category,
      product_key: product_key || null,
      file_name: req.file.originalname,
      file_url: fileUrl,
      file_size: req.file.size,
    }).select().single();
    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 素材削除 ──
router.delete('/assets/:id', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data: asset } = await sb.from('sns_assets').select('*').eq('id', req.params.id).single();
    if (!asset) return res.status(404).json({ error: '素材が見つかりません' });

    // ストレージからも削除
    const urlParts = asset.file_url.split('/sns-assets/');
    if (urlParts[1]) {
      await sb.storage.from('sns-assets').remove([urlParts[1]]);
    }

    const { error } = await sb.from('sns_assets').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 台本一覧 ──
router.get('/scripts', async (_req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('sns_scripts').select('*').order('script_number');
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 台本作成 ──
router.post('/scripts', async (req, res) => {
  try {
    const sb = getSupabase();
    const { script_number, theme, product, parts, caption, hashtags } = req.body;
    const { data, error } = await sb.from('sns_scripts').insert({
      script_number, theme, product, parts, caption, hashtags: hashtags || [],
    }).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 台本更新 ──
router.put('/scripts/:id', async (req, res) => {
  try {
    const sb = getSupabase();
    const { theme, product, parts, caption, hashtags } = req.body;
    const { data, error } = await sb.from('sns_scripts').update({
      theme, product, parts, caption, hashtags, updated_at: new Date().toISOString(),
    }).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 台本削除 ──
router.delete('/scripts/:id', async (req, res) => {
  try {
    const sb = getSupabase();
    const { error } = await sb.from('sns_scripts').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 動画一覧 ──
router.get('/videos', async (_req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('sns_videos').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// テロップサイズ（パートごと）
const SUBTITLE_SIZES = {
  hook: 80, problem: 64, step1: 64, step2: 64, step3: 64, product: 64, cta: 72,
};

// ── Pexels API: ナレーションに合ったフリー動画を自動検索 ──
async function searchPexelsVideo(query, pexelsKey) {
  try {
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&size=medium&per_page=5&min_duration=5&max_duration=30`;
    const resp = await fetch(url, { headers: { Authorization: pexelsKey } });
    if (!resp.ok) return null;
    const data = await resp.json();
    const videos = data.videos || [];
    if (videos.length === 0) return null;
    // 最初の動画からHD品質のファイルURLを取得
    const video = videos[0];
    const file = video.video_files
      .filter(f => f.quality === 'hd' || f.quality === 'sd')
      .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
    return file ? file.link : null;
  } catch { return null; }
}

// ── Claude AI: ナレーションから英語検索キーワードを生成 ──
async function generateSearchQueries(script, anthropicClient) {
  const partsText = PART_ORDER
    .filter(k => k !== 'product' && k !== 'cta' && script.parts[k])
    .map(k => `${k}: ${script.parts[k].narration}`)
    .join('\n');

  const resp = await anthropicClient.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `以下はフィットネス教育動画の各パートのナレーションです。各パートに合った背景映像をPexelsで検索するための英語キーワード（2-4語）を生成してください。

${partsText}

以下のJSON形式で出力してください（他のテキストは不要）：
{"hook":"keyword","problem":"keyword","step1":"keyword","step2":"keyword","step3":"keyword"}`
    }],
  });

  try {
    const text = resp.content[0].text.trim();
    const jsonMatch = text.match(/\{[^}]+\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch { return {}; }
}

// ── 動画定義組み立て ──
// 教育パート: Pexelsのフリー動画（暗め）+ 大テロップ + 音声
// 商品パート: 実写PV + テロップ（下部）
// CTA: ブランドレッド背景 + テロップ
async function buildMovie(script, assets, apiKeys) {
  const voiceId = apiKeys.elevenlabs_voice_id || '';
  const productAssets = assets.filter(a => a.category === 'product' && a.product_key === script.product);
  const bgmAssets = assets.filter(a => a.category === 'bgm');
  const pexelsKey = apiKeys.pexels || '';

  // Pexels自動検索: ナレーション内容に合った背景動画を取得
  let pexelsUrls = {};
  if (pexelsKey) {
    try {
      const { getAnthropicClient } = require('./shared.cjs');
      const anthropic = await getAnthropicClient();
      const queries = await generateSearchQueries(script, anthropic);
      console.log('[SNS] Pexels search queries:', queries);

      // 各パートの背景を並列検索
      const entries = Object.entries(queries);
      const results = await Promise.all(
        entries.map(([key, query]) => searchPexelsVideo(query, pexelsKey).then(url => [key, url]))
      );
      for (const [key, url] of results) {
        if (url) pexelsUrls[key] = url;
      }
      console.log('[SNS] Pexels found:', Object.keys(pexelsUrls).length, '/', entries.length);
    } catch (err) {
      console.error('[SNS] Pexels search error:', err.message);
    }
  }

  // フォールバック: Supabaseにアップロード済みの背景素材
  const bgAssets = assets.filter(a => a.category === 'background').sort((a, b) => a.file_name.localeCompare(b.file_name));

  const scenes = [];
  const educationParts = ['hook', 'problem', 'step1', 'step2', 'step3'];

  for (const partKey of PART_ORDER) {
    const part = script.parts[partKey];
    if (!part) continue;

    const elements = [];

    // 背景
    if (partKey === 'product' && productAssets.length > 0) {
      // 商品パート → 実写PV
      elements.push({ type: 'video', src: productAssets[0].file_url, resize: 'cover', muted: true, duration: -2 });
    } else if (partKey !== 'cta') {
      // 教育パート → Pexels動画 or アップロード済み背景
      const pexelsUrl = pexelsUrls[partKey];
      if (pexelsUrl) {
        elements.push({ type: 'video', src: pexelsUrl, resize: 'cover', muted: true, duration: -2, opacity: 0.4 });
      } else if (bgAssets.length > 0) {
        const idx = educationParts.indexOf(partKey);
        const bg = bgAssets[(idx >= 0 ? idx : 0) % bgAssets.length];
        elements.push({ type: 'video', src: bg.file_url, resize: 'cover', muted: true, duration: -2, opacity: 0.3 });
      }
    }
    // CTA → background-color（下で設定）

    // ナレーション
    if (part.narration) {
      elements.push({ type: 'voice', model: 'elevenlabs', text: part.narration, voice: voiceId });
    }

    // テロップ
    if (part.subtitle && part.subtitle.length > 0) {
      const fontSize = SUBTITLE_SIZES[partKey] || 64;
      elements.push({
        type: 'text',
        text: part.subtitle.join('\n'),
        settings: {
          'font-family': 'Noto Sans JP', 'font-size': fontSize, 'font-weight': 800,
          color: BRAND_COLOR_WHITE, 'text-align': 'center',
          'text-shadow': '2px 2px 12px rgba(0,0,0,0.95)',
        },
        position: partKey === 'product' ? 'bottom' : 'center',
        duration: -2,
      });
    }

    const scene = { elements, duration: -1 };
    if (partKey === 'cta') scene['background-color'] = BRAND_COLOR_RED;
    scenes.push(scene);
  }

  const movie = { resolution: 'custom', width: 1080, height: 1920, scenes, elements: [] };

  // BGM
  if (bgmAssets.length > 0) {
    movie.elements.push({ type: 'audio', src: bgmAssets[0].file_url, volume: 0.15, duration: -2 });
  }

  return movie;
}

// ── レンダリング開始 ──
router.post('/videos/render', async (req, res) => {
  try {
    const { script_id } = req.body;
    const sb = getSupabase();

    // 台本取得
    const { data: script, error: sErr } = await sb.from('sns_scripts').select('*').eq('id', script_id).single();
    if (sErr || !script) return res.status(404).json({ error: '台本が見つかりません' });

    // 素材取得
    const { data: assets } = await sb.from('sns_assets').select('*');

    // APIキー取得
    const apiKeys = await getSnsApiKeys();
    const json2videoKey = apiKeys.json2video;
    if (!json2videoKey) return res.status(400).json({ error: 'JSON2VideoのAPIキーがAPI設定に登録されていません' });

    // 動画定義組み立て
    const movie = await buildMovie(script, assets || [], apiKeys);

    // キャプション生成
    const tags = (script.hashtags || []).join(' ');
    const caption = `${script.caption}\n\n${tags}`;

    // 動画レコード作成
    const { data: video, error: vErr } = await sb.from('sns_videos').insert({
      script_id,
      script_number: script.script_number,
      theme: script.theme,
      product: script.product,
      status: 'rendering',
      caption,
      movie_definition: movie,
    }).select().single();
    if (vErr) throw vErr;

    // JSON2Video APIに送信
    const resp = await fetch('https://api.json2video.com/v2/movies', {
      method: 'POST',
      headers: { 'x-api-key': json2videoKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(movie),
    });
    const result = await resp.json();

    if (!resp.ok || !result.project) {
      await sb.from('sns_videos').update({ status: 'error', error_message: JSON.stringify(result) }).eq('id', video.id);
      return res.status(500).json({ error: 'レンダリング開始に失敗しました', detail: result });
    }

    await sb.from('sns_videos').update({ json2video_project: result.project }).eq('id', video.id);

    res.json({ video_id: video.id, project: result.project });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ステータスポーリング ──
router.get('/videos/:id/poll', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data: video } = await sb.from('sns_videos').select('*').eq('id', req.params.id).single();
    if (!video) return res.status(404).json({ error: '動画が見つかりません' });

    if (video.status === 'done' || video.status === 'error') {
      return res.json(video);
    }

    if (!video.json2video_project) {
      return res.json(video);
    }

    // JSON2Video APIでステータス確認
    const apiKeys = await getSnsApiKeys();
    const json2videoKey = apiKeys.json2video;
    if (!json2videoKey) return res.json(video);

    const resp = await fetch(`https://api.json2video.com/v2/movies?project=${video.json2video_project}`, {
      headers: { 'x-api-key': json2videoKey },
    });
    const result = await resp.json();
    const movieData = result.movie || {};

    if (movieData.status === 'done') {
      const { data: updated } = await sb.from('sns_videos').update({
        status: 'done', video_url: movieData.url, updated_at: new Date().toISOString(),
      }).eq('id', video.id).select().single();
      return res.json(updated);
    }

    if (movieData.status === 'error') {
      const { data: updated } = await sb.from('sns_videos').update({
        status: 'error', error_message: movieData.message || 'Unknown error', updated_at: new Date().toISOString(),
      }).eq('id', video.id).select().single();
      return res.json(updated);
    }

    res.json({ ...video, render_status: movieData.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 動画削除 ──
router.delete('/videos/:id', async (req, res) => {
  try {
    const sb = getSupabase();
    const { error } = await sb.from('sns_videos').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// SNS投稿キュー（キュー + ワンタップ投稿）
//   完成動画をAIで投稿文最適化 → キュー化 → 人がワンタップ投稿。
//   TikTok/Instagram公式APIが接続済みなら自動投稿、未接続なら投稿アシスト
//   （投稿文コピー + 動画DL + 「投稿済み」ワンタップ）にフォールバック。
// ===========================================================================

const PLATFORM_LABEL = { tiktok: 'TikTok', instagram: 'Instagram' };

// プラットフォーム別の投稿文をAIで最適化
async function optimizeCaption(video, platform) {
  const { getAnthropicClient } = require('./shared.cjs');
  const productName = (PRODUCTS[video.product] || {}).name || video.product || 'FITPEAK商品';
  const baseCaption = video.caption || '';
  const guide = platform === 'tiktok'
    ? 'TikTok向け: 最初の1行で強いフック。短く勢いのある口語。トレンド感。ハッシュタグは8〜12個（日本語＋一部英語、#筋トレ #宅トレ #ジム など）。最適投稿時間帯は平日19:00〜22:00。'
    : 'Instagram Reels向け: 共感→価値→CTAの流れ。改行を使い読みやすく。絵文字は使わない。ハッシュタグは15〜25個をまとめて末尾に。最適投稿時間帯は平日20:00〜21:00、週末11:00。';

  const prompt = `あなたはFITPEAK（筋トレギアD2Cブランド）のSNS運用責任者です。
以下の動画について、${PLATFORM_LABEL[platform]}に最適化した投稿文を作成してください。

商品: ${productName}
テーマ: ${video.theme || ''}
元キャプション: ${baseCaption}

${guide}

以下のJSON形式のみで出力（他のテキストは禁止）:
{"caption":"投稿本文（ハッシュタグは含めない）","hashtags":["#tag1","#tag2"],"best_time_jst":"20:00","reason":"その時間を推奨する理由を一言"}`;

  const anthropic = await getAnthropicClient();
  const completion = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 700,
    messages: [{ role: 'user', content: prompt }],
  });
  const textBlock = (completion.content || []).find((b) => b.type === 'text');
  const raw = (textBlock?.text || '').trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { caption: baseCaption, hashtags: video.hashtags || [], best_time_jst: null };
  try {
    const p = JSON.parse(m[0]);
    return {
      caption: p.caption || baseCaption,
      hashtags: Array.isArray(p.hashtags) ? p.hashtags : [],
      best_time_jst: p.best_time_jst || null,
      reason: p.reason || '',
    };
  } catch {
    return { caption: baseCaption, hashtags: video.hashtags || [], best_time_jst: null };
  }
}

// "HH:MM"(JST) から次回の投稿日時(timestamptz)を計算。過去なら翌日。
function nextOccurrence(hhmm) {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, min] = hhmm.split(':').map(Number);
  const nowUtc = Date.now();
  const jstNow = new Date(nowUtc + 9 * 3600 * 1000); // JST換算
  const target = new Date(jstNow);
  target.setHours(h, min, 0, 0);
  if (target.getTime() <= jstNow.getTime()) target.setDate(target.getDate() + 1);
  // JST→UTCに戻してISO
  return new Date(target.getTime() - 9 * 3600 * 1000).toISOString();
}

// 完成動画を投稿キューに追加（プラットフォームごとに最適化）
router.post('/videos/:id/queue', async (req, res) => {
  try {
    const sb = getSupabase();
    const platforms = Array.isArray(req.body?.platforms) && req.body.platforms.length
      ? req.body.platforms
      : ['tiktok', 'instagram'];

    const { data: video } = await sb.from('sns_videos').select('*').eq('id', req.params.id).single();
    if (!video) return res.status(404).json({ error: '動画が見つかりません' });
    if (video.status !== 'done' || !video.video_url) {
      return res.status(400).json({ error: 'レンダリング完了済みの動画のみキューに追加できます' });
    }

    const created = [];
    for (const platform of platforms) {
      if (!PLATFORM_LABEL[platform]) continue;
      const opt = await optimizeCaption(video, platform);
      const { data, error } = await sb.from('sns_post_queue').insert({
        video_id: video.id,
        platform,
        caption: opt.caption,
        hashtags: opt.hashtags,
        scheduled_for: nextOccurrence(opt.best_time_jst),
        status: 'queued',
      }).select().single();
      if (error) {
        console.error('[sns-queue] insert error:', error.message);
        continue;
      }
      created.push({ ...data, _reason: opt.reason });
    }

    res.json({ created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 投稿キュー一覧（動画情報をジョイン）
router.get('/post-queue', async (req, res) => {
  try {
    const sb = getSupabase();
    let q = sb.from('sns_post_queue')
      .select('*, sns_videos(video_url, theme, product, script_number)')
      .order('created_at', { ascending: false })
      .limit(200);
    if (req.query.status) q = q.eq('status', req.query.status);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// キュー項目の編集
router.put('/post-queue/:id', async (req, res) => {
  try {
    const sb = getSupabase();
    const allowed = ['caption', 'hashtags', 'scheduled_for', 'platform'];
    const patch = {};
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
    const { data, error } = await sb.from('sns_post_queue')
      .update(patch).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// TikTok/Instagram公式APIで投稿（接続済みなら）。未接続ならmanualモードを返す。
async function publishToPlatform(item, video) {
  const sb = getSupabase();
  // channel_stores に該当プラットフォームの有効な認証情報があるか
  const { data: store } = await sb.from('channel_stores')
    .select('channel, access_token, metadata')
    .eq('channel', item.platform.toUpperCase())
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (!store || !store.access_token) {
    // API未接続 → 投稿アシスト（手動）モード
    return {
      mode: 'manual',
      video_url: video.video_url,
      caption: `${item.caption}\n\n${(item.hashtags || []).join(' ')}`.trim(),
    };
  }

  // 公式API接続済み → ここで各プラットフォームのContent Posting APIを呼ぶ
  // （TikTok Content Posting API / Instagram Graph API。審査通過後にcredentialを
  //   channel_storesへ登録すれば、この分岐で自動投稿される。）
  throw new Error(`${PLATFORM_LABEL[item.platform]}の自動投稿APIは未実装です（認証情報は検出）。手動投稿をご利用ください。`);
}

// ワンタップ投稿
router.post('/post-queue/:id/publish', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data: item } = await sb.from('sns_post_queue').select('*').eq('id', req.params.id).maybeSingle();
    if (!item) return res.status(404).json({ error: 'キュー項目が見つかりません' });
    const { data: video } = await sb.from('sns_videos').select('*').eq('id', item.video_id).maybeSingle();
    if (!video) return res.status(404).json({ error: '動画が見つかりません' });

    const result = await publishToPlatform(item, video);

    if (result.mode === 'manual') {
      // 手動投稿アシスト: 投稿文と動画URLを返す（statusは変更しない。投稿後にmark-posted）
      return res.json({ mode: 'manual', ...result });
    }

    // API投稿成功
    await sb.from('sns_post_queue').update({
      status: 'posted', posted_at: new Date().toISOString(), post_url: result.post_url || null, error: null,
    }).eq('id', item.id);
    res.json({ mode: 'api', post_url: result.post_url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 投稿済みにする（手動投稿後のワンタップ）
router.post('/post-queue/:id/mark-posted', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('sns_post_queue').update({
      status: 'posted', posted_at: new Date().toISOString(), post_url: req.body?.post_url || null,
    }).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// スキップ
router.post('/post-queue/:id/skip', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('sns_post_queue').update({ status: 'skipped' })
      .eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
