/**
 * FITPEAK RAG Module
 *
 * 公式LINEのメッセージに対して、Supabase上のナレッジチャンクを
 * ベクトル検索してClaudeで回答を生成する。
 *
 * 環境変数:
 *   ANTHROPIC_API_KEY
 *   VOYAGE_API_KEY
 *   SUPABASE_URL, SUPABASE_ANON_KEY (shared.cjs経由)
 */

const { getSupabase, getAnthropicClient } = require('./shared.cjs');

const EMBEDDING_MODEL = 'voyage-3-lite'; // 512次元
const VOYAGE_EMBED_URL = 'https://api.voyageai.com/v1/embeddings';
const CLAUDE_MODEL = 'claude-sonnet-4-5';
const MAX_KNOWLEDGE_HITS = 5;
const MIN_SIMILARITY = 0.35;

const FITPEAK_SYSTEM_PROMPT = `あなたはFITPEAKの公式LINEを担当するスタッフです。

## FITPEAKについて
- Amazon・ShopifyでトレーニングギアをEC販売するブランド
- 主力商品：トレーニングベルト、パワーグリップ、リストラップ
- フィットネスアプリも開発中

## 回答ルール
1. 必ず以下のナレッジ情報を根拠に回答する
2. ナレッジにない情報は「確認してご連絡します」と答える（絶対に嘘をつかない）
3. 絵文字を適度に使い、LINEらしい温かみのあるトーンで話す
4. 200文字以内を目標に簡潔に答える
5. セール・キャンペーン情報は必ずナレッジの最新情報を参照する

## 参考ナレッジ：
{retrieved_knowledge}`;

/**
 * Voyage AI でテキストを embedding に変換する（REST直接呼び出し）
 * @param {string} text
 * @param {'query'|'document'} inputType
 * @returns {Promise<number[]>}
 */
async function embedText(text, inputType = 'query') {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error('VOYAGE_API_KEY が未設定です');

  const res = await fetch(VOYAGE_EMBED_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: text,
      model: EMBEDDING_MODEL,
      input_type: inputType,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Voyage embedding API ${res.status}: ${body}`);
  }

  const json = await res.json();
  const vec = json?.data?.[0]?.embedding;
  if (!Array.isArray(vec)) {
    throw new Error('Voyage embedding の取得に失敗しました');
  }
  return vec;
}

/**
 * ナレッジチャンクをベクトル検索
 * @param {string} query
 * @param {{ category?: string, limit?: number }} [opts]
 * @returns {Promise<Array<{id:string,category:string,title:string,content:string,similarity:number}>>}
 */
async function searchKnowledge(query, opts = {}) {
  const { category = null, limit = MAX_KNOWLEDGE_HITS } = opts;
  const embedding = await embedText(query, 'query');

  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('search_knowledge_chunks', {
    query_embedding: embedding,
    match_category: category,
    match_count: limit,
  });

  if (error) {
    throw new Error(`ナレッジ検索エラー: ${error.message}`);
  }
  return (data || []).filter((r) => r.similarity >= MIN_SIMILARITY);
}

/**
 * ナレッジ配列をプロンプトに埋め込む形式に整形
 */
function formatKnowledge(chunks) {
  if (!chunks || chunks.length === 0) {
    return '（該当するナレッジが見つかりませんでした）';
  }
  return chunks
    .map(
      (c, i) =>
        `[${i + 1}] (${c.category}) ${c.title}\n${c.content}`.trim(),
    )
    .join('\n\n---\n\n');
}

/**
 * FITPEAK担当者としての返信を生成する
 * @param {string} userMessage
 * @returns {Promise<string>}
 */
async function generateFITPEAKReply(userMessage) {
  const trimmed = (userMessage || '').trim();
  if (!trimmed) {
    return 'メッセージありがとうございます😊 ご用件を教えていただけますか？';
  }

  let knowledgeText;
  try {
    const chunks = await searchKnowledge(trimmed);
    knowledgeText = formatKnowledge(chunks);
  } catch (err) {
    console.error('[fitpeak-rag] searchKnowledge error:', err.message);
    knowledgeText = '（ナレッジ検索に失敗しました）';
  }

  const systemPrompt = FITPEAK_SYSTEM_PROMPT.replace(
    '{retrieved_knowledge}',
    knowledgeText,
  );

  const anthropic = getAnthropicClient();
  const completion = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 500,
    system: systemPrompt,
    messages: [{ role: 'user', content: trimmed }],
  });

  const textBlock = (completion.content || []).find((b) => b.type === 'text');
  const reply = textBlock?.text?.trim();
  if (!reply) {
    return '確認してご連絡します🙏';
  }
  return reply;
}

/**
 * 複数テキストを一度のAPI呼び出しで embedding に変換
 * @param {string[]} texts
 * @param {'query'|'document'} inputType
 * @returns {Promise<number[][]>}
 */
async function embedTexts(texts, inputType = 'document') {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error('VOYAGE_API_KEY が未設定です');
  if (!Array.isArray(texts) || texts.length === 0) return [];

  const res = await fetch(VOYAGE_EMBED_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: texts,
      model: EMBEDDING_MODEL,
      input_type: inputType,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Voyage embedding API ${res.status}: ${body}`);
  }

  const json = await res.json();
  const data = json?.data;
  if (!Array.isArray(data)) throw new Error('Voyage embedding 応答不正');
  return data.map(d => d.embedding);
}

module.exports = {
  generateFITPEAKReply,
  searchKnowledge,
  embedText,
  embedTexts,
};
