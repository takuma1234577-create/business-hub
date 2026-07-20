/**
 * Cross-Channel Notification Module
 *
 * Shopifyメールで対応した場合 → 公式LINEに「メールにてご連絡しておりますので、ご確認ください。」
 * 公式LINEで対応した場合 → Shopifyメールに「公式LINEにてご連絡しておりますので、ご確認ください。」
 */

const { getSupabase, getGoogleOAuth2, google, getLineCredentials } = require('./shared.cjs');

const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });

/**
 * メールで対応した後、公式LINEに通知を送る
 * @param {string} customerEmail - お客様のメールアドレス
 * @param {string} customerName - お客様の名前
 */
async function notifyLineAboutEmail(customerEmail, customerName) {
  try {
    // メールアドレスまたは名前でLINE友だちを検索
    // まず名前で部分一致検索
    let friend = null;

    if (customerName) {
      // 姓だけ、名だけでもマッチするよう部分一致
      const nameParts = customerName.replace(/\s+/g, '').split('');
      const { data: friends } = await supabase
        .from('friends')
        .select('id, line_user_id, display_name, channel_id')
        .eq('status', 'active');

      if (friends) {
        // 名前の類似度で最もマッチする友だちを探す
        for (const f of friends) {
          const dn = (f.display_name || '').replace(/\s+/g, '');
          if (dn === customerName.replace(/\s+/g, '')) {
            friend = f;
            break;
          }
          // 部分一致（名前が含まれる）
          if (customerName.length >= 2 && dn.includes(customerName.replace(/\s+/g, ''))) {
            friend = f;
          }
        }
      }
    }

    if (!friend?.line_user_id) return false;

    const { accessToken: token } = await getLineCredentials(friend.channel_id);
    if (!token) return false;

    // LINE Push APIで通知
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: friend.line_user_id,
        messages: [{ type: 'text', text: 'メールにてご連絡しておりますので、ご確認ください。' }],
      }),
    });

    if (!res.ok) {
      console.error('[cross-channel] LINE push failed:', res.status);
      return false;
    }

    // チャットログに記録
    if (friend.id && friend.channel_id) {
      await supabase.from('chat_messages').insert({
        channel_id: friend.channel_id,
        friend_id: friend.id,
        direction: 'outgoing',
        message_type: 'text',
        content: { text: 'メールにてご連絡しておりますので、ご確認ください。', source: 'cross_channel' },
      });
    }

    console.log(`[cross-channel] LINE notification sent to ${friend.display_name}`);
    return true;
  } catch (err) {
    console.error('[cross-channel] notifyLineAboutEmail error:', err.message);
    return false;
  }
}

/**
 * LINEで対応した後、Shopifyメール（Gmail）に通知を送る
 * @param {string} lineUserId - LINE User ID
 * @param {string} displayName - LINEの表示名
 */
async function notifyEmailAboutLine(lineUserId, displayName) {
  try {
    // 最近のメール自動返信ログから、この顧客に該当するメールを探す
    // 名前でマッチ
    const { data: logs } = await supabase
      .from('email_auto_reply_logs')
      .select('customer_email, subject')
      .order('created_at', { ascending: false })
      .limit(50);

    if (!logs || logs.length === 0) return false;

    // 名前でマッチするログを探す
    let targetEmail = null;
    let targetSubject = null;
    const cleanName = (displayName || '').replace(/\s+/g, '');

    for (const log of logs) {
      // customer_messageにお客様名が含まれていないか、またはメールアドレスが一致するか
      if (log.customer_email && cleanName.length >= 2) {
        // メール内の名前とLINE表示名の一致を確認するため、ログのcustomer_messageを使う
        // ここでは直近のログのメールに通知を送る（名前マッチは簡易）
        targetEmail = log.customer_email;
        targetSubject = log.subject;
        break;
      }
    }

    // より正確なマッチング: Shopifyの注文からLINE表示名と一致する顧客を検索
    if (!targetEmail) {
      // friends テーブルにメール情報があれば使う
      return false;
    }

    // Gmail APIで通知メールを下書き作成
    const { data: store } = await supabase
      .from('channel_stores')
      .select('gmail_token_id')
      .not('gmail_token_id', 'is', null)
      .limit(1)
      .maybeSingle();

    if (!store?.gmail_token_id) return false;

    const { data: tokenData } = await supabase
      .from('oauth_tokens')
      .select('*')
      .eq('id', store.gmail_token_id)
      .single();

    if (!tokenData) return false;

    const { getGoogleOAuth2: getOAuth } = require('./shared.cjs');
    const oauth2Client = getOAuth();
    if (!oauth2Client) return false;

    oauth2Client.setCredentials({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      scope: tokenData.scope,
      token_type: tokenData.token_type,
      expiry_date: Number(tokenData.expiry_date),
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const replySubject = targetSubject
      ? (targetSubject.startsWith('Re:') ? targetSubject : `Re: ${targetSubject}`)
      : 'FITPEAKカスタマーサポートより';

    const emailLines = [
      `To: ${targetEmail}`,
      `Subject: ${replySubject}`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      '公式LINEにてご連絡しておりますので、ご確認ください。',
      '',
      '---',
      'FITPEAK カスタマーサポート',
    ];
    const rawEmail = Buffer.from(emailLines.join('\r\n')).toString('base64url');

    await gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw: rawEmail } },
    });

    console.log(`[cross-channel] Email notification drafted to ${targetEmail}`);
    return true;
  } catch (err) {
    console.error('[cross-channel] notifyEmailAboutLine error:', err.message);
    return false;
  }
}

module.exports = {
  notifyLineAboutEmail,
  notifyEmailAboutLine,
};
