/**
 * インフルエンサー・ギフティング エージェント Module
 *
 * FITPEAKの商品をインフルエンサーへギフティングする一連の業務を自動化する。
 *   ① リサーチ  : インフルエンサーDB API(Modash) または手動インポートで候補を収集
 *   ② 選定      : フォロワー数/エンゲージ率/ジャンル適合をClaudeがスコアリング
 *   ③ 文章送信  : パーソナライズしたギフト提案文を生成 → Gmailで送信(承認ゲート付き)
 *                 Instagram DMは規約/BANリスク回避のため「下書き生成」まで
 *   ④ 返信対応  : 受信メールをClaudeが解釈し、住所ヒアリング返信を自動生成/送信
 *   ⑤ FBA発送   : 収集した住所へ Amazon MCF(Multi-Channel Fulfillment) で自動発送(承認ゲート付き)
 *
 * 安全設計（ユーザー選択: 承認ゲート付き自動）:
 *   - リサーチ/選定/文面生成/返信生成 は全自動
 *   - 「送信」と「FBA発送」は既定で承認制(mode='approval')。管理画面で一括承認。
 *   - send_mode='auto' / ship_mode='auto' でcron全自動送信/発送も可能（信頼運用時のみ）
 *
 * 依存: shared.cjs (Supabase/Anthropic/Gmail), amazon.cjs (getAccessToken → SP-API/MCF)
 *
 * エンドポイント (/api/gifting):
 *   GET  /settings                     設定取得
 *   PUT  /settings                     設定更新
 *   GET  /candidates?stage=...         候補一覧
 *   POST /research                     ①リサーチ実行（手動トリガー）
 *   POST /import                       手動で候補リストを投入
 *   POST /score                        ②未スコアの候補を採点
 *   POST /candidates/:id/select        候補を選定(queued)へ
 *   POST /candidates/:id/reject        候補を除外
 *   POST /draft-outreach               ③選定済み候補の提案文を生成(pending)
 *   GET  /messages?candidate_id=...    メッセージ履歴
 *   PUT  /messages/:id                 下書き編集
 *   POST /messages/:id/send            ③承認して送信
 *   POST /check-replies                ④受信返信をチェックし対応
 *   GET  /shipments?status=...         発送一覧
 *   POST /candidates/:id/prepare-ship  ⑤発送を準備(pending_approval)
 *   POST /shipments/:id/approve        ⑤承認してMCF発送
 *   GET  /stats                        集計
 *   GET  /cron                         日次: enabled時にパイプラインを回す
 */

const express = require('express');
const router = express.Router();

const { getSupabase, getAnthropicClient, getGoogleAuthClient, google } = require('./shared.cjs');
const { getAccessToken } = require('./amazon.cjs');

const CLAUDE_MODEL = 'claude-sonnet-4-5';
const GMAIL_SENDER = 'takuma1234577@gmail.com';
const BASE_URL = process.env.BUSINESS_HUB_URL || 'https://business-hub-beige.vercel.app';

// 公開の住所入力フォームURL
function addressFormUrl(token) {
  return `${BASE_URL}/gift-address?t=${token}`;
}
function genToken() {
  return require('crypto').randomBytes(24).toString('base64url');
}

// ── 設定 ──────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  id: 'default',
  enabled: false,
  research_mode: 'manual',   // db_api | manual（Cowork中心の既定）
  send_mode: 'auto',         // approval | auto（メールは送信まで自動が既定）
  ship_mode: 'approval',     // approval | auto（発送はコストが絡むため承認制が既定）
  daily_research_limit: 20,
  daily_send_limit: 15,
  min_followers: 5000,
  max_followers: 300000,
  min_engagement: 1.5,
  target_niches: 'フィットネス,筋トレ,ボディメイク,トレーニング,健康,ジム',
  target_country: 'JP',
  platforms: 'instagram',
  product_sku: '',
  product_name: 'FITPEAK トレーニングギア',
  gift_qty: 1,
  from_name: 'FITPEAK',
  email_subject: '【FITPEAK】商品ギフトのご提案',
  gift_message_instructions: '',
  reply_instructions: '',
  min_score: 0.6,
};

async function getSettings() {
  const sb = getSupabase();
  const { data } = await sb.from('gifting_settings').select('*').eq('id', 'default').maybeSingle();
  return { ...DEFAULT_SETTINGS, ...(data || {}) };
}

// api_keys から任意サービスのキーを復号取得（shared._decryptApiKey と同一方式）
function decryptApiKey(encrypted) {
  const crypto = require('crypto');
  const secret = process.env.BANK_CREDENTIAL_ENCRYPTION_KEY || process.env.SUPABASE_ANON_KEY || 'default-key';
  const key = crypto.scryptSync(secret, 'api-keys-salt', 32);
  const { iv, data, tag } = JSON.parse(encrypted);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  let out = decipher.update(data, 'hex', 'utf8');
  out += decipher.final('utf8');
  return out;
}

async function getModashKey() {
  const sb = getSupabase();
  const { data } = await sb.from('api_keys').select('api_key_encrypted').eq('id', 'modash').eq('is_active', true).maybeSingle();
  if (data?.api_key_encrypted) {
    try { return decryptApiKey(data.api_key_encrypted); } catch { /* fall through */ }
  }
  return process.env.MODASH_API_KEY || null;
}

