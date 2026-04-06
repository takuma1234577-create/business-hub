/**
 * Gmail取引通知メール解析モジュール
 * 各銀行・カード会社からの取引通知メールを解析して取引データを抽出する
 */

async function getGmailClient() {
  const { getGoogleOAuth2, google } = require('../shared.cjs');
  const { getSupabase } = require('../shared.cjs');
  const supabase = getSupabase();

  const oauth2Client = getGoogleOAuth2();
  if (!oauth2Client) throw new Error('Google OAuth未設定です。設定画面からGmail認証を行ってください。');

  const { data: tokenData, error: tokenErr } = await supabase.from('oauth_tokens')
    .select('*').eq('id', 'gmail').single();
  if (tokenErr || !tokenData) throw new Error('Gmail未認証です。設定画面からGmail認証を行ってください。');

  oauth2Client.setCredentials({
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    scope: tokenData.scope,
    token_type: tokenData.token_type,
    expiry_date: Number(tokenData.expiry_date),
  });

  oauth2Client.on('tokens', async (tokens) => {
    const updates = { access_token: tokens.access_token, updated_at: new Date().toISOString() };
    if (tokens.refresh_token) updates.refresh_token = tokens.refresh_token;
    await supabase.from('oauth_tokens').update(updates).eq('id', 'gmail');
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

function getEmailBody(message) {
  let body = '';
  const parts = message.payload?.parts || [];
  if (parts.length > 0) {
    for (const part of parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        body = Buffer.from(part.body.data, 'base64url').toString('utf-8');
        break;
      }
    }
    // text/htmlフォールバック
    if (!body) {
      for (const part of parts) {
        if (part.mimeType === 'text/html' && part.body?.data) {
          const html = Buffer.from(part.body.data, 'base64url').toString('utf-8');
          body = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
          break;
        }
      }
    }
  } else if (message.payload?.body?.data) {
    body = Buffer.from(message.payload.body.data, 'base64url').toString('utf-8');
  }
  return body;
}

function getEmailDate(message) {
  const headers = message.payload?.headers || [];
  const dateHeader = headers.find(h => h.name === 'Date')?.value;
  if (!dateHeader) return null;
  try {
    return new Date(dateHeader).toISOString().split('T')[0];
  } catch {
    return null;
  }
}

function getEmailSubject(message) {
  const headers = message.payload?.headers || [];
  return headers.find(h => h.name === 'Subject')?.value || '';
}

function extractAmount(text) {
  const patterns = [
    /(?:金額|お取引金額|ご利用金額|振込金額|引落金額|お支払金額|利用金額)[：:\s]*￥?([0-9,]+)/,
    /￥([0-9,]+)/,
    /([0-9,]+)\s*円/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return parseInt(m[1].replace(/,/g, ''), 10);
  }
  return 0;
}

// =====================
// 金融機関別メールパーサー
// =====================

const INSTITUTION_PARSERS = {
  // 楽天銀行
  rakuten_bank: {
    queries: [
      'from:rakuten-bank.co.jp subject:(入出金 OR 振込 OR 引落 OR デビット)',
    ],
    parse(message) {
      const subject = getEmailSubject(message);
      const body = getEmailBody(message);
      const date = getEmailDate(message);
      const text = subject + '\n' + body;
      if (!date) return null;

      const amount = extractAmount(text);
      if (!amount) return null;

      const isDeposit = /入金|振込入金|受取|着金/.test(text);
      const isWithdraw = /出金|振込|引落|デビット|支払|ATM/.test(text) && !isDeposit;

      return {
        date,
        description: subject.replace(/【.*?】/g, '').replace(/楽天銀行/g, '').trim() || '取引',
        amount: isWithdraw ? -amount : amount,
        balanceAfter: null,
        rawData: { subject, source: 'gmail' },
      };
    },
  },

  // 楽天カード
  rakuten_card: {
    queries: [
      'from:rakuten-card.co.jp subject:(カード利用 OR 速報 OR ご利用)',
    ],
    parse(message) {
      const subject = getEmailSubject(message);
      const body = getEmailBody(message);
      const date = getEmailDate(message);
      const text = subject + '\n' + body;
      if (!date) return null;

      const amount = extractAmount(text);
      if (!amount) return null;

      // 利用店舗名を抽出
      const shopMatch = body.match(/(?:ご利用店舗|利用先)[：:\s]*(.+)/);

      return {
        date,
        description: shopMatch?.[1]?.trim() || subject.replace(/【.*?】/g, '').trim() || 'カード利用',
        amount: -amount, // カードは常に出金
        balanceAfter: null,
        rawData: { subject, source: 'gmail' },
      };
    },
  },

  // 住信SBIネット銀行
  sbi_net: {
    queries: [
      'from:netbk.co.jp subject:(入金 OR 出金 OR 振込 OR 引落 OR デビット)',
      'from:住信SBIネット銀行 subject:(入金 OR 出金 OR 振込)',
    ],
    parse(message) {
      const subject = getEmailSubject(message);
      const body = getEmailBody(message);
      const date = getEmailDate(message);
      const text = subject + '\n' + body;
      if (!date) return null;

      const amount = extractAmount(text);
      if (!amount) return null;

      const isDeposit = /入金|振込入金|受取|着金/.test(text);
      const isWithdraw = /出金|振込出金|引落|デビット|支払/.test(text) && !isDeposit;

      if (!isDeposit && !isWithdraw) return null;

      return {
        date,
        description: subject.replace(/【.*?】/g, '').replace(/住信SBIネット銀行/g, '').trim() || '取引',
        amount: isWithdraw ? -amount : amount,
        balanceAfter: null,
        rawData: { subject, source: 'gmail' },
      };
    },
  },

  // 三井住友カード
  smbc_card: {
    queries: [
      'from:smbc-card.com subject:(ご利用 OR カード利用)',
      'from:vpass subject:(ご利用)',
    ],
    parse(message) {
      const subject = getEmailSubject(message);
      const body = getEmailBody(message);
      const date = getEmailDate(message);
      const text = subject + '\n' + body;
      if (!date) return null;

      const amount = extractAmount(text);
      if (!amount) return null;

      const shopMatch = body.match(/(?:ご利用先|利用先)[：:\s]*(.+)/);

      return {
        date,
        description: shopMatch?.[1]?.trim() || subject.replace(/【.*?】/g, '').trim() || 'カード利用',
        amount: -amount,
        balanceAfter: null,
        rawData: { subject, source: 'gmail' },
      };
    },
  },
};

/**
 * Gmail経由で取引を取得する
 * @param {string} institutionCode - 金融機関コード
 * @param {string} fromDate - YYYY-MM-DD
 * @param {string} toDate - YYYY-MM-DD
 * @returns {Promise<Array>}
 */
async function fetchTransactionsViaGmail(institutionCode, fromDate, toDate) {
  const parser = INSTITUTION_PARSERS[institutionCode];
  if (!parser) throw new Error(`${institutionCode} のGmailパーサーは未対応です`);

  const gmail = await getGmailClient();
  const afterDate = fromDate.replace(/-/g, '/');
  const beforeDate = new Date(new Date(toDate).getTime() + 86400000).toISOString().split('T')[0].replace(/-/g, '/');

  const transactions = [];
  const seenIds = new Set();

  for (const baseQuery of parser.queries) {
    const q = `${baseQuery} after:${afterDate} before:${beforeDate}`;
    try {
      const listRes = await gmail.users.messages.list({ userId: 'me', q, maxResults: 200 });
      for (const msg of (listRes.data.messages || [])) {
        if (seenIds.has(msg.id)) continue;
        seenIds.add(msg.id);
        try {
          const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
          const tx = parser.parse(detail.data);
          if (tx) transactions.push(tx);
        } catch (e) {
          console.error('Email parse error:', msg.id, e.message);
        }
      }
    } catch (e) {
      console.error('Gmail search error:', e.message);
    }
  }

  // 日付順ソート
  transactions.sort((a, b) => a.date.localeCompare(b.date));
  return transactions;
}

async function isGmailAvailable() {
  try {
    const { getGoogleOAuth2 } = require('../shared.cjs');
    const { getSupabase } = require('../shared.cjs');
    const supabase = getSupabase();
    const oauth2Client = getGoogleOAuth2();
    if (!oauth2Client) return false;
    const { data } = await supabase.from('oauth_tokens').select('id').eq('id', 'gmail').single();
    return !!data;
  } catch {
    return false;
  }
}

module.exports = { fetchTransactionsViaGmail, isGmailAvailable, INSTITUTION_PARSERS };
