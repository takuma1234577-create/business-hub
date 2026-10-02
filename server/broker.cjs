/**
 * 秘密の仲介窓口（ブローカー）。APIキーを持ったサーバーが、代わりに外部APIを呼び、結果だけを返す。
 *
 * - APIキーの値は、どの応答・記録・画面にも出さない（キーを返す口は作らない。応答に混ざったら伏せ字にする）。
 * - 呼べる相手は、サービスごとに「ホスト・メソッド・パス」を固定した許可リストだけ。任意のURLにキーを付けて送れない。
 * - 呼べる強さは3段階:
 *     free     … 読み取りなど。自由に呼べる（件数の上限あり）
 *     metered  … 費用がかかる呼び出し。1日の回数に上限がある
 *     approval … 外に何かを送る・公開する・お金に関わる操作。オーナーのLINE承認（ref=broker:<ハッシュ>）が済んだものだけ。1回きり
 * - 呼ぶ人は専用の鍵（BROKER_KEYS=名前:鍵,名前:鍵）で区別し、全部の呼び出しを broker_audit に残す（秘密は残さない）。
 * - 呼び出し用でない秘密（暗号化の鍵・署名シークレット・クライアントシークレット等）は、対象外。
 */
const express = require('express');
const crypto = require('crypto');
const { getSupabase } = require('./shared.cjs');
const settings = require('./settings.cjs');

const router = express.Router();
const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });

const DAILY_CAP = { free: 3000, metered: 200 };       // 呼び出し元×サービスごとの、1日の回数の上限
const APPROVAL_TTL_MS = 24 * 3600 * 1000;
const FORBIDDEN_QUERY = /^(key|api_key|apikey|access_token|token|authorization|x-api-key)$/i;