// ============================================================
// ① リサーチ: Modash Discovery API でインフルエンサー候補を収集
// ============================================================
// Modash未設定なら例外を投げ、呼び出し側で手動インポートを促す。
async function researchViaModash(settings, limit) {
  const apiKey = await getModashKey();
  if (!apiKey) {
    const err = new Error('MODASH_API_KEY が未設定です。API設定でModashキーを登録するか、手動インポートをご利用ください。');
    err.code = 'NO_MODASH_KEY';
    throw err;
  }

  const platform = (settings.platforms || 'instagram').split(',')[0].trim() || 'instagram';
  const niches = (settings.target_niches || '').split(',').map((s) => s.trim()).filter(Boolean);

  // Modash Discovery API: POST /v1/{platform}/search
  const body = {
    page: 0,
    sort: { field: 'followers', direction: 'desc' },
    filter: {
      influencer: {
        followers: { min: settings.min_followers || 0, max: settings.max_followers || 10000000 },
        engagementRate: (settings.min_engagement || 0) / 100,
        location: [], // 数値ID要求のため名称ではなくフリーワードでニッチ補完
        relevance: niches.map((n) => `#${n}`),
        language: settings.target_country === 'JP' ? 'ja' : undefined,
      },
    },
  };

  const resp = await fetch(`https://api.modash.io/v1/${platform}/search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`Modash検索失敗 ${resp.status}: ${t.slice(0, 300)}`);
  }
  const json = await resp.json();
  const results = (json.lookalikes || json.results || json.data || []).slice(0, limit);

  return results.map((r) => {
    const p = r.profile || r;
    return {
      source: 'modash',
      platform,
      handle: p.username || p.handle || '',
      profile_url: p.url || (p.username ? `https://www.${platform}.com/${p.username}` : null),
      full_name: p.fullname || p.fullName || p.name || null,
      email: (p.contacts || []).find((c) => c.type === 'email')?.value || p.email || null,
      followers: p.followers || p.followerCount || null,
      engagement_rate: p.engagementRate != null ? Number((p.engagementRate * 100).toFixed(2)) : null,
      avg_views: p.avgViews || p.averageViews || null,
      niche: niches.join('/') || null,
      country: p.country || settings.target_country || null,
      bio: p.bio || null,
      meta: r,
    };
  }).filter((c) => c.handle);
}

// 候補をUPSERT（重複はplatform+handleで排除）。新規追加数を返す。
async function upsertCandidates(rows) {
  if (!rows || rows.length === 0) return { inserted: 0, candidates: [] };
  const sb = getSupabase();
  const inserted = [];
  for (const row of rows) {
    const { data: existing } = await sb.from('gifting_candidates')
      .select('id').eq('platform', row.platform).eq('handle', row.handle).maybeSingle();
    if (existing) continue;
    const { data, error } = await sb.from('gifting_candidates')
      .insert({ ...row, stage: 'researched', updated_at: new Date().toISOString() })
      .select().single();
    if (!error && data) inserted.push(data);
  }
  return { inserted: inserted.length, candidates: inserted };
}

// ============================================================
// ② 選定: Claudeでフィット度をスコアリング
// ============================================================
const SCORING_SYSTEM = `あなたはFITPEAK（フィットネス/筋トレ系ギア・サプリのD2Cブランド）のインフルエンサー・マーケティング担当です。
与えられたインフルエンサー候補が「FITPEAKの商品をギフティングして紹介してもらう相手」としてどれだけ適切かを評価します。

## FITPEAK
- トレーニングギア（リストラップ/パワーグリップ/トレーニングベルト/ニースリーブ 等）とサプリ/健康食品を Amazon・公式サイトで販売
- ターゲット: 筋トレ・ボディメイク・ジム通い・健康志向の20〜40代

## 評価観点
- ジャンル適合（フィットネス/筋トレ/健康/ボディメイク/食トレ 等に強いほど高い）
- フォロワー規模（マイクロ〜ミドルが費用対効果高。数百万の大型は優先度中）
- エンゲージメント率（高いほど良い。1.5%以上が目安）
- 商業利用のしやすさ（連絡先=email がある方が全自動送信でき高評価）
- ブランド毀損リスク（過度な炎上/アンチ多め/ジャンル不一致は減点）

## 出力（JSONのみ。前後に文章を書かない）
{"score":0.0〜1.0,"fit_segment":"マイクロ筋トレ系 等の一言","reasoning":"社内向けの簡潔な根拠","recommend":true/false}`;

async function scoreCandidate(anthropic, settings, c) {
  const userMsg = `# 候補
プラットフォーム: ${c.platform}
ハンドル: @${c.handle}
氏名: ${c.full_name || '不明'}
フォロワー: ${c.followers ?? '不明'}
エンゲージ率: ${c.engagement_rate != null ? c.engagement_rate + '%' : '不明'}
平均再生: ${c.avg_views ?? '不明'}
ジャンル: ${c.niche || '不明'}
国: ${c.country || '不明'}
連絡先email: ${c.email ? 'あり' : 'なし'}
bio: ${(c.bio || '').slice(0, 400)}

# 選定基準
最低スコア(推奨閾値): ${settings.min_score}
狙うニッチ: ${settings.target_niches}
${settings.gift_message_instructions ? '補足指示: ' + settings.gift_message_instructions : ''}`;

  const resp = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 500,
    system: SCORING_SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
  });
  const text = resp.content?.[0]?.text || '{}';
  const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  return parsed;
}

