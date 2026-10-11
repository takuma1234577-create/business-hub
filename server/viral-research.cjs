// バズリサーチ: YouTube/TikTok の外れ値動画リサーチ + Copilot(Claude Code経由)
// yt-dlp と claude コマンドを使うので、Mac で business-hub を起動したときだけ動く。Vercel では 503 を返す。
const express = require('express');
const { randomUUID } = require('node:crypto');
const store = require('./viral-research/store.cjs');
const { searchMany, accountOutliers, refreshAccount, transcript } = require('./viral-research/sources.cjs');
const { parseAccount } = require('./viral-research/normalize.cjs');
const { runCopilot, suggestQueries } = require('./viral-research/copilot.cjs');

const router = express.Router();
const SCHEDULE_MS = { daily: 86400_000, weekly: 7 * 86400_000, monthly: 30 * 86400_000 };
const running = new Set();

router.use((req, res, next) => {
  if (process.env.VERCEL) return res.status(503).json({ error: 'local_only' });
  next();
});

// 長い処理は1行1イベント(NDJSON)で流す
function stream(res) {
  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' });
  return (ev) => res.write(JSON.stringify(ev) + '\n');
}

async function runAgent(agent, send = () => {}) {
  if (running.has(agent.id)) throw new Error('このエージェントは実行中です');
  running.add(agent.id);
  try {
    const videos = await searchMany(agent.queries, { period: agent.period || 'quarter', limit: 30, onProgress: (m) => send({ type: 'progress', message: m }) });
    await store.saveResults(`agent:${agent.id}`, videos);
    await store.saveAgent({ ...agent, lastRunAt: new Date().toISOString(), lastCount: videos.length });
    return videos;
  } finally {
    running.delete(agent.id);
  }
}

// 定期実行: ローカルのサーバーが動いている間、30分ごとに期限の来たエージェントを回す
function startScheduler() {
  if (process.env.VERCEL) return;
  const tick = async () => {
    for (const a of await store.listAgents()) {
      const every = SCHEDULE_MS[a.schedule];
      if (!every || running.has(a.id)) continue;
      if (a.lastRunAt && Date.now() - new Date(a.lastRunAt).getTime() < every) continue;
      try { await runAgent(a); console.log(`[viral-research] ${a.name} を実行`); } catch (e) { console.log(`[viral-research] ${a.name} 失敗: ${e.message}`); }
    }
  };
  setInterval(tick, 30 * 60_000).unref();
  setTimeout(tick, 60_000).unref();
}

router.get('/state', async (req, res) => {
  const [agents, tracked, assets, threads] = await Promise.all([store.listAgents(), store.listTracked(), store.listAssets(), store.listThreads()]);
  res.json({
    agents: agents.map((a) => ({ ...a, running: running.has(a.id) })),
    tracked,
    assets: assets.map(({ body, ...a }) => ({ ...a, preview: body.slice(0, 160) })),
    threads: threads.map(({ messages, ...t }) => t),
  });
});

// ニッチ検索
router.post('/search', async (req, res) => {
  const { queries, period } = req.body || {};
  if (!Array.isArray(queries) || !queries.length) return res.status(400).json({ error: 'キーワードを入れてください' });
  const send = stream(res);
  try {
    const videos = await searchMany(queries, { period, limit: 30, onProgress: (m) => send({ type: 'progress', message: m }) });
    await store.saveResults(`search:${queries.join(' / ')}`, videos);
    send({ type: 'videos', videos });
  } catch (e) { send({ type: 'error', message: e.message }); }
  res.end();
});

// リサーチエージェント
router.post('/agents/suggest', async (req, res) => {
  try { res.json({ queries: await suggestQueries(String(req.body?.brief || '')) }); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/agents', async (req, res) => res.json(await store.saveAgent(req.body || {})));
router.delete('/agents/:id', async (req, res) => { await store.deleteAgent(req.params.id); res.json({ ok: true }); });
router.post('/agents/:id/run', async (req, res) => {
  const agent = (await store.listAgents()).find((a) => a.id === req.params.id);
  if (!agent) return res.status(404).json({ error: 'not found' });
  const send = stream(res);
  try { send({ type: 'videos', videos: await runAgent(agent, send) }); } catch (e) { send({ type: 'error', message: e.message }); }
  res.end();
});
router.get('/agents/:id/results', async (req, res) => res.json(await store.getResultsMeta(`agent:${req.params.id}`)));

// 監視アカウント
router.post('/tracked', async (req, res) => {
  const a = parseAccount(req.body?.input);
  if (!a) return res.status(400).json({ error: 'TikTokの@ID、YouTubeのチャンネルURL(@名前 か /channel/UC…)を入れてください' });
  try {
    const r = await accountOutliers(a);
    await store.addTracked({ ...a, name: r.name });
    res.json({ account: { ...a, name: r.name }, ...r });
  } catch (e) { res.status(500).json({ error: `取得できませんでした: ${e.message}` }); }
});
router.delete('/tracked', async (req, res) => { await store.removeTracked(req.query.platform, req.query.handle); res.json({ ok: true }); });
router.get('/tracked/videos', async (req, res) => {
  const a = parseAccount(req.query.platform === 'youtube' && String(req.query.handle).startsWith('@') ? `yt:${req.query.handle}` : req.query.handle);
  if (!a) return res.status(400).json({ error: 'アカウントが不正です' });
  try { res.json(req.query.refresh ? await refreshAccount(a) : await accountOutliers(a)); } catch (e) { res.status(500).json({ error: e.message }); }
});

// フック(冒頭の発話)
router.get('/hook', async (req, res) => {
  try { res.json({ openingLine: await transcript(String(req.query.url), { seconds: 6 }) }); } catch (e) { res.status(500).json({ error: e.message }); }
});

// 保存物
router.get('/assets/:id', async (req, res) => res.json((await store.listAssets()).find((a) => a.id === req.params.id) ?? null));
router.delete('/assets/:id', async (req, res) => { await store.deleteAsset(req.params.id); res.json({ ok: true }); });

// Copilot
router.get('/threads/:id', async (req, res) => res.json(await store.getThread(req.params.id)));
router.post('/chat', async (req, res) => {
  const { threadId, message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message がありません' });
  const thread = (threadId && (await store.getThread(threadId))) || { id: randomUUID(), title: String(message).slice(0, 40), messages: [], sessionId: null };
  const send = stream(res);
  send({ type: 'thread', id: thread.id });
  const reply = { role: 'assistant', text: '', videos: [], tools: [] };
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  try {
    thread.sessionId = await runCopilot({
      message, sessionId: thread.sessionId, signal: ac.signal,
      onEvent: (ev) => {
        if (ev.type === 'text') reply.text += ev.text;
        if (ev.type === 'videos') reply.videos.push(...ev.videos);
        if (ev.type === 'tool') reply.tools.push(ev.command);
        if (ev.type === 'error') reply.text += `\n\n${ev.message}`;
        send(ev);
      },
    });
  } catch (e) {
    reply.text += `\n\n(エラー: ${e.message})`;
    send({ type: 'error', message: e.message });
  }
  thread.messages.push({ role: 'user', text: message }, reply);
  await store.saveThread(thread);
  res.end();
});

module.exports = router;
module.exports.startScheduler = startScheduler;