// ---- サービスの許可リスト -------------------------------------------------------------
// auth: 秘密をどう付けるか。rules: 許可する呼び出し（method と path の正規表現・強さ）。
const SERVICES = {
  chatwork: {
    secret: 'chatwork', host: 'api.chatwork.com', auth: (k) => ({ headers: { 'X-ChatWorkToken': k } }),
    rules: [
      { m: 'GET', p: /^\/v2\/(me|rooms\/\d+|rooms\/\d+\/(messages|members|tasks|files))$/, tier: 'free' },
      { m: 'POST', p: /^\/v2\/rooms\/\d+\/messages$/, tier: 'approval' },
    ],
    // 触れるルームを限定する（既定: たお太郎の発注ルームだけ。環境変数 BROKER_CHATWORK_ROOMS=ID,ID で追加）。会計事務所など、他のルームには触れない
    scope: (path) => { const m = path.match(/^\/v2\/rooms\/(\d+)/); if (!m) return true; return String(process.env.BROKER_CHATWORK_ROOMS || '445627173').split(',').map((x) => x.trim()).includes(m[1]); },
  },
  jev: {
    secret: 'jev', host: 'api.typesafe.ai', auth: (k) => ({ headers: { Authorization: `Bearer ${k}` } }),
    rules: [{ m: 'POST', p: /^\/v1\/systemone$/, tier: 'metered' }],
  },
  anthropic: {
    secret: 'anthropic', host: 'api.anthropic.com', auth: (k) => ({ headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01' } }),
    rules: [{ m: 'POST', p: /^\/v1\/(messages|messages\/count_tokens)$/, tier: 'metered' }, { m: 'GET', p: /^\/v1\/models$/, tier: 'free' }],
  },
  openai: {
    secret: ['org_openai', 'openai'], host: 'api.openai.com', auth: (k) => ({ headers: { Authorization: `Bearer ${k}` } }),
    rules: [{ m: 'POST', p: /^\/v1\/(chat\/completions|responses)$/, tier: 'metered' }, { m: 'POST', p: /^\/v1\/embeddings$/, tier: 'free' }, { m: 'GET', p: /^\/v1\/models$/, tier: 'free' }],
  },
  gemini: {
    secret: ['org_gemini', 'gemini'], host: 'generativelanguage.googleapis.com', auth: (k) => ({ query: { key: k } }),
    rules: [{ m: 'POST', p: /^\/v1(beta)?\/models\/[\w.\-]+:(generateContent|countTokens)$/, tier: 'metered' }, { m: 'POST', p: /^\/v1(beta)?\/models\/[\w.\-]+:(embedContent|batchEmbedContents)$/, tier: 'free' }, { m: 'GET', p: /^\/v1(beta)?\/models(\/[\w.\-]+)?$/, tier: 'free' }],
  },
  grok: {
    secret: 'org_grok', host: 'api.x.ai', auth: (k) => ({ headers: { Authorization: `Bearer ${k}` } }),
    rules: [{ m: 'POST', p: /^\/v1\/(responses|chat\/completions)$/, tier: 'metered' }, { m: 'GET', p: /^\/v1\/models$/, tier: 'free' }],
  },
  notion: {
    secret: 'org_notion', host: 'api.notion.com', auth: (k) => ({ headers: { Authorization: `Bearer ${k}`, 'Notion-Version': '2022-06-28' } }),
    vars: { notion_parent: 'org_notion_parent' }, bodyVars: true,
    rules: [
      { m: 'POST', p: /^\/v1\/databases$/, tier: 'free', body: 'parent_is_notion_parent' },
      { m: 'POST', p: /^\/v1\/databases\/[0-9a-f\-]{32,36}\/query$/, tier: 'free', body: 'db_is_memory' },
      { m: 'GET', p: /^\/v1\/databases\/[0-9a-f\-]{32,36}$/, tier: 'free' },
      { m: 'POST', p: /^\/v1\/pages$/, tier: 'free', body: 'page_in_memory_db' },
      { m: 'PATCH', p: /^\/v1\/pages\/[0-9a-f\-]{32,36}$/, tier: 'free' },
      { m: 'GET', p: /^\/v1\/blocks\/[0-9a-f\-]{32,36}\/children$/, tier: 'free' },
      { m: 'PATCH', p: /^\/v1\/blocks\/[0-9a-f\-]{32,36}\/children$/, tier: 'free' },
    ],
  },
  pexels: {
    secret: 'pexels', host: 'api.pexels.com', auth: (k) => ({ headers: { Authorization: k } }),
    rules: [{ m: 'GET', p: /^\/(videos|v1)\/(search|popular|videos\/\d+|curated)$/, tier: 'free' }],
  },
  json2video: {
    secret: 'json2video', host: 'api.json2video.com', auth: (k) => ({ headers: { 'x-api-key': k } }),
    rules: [{ m: 'GET', p: /^\/v2\/movies$/, tier: 'free' }, { m: 'POST', p: /^\/v2\/movies$/, tier: 'approval' }],
  },
  upload_post: {
    secret: 'upload_post_api_key', host: 'api.upload-post.com', auth: (k) => ({ headers: { Authorization: `Apikey ${k}` } }),
    rules: [
      { m: 'GET', p: /^\/api\/(uploadposts\/(me|users|history|status|post-analytics(\/cached|\/[\w\-]+)?)|analytics\/[\w\-]+)$/, tier: 'free' },
      { m: 'POST', p: /^\/api\/(upload|upload_photos|upload_text|uploadposts\/[\w\-\/]+)$/, tier: 'approval' },   // 投稿・公開
    ],
  },
  slack: {
    secret: 'slack_bot_token', host: 'slack.com', auth: (k) => ({ headers: { Authorization: `Bearer ${k}` } }),
    rules: [
      { m: 'GET', p: /^\/api\/(conversations\.(list|history|replies|info)|users\.(list|info)|auth\.test)$/, tier: 'free' },
      { m: 'POST', p: /^\/api\/(chat\.postMessage|chat\.update|reactions\.add)$/, tier: 'approval' },
    ],
  },
  meta_capi: {
    secret: 'meta_capi_access_token', host: 'graph.facebook.com', auth: (k) => ({ query: { access_token: k } }), vars: { pixel: 'meta_pixel_id' },
    rules: [{ m: 'POST', p: /^\/v\d+\.\d+\/\{pixel\}\/events$/, tier: 'approval' }],
  },
};

// 呼び出し用でない秘密（対象外）。理由を、一覧で示す
const NOT_CALLABLE = {
  bank_encryption: '他の鍵を暗号化している元の鍵。絶対に渡さない',
  slack_signing_secret: '署名の検証用（呼び出し用ではない）', slack_webhook: 'Webhook URL自体が秘密。Slack の chat.postMessage を使う',
  google_client_id: 'OAuth用（Gmail等の連携で使う。仲介の対象外）', google_client_secret: 'OAuth用の秘密（対象外）',
  google_maps: '課金されるGoogle APIは使わない方針（停止指示）',
  ebay_client_id: 'eBay は、トークンの更新を含む専用の仕組みがあるため、次の段階', ebay_client_secret: 'eBay（次の段階）', ebay_dev_id: 'eBay（次の段階）',
  ebay_refresh_token: 'eBay（次の段階）', ebay_verification_token: '検証用', ebay_runame: '設定値', ebay_env: '設定値',
  line_login_channel_id: 'LINEログイン用（対象外）', line_login_channel_secret: 'LINEログイン用の秘密（対象外）', line_liff_add_id: '設定値',
  elevenlabs_voice_id: '設定値', elevenlabs_connection_id: '設定値', upload_post_user: '設定値（プロフィール名）',
  meta_pixel_id: '設定値（meta_capi の一部として使う）', meta_capi_test_code: '設定値', meta_capi_event_name: '設定値', slack_channel_id: '設定値',
};

// Notion のページIDを、貼られた形（URL・題名つきの末尾・ハイフンあり/なし）から取り出して、標準の形（8-4-4-4-12）にする
function notionId(value) {
  const m = String(value || '').match(/[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}(?![0-9a-fA-F])/g);
  if (!m) return null;
  const h = m[m.length - 1].replace(/-/g, '').toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Notion は、共通メモリのデータベースの中だけに触れる（データベースの作成は、親ページの下だけ）
async function memoryDbId() {
  const { data } = await supabase.from('org_memory_config').select('value').eq('key', 'notion_db_id').maybeSingle();
  return data?.value || null;
}
const norm = (id) => String(id || '').replace(/-/g, '').toLowerCase();
async function bodyCheck(kind, path, body) {
  if (kind === 'parent_is_notion_parent') return body?.parent?.page_id === '{notion_parent}' ? null : 'データベースは、API設定の親ページの下にだけ作れます';
  const db = await memoryDbId();
  if (!db) return '共通メモリのデータベースが、まだ作られていません';
  if (kind === 'db_is_memory') return norm(path.split('/')[3]) === norm(db) ? null : '共通メモリ以外のデータベースには、触れません';
  if (kind === 'page_in_memory_db') return norm(body?.parent?.database_id) === norm(db) ? null : '共通メモリのデータベースの中にだけ、ページを作れます';
  return null;
}

// ---- 呼ぶ人 ------------------------------------------------------------------------
function callerOf(req) {
  const given = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!given) return null;
  for (const pair of String(process.env.BROKER_KEYS || '').split(',')) {
    const i = pair.indexOf(':'); if (i < 1) continue;
    const name = pair.slice(0, i).trim(); const key = pair.slice(i + 1).trim();
    if (key && key.length === given.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(given))) return name;
  }
  return null;
}

const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object'
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v ?? null));
/** 承認の対象を一意に表すハッシュ。LINEの承認依頼（ref）と、実行時の照合の両方で同じ式を使う */
function approvalHash({ service, method, path, body }) {
  return crypto.createHash('sha256').update(`${service}|${String(method).toUpperCase()}|${path}|${canonical(body)}`).digest('hex').slice(0, 24);
}