async function scoreUnscored(limit = 50) {
  const sb = getSupabase();
  const settings = await getSettings();
  const anthropic = await getAnthropicClient();
  const { data: rows } = await sb.from('gifting_candidates')
    .select('*').eq('stage', 'researched').is('score', null)
    .order('created_at', { ascending: true }).limit(limit);
  if (!rows || rows.length === 0) return { scored: 0, selected: 0 };

  let scored = 0, selected = 0;
  for (const c of rows) {
    try {
      const r = await scoreCandidate(anthropic, settings, c);
      const passes = Number(r.score) >= Number(settings.min_score) && r.recommend !== false;
      await sb.from('gifting_candidates').update({
        score: r.score,
        fit_segment: r.fit_segment || null,
        score_reasoning: r.reasoning || null,
        stage: passes ? 'selected' : 'rejected',
        updated_at: new Date().toISOString(),
      }).eq('id', c.id);
      scored++;
      if (passes) selected++;
    } catch (e) {
      console.error(`[gifting] score error @${c.handle}:`, e.message);
    }
  }
  return { scored, selected };
}

// ============================================================
// ③ 文章送信: 提案文の生成 & Gmail送信
// ============================================================
const OUTREACH_SYSTEM = `あなたはFITPEAK（フィットネス/筋トレ系ギアのD2Cブランド）のトップのインフルエンサー・ギフティング担当です。
返信率・受け取り率が最大化されるよう、行動心理を踏まえた高コンバージョンの打診メッセージを日本語で作成します。

## FITPEAK
- Amazon・公式サイトでトレーニングギアを販売するブランド
- 公式: https://fitpeak.co/

## 高コンバージョンの構成（この順序で自然に）
1. フック: 相手の発信/種目に具体的に触れ「あなたを見て連絡した」感を出す（テンプレ感を消す）
2. 用件を短く: 「商品を無償でお送りしたい」を早めに明示（相手の時間を奪わない）
3. 社会的証明: 補足指示で与えられた実績（販売数・高評価・レビュー数など）を"数字"で1〜2点、押し付けずに信頼づけとして入れる
4. 低圧オファー: 投稿は必須ではない/気に入れば紹介いただけると嬉しい、という低プレッシャー。ステマにならないようPR表記のお願いは丁寧に一言
5. 単一CTA: 発送先はフォームから入力いただく旨を明記し、行動を1つに絞る（返信で住所を書く必要はない旨も添える）

## ルール
- email本文には必ずプレースホルダ {address_form_url} を1回だけ含める（システムが実URLに置換）
- 件名は開封したくなる具体性（実績や"無償"を匂わせる）。ただし煽りすぎない
- email本文は250〜400字、絵文字なし、署名は「FITPEAK ${'{from_name}'}」
- 誇大表現・医療的効果の断定はしない。与えられていない数字を捏造しない
- dm用(下書き): 120〜180字、カジュアル寄り、絵文字なし、フォームURLは入れない（DMは人力送信のため）

## 出力（JSONのみ）
{"email_subject":"件名","email_body":"メール本文(署名まで含む)","dm_draft":"Instagram DM用の短い下書き"}`;

async function generateOutreach(anthropic, settings, c) {
  const userMsg = `# 送り先インフルエンサー
@${c.handle}（${c.platform}） / ${c.full_name || '氏名不明'}
ジャンル: ${c.niche || c.fit_segment || '不明'} / フォロワー: ${c.followers ?? '不明'}
bio: ${(c.bio || '').slice(0, 300)}

# 提供する商品
${settings.product_name}

# 送信元
差出人名: ${settings.from_name}
${settings.gift_message_instructions ? '補足指示: ' + settings.gift_message_instructions : ''}`;

  const resp = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 900,
    system: OUTREACH_SYSTEM.replace('${from_name}', settings.from_name),
    messages: [{ role: 'user', content: userMsg }],
  });
  const text = resp.content?.[0]?.text || '{}';
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
}

