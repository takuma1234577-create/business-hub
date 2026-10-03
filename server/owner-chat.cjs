/** AIマップのグループチャットにオーナーが書いた指示を、AI組織（fitpeak-ai-org の /api/owner-chat）に渡す。認証は仲介窓口の組織用の鍵（BROKER_KEYS の org:）。 */
const { orgKey } = require('./owner-relay.cjs');

async function sendOwnerChat({ room, to, body }, { env = process.env, fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  const key = orgKey(env);
  if (!key) return { ok: false, status: 500, data: { error: '組織との連携の鍵が未設定です' } };
  try {
    const base = (env.AI_ORG_URL || 'https://fitpeak-ai-org.vercel.app').replace(/\/$/, '');
    const r = await fetchImpl(`${base}/api/owner-chat`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ room, ...(to ? { to } : {}), body }), signal: AbortSignal.timeout(timeoutMs) });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } catch (e) { return { ok: false, status: 502, data: { error: `組織に届きませんでした（${String(e.message || e).slice(0, 60)}）` } }; }
}

module.exports = { sendOwnerChat };