// 秘密は、候補の順に探す（AI組織専用の枠を先に、無ければ従来の枠）
async function secretOf(svc) {
  for (const id of [].concat(svc.secret)) { const v = await settings.getActiveApiKey(id); if (v) return v; }
  return null;
}

async function audit(row) { try { await supabase.from('broker_audit').insert(row); } catch { /* 記録できなくても、呼び出しの結果は返す */ } }

async function usedToday(caller, service) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await supabase.from('broker_audit').select('id', { count: 'exact', head: true }).eq('caller', caller).eq('service', service).eq('ok', true).gte('at', since);
  return count || 0;
}

async function checkApproval(hash) {
  const { data } = await supabase.from('org_escalations').select('id,status,answer,answered_at').eq('ref', `broker:${hash}`).order('created_at', { ascending: false }).limit(1);
  const e = data && data[0];
  if (!e) return { ok: false, why: 'この操作の承認依頼がありません（先にオーナーのLINE承認が必要です）' };
  if (e.status !== 'answered' || e.answer !== 'approve') return { ok: false, why: e.status === 'open' ? 'オーナーの回答待ちです' : 'オーナーが見送りました' };
  if (Date.now() - new Date(e.answered_at).getTime() > APPROVAL_TTL_MS) return { ok: false, why: '承認から24時間を過ぎています（もう一度、承認が必要です）' };
  const { count } = await supabase.from('broker_audit').select('id', { count: 'exact', head: true }).eq('approval_id', e.id).eq('ok', true);
  if (count) return { ok: false, why: 'この承認は、使用済みです（1回きり）' };
  return { ok: true, id: e.id };
}

