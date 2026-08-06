/**
 * タグ遅延配信の「AIに返信させる」モード用の、ルール単体に閉じたAI返信生成。
 *
 * FITPEAK AI（fitpeak-rag.cjs）とは異なり、特定のブランド・注文検索・在庫検索には
 * 一切依存しない汎用実装。各タグ遅延配信ルールに設定された「ナレッジベース/配信意図」
 * のみを根拠として返信し、そこから答えられない質問には憶測で答えず、
 * 「担当者が確認してご連絡します」という安全側の返信に倒す。
 */

const { getAnthropicClient } = require('./shared.cjs');
const { sendSlackEscalation } = require('./slack-notify.cjs');

const CLAUDE_MODEL = 'claude-sonnet-4-5';

const FALLBACK_REPLY = 'ご連絡ありがとうございます。担当者が内容を確認し、あらためてご連絡いたします。';

function buildSystemPrompt(knowledge, ruleName) {
  return [
    `あなたは公式LINEアカウントの自動応答担当です。以下は「${ruleName || '配信ルール'}」という自動配信メッセージに対するお客様からの返信に対応する場面です。`,
    '',
    '## このやりとりで使ってよい情報（これ以外の知識・推測は一切使わないこと）',
    knowledge && knowledge.trim() ? knowledge.trim() : '（ナレッジ未設定。挨拶・お礼など一般的な受け答えのみ行う）',
    '',
    '## 厳守事項',
    '- 上記の情報だけでは答えられない質問（商品の詳細、注文状況、金額、キャンペーンの有無など）には、絶対に推測や一般論で答えないこと。',
    '- 答えられない場合は必ず reply を「担当者が確認してご連絡します」という趣旨の一文にし、needs_escalation を true にすること。',
    '- 存在しない制度・キャンペーン・保証などを勝手に作って案内しないこと。',
    '- 敬語・丁寧な文体で、簡潔に（3文以内を目安に）返信すること。',
    '- 絵文字は使わないこと。',
    '',
    '## 出力形式',
    '以下のJSON形式のみを出力すること（前後に説明文やコードフェンスを付けない）。',
    '{"reply": "返信文", "needs_escalation": boolean, "escalation_reason": "エスカレーションが必要な理由（不要ならnull）"}',
  ].join('\n');
}

/**
 * @param {string} userMessage お客様からの返信テキスト
 * @param {{ knowledge?: string, ruleName?: string, chatHistory?: Array<{role:string, content:string}> }} ctx
 * @returns {Promise<{ reply: string, needsEscalation: boolean, escalationReason: string }>}
 */
async function generateTagReplyAI(userMessage, ctx = {}) {
  const trimmed = (userMessage || '').trim();
  if (!trimmed) {
    return { reply: FALLBACK_REPLY, needsEscalation: false, escalationReason: '' };
  }

  const systemPrompt = buildSystemPrompt(ctx.knowledge, ctx.ruleName);
  const messages = [];
  if (Array.isArray(ctx.chatHistory)) {
    for (const m of ctx.chatHistory) {
      if (m && m.role && m.content) messages.push({ role: m.role, content: m.content });
    }
  }
  messages.push({ role: 'user', content: trimmed });
  while (messages.length > 1 && messages[0].role !== 'user') messages.shift();

  let reply = FALLBACK_REPLY;
  let needsEscalation = false;
  let escalationReason = '';

  try {
    const anthropic = await getAnthropicClient();
    const completion = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 500,
      system: systemPrompt,
      messages,
    });
    const textBlock = (completion.content || []).find((b) => b.type === 'text');
    const raw = (textBlock?.text || '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.reply) reply = String(parsed.reply).trim();
      needsEscalation = !!parsed.needs_escalation;
      escalationReason = parsed.escalation_reason || '';
    } else if (raw) {
      reply = raw;
    }
  } catch (err) {
    console.error('[tag-reply-ai] generation error:', err.message);
    // 生成に失敗した場合も、それらしい返信を捏造せず安全側の定型文にする
    reply = FALLBACK_REPLY;
    needsEscalation = true;
    escalationReason = `AI生成エラー: ${err.message}`;
  }

  if (needsEscalation) {
    sendSlackEscalation({
      channel: 'LINE',
      customerName: ctx.customerName || '',
      customerMessage: trimmed,
      aiDraftReply: reply,
      reason: escalationReason || `タグ遅延配信AI返信(${ctx.ruleName || ''})が回答できず`,
      lineUserId: ctx.lineUserId || null,
    }).catch((err) => console.error('[tag-reply-ai] slack notify error:', err.message));
  }

  return { reply, needsEscalation, escalationReason };
}

module.exports = { generateTagReplyAI };
