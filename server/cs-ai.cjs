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

module.exports = router;
module.exports.maskPii = maskPii;
module.exports.publicEmailLog = publicEmailLog;
module.exports.publicChunk = publicChunk;
module.exports.slugOf = slugOf;
module.exports.checkKnowledge = checkKnowledge;
