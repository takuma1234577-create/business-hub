/**
 * 公式LINEに届いたテキストを、AI組織（fitpeak-ai-org の /api/owner-reply）に転送して、送信者がオーナーかどうかを確かめる。
 * オーナーなら、組織が文章を受け取り（案件へのコメント／社長への指示）、返信文を返す＝通常のお客様向けの自動返信は行わない。
 * オーナーでない・失敗・遅い・鍵がない、のときは handled:false（通常のお客様の扱い。お客様への返信は止めない）。
 * 認証: 仲介窓口の組織用の鍵（BROKER_KEYS の org:）。新しい鍵は作らない。
 */
function orgKey(env = process.env) {
  for (const pair of String(env.BROKER_KEYS || '').split(',')) {
    const i = pair.indexOf(':'); if (i < 1) continue;
    if (pair.slice(0, i).trim() === 'org') return pair.slice(i + 1).trim();
  }
  return '';
}

async function relayOwnerMessage({ lineUserId, text, env = process.env, fetchImpl = fetch, timeoutMs = 4000 }) {
  const t = String(text ?? '').trim();
  const key = orgKey(env);
  if (!t || !key || !lineUserId) return { handled: false };
  try {
    const base = (env.AI_ORG_URL || 'https://fitpeak-ai-org.vercel.app').replace(/\/$/, '');
    const r = await fetchImpl(`${base}/api/owner-reply`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ line_user_id: lineUserId, text: t }), signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { handled: false };
    const j = await r.json();
    return j && j.handled ? { handled: true, reply: String(j.reply || '') } : { handled: false };
  } catch { return { handled: false }; }
}

module.exports = { relayOwnerMessage, orgKey };