// 選定済み(selected)候補の提案文を生成し、gifting_messagesにpendingで積む。
async function draftOutreachForSelected(limit) {
  const sb = getSupabase();
  const settings = await getSettings();
  const anthropic = await getAnthropicClient();
  const { data: rows } = await sb.from('gifting_candidates')
    .select('*').eq('stage', 'selected')
    .order('score', { ascending: false }).limit(limit || settings.daily_send_limit);
  if (!rows || rows.length === 0) return { drafted: 0 };

  let drafted = 0;
  for (const c of rows) {
    try {
      const out = await generateOutreach(anthropic, settings, c);

      // 住所入力フォーム用トークンを用意（候補ごとに1つ）
      let token = c.address_token;
      if (!token) {
        token = genToken();
        await sb.from('gifting_candidates').update({ address_token: token }).eq('id', c.id);
      }
      const formUrl = addressFormUrl(token);

      // email本文にフォームURLを反映（プレースホルダ置換。無ければ末尾に追記）
      let emailBody = out.email_body || '';
      if (emailBody.includes('{address_form_url}')) {
        emailBody = emailBody.replace(/\{address_form_url\}/g, formUrl);
      } else {
        emailBody += `\n\n▼商品のお届け先はこちらのフォームからご入力ください（ご返信は不要です）\n${formUrl}`;
      }

      // email下書き
      await sb.from('gifting_messages').insert({
        candidate_id: c.id,
        channel: 'email',
        direction: 'outbound',
        subject: out.email_subject || settings.email_subject,
        body: emailBody,
        status: c.email ? 'pending' : 'draft', // emailが無ければ送信不可なのでdraft
      });
      // DM下書き（送信は人力。参照用に保存）
      if (out.dm_draft) {
        await sb.from('gifting_messages').insert({
          candidate_id: c.id, channel: 'dm_draft', direction: 'outbound',
          subject: null, body: out.dm_draft, status: 'draft',
        });
      }
      await sb.from('gifting_candidates').update({ stage: 'queued', updated_at: new Date().toISOString() }).eq('id', c.id);
      drafted++;
    } catch (e) {
      console.error(`[gifting] outreach draft error @${c.handle}:`, e.message);
    }
  }
  return { drafted };
}

// Gmail送信。応答の threadId/messageId を返す。
async function sendGmail({ to, subject, body }) {
  const auth = await getGoogleAuthClient('gmail');
  const gmail = google.gmail({ version: 'v1', auth });
  const emailContent = [
    `To: ${to}`,
    `From: ${GMAIL_SENDER}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body,
  ].join('\r\n');
  const raw = Buffer.from(emailContent).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const { data } = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  return { threadId: data.threadId, messageId: data.id };
}

// 1件のメッセージ(email)を送信し、候補stageをcontactedに進める。
async function sendMessage(msg) {
  const sb = getSupabase();
  const { data: c } = await sb.from('gifting_candidates').select('*').eq('id', msg.candidate_id).maybeSingle();
  if (!c) throw new Error('候補が見つかりません');
  if (!c.email) throw new Error(`@${c.handle} にはメールアドレスがありません（DMは手動送信してください）`);

  const { threadId, messageId } = await sendGmail({ to: c.email, subject: msg.subject, body: msg.body });

  const { data: updated } = await sb.from('gifting_messages').update({
    status: 'sent', sent_at: new Date().toISOString(),
    gmail_thread_id: threadId, gmail_message_id: messageId, error: null,
  }).eq('id', msg.id).select().single();

  await sb.from('gifting_candidates').update({
    stage: 'contacted', last_contacted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', c.id);

  return updated;
}

// ============================================================
// ④ 返信対応: 受信メールを解釈し、住所ヒアリング/お礼を自動返信
// ============================================================
const REPLY_SYSTEM = `あなたはFITPEAKのインフルエンサー・ギフティング担当です。ギフティング打診メールへの相手からの返信を読み、次の対応を決めます。

## 判断
- interested: 相手がギフト受け取りに前向きか（true/false/unknown）
- has_address: 返信文に「配送に使える住所（氏名/郵便番号/住所）」が十分含まれるか
- 住所が含まれる場合は分解して address に格納（日本の住所前提。国コードはJP）
- 返信本文 reply_body を作成:
    - 前向きだが住所未提供 → 丁寧にお礼し、発送のため氏名/郵便番号/住所のご返信を依頼
    - 住所提供済み → お礼し、発送手配する旨を伝える（250字以内・絵文字なし・署名FITPEAK）
    - 辞退/不要 → 丁寧にお礼して終了（should_close=true）

## 出力（JSONのみ）
{"interested":"true|false|unknown","has_address":true/false,
 "address":{"recipient_name":"","postal_code":"","address_line1":"","address_line2":"","city":"","state_or_region":""},
 "should_close":false,"reply_body":"返信本文(署名まで)"}`;

// contacted/replied/address_pending 状態の候補について、Gmailスレッドの新着返信を取得して対応する。
async function checkReplies(limit = 30) {
  const sb = getSupabase();
  const settings = await getSettings();
  const auth = await getGoogleAuthClient('gmail');
  const gmail = google.gmail({ version: 'v1', auth });
  const anthropic = await getAnthropicClient();

  // 直近で送信済みのemailメッセージ（thread付き）を対象に
  const { data: sentMsgs } = await sb.from('gifting_messages')
    .select('*').eq('channel', 'email').eq('direction', 'outbound').eq('status', 'sent')
    .not('gmail_thread_id', 'is', null)
    .order('sent_at', { ascending: false }).limit(limit);
  if (!sentMsgs || sentMsgs.length === 0) return { checked: 0, replied: 0, addresses: 0 };

  let checked = 0, replied = 0, addresses = 0;
  for (const sm of sentMsgs) {
    try {
      const { data: c } = await sb.from('gifting_candidates').select('*').eq('id', sm.candidate_id).maybeSingle();
      if (!c || ['shipped', 'declined', 'address_collected', 'ship_pending'].includes(c.stage)) continue;

      const thread = await gmail.users.threads.get({ userId: 'me', id: sm.gmail_thread_id, format: 'full' });
      const msgs = thread.data.messages || [];
      // 相手からの受信（自分がFromでない）で、送信より後のものを探す
      const inbound = msgs.filter((m) => {
        const from = (m.payload.headers || []).find((h) => h.name.toLowerCase() === 'from')?.value || '';
        const isSelf = from.includes(GMAIL_SENDER);
        const after = Number(m.internalDate) > new Date(sm.sent_at).getTime();
        return !isSelf && after;
      });
      checked++;
      if (inbound.length === 0) continue;

      const last = inbound[inbound.length - 1];
      const bodyText = extractPlainText(last.payload);
      // 既に取り込み済みの受信は二重処理しない
      const { data: dup } = await sb.from('gifting_messages')
        .select('id').eq('candidate_id', c.id).eq('direction', 'inbound').eq('gmail_message_id', last.id).maybeSingle();
      if (dup) continue;

      // 受信を記録
      await sb.from('gifting_messages').insert({
        candidate_id: c.id, channel: 'email', direction: 'inbound',
        body: bodyText.slice(0, 5000), status: 'received',
        gmail_thread_id: sm.gmail_thread_id, gmail_message_id: last.id, sent_at: new Date(Number(last.internalDate)).toISOString(),
      });
      replied++;

      // Claudeで解釈
      const resp = await anthropic.messages.create({
        model: CLAUDE_MODEL, max_tokens: 800, system: REPLY_SYSTEM,
        messages: [{ role: 'user', content: `# これまでの打診メール\n${sm.body}\n\n# 相手からの返信\n${bodyText.slice(0, 3000)}\n\n${settings.reply_instructions ? '補足: ' + settings.reply_instructions : ''}` }],
      });
      const text = resp.content?.[0]?.text || '{}';
      const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));

      if (parsed.interested === 'false' || parsed.should_close) {
        await sb.from('gifting_candidates').update({ stage: 'declined', updated_at: new Date().toISOString() }).eq('id', c.id);
        // 締めの返信（任意）
        if (parsed.reply_body) await queueOrSendReply(settings, c, sm, parsed.reply_body);
        continue;
      }

      if (parsed.has_address && parsed.address) {
        const a = parsed.address;
        await sb.from('gifting_candidates').update({
          stage: 'address_collected',
          recipient_name: a.recipient_name || c.full_name || null,
          postal_code: a.postal_code || null,
          address_line1: a.address_line1 || null,
          address_line2: a.address_line2 || null,
          city: a.city || null,
          state_or_region: a.state_or_region || null,
          country_code: 'JP',
          updated_at: new Date().toISOString(),
        }).eq('id', c.id);
        addresses++;
        if (parsed.reply_body) await queueOrSendReply(settings, c, sm, parsed.reply_body);
      } else {
        // 前向きだが住所未収集 → 住所依頼返信
        await sb.from('gifting_candidates').update({ stage: 'address_pending', updated_at: new Date().toISOString() }).eq('id', c.id);
        if (parsed.reply_body) await queueOrSendReply(settings, c, sm, parsed.reply_body);
      }
    } catch (e) {
      console.error(`[gifting] reply check error msg=${sm.id}:`, e.message);
    }
  }
  return { checked, replied, addresses };
}

