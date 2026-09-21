/**
 * FITPEAK 公開AIチャット（Shopifyストアフロント用）
 *
 * ストアフロント右下のチャットウィジェットから呼ばれる、認証不要のエンドポイント。
 * knowledge_chunks をベクトル検索し、Claude で回答を生成する。
 *
 * ルート:
 *   POST /api/public/chat          回答生成
 *   GET  /api/public/chat/health   死活確認
 *
 * 依存:
 *   server/shared.cjs      getSupabase / getAnthropicClient
 *   server/fitpeak-rag.cjs searchKnowledge
 */

const express = require('express');
const path = require('path');
const { getAnthropicClient } = require(path.join(__dirname, 'shared.cjs'));
const { searchKnowledge } = require(path.join(__dirname, 'fitpeak-rag.cjs'));

const router = express.Router();

const CLAUDE_MODEL = 'claude-sonnet-4-5';
const MAX_HISTORY = 8;         // 直近のやり取り（user+assistant）保持数
const MAX_MESSAGE_LEN = 800;
const KNOWLEDGE_HITS = 5;
const LINE_URL = 'https://line.me/R/ti/p/@956iyppc';

// ざっくりレート制限（IPごと）
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const rateBucket = new Map();

function checkRate(ip) {
  const now = Date.now();
  const entry = rateBucket.get(ip);
  if (!entry || now - entry.start > RATE_LIMIT_WINDOW_MS) {
    rateBucket.set(ip, { start: now, count: 1 });
    return true;
  }
  entry.count += 1;
  if (rateBucket.size > 5000) rateBucket.clear();
  return entry.count <= RATE_LIMIT_MAX;
}

const SYSTEM_PROMPT = `あなたはFITPEAK公式オンラインストアのAIサポート担当です。サイト右下のチャットから、24時間お客様の質問に答えます。

## 回答ルール
1. **必ず日本語で回答する。** 中国語（簡体字・繁体字）の漢字や語彙を絶対に使わない。日本の常用漢字・JIS規格の日本語表記のみを使う。
2. 丁寧だが簡潔な「です・ます調」。**200文字以内**を目安にする。
3. 回答は必ず下記「ナレッジ情報」を根拠にする。
4. **ナレッジにない情報について、絶対に「ありません」「やっていません」等の否定をしない。** 必ず「確認いたしますので、公式LINEからご連絡いただけますか？」と案内し、needs_escalation を true にする。
5. 憶測で在庫・納期・キャンペーン内容を答えない。
6. 会話の内容に応じて、購入を後押しする一言を自然に添えてよい（押し売りはしない）。

## 薬機法・景表法の遵守（重要）
- 本製品は医療機器ではない。「痩せる」「治る」「体質が改善する」等の効果効能をうたう表現は**絶対に使わない**。
- 「体幹を動かす」「姿勢を意識しやすくなる」など、動作ベースの表現にとどめる。
- 効果に個人差がある点に触れる場合は簡潔に。
- 他社製品を根拠なく貶める表現はしない。

## エスカレーション（needs_escalation = true にするケース）
- 注文内容・配送状況・返品返金の個別対応
- 在庫数・入荷時期・お届け日数の確定情報
- キャンペーン、クーポン、値引きの可否
- ナレッジに答えがない質問
- クレーム・苦情

エスカレーション時は、お客様に公式LINE（${LINE_URL}）でのご連絡を案内してください。

## 出力形式
必ず次のJSONのみを出力する（前後に説明文をつけない）:
{"reply":"お客様への返信本文","needs_escalation":true または false}`;

function formatKnowledge(chunks) {
  if (!chunks || chunks.length === 0) return '（該当するナレッジが見つかりませんでした）';
  return chunks
    .map((c, i) => `[${i + 1}] (${c.category}) ${c.title}\n${c.content}`.trim())
    .join('\n\n---\n\n');
}

function parseReply(text) {
  const raw = String(text || '').trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      if (j && typeof j.reply === 'string') {
        return { reply: j.reply.trim(), needs_escalation: Boolean(j.needs_escalation) };
      }
    } catch (_) { /* fallthrough */ }
  }
  return { reply: raw || 'うまくお答えできませんでした。公式LINEからお問い合わせください。', needs_escalation: true };
}

router.get('/health', (_req, res) => res.json({ ok: true, model: CLAUDE_MODEL }));

router.post('/', async (req, res) => {
  try {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
    if (!checkRate(ip)) {
      return res.status(429).json({
        reply: 'お問い合わせが集中しています。少し時間をおいてお試しいただくか、公式LINEからご連絡ください。',
        needs_escalation: true,
        line_url: LINE_URL,
      });
    }

    const message = String(req.body?.message || '').trim().slice(0, MAX_MESSAGE_LEN);
    if (!message) return res.status(400).json({ error: 'message は必須です' });

    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-MAX_HISTORY) : [];
    const pageContext = String(req.body?.page || '').slice(0, 200);

    let knowledgeText;
    try {
      const chunks = await searchKnowledge(message, { limit: KNOWLEDGE_HITS });
      knowledgeText = formatKnowledge(chunks);
    } catch (err) {
      console.error('[public-chat] ナレッジ検索エラー:', err.message);
      knowledgeText = '（ナレッジ検索に失敗しました）';
    }

    const messages = [];
    for (const h of history) {
      const role = h?.role === 'assistant' ? 'assistant' : 'user';
      const content = String(h?.content || '').slice(0, MAX_MESSAGE_LEN);
      if (content) messages.push({ role, content });
    }
    messages.push({
      role: 'user',
      content:
        (pageContext ? `【お客様が見ているページ】${pageContext}\n\n` : '') +
        `【ナレッジ情報】\n${knowledgeText}\n\n【お客様のご質問】\n${message}`,
    });

    const anthropic = await getAnthropicClient();
    const resp = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      messages,
    });

    const text = (resp?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const parsed = parseReply(text);

    res.json({ ...parsed, line_url: LINE_URL });
  } catch (err) {
    console.error('[public-chat] エラー:', err);
    res.status(500).json({
      reply: '申し訳ございません、ただいま混み合っております。公式LINEからお問い合わせいただけますか？',
      needs_escalation: true,
      line_url: LINE_URL,
    });
  }
});

module.exports = router;
