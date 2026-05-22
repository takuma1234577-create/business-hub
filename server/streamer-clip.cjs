const express = require('express');
const router = express.Router();
const multer = require('multer');
const { getSupabase, getAnthropicClient } = require('./shared.cjs');

// ファイルアップロード（メモリ保持、25MBまで）
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ── Profiles ──

router.get('/profiles', async (_req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('streamer_profiles')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[StreamerClip] profiles list:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/profiles/:id', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('streamer_profiles')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/profiles', async (req, res) => {
  try {
    const { id, display_name, config } = req.body;
    if (!id || !display_name) return res.status(400).json({ error: 'id と display_name は必須です' });
    const sb = getSupabase();
    const { data, error } = await sb
      .from('streamer_profiles')
      .insert({ id, display_name, config: config || {} })
      .select()
      .single();
    if (error) throw error;
    // stats行も作成
    await sb.from('streamer_profile_stats').insert({ profile_id: id });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/profiles/:id', async (req, res) => {
  try {
    const { display_name, config } = req.body;
    const sb = getSupabase();
    const update = { updated_at: new Date().toISOString() };
    if (display_name !== undefined) update.display_name = display_name;
    if (config !== undefined) update.config = config;
    const { data, error } = await sb
      .from('streamer_profiles')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/profiles/:id', async (req, res) => {
  try {
    const sb = getSupabase();
    const { error } = await sb.from('streamer_profiles').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Jobs ──

router.get('/jobs', async (req, res) => {
  try {
    const sb = getSupabase();
    let q = sb.from('streamer_jobs').select('*, streamer_profiles(display_name, config)').order('created_at', { ascending: false });
    if (req.query.profile_id) q = q.eq('profile_id', req.query.profile_id);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/jobs/:id', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data: job, error } = await sb
      .from('streamer_jobs')
      .select('*, streamer_profiles(display_name, config)')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    const { data: candidates } = await sb
      .from('streamer_candidates')
      .select('*')
      .eq('job_id', req.params.id)
      .order('score', { ascending: false });
    res.json({ ...job, candidates: candidates || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/jobs', async (req, res) => {
  try {
    const { profile_id, video_filename, video_url } = req.body;
    if (!profile_id || !video_filename) return res.status(400).json({ error: 'profile_id と video_filename は必須です' });
    const sb = getSupabase();
    const { data, error } = await sb
      .from('streamer_jobs')
      .insert({ profile_id, video_filename, video_url: video_url || null })
      .select()
      .single();
    if (error) throw error;
    // stats更新
    await sb.rpc('', {}).catch(() => {});
    await sb.from('streamer_profile_stats').upsert({
      profile_id,
      total_jobs: 1,
    }, { onConflict: 'profile_id' });
    // total_jobsをインクリメント
    const { data: stats } = await sb.from('streamer_profile_stats').select('total_jobs').eq('profile_id', profile_id).single();
    if (stats) {
      await sb.from('streamer_profile_stats').update({ total_jobs: (stats.total_jobs || 0) + 1 }).eq('profile_id', profile_id);
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/jobs/:id', async (req, res) => {
  try {
    const sb = getSupabase();
    const { error } = await sb.from('streamer_jobs').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── YouTube字幕取得 ──

function parseVideoUrl(url) {
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return { platform: 'youtube', videoId: ytMatch[1], url };
  return null;
}

// YouTube字幕を直接取得（YouTube内部APIから字幕トラックURLを取り出す）
async function fetchYouTubeTranscript(videoId) {
  // 1. まず youtube-transcript パッケージで試行
  try {
    const { YoutubeTranscript } = require('youtube-transcript');
    for (const lang of ['en', undefined, 'ja']) {
      try {
        const items = await YoutubeTranscript.fetchTranscript(videoId, lang ? { lang } : {});
        if (items && items.length > 0) {
          const transcript = items.map(item => {
            const start = item.offset / 1000;
            const end = start + (item.duration / 1000);
            return `[${formatSeconds(start)} - ${formatSeconds(end)}] ${item.text}`;
          }).join('\n');
          const totalDuration = (items[items.length - 1].offset + items[items.length - 1].duration) / 1000;
          return { transcript, duration: Math.floor(totalDuration) };
        }
      } catch { /* try next lang */ }
    }
  } catch {}

  // 2. フォールバック: 動画ページHTMLから字幕トラックURLを直接抽出
  console.log(`[StreamerClip] youtube-transcript failed, trying direct page scrape...`);
  try {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const html = await pageRes.text();

    // ytInitialPlayerResponse からキャプショントラックURLを抽出
    const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
    if (!playerMatch) {
      console.log('[StreamerClip] Could not find ytInitialPlayerResponse');
      return null;
    }

    let playerResponse;
    try { playerResponse = JSON.parse(playerMatch[1]); } catch { return null; }

    const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!tracks || tracks.length === 0) {
      console.log('[StreamerClip] No caption tracks found');
      return null;
    }

    // 英語優先、なければ最初のトラック
    const enTrack = tracks.find(t => t.languageCode === 'en') || tracks[0];
    const captionUrl = enTrack.baseUrl + '&fmt=json3';

    const captionRes = await fetch(captionUrl);
    if (!captionRes.ok) return null;
    const captionData = await captionRes.json();

    const events = captionData.events || [];
    const items = events
      .filter(e => e.segs && e.segs.length > 0)
      .map(e => ({
        text: e.segs.map(s => s.utf8 || '').join(''),
        start: (e.tStartMs || 0) / 1000,
        duration: (e.dDurationMs || 0) / 1000,
      }))
      .filter(item => item.text.trim());

    if (items.length === 0) return null;

    const transcript = items.map(item => {
      return `[${formatSeconds(item.start)} - ${formatSeconds(item.start + item.duration)}] ${item.text.trim()}`;
    }).join('\n');

    const last = items[items.length - 1];
    const totalDuration = last.start + last.duration;

    return { transcript, duration: Math.floor(totalDuration) };
  } catch (err) {
    console.log(`[StreamerClip] Direct scrape failed: ${err.message}`);
    return null;
  }
}

// YouTube動画タイトル取得（oEmbed API - 認証不要）
async function fetchYouTubeTitle(videoId) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (res.ok) {
      const data = await res.json();
      return data.title || videoId;
    }
  } catch {}
  return videoId;
}

// ── URL → ジョブ作成 + 字幕取得 + 候補抽出 ──

router.post('/jobs/process-url', async (req, res) => {
  const sb = getSupabase();
  let jobId = null;

  try {
    const { profile_id, url } = req.body;
    if (!profile_id) return res.status(400).json({ error: 'profile_id は必須です' });
    if (!url || !url.trim()) return res.status(400).json({ error: 'URLを入力してください' });

    const parsed = parseVideoUrl(url.trim());
    if (!parsed) return res.status(400).json({ error: 'YouTube URLを入力してください（例: https://www.youtube.com/watch?v=xxx）' });

    // 1. 動画タイトル取得
    console.log(`[StreamerClip] Processing YouTube: ${parsed.videoId}`);
    const title = await fetchYouTubeTitle(parsed.videoId);

    // 2. 字幕取得を試行
    let transcript = null;
    let duration = 0;
    let whisperCost = 0;
    let method = 'subtitle';

    const transcriptData = await fetchYouTubeTranscript(parsed.videoId);
    if (transcriptData) {
      transcript = transcriptData.transcript;
      duration = transcriptData.duration;
      console.log(`[StreamerClip] Got subtitle: ${title} (${duration}s, ${transcript.length} chars)`);
    } else {
      // 3. 字幕なし → ファイルアップロードを案内
      throw new Error('この動画の字幕を取得できませんでした。「ファイル」モードに切り替えて、音声ファイル（MP3/M4Aなど）を直接アップロードしてください。\n\n音声ファイルの取得方法: ブラウザ拡張機能やオンラインツールでYouTube動画の音声をダウンロードできます。');
    }

    // 4. ジョブ作成
    const { data: job, error: jobErr } = await sb
      .from('streamer_jobs')
      .insert({ profile_id, video_filename: title, video_url: url.trim(), status: 'processing' })
      .select()
      .single();
    if (jobErr) throw jobErr;
    jobId = job.id;

    // stats
    const { data: stats } = await sb.from('streamer_profile_stats').select('total_jobs').eq('profile_id', profile_id).single();
    if (stats) {
      await sb.from('streamer_profile_stats').update({ total_jobs: (stats.total_jobs || 0) + 1 }).eq('profile_id', profile_id);
    }

    // Whisperコスト記録（使った場合のみ）
    if (whisperCost > 0) {
      await sb.from('streamer_cost_logs').insert({
        job_id: jobId, profile_id, service: 'whisper',
        units: duration, cost_usd: whisperCost,
      });
    }

    // 5. Claude AI で候補抽出
    const { data: profile } = await sb.from('streamer_profiles').select('*').eq('id', profile_id).single();
    const claudeResult = await extractCandidatesWithClaude(jobId, profile_id, profile, transcript, sb);

    // 6. 完了
    const totalCost = whisperCost + claudeResult.cost_usd;
    await sb.from('streamer_jobs').update({ status: 'awaiting_review', total_cost_usd: totalCost }).eq('id', jobId);

    res.json({
      job_id: jobId,
      title,
      method,
      duration_seconds: duration,
      transcript_length: transcript.length,
      candidates: claudeResult.candidates,
      cost: { whisper: whisperCost, claude: claudeResult.cost_usd, total: totalCost },
    });
  } catch (err) {
    console.error('[StreamerClip] process-url error:', err.message);
    if (jobId) {
      await sb.from('streamer_jobs').update({ status: 'error', error_message: err.message }).eq('id', jobId).catch(() => {});
    }
    res.status(500).json({ error: err.message });
  }
});

// ── Whisper 文字起こし ──

async function transcribeWithWhisper(audioBuffer, filename) {
  const OpenAI = require('openai');

  // OpenAI APIキーをDB or 環境変数から取得
  let apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    try {
      const sb = getSupabase();
      const { data: row } = await sb.from('api_keys').select('api_key_encrypted').eq('id', 'openai').eq('is_active', true).single();
      if (row && row.api_key_encrypted) {
        const crypto = require('crypto');
        const secret = process.env.BANK_CREDENTIAL_ENCRYPTION_KEY || process.env.SUPABASE_ANON_KEY || 'default-key';
        const key = crypto.scryptSync(secret, 'api-keys-salt', 32);
        const { iv, data, tag } = JSON.parse(row.api_key_encrypted);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
        decipher.setAuthTag(Buffer.from(tag, 'hex'));
        let decrypted = decipher.update(data, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        apiKey = decrypted;
      }
    } catch {}
  }
  if (!apiKey) throw new Error('OPENAI_API_KEY が未設定です。API設定画面からOpenAIのAPIキーを設定してください。');

  const openai = new OpenAI({ apiKey });
  const file = new File([audioBuffer], filename, { type: 'audio/mpeg' });

  const response = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file,
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
  });

  return response;
}

// ── クリップアップロード → 文字起こし + 和訳・解説生成（メインフロー） ──

router.post('/jobs/upload-and-process', upload.single('file'), async (req, res) => {
  const sb = getSupabase();
  let jobId = null;

  try {
    const profileId = req.body.profile_id;
    if (!profileId) return res.status(400).json({ error: 'profile_id は必須です' });
    if (!req.file) return res.status(400).json({ error: 'クリップファイルをアップロードしてください' });

    const filename = req.file.originalname;
    const sourceUrl = req.body.source_url || null;

    // 1. ジョブ作成
    const { data: job, error: jobErr } = await sb
      .from('streamer_jobs')
      .insert({ profile_id: profileId, video_filename: filename, video_url: sourceUrl, status: 'transcribing' })
      .select()
      .single();
    if (jobErr) throw jobErr;
    jobId = job.id;

    // stats更新
    const { data: stats } = await sb.from('streamer_profile_stats').select('total_jobs').eq('profile_id', profileId).single();
    if (stats) {
      await sb.from('streamer_profile_stats').update({ total_jobs: (stats.total_jobs || 0) + 1 }).eq('profile_id', profileId);
    }

    // 2. Whisper API で文字起こし
    console.log(`[StreamerClip] Transcribing clip: ${filename} (${(req.file.size / 1024 / 1024).toFixed(1)}MB)...`);
    const whisperResult = await transcribeWithWhisper(req.file.buffer, filename);

    const durationMin = (whisperResult.duration || 0) / 60;
    const whisperCost = durationMin * 0.006;
    await sb.from('streamer_cost_logs').insert({
      job_id: jobId, profile_id: profileId, service: 'whisper',
      units: whisperResult.duration || 0, cost_usd: whisperCost,
    });

    const segments = whisperResult.segments || [];
    const transcript = segments.map(seg =>
      `[${formatSeconds(seg.start)} - ${formatSeconds(seg.end)}] ${seg.text.trim()}`
    ).join('\n');

    if (!transcript.trim()) {
      await sb.from('streamer_jobs').update({ status: 'error', error_message: '文字起こし結果が空でした', total_cost_usd: whisperCost }).eq('id', jobId);
      return res.status(400).json({ error: '文字起こし結果が空でした。音声が含まれているか確認してください。' });
    }

    // 3. Claude API で和訳・解説生成
    await sb.from('streamer_jobs').update({ status: 'processing' }).eq('id', jobId);

    const { data: profile } = await sb.from('streamer_profiles').select('*').eq('id', profileId).single();
    const claudeResult = await analyzeClipWithClaude(jobId, profileId, profile, transcript, sb);

    // 4. 完了
    const totalCost = whisperCost + claudeResult.cost_usd;
    await sb.from('streamer_jobs').update({
      status: 'awaiting_review',
      total_cost_usd: totalCost,
    }).eq('id', jobId);

    res.json({
      job_id: jobId,
      transcript: transcript,
      transcript_length: transcript.length,
      duration_seconds: whisperResult.duration || 0,
      analysis: claudeResult.analysis,
      cost: { whisper: whisperCost, claude: claudeResult.cost_usd, total: totalCost },
    });
  } catch (err) {
    console.error('[StreamerClip] upload-and-process error:', err.message);
    if (jobId) {
      await sb.from('streamer_jobs').update({ status: 'error', error_message: err.message }).eq('id', jobId).catch(() => {});
    }
    res.status(500).json({ error: err.message });
  }
});

function formatSeconds(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── クリップ分析（和訳・解説生成） ──
async function analyzeClipWithClaude(jobId, profileId, profile, transcript, sb) {
  const config = profile.config || {};
  const concept = config.concept || {};
  const pluginConfig = config.plugin_config || {};
  const extraction = config.extraction || {};
  const pluginType = extraction.plugin || 'english_learning';

  const prompt = `あなたは海外配信者の切り抜き動画を日本人視聴者向けに翻訳・解説するエキスパートです。

【動画フォーマット】
OpusClipのFitスタイル（縦型1080x1920）で、映像の上下に空きスペースがあります。
- 下段スペース: 英語字幕 + 日本語字幕を表示
- 上段スペース: 注目ワード・スラング・難しい表現の和訳と解説を表示

以下は「${profile.display_name}」の切り抜きクリップの文字起こし（タイムスタンプ付き）です。

【チャンネルコンセプト】${concept.channel_concept || '未設定'}
【ターゲット】${concept.target_audience || '未設定'}
【トーン】${concept.tone || '未設定'}

以下のJSON形式で出力してください。JSONのみを返してください（マークダウン装飾不要）。

{
  "subtitles": [
    下段字幕データ。セリフごとに分割。
    { "start": 開始秒, "end": 終了秒, "en": "英語原文", "jp": "自然な日本語訳" }
  ],
  "top_panels": [
    上段解説パネルデータ。セリフ内で注目すべきワード・スラング・難しい表現が出てきた瞬間に表示する。
    {
      "start": 表示開始秒,
      "end": 表示終了秒,
      "word": "注目ワード（英語）",
      "reading": "発音（カタカナ）",
      "meaning": "日本語の意味（短く）",
      "note": "補足説明（スラングの由来、ニュアンス、使い方など。1〜2文）"
    }
    ※ クリップ全体で3〜6個程度。視聴者が「へぇ」となる面白い表現を優先。
  ],
  "title_jp": ["タイトル案1", "タイトル案2", "タイトル案3"],
  "description_jp": "YouTube説明文（日本語）",
  "tags": ["#タグ1", "#タグ2", ...],
  "score": 1〜10の面白さ・教育的価値スコア
}

【字幕の注意点】
- 英語は聞き取った通り自然に（フィラーやスラングもそのまま）
- 日本語訳は意訳OK、視聴者が自然に読める口語体で
- 長いセリフは2〜3行に分割して読みやすく

【上段パネルの注意点】
- スラング、イディオム、若者言葉、文化的な表現を優先的にピックアップ
- 教科書に載らないリアルな英語表現を解説
- カタカナ読みは日本人が発音しやすい形で
- 補足は短く、でもZ世代の日本人が興味を持つ内容で

---
文字起こし:
${transcript}`;

  const anthropic = await getAnthropicClient();
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content.filter(c => c.type === 'text').map(c => c.text).join('');
  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  const costUsd = (inputTokens * 3 + outputTokens * 15) / 1_000_000;

  await sb.from('streamer_cost_logs').insert({
    job_id: jobId, profile_id: profileId, service: 'claude',
    units: inputTokens + outputTokens, cost_usd: costUsd,
  });

  let analysis;
  try {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    analysis = JSON.parse(cleaned);
  } catch (parseErr) {
    throw new Error('Claude応答のJSONパースに失敗: ' + parseErr.message);
  }

  // candidatesテーブルにも保存（レビュー画面で使う）
  const titleJp = Array.isArray(analysis.title_jp) ? analysis.title_jp[0] : (analysis.title_jp || '無題');
  const { error: insertErr } = await sb.from('streamer_candidates').insert({
    job_id: jobId,
    profile_id: profileId,
    plugin_used: pluginType,
    start_seconds: 0,
    end_seconds: 0,
    score: analysis.score || 7,
    title_jp: titleJp,
    metadata: analysis,
  });
  if (insertErr) console.error('[StreamerClip] candidate insert error:', insertErr.message);

  return { analysis, cost_usd: costUsd };
}

// Claude候補抽出の共通ロジック（テキスト入力版・URL版で使用）
async function extractCandidatesWithClaude(jobId, profileId, profile, transcript, sb) {
  const config = profile.config || {};
  const concept = config.concept || {};
  const extraction = config.extraction || {};
  const pluginConfig = config.plugin_config || {};
  const pluginType = extraction.plugin || 'english_learning';

  let pluginInstructions = '';
  if (pluginType === 'english_learning') {
    pluginInstructions = `
【英語学習プラグイン指示】
- 各候補に含まれる注目英単語・フレーズを抽出し、CEFR レベル（A1〜C2）を判定
- IPA 発音記号を付与
- 日本語の意味と例文を提供
- vocabulary_target_levels: ${JSON.stringify(pluginConfig.vocabulary_target_levels || ['B1', 'B2'])}
- max_vocabulary_per_clip: ${pluginConfig.max_vocabulary_per_clip || 3}
- metadata に "vocabulary" 配列を含めること（各要素: word, ipa, meaning_jp, cefr_level, example_sentence）`;
  } else if (pluginType === 'entertainment') {
    pluginInstructions = `
【エンタメ翻訳プラグイン指示】
- 面白さ・驚き・共感ポイントを最大化する区間を選定
- 日本人視聴者にウケる文脈を優先
- リアクションの強さ、ミーム性を重視
- metadata に "highlight_quote"（原文）, "quote_jp"（日本語訳）, "reaction_type" を含めること`;
  } else if (pluginType === 'slang_focus') {
    pluginInstructions = `
【スラング解説プラグイン指示】
- AAVE やZ世代スラングに注目
- 語源・文化的背景を解説
- metadata に "slang_terms" 配列を含めること（各要素: term, origin, meaning_jp, cultural_context, usage_example）`;
  }

  const prompt = `以下は海外配信者「${profile.display_name}」の配信文字起こしです。タイムスタンプ付きです。

【チャンネルコンセプト】${concept.channel_concept || '未設定'}
【ターゲット】${concept.target_audience || '未設定'}
【トーン】${concept.tone || '未設定'}
${pluginInstructions}

【抽出条件】
- 最小クリップ長: ${extraction.min_clip_duration_seconds || 30}秒
- 最大クリップ長: ${extraction.max_clip_duration_seconds || 60}秒
- 最大候補数: ${extraction.max_candidates_per_video || 5}
- 最低スコア: ${extraction.min_score_threshold || 6}/10

以下の文字起こしから、YouTube ショート動画として切り抜くべき面白い・教育的な区間の候補を抽出し、JSON配列で返してください。

各候補のフォーマット:
{
  "start_seconds": 開始秒数,
  "end_seconds": 終了秒数,
  "score": 1〜10のスコア,
  "title_jp": "日本語タイトル案",
  "metadata": { ... プラグイン固有データ }
}

JSONのみを返してください（\`\`\`jsonなどのマークダウン装飾は不要）。

---
文字起こし:
${transcript}`;

  const anthropic = await getAnthropicClient();
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content.filter(c => c.type === 'text').map(c => c.text).join('');

  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  const costUsd = (inputTokens * 3 + outputTokens * 15) / 1_000_000;

  await sb.from('streamer_cost_logs').insert({
    job_id: jobId, profile_id: profileId, service: 'claude',
    units: inputTokens + outputTokens, cost_usd: costUsd,
  });

  let candidates = [];
  try {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    candidates = JSON.parse(cleaned);
    if (!Array.isArray(candidates)) candidates = [candidates];
  } catch (parseErr) {
    throw new Error('Claude応答のJSONパースに失敗: ' + parseErr.message);
  }

  const minScore = extraction.min_score_threshold || 6;
  const maxCount = extraction.max_candidates_per_video || 5;
  candidates = candidates.filter(c => c.score >= minScore).sort((a, b) => b.score - a.score).slice(0, maxCount);

  const rows = candidates.map(c => ({
    job_id: jobId, profile_id: profileId, plugin_used: pluginType,
    start_seconds: c.start_seconds, end_seconds: c.end_seconds,
    score: c.score, title_jp: c.title_jp, metadata: c.metadata || {},
  }));

  if (rows.length > 0) {
    const { error: insertErr } = await sb.from('streamer_candidates').insert(rows);
    if (insertErr) throw insertErr;
  }

  return { candidates: rows, cost_usd: costUsd };
}

// ── Process (テキスト入力版 - 既存互換) ──

router.post('/jobs/:id/process', async (req, res) => {
  try {
    const { transcript } = req.body;
    if (!transcript || !transcript.trim()) return res.status(400).json({ error: 'transcript（文字起こしテキスト）が必要です' });

    const sb = getSupabase();
    const { data: job, error: jobErr } = await sb
      .from('streamer_jobs')
      .select('*, streamer_profiles(display_name, config)')
      .eq('id', req.params.id)
      .single();
    if (jobErr) throw jobErr;

    // 予算チェック
    if (job.total_cost_usd >= 1.0) {
      return res.status(400).json({ error: '予算上限 $1.00 に達しています' });
    }

    // ステータス更新
    await sb.from('streamer_jobs').update({ status: 'processing' }).eq('id', req.params.id);

    const { data: profile } = await sb.from('streamer_profiles').select('*').eq('id', job.profile_id).single();
    const result = await extractCandidatesWithClaude(req.params.id, job.profile_id, profile, transcript, sb);

    // ジョブ更新
    await sb.from('streamer_jobs').update({
      status: 'awaiting_review',
      total_cost_usd: (job.total_cost_usd || 0) + result.cost_usd,
    }).eq('id', req.params.id);

    res.json({ candidates: result.candidates, cost_usd: result.cost_usd });
  } catch (err) {
    console.error('[StreamerClip] process error:', err.message);
    const sb = getSupabase();
    await sb.from('streamer_jobs').update({ status: 'error', error_message: err.message }).eq('id', req.params.id).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// ── Candidates ──

router.get('/candidates', async (req, res) => {
  try {
    const sb = getSupabase();
    let q = sb.from('streamer_candidates').select('*').order('score', { ascending: false });
    if (req.query.job_id) q = q.eq('job_id', req.query.job_id);
    if (req.query.profile_id) q = q.eq('profile_id', req.query.profile_id);
    if (req.query.status) q = q.eq('status', req.query.status);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/candidates/:id', async (req, res) => {
  try {
    const { status } = req.body;
    const sb = getSupabase();
    const update = { status };
    if (status === 'approved' || status === 'rejected') update.reviewed_at = new Date().toISOString();
    const { data, error } = await sb
      .from('streamer_candidates')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/candidates/:id/publish', async (req, res) => {
  try {
    const { youtube_video_id } = req.body;
    const sb = getSupabase();
    const now = new Date().toISOString();
    const { data, error } = await sb
      .from('streamer_candidates')
      .update({ status: 'published', youtube_video_id, published_at: now })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;

    // stats更新
    const { data: stats } = await sb.from('streamer_profile_stats').select('*').eq('profile_id', data.profile_id).single();
    if (stats) {
      await sb.from('streamer_profile_stats').update({
        total_published: (stats.total_published || 0) + 1,
        last_published_at: now,
      }).eq('profile_id', data.profile_id);
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Stats ──

router.get('/stats', async (_req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('streamer_profile_stats').select('*, streamer_profiles(display_name)');
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats/:profile_id', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('streamer_profile_stats').select('*').eq('profile_id', req.params.profile_id).single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Cost Logs ──

router.get('/cost', async (req, res) => {
  try {
    const sb = getSupabase();
    let q = sb.from('streamer_cost_logs').select('*').order('recorded_at', { ascending: false });
    if (req.query.profile_id) q = q.eq('profile_id', req.query.profile_id);
    if (req.query.job_id) q = q.eq('job_id', req.query.job_id);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