// 返信メッセージを記録し、send_mode=autoなら即送信、approvalならpendingで保存。
async function queueOrSendReply(settings, candidate, originalMsg, replyBody) {
  const sb = getSupabase();
  const subject = originalMsg.subject ? `Re: ${originalMsg.subject}` : `Re: ${settings.email_subject}`;
  const autoSend = settings.send_mode === 'auto';
  const { data: rec } = await sb.from('gifting_messages').insert({
    candidate_id: candidate.id, channel: 'email', direction: 'outbound',
    subject, body: replyBody, status: autoSend ? 'pending' : 'draft',
  }).select().single();
  if (autoSend && candidate.email) {
    try { await sendMessage(rec); } catch (e) { console.error('[gifting] auto reply send失敗:', e.message); }
  }
}

// Gmail payloadから本文プレーンテキストを抽出
function extractPlainText(payload) {
  if (!payload) return '';
  const decode = (d) => Buffer.from((d || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decode(payload.body.data);
  if (payload.parts) {
    // text/plain優先、なければ最初のテキスト
    const plain = payload.parts.find((p) => p.mimeType === 'text/plain');
    if (plain?.body?.data) return decode(plain.body.data);
    for (const p of payload.parts) {
      const t = extractPlainText(p);
      if (t) return t;
    }
  }
  if (payload.body?.data) return decode(payload.body.data);
  return '';
}

// ============================================================
// ⑤ FBA(MCF)発送
// ============================================================
// 住所収集済み候補の発送レコードを作成（pending_approval）。ship_mode=autoなら即発送。
async function prepareShipment(candidateId) {
  const sb = getSupabase();
  const settings = await getSettings();
  const { data: c } = await sb.from('gifting_candidates').select('*').eq('id', candidateId).maybeSingle();
  if (!c) throw new Error('候補が見つかりません');
  if (!c.address_line1 || !c.postal_code) throw new Error('配送先住所が未収集です');
  if (!settings.product_sku) throw new Error('発送するSKU(product_sku)が設定で未指定です');

  // 既存の未完了発送があれば再利用
  const { data: existing } = await sb.from('gifting_shipments')
    .select('*').eq('candidate_id', c.id).in('status', ['pending_approval', 'submitted']).maybeSingle();
  if (existing) return existing;

  const { data: ship } = await sb.from('gifting_shipments').insert({
    candidate_id: c.id,
    sku: settings.product_sku,
    quantity: settings.gift_qty || 1,
    recipient_name: c.recipient_name || c.full_name,
    postal_code: c.postal_code,
    address_line1: c.address_line1,
    address_line2: c.address_line2,
    city: c.city,
    state_or_region: c.state_or_region,
    country_code: c.country_code || 'JP',
    status: 'pending_approval',
  }).select().single();

  await sb.from('gifting_candidates').update({ stage: 'ship_pending', updated_at: new Date().toISOString() }).eq('id', c.id);
  return ship;
}

// MCFへ発送依頼を送信（承認後 / autoモード両方から使用）。二重発送ガード付き。
async function submitShipment(shipment) {
  const sb = getSupabase();
  const axios = require('axios');
  if (shipment.mcf_order_id) throw new Error(`この発送は既にMCF依頼済みです (${shipment.mcf_order_id})`);

  const { token, endpoint } = await getAccessToken();
  const mcfOrderId = `GIFT-${shipment.id}`;
  const mcfBody = {
    sellerFulfillmentOrderId: mcfOrderId,
    displayableOrderId: mcfOrderId.slice(0, 40),
    displayableOrderDate: shipment.created_at,
    displayableOrderComment: 'FITPEAK Influencer Gift',
    shippingSpeedCategory: 'Standard',
    destinationAddress: {
      name: shipment.recipient_name,
      addressLine1: shipment.address_line1,
      addressLine2: shipment.address_line2 || '',
      city: shipment.city || '',
      stateOrRegion: shipment.state_or_region || '',
      postalCode: shipment.postal_code,
      countryCode: shipment.country_code || 'JP',
    },
    items: [{
      sellerSku: shipment.sku,
      sellerFulfillmentOrderItemId: `${mcfOrderId}-item-0`,
      quantity: shipment.quantity || 1,
    }],
  };

  // 二重出荷ガード: 同IDが既にAmazonに存在すれば新規作成しない
  try {
    const existing = await axios.get(
      `${endpoint}/fba/outbound/2020-07-01/fulfillmentOrders/${mcfOrderId}`,
      { headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' } }
    );
    if (existing.data?.payload?.fulfillmentOrder) {
      const { data: up } = await sb.from('gifting_shipments').update({
        status: 'submitted', mcf_order_id: mcfOrderId, error: null, updated_at: new Date().toISOString(),
      }).eq('id', shipment.id).select().single();
      await sb.from('gifting_candidates').update({ stage: 'shipped', updated_at: new Date().toISOString() }).eq('id', shipment.candidate_id);
      return up;
    }
  } catch (e) {
    const msg = String(e.response?.data ? JSON.stringify(e.response.data) : e.message);
    const notFound = e.response?.status === 404 || /not.?found|Unable to get order/i.test(msg);
    if (!notFound) throw e;
  }

  await axios.post(
    `${endpoint}/fba/outbound/2020-07-01/fulfillmentOrders`,
    mcfBody,
    { headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' } }
  );

  const { data: up } = await sb.from('gifting_shipments').update({
    status: 'submitted', mcf_order_id: mcfOrderId, error: null, updated_at: new Date().toISOString(),
  }).eq('id', shipment.id).select().single();
  await sb.from('gifting_candidates').update({ stage: 'shipped', updated_at: new Date().toISOString() }).eq('id', shipment.candidate_id);
  return up;
}

// ============================================================
// パイプライン（cronから呼ぶ）
// ============================================================
async function runPipeline(settings) {
  const out = { research: null, score: null, draft: null, replies: null, autoSent: 0, autoShipped: 0 };

  // ① リサーチ（db_apiモードかつModashキーがある場合のみ）
  if (settings.research_mode === 'db_api') {
    try {
      const rows = await researchViaModash(settings, settings.daily_research_limit);
      out.research = await upsertCandidates(rows);
    } catch (e) {
      out.research = { error: e.message, code: e.code };
    }
  }

  // ② 採点・選定
  try { out.score = await scoreUnscored(settings.daily_research_limit * 2); } catch (e) { out.score = { error: e.message }; }

  // ③ 提案文生成
  try { out.draft = await draftOutreachForSelected(settings.daily_send_limit); } catch (e) { out.draft = { error: e.message }; }

  // ③ 送信（send_mode=autoのときのみ自動送信。approvalは管理画面で承認）
  if (settings.send_mode === 'auto') {
    const sb = getSupabase();
    const { data: pend } = await sb.from('gifting_messages')
      .select('*').eq('channel', 'email').eq('direction', 'outbound').eq('status', 'pending')
      .order('created_at', { ascending: true }).limit(settings.daily_send_limit);
    for (const m of pend || []) {
      try { await sendMessage(m); out.autoSent++; await sleep(2000 + Math.random() * 2000); }
      catch (e) {
        await getSupabase().from('gifting_messages').update({ status: 'failed', error: e.message }).eq('id', m.id);
      }
    }
  }

  // ④ 返信チェック
  try { out.replies = await checkReplies(30); } catch (e) { out.replies = { error: e.message }; }

  // ⑤ 発送（住所収集済みを発送準備。ship_mode=autoなら即発送）
  const sb = getSupabase();
  const { data: ready } = await sb.from('gifting_candidates')
    .select('*').eq('stage', 'address_collected').limit(settings.daily_send_limit);
  for (const c of ready || []) {
    try {
      const ship = await prepareShipment(c.id);
      if (settings.ship_mode === 'auto' && ship.status === 'pending_approval') {
        await submitShipment(ship);
        out.autoShipped++;
      }
    } catch (e) {
      console.error(`[gifting] ship prepare error @${c.handle}:`, e.message);
    }
  }

  return out;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ===========================================================================
// ルート
// ===========================================================================
router.get('/settings', async (_req, res) => {
  try { res.json(await getSettings()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/settings', async (req, res) => {
  try {
    const sb = getSupabase();
    const allowed = [
      'enabled', 'research_mode', 'send_mode', 'ship_mode', 'daily_research_limit', 'daily_send_limit',
      'min_followers', 'max_followers', 'min_engagement', 'target_niches', 'target_country', 'platforms',
      'product_sku', 'product_name', 'gift_qty', 'from_name', 'email_subject',
      'gift_message_instructions', 'reply_instructions', 'min_score',
    ];
    const patch = { id: 'default', updated_at: new Date().toISOString() };
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
    const { data, error } = await sb.from('gifting_settings').upsert(patch, { onConflict: 'id' }).select().single();
    if (error) throw error;
    res.json({ ...DEFAULT_SETTINGS, ...data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/candidates', async (req, res) => {
  try {
    const sb = getSupabase();
    let q = sb.from('gifting_candidates').select('*').order('score', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(500);
    if (req.query.stage) q = q.eq('stage', req.query.stage);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/research', async (req, res) => {
  try {
    const settings = await getSettings();
    const limit = req.body?.limit ? Number(req.body.limit) : settings.daily_research_limit;
    const rows = await researchViaModash(settings, limit);
    const result = await upsertCandidates(rows);
    res.json(result);
  } catch (e) {
    res.status(e.code === 'NO_MODASH_KEY' ? 400 : 500).json({ error: e.message, code: e.code });
  }
});

// 手動インポート: [{handle, platform, email, full_name, followers, engagement_rate, niche, bio, profile_url}]
router.post('/import', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.candidates) ? req.body.candidates : [];
    if (items.length === 0) return res.status(400).json({ error: 'candidates配列が空です' });
    const rows = items.map((it) => ({
      source: 'manual',
      platform: it.platform || 'instagram',
      handle: (it.handle || '').replace(/^@/, '').trim(),
      profile_url: it.profile_url || null,
      full_name: it.full_name || null,
      email: it.email || null,
      followers: it.followers != null ? Number(it.followers) : null,
      engagement_rate: it.engagement_rate != null ? Number(it.engagement_rate) : null,
      niche: it.niche || null,
      country: it.country || null,
      bio: it.bio || null,
    })).filter((r) => r.handle);
    const result = await upsertCandidates(rows);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/score', async (req, res) => {
  try {
    const limit = req.body?.limit ? Number(req.body.limit) : 50;
    res.json(await scoreUnscored(limit));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/candidates/:id/select', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('gifting_candidates')
      .update({ stage: 'selected', updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/candidates/:id/reject', async (req, res) => {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('gifting_candidates')
      .update({ stage: 'rejected', updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/draft-outreach', async (req, res) => {
  try {
    const limit = req.body?.limit ? Number(req.body.limit) : undefined;
    res.json(await draftOutreachForSelected(limit));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/messages', async (req, res) => {
  try {
    const sb = getSupabase();
    let q = sb.from('gifting_messages').select('*').order('created_at', { ascending: false }).limit(500);
    if (req.query.candidate_id) q = q.eq('candidate_id', req.query.candidate_id);
    if (req.query.status) q = q.eq('status', req.query.status);
    if (req.query.channel) q = q.eq('channel', req.query.channel);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/messages/:id', async (req, res) => {
  try {
    const sb = getSupabase();
    const allowed = ['subject', 'body', 'status'];
    const patch = {};
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
    const { data, error } = await sb.from('gifting_messages').update(patch).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/messages/:id/send', async (req, res) => {
  const sb = getSupabase();
  try {
    const { data: msg } = await sb.from('gifting_messages').select('*').eq('id', req.params.id).maybeSingle();
    if (!msg) return res.status(404).json({ error: 'メッセージが見つかりません' });
    if (msg.status === 'sent') return res.status(400).json({ error: '既に送信済みです' });
    if (msg.channel !== 'email') return res.status(400).json({ error: 'このメッセージはメールではありません（DMは手動送信）' });
    res.json(await sendMessage(msg));
  } catch (e) {
    await sb.from('gifting_messages').update({ status: 'failed', error: e.message }).eq('id', req.params.id);
    res.status(500).json({ error: e.message });
  }
});

router.post('/check-replies', async (req, res) => {
  try {
    const limit = req.body?.limit ? Number(req.body.limit) : 30;
    res.json(await checkReplies(limit));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/shipments', async (req, res) => {
  try {
    const sb = getSupabase();
    let q = sb.from('gifting_shipments').select('*').order('created_at', { ascending: false }).limit(500);
    if (req.query.status) q = q.eq('status', req.query.status);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/candidates/:id/prepare-ship', async (req, res) => {
  try { res.json(await prepareShipment(req.params.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/shipments/:id/approve', async (req, res) => {
  const sb = getSupabase();
  try {
    const { data: ship } = await sb.from('gifting_shipments').select('*').eq('id', req.params.id).maybeSingle();
    if (!ship) return res.status(404).json({ error: '発送が見つかりません' });
    if (ship.status === 'submitted') return res.status(400).json({ error: '既に発送依頼済みです' });
    res.json(await submitShipment(ship));
  } catch (e) {
    await sb.from('gifting_shipments').update({ status: 'failed', error: e.message, updated_at: new Date().toISOString() }).eq('id', req.params.id);
    res.status(500).json({ error: e.message });
  }
});

router.get('/stats', async (_req, res) => {
  try {
    const sb = getSupabase();
    const { data: cands } = await sb.from('gifting_candidates').select('stage');
    const stages = {};
    for (const r of cands || []) stages[r.stage] = (stages[r.stage] || 0) + 1;
    const { data: ships } = await sb.from('gifting_shipments').select('status');
    const shipStatus = {};
    for (const r of ships || []) shipStatus[r.status] = (shipStatus[r.status] || 0) + 1;
    const { data: msgs } = await sb.from('gifting_messages').select('status, channel, direction');
    const sent = (msgs || []).filter((m) => m.status === 'sent').length;
    const pendingSend = (msgs || []).filter((m) => m.status === 'pending' && m.channel === 'email').length;
    res.json({ stages, shipStatus, total_candidates: (cands || []).length, sent, pending_send: pendingSend });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 日次cron: enabled時にパイプラインを実行
router.get('/cron', async (_req, res) => {
  try {
    const settings = await getSettings();
    if (!settings.enabled) return res.json({ skipped: true, reason: 'disabled' });
    const result = await runPipeline(settings);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[gifting] cron error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ===========================================================================
// 公開ルート（認証不要・トークン式の住所入力フォーム）
//   /api/public/gifting にマウント（authMiddlewareより前）
// ===========================================================================
const publicRouter = express.Router();

// フォーム表示用コンテキスト
publicRouter.get('/context', async (req, res) => {
  try {
    const token = String(req.query.t || '');
    if (!token) return res.status(400).json({ error: 'token required' });
    const sb = getSupabase();
    const { data: c } = await sb.from('gifting_candidates')
      .select('handle, full_name, stage, recipient_name, postal_code, address_line1, address_line2, city, state_or_region')
      .eq('address_token', token).maybeSingle();
    if (!c) return res.status(404).json({ error: 'not found' });
    const settings = await getSettings();
    const done = ['address_collected', 'ship_pending', 'shipped'].includes(c.stage);
    res.json({
      candidate: { handle: c.handle, full_name: c.full_name },
      product_name: settings.product_name,
      from_name: settings.from_name,
      already_submitted: done,
      current: done ? {
        recipient_name: c.recipient_name, postal_code: c.postal_code,
        address_line1: c.address_line1, address_line2: c.address_line2,
        city: c.city, state_or_region: c.state_or_region,
      } : null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 住所送信 → 発送準備(pending_approval)まで自動化
publicRouter.post('/address', async (req, res) => {
  try {
    const token = String(req.query.t || req.body.t || '');
    if (!token) return res.status(400).json({ error: 'token required' });
    const sb = getSupabase();
    const { data: c } = await sb.from('gifting_candidates').select('*').eq('address_token', token).maybeSingle();
    if (!c) return res.status(404).json({ error: 'not found' });

    const b = req.body || {};
    const recipient_name = (b.recipient_name || '').trim();
    const postal_code = (b.postal_code || '').trim();
    const address_line1 = (b.address_line1 || '').trim();
    if (!recipient_name || !postal_code || !address_line1) {
      return res.status(400).json({ error: 'お名前・郵便番号・住所は必須です' });
    }

    await sb.from('gifting_candidates').update({
      stage: 'address_collected',
      recipient_name,
      postal_code,
      address_line1,
      address_line2: (b.address_line2 || '').trim() || null,
      city: (b.city || '').trim() || null,
      state_or_region: (b.state_or_region || '').trim() || null,
      country_code: 'JP',
      updated_at: new Date().toISOString(),
    }).eq('id', c.id);

    // 発送準備（SKU未設定なら住所保存のみで、発送準備はダッシュボードから）
    let shipmentPrepared = false;
    try { await prepareShipment(c.id); shipmentPrepared = true; }
    catch (e) { console.warn(`[gifting] public prepare-ship skipped @${c.handle}:`, e.message); }

    res.json({ ok: true, shipmentPrepared });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.publicRouter = publicRouter;