// ---- 呼び出し ----------------------------------------------------------------------
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  const caller = callerOf(req);
  if (!caller) return res.status(401).json({ error: 'unauthorized' });
  req.caller = caller; next();
});

router.get('/services', async (req, res) => {
  const out = {};
  for (const [id, s] of Object.entries(SERVICES)) {
    let configured = false; try { configured = !!(await secretOf(s)); } catch { configured = false; }
    out[id] = { host: s.host, configured, allowed: s.rules.map((r) => ({ method: r.m, path: String(r.p).replace(/^\/\^?|\$?\/$/g, ''), tier: r.tier })) };
  }
  res.json({ services: out, not_callable: NOT_CALLABLE, tiers: { free: '自由（読み取り等）', metered: `1日${DAILY_CAP.metered}回まで（費用がかかる）`, approval: 'オーナーのLINE承認が済んだ1回きりの操作' } });
});

/** 承認依頼に使うハッシュを返す（AI組織が、LINEの承認依頼の ref に使う） */
router.post('/approval-hash', (req, res) => {
  const { service, method, path, body } = req.body || {};
  if (!SERVICES[service]) return res.status(400).json({ error: 'service が不正です' });
  res.json({ hash: approvalHash({ service, method, path, body }), ref: `broker:${approvalHash({ service, method, path, body })}` });
});

