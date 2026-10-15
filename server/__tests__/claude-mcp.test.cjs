// スマホのClaude（AIエージェント社長）から、日報・判断待ち・費用の確認と、承認/却下・組織への指示を行う接続口。node server/__tests__/claude-mcp.test.cjs
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { createClaudeMcp, signToken, verifyToken } = require('../claude-mcp.cjs');

const OWNER = 'owner@example.com';
const ENV = { MCP_SIGNING_SECRET: 'test-secret', MCP_OWNER_EMAILS: OWNER, GOOGLE_CLIENT_ID: 'gcid', GOOGLE_CLIENT_SECRET: 'gsecret' };
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const b64u = (b) => Buffer.from(b).toString('base64url');
const idToken = (claims) => `${b64u(JSON.stringify({ alg: 'RS256' }))}.${b64u(JSON.stringify(claims))}.sig`;

// Supabase の最小の偽物（select→eq→order→limit の連鎖で、表ごとの行を返す）
function fakeSupabase(tables) {
  return {
    from(name) {
      const q = { rows: [...(tables[name] || [])], filters: [] };
      const chain = {
        select() { return chain; },
        eq(col, v) { q.rows = q.rows.filter((r) => r[col] === v); return chain; },
        gte(col, v) { q.rows = q.rows.filter((r) => r[col] >= v); return chain; },
        order(col, { ascending } = {}) { q.rows.sort((a, b) => (a[col] > b[col] ? 1 : -1) * (ascending === false ? -1 : 1)); return chain; },
        limit(n) { q.rows = q.rows.slice(0, n); return chain; },
        then(res, rej) { return Promise.resolve({ data: q.rows, error: null }).then(res, rej); },
      };
      return chain;
    },
  };
}

