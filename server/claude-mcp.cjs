/**
 * スマホのClaude（AIエージェント社長スキル）から使う、business-hub の接続口（MCPコネクタ）。
 * できること: 社長の日報・判断待ち・AI費用を読む／判断待ちに承認・却下で答える／AI組織の部屋に指示を出す。
 *
 * ログイン: Claude の「カスタムコネクタ」が OAuth で接続 → ここが Google ログインに回し、
 *   MCP_OWNER_EMAILS（既定はオーナー本人のみ）のメールだけ通す。状態はDBに持たず、署名つきの札で受け渡す（Vercelの都度起動に合わせる）。
 * 署名の鍵: MCP_SIGNING_SECRET（無ければ Supabase のサービス鍵から導出）。鍵を替えると発行済みの札はすべて無効になる。
 * Google: 既存の GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET。Google Cloud 側に戻り先 <サイト>/api/mcp-oauth/google-callback の登録が要る。
 */
const crypto = require('crypto');
const express = require('express');

const DEFAULT_OWNERS = 'takuma1234577@gmail.com';
const CLAUDE_REDIRECTS = ['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'];
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const ROOMS = ['exec', 'company', 'site', 'sns', 'gear', 'cs', 'amazon', 'creashot'];
const ACCESS_TTL = 3600;
const REFRESH_TTL = 30 * 24 * 3600;

function signingKey(env) {
  if (env.MCP_SIGNING_SECRET) return String(env.MCP_SIGNING_SECRET);
  const base = env.SUPABASE_SERVICE_ROLE_KEY || '';
  return base ? crypto.createHmac('sha256', base).update('claude-mcp:v1').digest('hex') : '';
}
function signToken(payload, env) {
  const key = signingKey(env);
  if (!key) throw new Error('署名の鍵が未設定です');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', key).update(body).digest('base64url')}`;
}
function verifyToken(token, type, env, nowMs = Date.now()) {
  const key = signingKey(env);
  const [body, sig, extra] = String(token || '').split('.');
  if (!key || !body || !sig || extra !== undefined) return null;
  const want = crypto.createHmac('sha256', key).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!p || p.t !== type || typeof p.exp !== 'number' || p.exp * 1000 <= nowMs) return null;
  return p;
}
const owners = (env) => String(env.MCP_OWNER_EMAILS || DEFAULT_OWNERS).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const isOwner = (env, email) => owners(env).includes(String(email || '').toLowerCase());
const allowedRedirects = (env) => [...CLAUDE_REDIRECTS, ...String(env.MCP_EXTRA_REDIRECTS || '').split(',').map((s) => s.trim()).filter(Boolean)];
const s256 = (v) => crypto.createHash('sha256').update(String(v)).digest('base64url');
const originOf = (req) => `${req.protocol}://${req.get('host')}`;
const page = (res, status, text) => res.status(status).type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:'Noto Sans JP',sans-serif;padding:24px"><p>${text}</p></body>`);

