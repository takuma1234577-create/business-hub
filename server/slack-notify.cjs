/**
 * Slack通知モジュール
 *
 * AIが人間のエスカレーションを必要と判断した時に、Slackで担当者に通知する。
 * - Bot Token が設定されていればスレッド対応の chat.postMessage を使用
 * - なければ Incoming Webhook にフォールバック
 *
 * 環境変数:
 *   SLACK_BOT_TOKEN, SLACK_CHANNEL_ID, SLACK_SIGNING_SECRET
 *   SLACK_WEBHOOK_URL (フォールバック)
 */

const { getSupabase } = require('./shared.cjs');

function buildBlocks({ channel, customerName, customerMessage, aiDraftReply, reason, context, escalationId }) {
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '🚨 確認が必要な問い合わせ', emoji: true } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*チャネル:*\n${channel || '-'}` },
        { type: 'mrkdwn', text: `*お客様:*\n${customerName || '不明'}` },
      ],
    },
    { type: 'section', text: { type: 'mrkdwn', text: `*確認理由:*\n${reason || '-'}` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*お客様のメッセージ:*\n\`\`\`${(customerMessage || '').slice(0, 1500)}\`\`\`` } },
  ];
  if (aiDraftReply) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*AIドラフト返信:*\n\`\`\`${aiDraftReply.slice(0, 1500)}\`\`\`` } });
  }
  if (context) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: context.slice(0, 500) }] });
  }
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `💡 スレッドに対応指示を書いてください（例：「無料でMサイズ送って」「1000円クーポン発行して」）。AIが指示を分析して自動対応し、完了後にお客様へ連絡します。 *ID:* \`${escalationId || '-'}\`` }],
  });
  return blocks;
}

async function postViaBotToken(channelId, text, blocks) {
  const token = process.env.SLACK_BOT_TOKEN;
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ channel: channelId, text, blocks }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`slack chat.postMessage failed: ${json.error}`);
  return json; // { ok, ts, channel, ... }
}

async function postViaWebhook(webhookUrl, text, blocks) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, blocks }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`slack webhook failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return { ok: true };
}

/**
 * エスカレーション通知を送信し、slack_escalationsテーブルに記録
 */
async function sendSlackEscalation({ channel, customerName, customerMessage, aiDraftReply, reason, context, lineUserId, email }) {
  const supabase = getSupabase();

  // DB記録を先に作成（IDを取得するため）
  const { data: record, error: insErr } = await supabase.from('slack_escalations').insert({
    channel_type: channel || 'LINE',
    line_user_id: lineUserId || null,
    email_address: email || null,
    customer_name: customerName || null,
    original_message: customerMessage,
    ai_draft: aiDraftReply || null,
    reason: reason || null,
    status: 'pending',
  }).select().single();

  if (insErr) {
    console.error('[slack] escalation insert error:', insErr.message);
    return { ok: false, error: insErr.message };
  }

  const text = `確認が必要な問い合わせ: ${customerName || '不明'} - ${reason || ''}`;
  const blocks = buildBlocks({ channel, customerName, customerMessage, aiDraftReply, reason, context, escalationId: record.id });

  // Bot Token優先、なければWebhook
  const botToken = process.env.SLACK_BOT_TOKEN;
  const channelId = process.env.SLACK_CHANNEL_ID;
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  try {
    if (botToken && channelId) {
      const result = await postViaBotToken(channelId, text, blocks);
      // ts/channel を保存してスレッド追跡可能に
      await supabase.from('slack_escalations').update({
        slack_ts: result.ts,
        slack_channel: result.channel,
      }).eq('id', record.id);
      return { ok: true, id: record.id, ts: result.ts };
    } else if (webhookUrl) {
      await postViaWebhook(webhookUrl, text, blocks);
      return { ok: true, id: record.id, warning: 'webhook_only_no_thread_tracking' };
    } else {
      console.log('[slack] 未設定のためスキップ');
      return { ok: false, reason: 'not_configured' };
    }
  } catch (err) {
    console.error('[slack] send error:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Slackの確認メッセージを投稿（スレッド内）
 */
async function postSlackThreadReply(channelId, threadTs, text) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel: channelId, thread_ts: threadTs, text }),
    });
  } catch (err) {
    console.error('[slack] thread reply error:', err.message);
  }
}

module.exports = { sendSlackEscalation, postSlackThreadReply };
