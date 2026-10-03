/** AI組織（fitpeak-ai-org の /api/owner-notify）に頼んで、オーナーの公式LINEへ通知する。認証は仲介窓口の組織用の鍵（BROKER_KEYS の org:）。 */
const { orgKey } = require('./owner-relay.cjs');

async function notifyOwner(payload, { env = process.env, fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const key = orgKey(env);
  if (!key) return { ok: false, error: 'no_key' };
  try {
    const base = (env.AI_ORG_URL || 'https://fitpeak-ai-org.vercel.app').replace(/\/$/, '');
    const r = await fetchImpl(`${base}/api/owner-notify`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { ok: false, error: `http_${r.status}` };
    const j = await r.json().catch(() => ({}));
    return j && j.ok ? { ok: true } : { ok: false, error: 'rejected' };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 80) }; }
}

module.exports = { notifyOwner };