router.post('/call', async (req, res) => {
  const { service, method: m, path, query, body } = req.body || {};
  const method = String(m || 'GET').toUpperCase();
  const base = { caller: req.caller, service: String(service || '').slice(0, 40), op: `${method} ${String(path || '').slice(0, 160)}` };
  const fail = async (code, error, extra = {}) => { await audit({ ...base, ok: false, http: code, note: String(error).slice(0, 200), ...extra }); return res.status(code).json({ error }); };
  try {
    const svc = SERVICES[service];
    if (!svc) return fail(400, `未対応のサービスです: ${service}`);
    if (typeof path !== 'string' || !path.startsWith('/') || /\/\/|\.\.|[@\\#?\s]/.test(path.replace(/\{pixel\}/, ''))) return fail(400, 'path が不正です');
    // 許可リスト照合（pathの {pixel} などの変数は、サーバーが埋める）
    const rule = svc.rules.find((r) => r.m === method && r.p.test(svc.vars?.pixel ? path.replace(/\/\d{6,}\//, '/{pixel}/') : path));
    if (!rule) return fail(403, `許可されていない呼び出しです（${service} ${method} ${path}）`);
    if (svc.scope && !svc.scope(path)) return fail(403, '許可されていないルーム・対象です');
    if (rule.body) { const why = await bodyCheck(rule.body, path, body); if (why) return fail(403, why); }
    for (const k of Object.keys(query || {})) if (FORBIDDEN_QUERY.test(k)) return fail(400, `クエリ ${k} は指定できません`);
    if (body !== undefined && JSON.stringify(body).length > 200000) return fail(413, '本文が大きすぎます');

    // 強さごとの確認
    let approvalId = null;
    if (rule.tier === 'approval') {
      const a = await checkApproval(approvalHash({ service, method, path, body }));
      if (!a.ok) return fail(403, `承認が必要です: ${a.why}`);
      approvalId = a.id;
    } else {
      const cap = DAILY_CAP[rule.tier];
      if (cap && (await usedToday(req.caller, service)) >= cap) return fail(429, `1日の回数の上限（${cap}回）に達しました`);
    }

    const key = String((await secretOf(svc)) || '').trim();
    if (!key) return fail(503, `${service} のキーがAPI設定に未登録です`);
    const a = svc.auth(key);
    let realPath = path;
    for (const [v, secretId] of Object.entries(svc.vars || {})) { const val = await settings.getActiveApiKey(secretId); if (val) realPath = realPath.replace(`{${v}}`, val); }
    const url = new URL(`https://${svc.host}${realPath}`);
    for (const [k, v] of Object.entries({ ...(query || {}), ...(a.query || {}) })) url.searchParams.set(k, String(v));
    if (url.host !== svc.host) return fail(400, '宛先が不正です');

    const headers = { ...(a.headers || {}), Accept: 'application/json' };
    let payload;
    if (body !== undefined && method !== 'GET') {
      if (service === 'chatwork' || service === 'slack') {   // フォーム形式
        headers['Content-Type'] = service === 'slack' ? 'application/json; charset=utf-8' : 'application/x-www-form-urlencoded';
        payload = service === 'slack' ? JSON.stringify(body) : new URLSearchParams(Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)]))).toString();
      } else { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
      // 本文の {変数} を、サーバー側の設定値で埋める（Notion の親ページID）。値は、呼び出し元には見えない
      if (svc.bodyVars) for (const [v, secretId] of Object.entries(svc.vars || {})) { const val = await settings.getActiveApiKey(secretId); if (val) payload = payload.split(`{${v}}`).join(notionId(val) || ''); }
    }
    const r = await fetch(url, { method, headers, body: payload, signal: AbortSignal.timeout(45000), redirect: 'error' });
    let text = await r.text();
    // キーが応答に混ざっていたら伏せる（そのまま・URLエンコード・Base64）
    for (const secret of [key, encodeURIComponent(key), Buffer.from(key).toString('base64')]) if (secret && secret.length >= 6) text = text.split(secret).join('***');
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = null; }
    await audit({ ...base, ok: r.ok, http: r.status, note: r.ok ? null : text.slice(0, 120).replace(/\s+/g, ' '), approval_id: r.ok ? approvalId : null });
    res.status(r.ok ? 200 : 502).json({ http: r.status, data: parsed !== null ? parsed : text.slice(0, 20000) });
  } catch (e) {
    await audit({ ...base, ok: false, http: 500, note: String(e.message || e).slice(0, 200) });
    res.status(500).json({ error: String(e.message || e).replace(/[A-Za-z0-9_\-]{24,}/g, '***') });
  }
});

module.exports = router;
module.exports.approvalHash = approvalHash;
module.exports.notionId = notionId;
module.exports.SERVICES = SERVICES;