// ---- 道具（MCPのtools） ----
const TOOLS = [
  {
    name: 'get_daily_report',
    description: 'AI組織の社長が毎晩（日本時間23時45分ごろ）作る、オーナー向けの日報を読む。本文（body）と数字（numbers: LINE登録・予算USD・判断待ち件数など）。days で直近何日分か（1〜7、既定1）。',
    inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 7 } } },
    annotations: { title: '社長の日報を読む', readOnlyHint: true },
  },
  {
    name: 'list_approvals',
    description: 'オーナーの判断待ち（承認・却下が必要な案件）を、急ぎ順・古い順で一覧する。各件に id・担当・急ぎ度・見出し・詳細・選択肢・待っている日数。',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50 }, urgency: { type: 'string', enum: ['high', 'normal', 'low'] } } },
    annotations: { title: '判断待ちを見る', readOnlyHint: true },
  },
  {
    name: 'get_spend',
    description: 'AI組織が使ったAI費用（USD）を、直近 days 日（24時間×日数、1〜31、既定1）で合計し、担当別の上位10件を出す。',
    inputSchema: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 31 } } },
    annotations: { title: 'AI費用を見る', readOnlyHint: true },
  },
  {
    name: 'answer_approval',
    description: '判断待ちの1件に、オーナーとして承認（approve）か却下（reject）で答える。公式LINEのワンタップ回答と同じ処理で、承認すると組織が実行に移る。必ずオーナーに口頭で復唱・確認してから呼ぶこと。',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'list_approvals の id' }, action: { type: 'string', enum: ['approve', 'reject'] } }, required: ['id', 'action'] },
    annotations: { title: '判断待ちに答える', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'send_instruction',
    description: 'AI組織の部屋に、オーナーの指示を書き込む（AIマップのグループチャットと同じ）。宛先省略時は、exec・company は社長、各部門はその部長に最優先の仕事として入る。room: exec=社長室 / company=全社 / site=サイト運用 / sns=SNS / gear=ギア / cs=お客様対応 / amazon=Amazon / creashot=クレアショット。必ずオーナーに内容を確認してから呼ぶこと。',
    inputSchema: { type: 'object', properties: { room: { type: 'string', enum: ROOMS }, to: { type: 'string', description: '担当のID（任意）' }, body: { type: 'string', minLength: 1, maxLength: 2000 } }, required: ['room', 'body'] },
    annotations: { title: 'AI組織に指示を出す', readOnlyHint: false, destructiveHint: false },
  },
];

class ToolError extends Error {}
const intIn = (v, lo, hi, dflt) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
const URGENCY = { high: 0, normal: 1, low: 2 };

async function runTool(name, args, deps) {
  const a = args && typeof args === 'object' ? args : {};
  const nowMs = deps.now();
  if (name === 'get_daily_report') {
    const { data, error } = await deps.getSupabase().from('org_owner_reports').select('day,body,numbers,sent_at').order('day', { ascending: false }).limit(intIn(a.days, 1, 7, 1));
    if (error) throw new Error(error.message);
    return { reports: data || [] };
  }
  if (name === 'list_approvals') {
    const { data, error } = await deps.getSupabase().from('org_escalations').select('id,agent_id,urgency,headline,detail,options,created_at').eq('status', 'open').order('created_at', { ascending: true }).limit(500);
    if (error) throw new Error(error.message);
    const rows = (data || []).filter((r) => !a.urgency || r.urgency === a.urgency);
    const counts = rows.reduce((m, r) => ({ ...m, [r.urgency || 'normal']: (m[r.urgency || 'normal'] || 0) + 1 }), {});
    const items = rows
      .sort((x, y) => (URGENCY[x.urgency] ?? 1) - (URGENCY[y.urgency] ?? 1) || String(x.created_at).localeCompare(String(y.created_at)))
      .slice(0, intIn(a.limit, 1, 50, 10))
      .map((r) => ({ ...r, days_waiting: Math.floor((nowMs - Date.parse(r.created_at)) / 86400000) }));
    return { total_open: rows.length, counts, items };
  }
  if (name === 'get_spend') {
    const days = intIn(a.days, 1, 31, 1);
    const since = new Date(nowMs - days * 86400000).toISOString();
    const { data, error } = await deps.getSupabase().from('org_runs').select('agent_id,cost_usd,started_at').gte('started_at', since).limit(20000);
    if (error) throw new Error(error.message);
    const by = new Map();
    for (const r of data || []) {
      const cur = by.get(r.agent_id) || { agent_id: r.agent_id, usd: 0, runs: 0 };
      cur.usd += Number(r.cost_usd) || 0; cur.runs += 1; by.set(r.agent_id, cur);
    }
    const round = (n) => Math.round(n * 10000) / 10000;
    const list = [...by.values()].map((x) => ({ ...x, usd: round(x.usd) })).sort((x, y) => y.usd - x.usd);
    return { days, since, total_usd: round(list.reduce((s, x) => s + x.usd, 0)), by_agent: list.slice(0, 10) };
  }
  if (name === 'answer_approval') {
    if (!/^[0-9a-f-]{36}$/i.test(String(a.id || ''))) throw new ToolError('id が正しくありません（list_approvals の id を使ってください）');
    if (!['approve', 'reject'].includes(a.action)) throw new ToolError('action は approve か reject です');
    const r = await deps.sendOwnerAnswer({ id: String(a.id), action: a.action });
    if (!r.ok) throw new ToolError(r.data?.message || r.data?.error || `組織が受け付けませんでした（${r.status}）`);
    return { ok: true, ...r.data };
  }
  if (name === 'send_instruction') {
    if (!ROOMS.includes(a.room)) throw new ToolError(`room は ${ROOMS.join(' / ')} のどれかです`);
    const body = String(a.body ?? '').trim();
    if (!body || body.length > 2000) throw new ToolError('指示の本文は1〜2000文字です');
    const r = await deps.sendOwnerChat({ room: a.room, to: a.to ? String(a.to) : undefined, body });
    if (!r.ok) throw new ToolError(r.data?.error || r.data?.message || `組織に届きませんでした（${r.status}）`);
    return { ok: true, ...r.data };
  }
  throw new ToolError(`未知の道具です: ${name}`);
}