(async () => {
  const now = Date.parse('2026-10-15T23:00:00Z');
  const calls = { answer: [], chat: [], google: [] };
  let googleClaims = { iss: 'https://accounts.google.com', aud: 'gcid', email: OWNER, email_verified: true, exp: now / 1000 + 600 };
  const deps = {
    env: ENV,
    now: () => now,
    getSupabase: () => fakeSupabase({
      org_owner_reports: [
        { day: '2026-10-14', body: '【社長の日報 2026-10-14】', numbers: { events: { open_escalations: 78 } }, sent_at: 'x' },
        { day: '2026-10-15', body: '【社長の日報 2026-10-15】', numbers: { events: { open_escalations: 83 } }, sent_at: 'y' },
      ],
      org_escalations: [
        { id: 'a', status: 'open', urgency: 'normal', agent_id: 'op-sns', headline: '普通の件', detail: 'd', options: null, created_at: '2026-10-12T00:00:00Z' },
        { id: 'b', status: 'open', urgency: 'high', agent_id: 'op-cs', headline: '急ぎの件', detail: 'd', options: null, created_at: '2026-10-06T00:00:00Z' },
        { id: 'c', status: 'answered', urgency: 'high', agent_id: 'op-cs', headline: '回答済み', created_at: '2026-10-01T00:00:00Z' },
      ],
      org_runs: [
        { agent_id: 'op-cs', cost_usd: 0.5, started_at: '2026-10-15T01:00:00.000Z' },
        { agent_id: 'op-cs', cost_usd: 0.25, started_at: '2026-10-15T02:00:00.000Z' },
        { agent_id: 'op-sns', cost_usd: 1, started_at: '2026-10-15T03:00:00.000Z' },
        { agent_id: 'op-old', cost_usd: 9, started_at: '2026-09-01T00:00:00.000Z' },
      ],
    }),
    sendOwnerAnswer: async (a) => { calls.answer.push(a); return { ok: true, status: 200, data: { ok: true, title: '承認しました' } }; },
    sendOwnerChat: async (a) => { calls.chat.push(a); return { ok: true, status: 200, data: { target: 'president' } }; },
    fetchImpl: async (url, init) => { calls.google.push({ url, body: String(init.body) }); return { ok: true, status: 200, json: async () => ({ id_token: idToken(googleClaims) }) }; },
  };
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(createClaudeMcp(deps).router);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p) => fetch(base + p, { redirect: 'manual' });
  const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const form = (p, obj) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(obj).toString() });

  try {
    // 署名つきの札: 改ざん・期限切れ・種類違いは通らない
    const t = signToken({ t: 'at', e: OWNER, exp: now / 1000 + 60 }, ENV);
    assert.equal(verifyToken(t, 'at', ENV, now).e, OWNER);
    assert.equal(verifyToken(t, 'rt', ENV, now), null);
    assert.equal(verifyToken(t.slice(0, -2) + 'xx', 'at', ENV, now), null);
    assert.equal(verifyToken(t, 'at', { ...ENV, MCP_SIGNING_SECRET: 'other' }, now), null);
    assert.equal(verifyToken(signToken({ t: 'at', e: OWNER, exp: now / 1000 - 1 }, ENV), 'at', ENV, now), null);
    console.log('OK   署名つきの札の検証');

    // 接続先の案内（ClaudeがOAuthの場所を見つけるため）
    let r = await get('/.well-known/oauth-protected-resource/api/mcp');
    let j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.resource, `${base}/api/mcp`);
    assert.deepEqual(j.authorization_servers, [base]);
    r = await get('/.well-known/oauth-authorization-server');
    j = await r.json();
    assert.equal(j.token_endpoint, `${base}/api/mcp-oauth/token`);
    assert.deepEqual(j.code_challenge_methods_supported, ['S256']);
    console.log('OK   接続先の案内');

    // 鍵なしでは何もできない（401で、ログインの場所を案内する）
    r = await post('/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.equal(r.status, 401);
    assert.match(r.headers.get('www-authenticate'), /resource_metadata=".*\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
    r = await post('/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Authorization: 'Bearer nonsense' });
    assert.equal(r.status, 401);
    console.log('OK   鍵なし・偽の鍵は401');

    // クライアント登録: Claude以外の戻り先は断る
    r = await post('/api/mcp-oauth/register', { redirect_uris: ['https://evil.example/cb'] });
    assert.equal(r.status, 400);
    r = await post('/api/mcp-oauth/register', { redirect_uris: [REDIRECT], client_name: 'Claude' });
    j = await r.json();
    assert.equal(r.status, 201);
    const clientId = j.client_id;
    assert.ok(clientId);

    // 認可: Googleログインへ送る
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const authQ = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'st123' });
    r = await get(`/api/mcp-oauth/authorize?${authQ}`);
    assert.equal(r.status, 302);
    const g = new URL(r.headers.get('location'));
    assert.equal(g.origin, 'https://accounts.google.com');
    assert.equal(g.searchParams.get('client_id'), 'gcid');
    assert.equal(g.searchParams.get('redirect_uri'), `${base}/api/mcp-oauth/google-callback`);
    // 戻り先の差し替え・PKCEなしは断る
    assert.equal((await get(`/api/mcp-oauth/authorize?${new URLSearchParams({ ...Object.fromEntries(authQ), redirect_uri: 'https://claude.com/api/mcp/auth_callback' })}`)).status, 400);
    const noPkce = new URLSearchParams(authQ); noPkce.delete('code_challenge');
    assert.equal((await get(`/api/mcp-oauth/authorize?${noPkce}`)).status, 400);
    console.log('OK   登録と認可（Claudeの戻り先・PKCE必須）');

    // Googleから戻る: オーナー以外は断る
    const pending = g.searchParams.get('state');
    googleClaims = { ...googleClaims, email: 'someone@example.com' };
    r = await get(`/api/mcp-oauth/google-callback?code=gcode&state=${encodeURIComponent(pending)}`);
    assert.equal(r.status, 403);
    googleClaims = { ...googleClaims, email: OWNER, email_verified: false };
    assert.equal((await get(`/api/mcp-oauth/google-callback?code=gcode&state=${encodeURIComponent(pending)}`)).status, 403);
    googleClaims = { ...googleClaims, email_verified: true, aud: 'other-client' };
    assert.equal((await get(`/api/mcp-oauth/google-callback?code=gcode&state=${encodeURIComponent(pending)}`)).status, 403);
    googleClaims = { ...googleClaims, aud: 'gcid' };
    assert.equal((await get('/api/mcp-oauth/google-callback?code=gcode&state=forged')).status, 400);
    r = await get(`/api/mcp-oauth/google-callback?code=gcode&state=${encodeURIComponent(pending)}`);
    assert.equal(r.status, 302);
    const back = new URL(r.headers.get('location'));
    assert.equal(`${back.origin}${back.pathname}`, REDIRECT);
    assert.equal(back.searchParams.get('state'), 'st123');
    const code = back.searchParams.get('code');
    assert.match(calls.google.at(-1).body, /client_secret=gsecret/);
    console.log('OK   Googleログインはオーナー本人だけ');

    // 札の交換: 検証コードが違えば断る
    r = await form('/api/mcp-oauth/token', { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: 'wrong' });
    assert.equal(r.status, 400);
    r = await form('/api/mcp-oauth/token', { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier });
    j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.token_type, 'Bearer');
    const access = j.access_token;
    r = await form('/api/mcp-oauth/token', { grant_type: 'refresh_token', refresh_token: j.refresh_token, client_id: clientId });
    assert.equal(r.status, 200);
    assert.ok((await r.json()).access_token);
    assert.equal((await form('/api/mcp-oauth/token', { grant_type: 'refresh_token', refresh_token: access, client_id: clientId })).status, 400);
    console.log('OK   札の交換と更新');

    // MCP本体
    const rpc = async (method, params, id = 1) => {
      const res = await post('/api/mcp', { jsonrpc: '2.0', id, method, params }, { Authorization: `Bearer ${access}` });
      return { status: res.status, body: res.status === 202 ? null : await res.json() };
    };
    let x = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    assert.equal(x.body.result.protocolVersion, '2025-06-18');
    assert.ok(x.body.result.capabilities.tools);
    assert.equal((await post('/api/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, { Authorization: `Bearer ${access}` })).status, 202);
    x = await rpc('tools/list');
    const names = x.body.result.tools.map((t2) => t2.name).sort();
    assert.deepEqual(names, ['answer_approval', 'get_daily_report', 'get_spend', 'list_approvals', 'send_instruction']);
    const call = async (name, args) => JSON.parse((await rpc('tools/call', { name, arguments: args })).body.result.content[0].text);
    const callRaw = async (name, args) => (await rpc('tools/call', { name, arguments: args })).body.result;

    let out = await call('get_daily_report', {});
    assert.equal(out.reports.length, 1);
    assert.equal(out.reports[0].day, '2026-10-15');
    out = await call('get_daily_report', { days: 2 });
    assert.equal(out.reports.length, 2);

    out = await call('list_approvals', {});
    assert.equal(out.total_open, 2);
    assert.deepEqual(out.items.map((i) => i.id), ['b', 'a']);
    assert.equal(out.items[0].days_waiting, 9);

    out = await call('get_spend', { days: 1 });
    assert.equal(out.total_usd, 1.75);
    assert.deepEqual(out.by_agent[0], { agent_id: 'op-sns', usd: 1, runs: 1 });

    const ID = '88078081-4d4b-4e2a-a69b-a47c2dd44b9f';
    out = await call('answer_approval', { id: ID, action: 'approve' });
    assert.equal(out.ok, true);
    assert.deepEqual(calls.answer.at(-1), { id: ID, action: 'approve' });
    assert.equal((await callRaw('answer_approval', { id: ID, action: 'delete' })).isError, true);

    out = await call('send_instruction', { room: 'sns', body: '今日はプロテインの投稿を1本' });
    assert.equal(out.ok, true);
    assert.deepEqual(calls.chat.at(-1), { room: 'sns', to: undefined, body: '今日はプロテインの投稿を1本' });
    assert.equal((await callRaw('send_instruction', { room: 'nowhere', body: 'x' })).isError, true);
    assert.equal((await callRaw('send_instruction', { room: 'sns', body: '' })).isError, true);

    x = await rpc('tools/call', { name: 'no_such_tool', arguments: {} });
    assert.ok(x.body.error || x.body.result.isError);
    x = await rpc('no/such/method');
    assert.equal(x.body.error.code, -32601);
    console.log('OK   MCPの道具（日報・判断待ち・費用・承認・指示）');

    // 許可リストから外したら、発行済みの札も使えない
    const app2 = express(); app2.use(express.json());
    app2.use(createClaudeMcp({ ...deps, env: { ...ENV, MCP_OWNER_EMAILS: 'new@example.com' } }).router);
    const s2 = app2.listen(0);
    r = await fetch(`http://127.0.0.1:${s2.address().port}/api/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.equal(r.status, 401);
    s2.close();
    console.log('OK   許可リスト外の札は無効');
  } finally {
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
