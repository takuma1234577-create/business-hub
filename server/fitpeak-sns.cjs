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

module.exports = router;
