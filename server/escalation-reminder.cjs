// 人に回したお客様対応（slack_escalations）が、24時間たっても未処理のとき、オーナーのLINEに再通知する。
// 背景（2026-10-06）: 9/18から12件の案件が18日間未処理で、お客様が怒った。通知が届いても、期限が無く、見落とされていた。
const express = require('express');
const router = express.Router();

const DAY = 24 * 3600 * 1000;

/** 24時間たった未処理で、直近24時間に再通知していないもの */
function pickStale(rows, now = new Date()) {
  return (rows || []).filter((r) => r.status === 'pending'
    && now - new Date(r.created_at) >= DAY
    && (!r.last_reminded_at || now - new Date(r.last_reminded_at) >= DAY));
}

/** LINEに出す1通の文面（専門用語なし・絵文字なし）。古い順に上位5件 */
function buildDigest(stale, now = new Date()) {
  const days = (r) => Math.floor((now - new Date(r.created_at)) / DAY);
  const sorted = [...stale].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const lines = sorted.slice(0, 5).map((r) => `・${r.customer_name || '名前不明'}さん（${days(r)}日前）「${String(r.original_message || '').replace(/\s+/g, ' ').slice(0, 24)}」`);
  const more = sorted.length > 5 ? `\nほか${sorted.length - 5}件` : '';
  return `お客様への対応が終わっていないものが${sorted.length}件あります。いちばん古いものは${days(sorted[0])}日前です。\n${lines.join('\n')}${more}\n\n放置するとお客様の不満が大きくなります。対応するか、対応しないと決めて閉じてください。`;
}

async function remindStale({ rows, now = new Date(), notify, markReminded }) {
  const stale = pickStale(rows, now);
  if (!stale.length) return { reminded: 0 };
  const r = await notify({ kind: 'info', text: buildDigest(stale, now) });
  if (!r || !r.ok) return { reminded: 0, error: r?.error || 'notify_failed' };
  await markReminded(stale.map((x) => x.id));
  return { reminded: stale.length };
}

// GET /api/escalation-reminder/cron（daily-cron から10分間隔で呼ばれる。24時間に1回だけ実際に通知する）
router.get('/cron', async (_req, res) => {
  try {
    const { getSupabase } = require('./shared.cjs');
    const { notifyOwner } = require('./owner-notify.cjs');
    const supabase = getSupabase();
    const { data, error } = await supabase.from('slack_escalations').select('id,status,customer_name,original_message,created_at,last_reminded_at,remind_count').eq('status', 'pending').lte('created_at', new Date(Date.now() - DAY).toISOString()).limit(500);
    if (error) return res.status(500).json({ error: error.message });
    const result = await remindStale({
      rows: data, notify: (p) => notifyOwner(p),
      markReminded: async (ids) => {
        const now = new Date().toISOString();
        for (const row of data.filter((x) => ids.includes(x.id))) await supabase.from('slack_escalations').update({ last_reminded_at: now, remind_count: (row.remind_count || 0) + 1 }).eq('id', row.id);
      },
    });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.pickStale = pickStale;
module.exports.buildDigest = buildDigest;
module.exports.remindStale = remindStale;