async function handleRpc(msg, deps) {
  const { id, method, params } = msg || {};
  const isNote = id === undefined || id === null;
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof method !== 'string') return fail(-32600, 'Invalid Request');
  if (isNote) return null;
  if (method === 'initialize') {
    const asked = params?.protocolVersion;
    return reply({
      protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'fitpeak-business-hub', title: 'FITPEAK business-hub（AIエージェント社長）', version: '1.0.0' },
      instructions: 'FITPEAK AI組織の日報・判断待ち・AI費用を読み、オーナーの承認/却下と指示を組織に渡す。書き込み系（answer_approval / send_instruction）は必ずオーナーに確認してから使う。',
    });
  }
  if (method === 'ping') return reply({});
  if (method === 'tools/list') return reply({ tools: TOOLS });
  if (method === 'tools/call') {
    try {
      const out = await runTool(params?.name, params?.arguments, deps);
      return reply({ content: [{ type: 'text', text: JSON.stringify(out) }] });
    } catch (e) {
      if (!(e instanceof ToolError)) console.error('[claude-mcp] tool', params?.name, e.message);
      return reply({ isError: true, content: [{ type: 'text', text: e instanceof ToolError ? e.message : `処理に失敗しました（${String(e.message).slice(0, 120)}）` }] });
    }
  }
  return fail(-32601, `Method not found: ${method}`);
}

