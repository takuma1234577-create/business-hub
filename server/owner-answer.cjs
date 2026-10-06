/** AIマップから、判断待ち（承認/却下）をAI組織（fitpeak-ai-org の /api/owner-answer）へ渡す。認証は仲介窓口の組織用の鍵（BROKER_KEYS の org:）。 */
const { orgKey } = require('./owner-relay.cjs');

async function sendOwnerAnswer({ id, action }, { env = process.env, fetchImpl = fetch, timeoutMs = 25000 } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return { ok: false, status: 400, data: { message: '案件のIDが正しくありません' } };
  if (!['approve', 'reject'].includes(action)) return { ok: false, status: 400, data: { message: '回答は承認か却下のどちらかです' } };
  const key = orgKey(env);
  if (!key) return { ok: false, status: 500, data: { message: '組織との連携の鍵が未設定です' } };
  try {
    const base = (env.AI_ORG_URL || 'https://fitpeak-ai-org.vercel.app').replace(/\/$/, '');
    const r = await fetchImpl(`${base}/api/owner-answer`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }), signal: AbortSignal.timeout(timeoutMs) });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } catch (e) { return { ok: false, status: 502, data: { message: `組織に届きませんでした（${String(e.message || e).slice(0, 60)}）` } }; }
}

module.exports = { sendOwnerAnswer };
