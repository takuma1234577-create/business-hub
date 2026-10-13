/**
 * カスタマーサービス部門（AI組織）向けの窓口。公式LINE CRMの「メール自動返信」と「ナレッジベース」を、AIエージェントが運用するための口。
 *
 *  - 読む: メール自動返信の設定・件数・ログ、ナレッジの一覧。お客様の個人情報（メールアドレス・電話・住所・注文番号・氏名）は伏せて返す
 *  - 書く: ナレッジの公開だけ。お客様への返信の中身が変わるので、オーナーのLINE承認（ref=broker:<ハッシュ>）が済んだ同一内容を1回きり
 *  - 返信メールそのものの送信・設定の変更（自動返信のオン／オフ、下書き／送信）は、ここからはできない（人が管理画面で行う）
 * 認証: Bearer CS_AI_KEY
 */
const express = require('express');
const crypto = require('crypto');
const { getSupabase } = require('./shared.cjs');
const { approvalHash, checkApproval } = require('./broker.cjs');

const router = express.Router();
const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });

// ---- 個人情報の伏せ字（純粋な関数）----
const PATTERNS = [
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[メール]'],
  [/U[0-9a-f]{32}/g, '[LINE ID]'],
  [/\b\d{3}-\d{7}-\d{7}\b/g, '[注文番号]'],
  [/#\d{5,}/g, '[注文番号]'],
  [/〒?\s?\d{3}-\d{4}[^\n。、]{0,60}?(?:\d{1,4}(?:[-ー]\d{1,4}){1,3}|丁目|番地?|号)/g, '[住所]'],
  [/(?<![\d-])0\d{1,4}[-\s(（]?\d{1,4}[-\s)）]?\d{3,4}(?!\d)/g, '[電話]'],
  [/(?<!\d)0[789]0\d{8}(?!\d)/g, '[電話]'],
  [/[぀-ヿ一-鿿A-Za-z]{1,10}様/g, 'お客様'],
];
function maskPii(text) {
  let t = String(text ?? '');
  for (const [re, to] of PATTERNS) t = t.replace(re, to);
  return t;
}
const clip = (t, n) => maskPii(t).slice(0, n);

const publicEmailLog = (l) => ({ id: l.id, at: l.created_at, status: l.status, subject: clip(l.subject, 200), customer_message: clip(l.customer_message, 1500), ai_reply: clip(l.ai_reply, 2500), error: l.error ? String(l.error).slice(0, 200) : null });
const publicChunk = (c) => ({ id: c.id, source: c.source, source_id: c.source_id, category: c.category, title: clip(c.title, 200), content: clip(c.content, 3000), updated_at: c.updated_at });
const slugOf = (title) => String(title || '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80);

// ナレッジはお客様への返信の根拠になる。入れてはいけないもの
const KB_FORBIDDEN = /原価|仕入(れ)?値|粗利|利益率|営業利益|卸値/;
function checkKnowledge({ title, content, category }) {
  const t = String(title || '').trim(); const c = String(content || '').trim();
  if (t.length < 4 || t.length > 120) return 'title は4〜120字';
  if (c.length < 20 || c.length > 4000) return 'content は20〜4000字';
  if (maskPii(`${t}\n${c}`) !== `${t}\n${c}`) return '個人情報（メール・電話・住所・注文番号・氏名）が含まれています';
  if (KB_FORBIDDEN.test(`${t}\n${c}`)) return '原価・利益の数字は、お客様への返信の根拠に入れられません';
  if (!['faq', 'product', 'policy', 'manual'].includes(category || 'faq')) return 'category は faq / product / policy / manual';
  return null;
}
const kbBody = (i) => ({ slug: slugOf(i.title), title: String(i.title).trim(), content: String(i.content).trim(), category: i.category || 'faq' });
const kbHash = (i) => approvalHash({ service: 'cs_kb', method: 'POST', path: '/knowledge', body: kbBody(i) });


// ---- LINE返信（エージェントが読み、決まりの範囲で自動送信し、迷ったら人に回す）----
const FOOTER = '\n\n─────────\nFITPEAK AIより';
const withFooter = (t) => (String(t).endsWith(FOOTER) ? String(t) : `${t}${FOOTER}`);
const AI_SOURCES = new Set(['fitpeak_rag', 'fitpeak_rag_instant', 'creashot_bot', 'creashot_bot_opening', 'tag_scheduled_ai_reply', 'ai_org_agent']);
const OK_URL = /^https?:\/\/(?:fitpeak\.co|[\w-]+\.fitpeak\.co|www\.amazon\.co\.jp|amazon\.co\.jp|amzn\.asia|lin\.ee)(?:[/?#]\S*)?$/;
const CLAIMS = /(筋肉(が|を)?(増え(る|ます|ま)|つき(ます|ま)|付き)|痩せ(る|ます|ま)|やせ(る|ます)|治(る|ります|り)|疲労(が|を)?回復|(絶対|必ず|確実に)(効|痩|増|治))/;
// 人が動く約束・期限の約束（2026-10-06: 「責任者から必ず連絡」を繰り返して未履行になり、お客様が激怒した）
const PROMISES = /((担当者?|責任者|スタッフ|上長).{0,12}(連絡|ご連絡|対応|確認のうえ|お電話)|折り返|(本日|今日|明日|明後日|今週|[0-9０-９]+日|[0-9０-９]+時間)(中|内|以内|までに|まで)に?.{0,12}(連絡|ご連絡|発送|返金|対応|お送り|ご報告)|(必ず|責任をもって).{0,6}(連絡|ご連絡|対応|発送|返金))/;
function checkReplyText(text) {
  const t = String(text ?? '').trim();
  if (!t) return '返信文が空です';
  if (t.length > 900) return '返信文が長すぎます（900字まで）';
  if (maskPii(t) !== t) return '個人情報（メール・電話・住所・注文番号）が含まれています';
  for (const u of t.match(/https?:\/\/\S+/g) || []) if (!OK_URL.test(u)) return `許可されていないURLです: ${u.slice(0, 60)}`;
  if (KB_FORBIDDEN.test(t)) return '原価・利益の数字は、お客様への返信に入れられません';
  if (CLAIMS.test(t)) return '効能効果の断定になりうる表現です（言い換えるか、人に回す）';
  if (PROMISES.test(t)) return '人の対応・時期の約束になりうる表現です。「内容を確認のうえ、このLINEでお知らせします。お時間をいただく場合があります」にしてください';
  return null;
}
function textOf(content) {
  if (!content) return '';
  if (typeof content.text === 'string') return content.text;
  if (Array.isArray(content.messages)) return content.messages.filter((m) => m && m.type === 'text' && m.text).map((m) => m.text).join('\n');
  return '';
}
/** 受信箱: 友だちごとに、最後が受信で、その後に返信がなく、処理済みでなく、人が最近返信していないもの。rows は古い順でも新しい順でもよい */
function pendingThreads(rows, { handled = new Set(), excludeFriends = new Set(), humanWindowMs = 24 * 3600000, aiCountsAsAnswer = true, now = new Date() } = {}) {
  const by = new Map();
  for (const r of rows) { if (!by.has(r.friend_id)) by.set(r.friend_id, []); by.get(r.friend_id).push(r); }
  const out = [];
  for (const [friend, list] of by) {
    if (excludeFriends.has(friend)) continue;
    list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const lastIn = [...list].reverse().find((r) => r.direction === 'incoming'); if (!lastIn || handled.has(lastIn.id)) continue;
    const after = list.filter((r) => r.direction !== 'incoming' && new Date(r.created_at) >= new Date(lastIn.created_at));
    if (after.some((r) => aiCountsAsAnswer || !AI_SOURCES.has(r.content?.source))) continue;
    const humanRecent = list.some((r) => r.direction !== 'incoming' && !AI_SOURCES.has(r.content?.source) && (r.content?.source === 'crm_ui' || !r.content?.source) && now - new Date(r.created_at) < humanWindowMs);
    if (humanRecent) continue;
    const history = list.filter((r) => r.id !== lastIn.id && new Date(r.created_at) <= new Date(lastIn.created_at)).slice(-6).map((r) => ({ who: r.direction === 'incoming' ? 'お客様' : (AI_SOURCES.has(r.content?.source) ? 'AI' : '担当者'), text: clip(textOf(r.content), 400) }));
    out.push({ thread: friend, incoming_id: lastIn.id, at: lastIn.created_at, text: clip(textOf(lastIn.content), 800), history });
  }
  return out.sort((a, b) => new Date(a.at) - new Date(b.at));
}

router.use((req, res, next) => {
  const key = process.env.CS_AI_KEY || '';
  const given = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!key || key.length !== given.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(given))) return res.status(401).json({ error: 'unauthorized' });
  res.setHeader('Cache-Control', 'no-store');
  next();
});

router.get('/state', async (_req, res) => {
  try {
    const { data: set } = await supabase.from('email_auto_reply_settings').select('enabled,mode,gmail_query,max_emails_per_run,updated_at').limit(1).maybeSingle();
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data: logs } = await supabase.from('email_auto_reply_logs').select('status,created_at').gte('created_at', since).limit(5000);
    const byStatus = {}; for (const l of logs || []) byStatus[l.status] = (byStatus[l.status] || 0) + 1;
    const { data: chunks } = await supabase.from('knowledge_chunks').select('source,category').limit(5000);
    const kb = {}; for (const c of chunks || []) { const k = `${c.source}/${c.category || '-'}`; kb[k] = (kb[k] || 0) + 1; }
    res.json({ now: new Date().toISOString(), auto_reply: set ? { enabled: set.enabled, mode: set.mode, mode_note: 'draft=Gmailの下書きに保存（人が送る）／sent=自動送信', max_emails_per_run: set.max_emails_per_run, updated_at: set.updated_at } : null,
      emails_last_30_days: { total: (logs || []).length, by_status: byStatus, latest_at: (logs || []).map((l) => l.created_at).sort().pop() || null }, knowledge: { total: (chunks || []).length, by_source_category: kb },
      note: '個人情報は伏せている。自動返信の設定の変更・メールの送信は、人が管理画面で行う' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/emails', async (req, res) => {
  try {
    const days = Math.min(90, Number.parseInt(req.query.days, 10) || 14); const limit = Math.min(50, Number.parseInt(req.query.limit, 10) || 20);
    let q = supabase.from('email_auto_reply_logs').select('id,created_at,status,subject,customer_message,ai_reply,error').gte('created_at', new Date(Date.now() - days * 86400000).toISOString()).order('created_at', { ascending: false }).limit(limit);
    if (req.query.status) q = q.eq('status', String(req.query.status));
    const { data, error } = await q; if (error) return res.status(500).json({ error: error.message });
    res.json({ count: (data || []).length, emails: (data || []).map(publicEmailLog) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/knowledge', async (req, res) => {
  try {
    const limit = Math.min(50, Number.parseInt(req.query.limit, 10) || 20);
    let q = supabase.from('knowledge_chunks').select('id,source,source_id,category,title,content,updated_at').order('updated_at', { ascending: false }).limit(limit);
    if (req.query.source) q = q.eq('source', String(req.query.source));
    if (req.query.category) q = q.eq('category', String(req.query.category));
    if (req.query.search) { const s = String(req.query.search).replace(/[%,()]/g, ' ').slice(0, 60); q = q.or(`title.ilike.%${s}%,content.ilike.%${s}%`); }
    const { data, error } = await q; if (error) return res.status(500).json({ error: error.message });
    res.json({ count: (data || []).length, chunks: (data || []).map(publicChunk) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** 承認依頼に使う参照。LINEの承認依頼（org_escalations.ref）に、この ref を入れる */
router.post('/approval-ref', (req, res) => {
  const why = checkKnowledge(req.body || {}); if (why) return res.status(400).json({ error: why });
  res.json({ ref: `broker:${kbHash(req.body)}`, slug: slugOf(req.body.title) });
});

/** ナレッジを公開する（承認済みの同一内容だけ。同じ題名は置き換える） */
router.post('/knowledge', express.json({ limit: '100kb' }), async (req, res) => {
  const why = checkKnowledge(req.body || {}); if (why) return res.status(400).json({ error: why });
  const body = kbBody(req.body); const base = { caller: 'cs-ai', service: 'cs_kb', op: `POST /knowledge ${body.slug}`.slice(0, 160) };
  try {
    const a = await checkApproval(kbHash(req.body));
    if (!a.ok) { await supabase.from('broker_audit').insert({ ...base, ok: false, http: 403, note: a.why.slice(0, 200) }); return res.status(403).json({ error: `承認が必要です: ${a.why}` }); }
    const { embedText } = require('./fitpeak-rag.cjs');
    const embedding = await embedText(`${body.title}\n${body.content}`, 'document');
    const { data, error } = await supabase.from('knowledge_chunks').upsert({ source: 'ai_org', source_id: body.slug, category: body.category, title: body.title, content: body.content, metadata: { by: 'ai-org', approval_id: a.id }, embedding, updated_at: new Date().toISOString() }, { onConflict: 'source,source_id' }).select('id').single();
    if (error) { await supabase.from('broker_audit').insert({ ...base, ok: false, http: 500, note: error.message.slice(0, 200) }); return res.status(500).json({ error: error.message }); }
    await supabase.from('broker_audit').insert({ ...base, ok: true, http: 200, approval_id: a.id });
    res.json({ published: true, id: data.id, slug: body.slug });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ---- LINE: 受信箱・返信・人に回す ----
const SHADOW = () => process.env.CS_LINE_SEND !== 'live';   // live 以外は「シャドー」: 返信案を記録するだけで、送らない
async function creashotFriends() {
  const { data: set } = await supabase.from('creashot_bot_settings').select('tag_id').limit(1).maybeSingle();
  if (!set?.tag_id) return new Set();
  const { data } = await supabase.from('friend_tags').select('friend_id').eq('tag_id', set.tag_id).limit(5000);
  return new Set((data || []).map((r) => r.friend_id));
}
router.get('/line/inbox', async (req, res) => {
  try {
    const { DEFAULT_CHANNEL_ID } = require('./shared.cjs');
    const since = new Date(Date.now() - 24 * 3600000).toISOString();
    const { data: rows, error } = await supabase.from('chat_messages').select('id,friend_id,direction,content,created_at').eq('channel_id', DEFAULT_CHANNEL_ID).gte('created_at', since).order('created_at', { ascending: false }).limit(1500);
    if (error) return res.status(500).json({ error: error.message });
    const { data: done } = await supabase.from('cs_line_handled').select('incoming_message_id').gte('at', since).limit(2000);
    const minAge = Number.parseInt(req.query.min_age_minutes, 10); const cutoff = Date.now() - (Number.isFinite(minAge) ? minAge : 2) * 60000;
    const threads = pendingThreads((rows || []).filter((r) => new Date(r.created_at).getTime() <= cutoff || r.direction !== 'incoming'), { handled: new Set((done || []).map((d) => d.incoming_message_id)), excludeFriends: await creashotFriends(), aiCountsAsAnswer: !SHADOW() }).slice(0, 10);
    res.json({ mode: SHADOW() ? 'shadow' : 'live', count: threads.length, threads, note: 'クレアショット専用ボットの対象者は含まれない（次の段階）。お客様の名前は返さない' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function loadIncoming(id) {
  const { DEFAULT_CHANNEL_ID } = require('./shared.cjs');
  const { data: m } = await supabase.from('chat_messages').select('id,friend_id,channel_id,direction,created_at,content').eq('id', id).maybeSingle();
  if (!m || m.direction !== 'incoming' || m.channel_id !== DEFAULT_CHANNEL_ID) return { error: '対象の受信メッセージがありません' };
  if (Date.now() - new Date(m.created_at).getTime() > 24 * 3600000) return { error: '24時間を過ぎた受信です（人が対応）' };
  const { data: done } = await supabase.from('cs_line_handled').select('incoming_message_id').eq('incoming_message_id', id).maybeSingle();
  if (done) return { error: 'この受信は、すでに処理済みです' };
  if ((await creashotFriends()).has(m.friend_id)) return { error: 'クレアショット専用ボットの対象者です（別の仕組み）' };
  return { m };
}

/** 決まりを満たす返信を自動送信する（シャドーの間は、記録だけ）。1日の上限と、1人あたりの上限あり */
router.post('/line/reply', async (req, res) => {
  const { incoming_id: id, text, reason } = req.body || {};
  const base = { caller: 'cs-ai', service: 'cs_line', op: `POST /line/reply ${String(id).slice(0, 36)}` };
  try {
    const bad = checkReplyText(text); if (bad) return res.status(400).json({ error: bad });
    const { m, error } = await loadIncoming(id); if (error) return res.status(409).json({ error });
    const shadow = SHADOW();
    if (!shadow) {
      const { count: after } = await supabase.from('chat_messages').select('id', { count: 'exact', head: true }).eq('friend_id', m.friend_id).in('direction', ['outgoing', 'outbound']).gte('created_at', m.created_at);
      if (after) return res.status(409).json({ error: 'この受信には、すでに返信があります（二重返信を防止）' });
      const dayAgo = new Date(Date.now() - 24 * 3600000).toISOString();
      const { count: today } = await supabase.from('cs_line_handled').select('incoming_message_id', { count: 'exact', head: true }).eq('outcome', 'replied').gte('at', dayAgo);
      if ((today || 0) >= 120) return res.status(429).json({ error: '1日の自動返信の上限（120通）に達しました' });
    }
    const full = withFooter(String(text).trim());
    if (shadow) {
      await supabase.from('cs_line_handled').insert({ incoming_message_id: id, friend_id: m.friend_id, outcome: 'shadow', draft: full, reason: String(reason || '').slice(0, 300) });
      await supabase.from('broker_audit').insert({ ...base, ok: true, http: 200, note: 'shadow' });
      return res.json({ sent: false, shadow: true, note: 'シャドー中のため、送信していません（返信案を記録しました）' });
    }
    const { getLineCredentials } = require('./shared.cjs');
    const { data: fr } = await supabase.from('friends').select('line_user_id,channel_id').eq('id', m.friend_id).maybeSingle();
    const { accessToken } = await getLineCredentials(m.channel_id);
    if (!fr?.line_user_id || !accessToken) return res.status(500).json({ error: 'LINEの送信先・認証情報がありません' });
    const r = await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ to: fr.line_user_id, messages: [{ type: 'text', text: full }] }), signal: AbortSignal.timeout(20000) });
    if (!r.ok) { await supabase.from('broker_audit').insert({ ...base, ok: false, http: r.status, note: (await r.text().catch(() => '')).slice(0, 150) }); return res.status(502).json({ error: `LINEへの送信に失敗しました（${r.status}）` }); }
    await supabase.from('chat_messages').insert({ channel_id: m.channel_id, friend_id: m.friend_id, direction: 'outgoing', message_type: 'text', content: { text: full, source: 'ai_org_agent' } });
    await supabase.from('cs_line_handled').insert({ incoming_message_id: id, friend_id: m.friend_id, outcome: 'replied', draft: full, reason: String(reason || '').slice(0, 300) });
    await supabase.from('broker_audit').insert({ ...base, ok: true, http: 200 });
    res.json({ sent: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/** 返信しない（スタンプ・お礼・対応不要）または人に回す（Slackに確認依頼。担当者がスレッドで指示すれば、既存の仕組みで返信される） */
router.post('/line/handoff', async (req, res) => {
  const { incoming_id: id, outcome = 'handoff', reason, draft } = req.body || {};
  try {
    if (!['handoff', 'skip'].includes(outcome)) return res.status(400).json({ error: 'outcome は handoff / skip' });
    if (outcome === 'handoff' && String(reason || '').trim().length < 4) return res.status(400).json({ error: '人に回す理由を書いてください' });
    const { m, error } = await loadIncoming(id); if (error) return res.status(409).json({ error });
    let slack = null;
    if (outcome === 'handoff') {
      const { data: fr } = await supabase.from('friends').select('line_user_id,display_name').eq('id', m.friend_id).maybeSingle();
      slack = await require('./slack-notify.cjs').sendSlackEscalation({ channel: 'LINE', customerName: fr?.display_name || '', customerMessage: textOf(m.content), aiDraftReply: draft ? String(draft).slice(0, 900) : null, reason: `AI担当（カスタマーサービス）が人に回す: ${String(reason).slice(0, 200)}`, lineUserId: fr?.line_user_id });
    }
    await supabase.from('cs_line_handled').insert({ incoming_message_id: id, friend_id: m.friend_id, outcome, draft: draft ? String(draft).slice(0, 900) : null, reason: String(reason || '').slice(0, 300) });
    res.json({ ok: true, outcome, slack: slack ? { ok: !!slack.ok } : null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * お客様対応の確認（slack_escalations。通知は LINE）に対する、オーナーの返事を実行する。AI組織の /api/owner-reply と /api/answer から呼ばれる。
 *   instruction: オーナーの文章の指示を解析して実行（Amazon MCFの発送・クーポン発行・メッセージ送信）。時間がかかるので、すぐ 202 を返し、進み具合と結果はLINEで知らせる
 *   send_draft : AIの返信案を、そのままお客様に送る
 *   dismiss    : 対応しない（お客様には何も送らない）
 */
router.post('/line/escalation-action', async (req, res) => {
  const { escalation_id: id, action, instruction } = req.body || {};
  try {
    if (!['instruction', 'send_draft', 'dismiss'].includes(action)) return res.status(400).json({ error: 'action は instruction / send_draft / dismiss' });
    const { data: esc } = await supabase.from('slack_escalations').select('*').eq('id', id).maybeSingle();
    if (!esc) return res.status(404).json({ error: '案件が見つかりません' });
    if (esc.status !== 'pending') return res.status(409).json({ error: `この案件は処理済みです（${esc.status}）` });
    const { notifyOwner } = require('./owner-notify.cjs');
    const lc = require('./line-crm.cjs');
    const tell = (text) => notifyOwner({ kind: 'info', text: String(text).slice(0, 900) });
    if (action === 'dismiss') {
      await supabase.from('slack_escalations').update({ status: 'resolved', resolution_text: '対応しない（オーナーがLINEで判断）', resolved_by: 'owner_line', resolved_at: new Date().toISOString() }).eq('id', id);
      return res.json({ ok: true });
    }
    if (!(esc.channel_type === 'LINE' && esc.line_user_id)) return res.status(409).json({ error: 'LINEのお客様ではない案件です（この経路では実行できません）' });
    if (action === 'send_draft') {
      const draft = String(esc.ai_draft || '').trim();
      if (!draft) return res.status(409).json({ error: '返信案がありません。文章で指示してください' });
      const bad = checkReplyText(draft); if (bad) return res.status(409).json({ error: `返信案をそのまま送れません（${bad}）。文章で指示してください` });
      const { data: friend } = await supabase.from('friends').select('id, channel_id').eq('line_user_id', esc.line_user_id).maybeSingle();
      await lc.pushToCustomer(friend?.channel_id, esc.line_user_id, withFooter(draft));
      if (friend) await supabase.from('chat_messages').insert({ channel_id: friend.channel_id, friend_id: friend.id, direction: 'outgoing', message_type: 'text', content: { text: draft, source: 'owner_line_send_draft' } });
      await supabase.from('slack_escalations').update({ status: 'resolved', resolution_text: 'AIの返信案をそのまま送信（オーナーがLINEで承認）', resolved_by: 'owner_line', resolved_at: new Date().toISOString() }).eq('id', id);
      return res.json({ ok: true });
    }
    const text = String(instruction || '').trim();
    if (!text) return res.status(400).json({ error: '指示が空です' });
    const job = (async () => {
      try { await lc.processStaffInstruction({ esc, staffInstruction: text, resolvedBy: 'owner_line', say: tell }); } catch (e) { await tell(`❌ 指示の実行に失敗しました: ${String(e.message || e).slice(0, 200)}`); }
    })();
    try { require('@vercel/functions').waitUntil(job); } catch { /* 長く動くサーバーなら、そのまま続く */ }
    return res.status(202).json({ accepted: true });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

// ---- レビューの状況（Amazonレビューの悪化・苦情の兆候・レビュー依頼の送信状況）----
const round1 = (n) => Math.round(n * 10) / 10;
/** 商品ごとの評価の推移と警告、レビュー依頼の送信状況、苦情の兆候（直近14日）をまとめる */
function summarizeReviews({ products = [], snapshots = [], solicitations = [], signals = [], autoSend = null, now = new Date() }) {
  const since30 = now - 30 * 86400000; const since14 = now - 14 * 86400000;
  const out = products.map((p) => {
    const snaps = snapshots.filter((x) => x.asin === p.asin).sort((a, b) => new Date(b.checked_at) - new Date(a.checked_at));
    const latest = snaps[0]; const old = snaps.find((x) => now - new Date(x.checked_at) >= 6 * 86400000);
    const noData = p.average_rating == null;
    const delta = !noData && p.previous_rating != null ? round1(Number(p.average_rating) - Number(p.previous_rating)) : null;
    const lowNow = latest ? (latest.star_1 || 0) + (latest.star_2 || 0) : null;
    const lowThen = old ? (old.star_1 || 0) + (old.star_2 || 0) : null;
    const lowInc = lowNow != null && lowThen != null ? lowNow - lowThen : null;
    let alert = null;
    if (noData) alert = 'no_data'; else if (delta != null && delta <= -0.1) alert = 'rating_drop'; else if (lowInc != null && lowInc >= 2) alert = 'new_low_stars';
    return { asin: p.asin, title: p.title, average_rating: p.average_rating == null ? null : Number(p.average_rating), rating_count: p.rating_count, previous_rating: p.previous_rating == null ? null : Number(p.previous_rating),
      delta_avg: delta, new_ratings: p.rating_count != null && p.previous_count != null ? p.rating_count - p.previous_count : null,
      star_distribution: latest ? { 1: latest.star_1, 2: latest.star_2, 3: latest.star_3, 4: latest.star_4, 5: latest.star_5 } : null, low_star_increase: lowInc, alert };
  });
  const recent = solicitations.filter((x) => new Date(x.sent_at || x.created_at) >= since30);
  const sent = recent.filter((x) => x.status === 'sent'); const failed = recent.filter((x) => x.status === 'failed' || x.status === 'error');
  const errors = [...new Set(failed.map((x) => String(x.error_message || '').slice(0, 120)).filter(Boolean))].slice(0, 3);
  const last = sent.map((x) => x.sent_at).filter(Boolean).sort().pop() || null;
  return {
    products: out,
    alerts: out.filter((p) => p.alert).map((p) => ({ asin: p.asin, title: p.title, alert: p.alert })),
    solicitations: { window_days: 30, sent_30d: sent.length, failed_30d: failed.length, last_sent_at: last, errors, auto_send: autoSend && autoSend.enabled ? { enabled: true, delayDays: autoSend.delayDays, maxPerDay: autoSend.maxPerDay } : { enabled: false } },
    signals: signals.filter((x) => new Date(x.created_at) >= since14).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 20)
      .map((x) => ({ source: x.source, category: x.category, urgency: x.urgency_score, needs_human_response: x.needs_human_response, refund_or_complaint: x.refund_or_complaint, at: x.created_at })),
  };
}

router.get('/reviews', async (_req, res) => {
  try {
    const since = new Date(Date.now() - 45 * 86400000).toISOString();
    const [p, sn, so, sg, st] = await Promise.all([
      supabase.from('amazon_review_products').select('asin,title,average_rating,rating_count,previous_rating,previous_count').eq('is_active', true),
      supabase.from('amazon_review_snapshots').select('asin,star_1,star_2,star_3,star_4,star_5,rating_count,average_rating,checked_at').gte('checked_at', since).limit(2000),
      supabase.from('amazon_review_solicitations').select('status,error_message,sent_at,created_at').gte('created_at', since).limit(2000),
      supabase.from('review_signals').select('source,category,urgency_score,needs_human_response,refund_or_complaint,created_at').gte('created_at', since).limit(500),
      supabase.from('amazon_analytics_settings').select('value').eq('key', 'review_auto_send').maybeSingle(),
    ]);
    res.json({ ...summarizeReviews({ products: p.data || [], snapshots: sn.data || [], solicitations: so.data || [], signals: sg.data || [], autoSend: st.data?.value || null }),
      note: 'Amazonのレビュー監視の商品は、評価が取れるまで no_data。レビュー依頼はAmazon公式の「レビュー依頼」（購入者1人1回）。個人を特定できる情報は含まない' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.maskPii = maskPii;
module.exports.publicEmailLog = publicEmailLog;
module.exports.publicChunk = publicChunk;
module.exports.slugOf = slugOf;
module.exports.checkKnowledge = checkKnowledge;
module.exports.summarizeReviews = summarizeReviews;
module.exports.checkReplyText = checkReplyText;
module.exports.pendingThreads = pendingThreads;
module.exports.textOf = textOf;
module.exports.withFooter = withFooter;
module.exports.FOOTER = FOOTER;