function createClaudeMcp(deps) {
  const d = { now: Date.now, fetchImpl: (...x) => fetch(...x), ...deps };
  const env = d.env;
  const router = express.Router();
  const ready = (res) => { if (signingKey(env)) return true; res.status(503).json({ error: 'server_not_configured' }); return false; };

  // ---- 接続先の案内 ----
  const resourceMeta = (req, res) => res.json({ resource: `${originOf(req)}/api/mcp`, authorization_servers: [originOf(req)], bearer_methods_supported: ['header'], resource_name: 'FITPEAK business-hub' });
  router.get('/.well-known/oauth-protected-resource', resourceMeta);
  router.get('/.well-known/oauth-protected-resource/api/mcp', resourceMeta);
  router.get('/.well-known/oauth-authorization-server', (req, res) => {
    const o = originOf(req);
    res.json({
      issuer: o,
      authorization_endpoint: `${o}/api/mcp-oauth/authorize`,
      token_endpoint: `${o}/api/mcp-oauth/token`,
      registration_endpoint: `${o}/api/mcp-oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['owner'],
    });
  });

  // ---- クライアント登録（Claudeの戻り先だけ） ----
  router.post('/api/mcp-oauth/register', (req, res) => {
    if (!ready(res)) return;
    const uris = Array.isArray(req.body?.redirect_uris) ? req.body.redirect_uris.map(String) : [];
    const ok = allowedRedirects(env);
    if (!uris.length || uris.some((u) => !ok.includes(u))) return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'Claude以外の戻り先は登録できません' });
    const clientId = `c.${signToken({ t: 'client', r: uris, exp: Math.floor(d.now() / 1000) + 10 * 365 * 86400 }, env)}`;
    return res.status(201).json({ client_id: clientId, client_name: String(req.body?.client_name || 'Claude').slice(0, 80), redirect_uris: uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
  });
  const clientOf = (clientId) => (String(clientId || '').startsWith('c.') ? verifyToken(String(clientId).slice(2), 'client', env, d.now()) : null);

  // ---- 認可 → Googleログイン ----
  router.get('/api/mcp-oauth/authorize', (req, res) => {
    if (!ready(res)) return;
    const q = req.query;
    const client = clientOf(q.client_id);
    if (!client || !client.r.includes(String(q.redirect_uri)) || !allowedRedirects(env).includes(String(q.redirect_uri))) return page(res, 400, '接続の依頼が正しくありません（戻り先が登録と違います）。');
    if (q.response_type !== 'code' || !q.code_challenge || q.code_challenge_method !== 'S256') return page(res, 400, '接続の依頼が正しくありません（PKCEが必要です）。');
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return page(res, 503, 'Googleログインの設定がありません。');
    const pending = signToken({ t: 'pend', cid: String(q.client_id), r: String(q.redirect_uri), cc: String(q.code_challenge), st: q.state === undefined ? null : String(q.state), exp: Math.floor(d.now() / 1000) + 600 }, env);
    const g = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    g.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${originOf(req)}/api/mcp-oauth/google-callback`, response_type: 'code', scope: 'openid email', state: pending, prompt: 'select_account' }).toString();
    return res.redirect(302, g.toString());
  });

  router.get('/api/mcp-oauth/google-callback', async (req, res) => {
    if (!ready(res)) return;
    const p = verifyToken(req.query.state, 'pend', env, d.now());
    if (!p || !req.query.code) return page(res, 400, 'ログインの期限が切れたか、依頼が正しくありません。Claudeからもう一度つないでください。');
    let claims;
    try {
      const r = await d.fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: String(req.query.code), client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: `${originOf(req)}/api/mcp-oauth/google-callback`, grant_type: 'authorization_code' }).toString(),
        signal: AbortSignal.timeout(10000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.id_token) return page(res, 502, 'Googleの確認に失敗しました。もう一度お試しください。');
      // id_token はGoogleのトークン窓口からTLSで直接受け取ったもの（OIDCの規定上、署名検証は省略できる）。中身の条件は確かめる
      claims = JSON.parse(Buffer.from(String(j.id_token).split('.')[1] || '', 'base64url').toString('utf8'));
    } catch (e) {
      console.error('[claude-mcp] google', e.message);
      return page(res, 502, 'Googleに届きませんでした。もう一度お試しください。');
    }
    const issOk = ['https://accounts.google.com', 'accounts.google.com'].includes(claims?.iss);
    const fresh = typeof claims?.exp === 'number' && claims.exp * 1000 > d.now();
    if (!issOk || claims.aud !== env.GOOGLE_CLIENT_ID || !fresh || claims.email_verified !== true || !isOwner(env, claims.email)) {
      return page(res, 403, 'このGoogleアカウントでは接続できません。オーナー本人のアカウントでログインしてください。');
    }
    const code = signToken({ t: 'code', cid: p.cid, r: p.r, cc: p.cc, e: String(claims.email).toLowerCase(), exp: Math.floor(d.now() / 1000) + 300 }, env);
    const back = new URL(p.r);
    back.searchParams.set('code', code);
    if (p.st !== null) back.searchParams.set('state', p.st);
    return res.redirect(302, back.toString());
  });

  // ---- 札の交換・更新 ----
  router.post('/api/mcp-oauth/token', (req, res) => {
    if (!ready(res)) return;
    res.setHeader('Cache-Control', 'no-store');
    const b = req.body || {};
    const bad = (error, desc) => res.status(400).json({ error, error_description: desc });
    const nowS = Math.floor(d.now() / 1000);
    const issue = (email, cid) => res.json({
      access_token: signToken({ t: 'at', e: email, exp: nowS + ACCESS_TTL }, env),
      token_type: 'Bearer', expires_in: ACCESS_TTL, scope: 'owner',
      refresh_token: signToken({ t: 'rt', e: email, cid, exp: nowS + REFRESH_TTL, n: crypto.randomBytes(6).toString('base64url') }, env),
    });
    if (b.grant_type === 'authorization_code') {
      const c = verifyToken(b.code, 'code', env, d.now());
      if (!c || c.r !== String(b.redirect_uri) || c.cid !== String(b.client_id)) return bad('invalid_grant', '認可コードが正しくないか、期限切れです');
      if (!b.code_verifier || s256(b.code_verifier) !== c.cc) return bad('invalid_grant', 'PKCEの検証に失敗しました');
      if (!isOwner(env, c.e)) return bad('invalid_grant', '許可されていないアカウントです');
      return issue(c.e, c.cid);
    }
    if (b.grant_type === 'refresh_token') {
      const t = verifyToken(b.refresh_token, 'rt', env, d.now());
      if (!t || (b.client_id && t.cid !== String(b.client_id)) || !isOwner(env, t.e)) return bad('invalid_grant', '更新用の札が正しくないか、期限切れです');
      return issue(t.e, t.cid);
    }
    return bad('unsupported_grant_type', '対応していない種類です');
  });

  // ---- MCP本体（Streamable HTTP・JSON応答） ----
  const unauthorized = (req, res) => {
    res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${originOf(req)}/.well-known/oauth-protected-resource/api/mcp"`);
    return res.status(401).json({ error: 'unauthorized' });
  };
  router.post('/api/mcp', async (req, res) => {
    if (!ready(res)) return;
    const m = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
    const t = m && verifyToken(m[1].trim(), 'at', env, d.now());
    if (!t || !isOwner(env, t.e)) return unauthorized(req, res);
    const body = req.body;
    const batch = Array.isArray(body);
    const out = (await Promise.all((batch ? body : [body]).map((x) => handleRpc(x, d)))).filter(Boolean);
    if (!out.length) return res.status(202).end();
    res.setHeader('Cache-Control', 'no-store');
    return res.json(batch ? out : out[0]);
  });
  router.get('/api/mcp', (req, res) => res.status(405).set('Allow', 'POST').json({ error: 'method_not_allowed' }));
  router.delete('/api/mcp', (req, res) => res.status(405).set('Allow', 'POST').json({ error: 'method_not_allowed' }));

  return { router };
}

// 本番用（index.cjs から使う）。依存は呼ばれたときに読み込む
function defaultRouter() {
  const lazy = () => ({ shared: require('./shared.cjs'), answer: require('./owner-answer.cjs'), chat: require('./owner-chat.cjs') });
  return createClaudeMcp({
    env: process.env,
    getSupabase: () => lazy().shared.getSupabase(),
    sendOwnerAnswer: (a) => lazy().answer.sendOwnerAnswer(a),
    sendOwnerChat: (a) => lazy().chat.sendOwnerChat(a),
  }).router;
}

module.exports = { createClaudeMcp, defaultRouter, signToken, verifyToken, TOOLS };
