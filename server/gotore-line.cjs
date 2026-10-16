/**
 * 合トレナビ：ジム記事のボタンから公式LINEに友だち追加した人へ、掲示板とプロフィール設定の案内を送る
 *
 * 流れ: 記事のボタン（data-fpl=合トレナビの流入経路コード、utm_content=gotore_main|gotore_watch…、utm_term=掲示板のキー）
 *   → /api/line-crm/go/:code が traffic_clicks に記録 → LIFF で友だち追加
 *   → 新しく友だちになった人: follow webhook（line-crm.cjs）から onFollow
 *   → もともと友だちの人:     LIFF の確定（line-login.cjs /liff/confirm）から onLiffFriend
 * 案内は1クリックにつき1回（gt_claim_invite）。「LINEで知らせる」から来た人は通知待ちにも登録する。
 * 合トレナビの経路で案内を送ったときは true を返す（呼び出し側は通常のあいさつを送らない）。
 */
const GOTORE_SOURCE_CODE = 'gtrnavi1';

function validKey(k) {
  return typeof k === 'string' && k.length > 0 && k.length <= 400 && !k.includes('/') ? k : null;
}

function buildMessage({ base, gymName, gymId, watch }) {
  // 記事名（日本語）を含むキーだとURLが数百文字になるので、掲示板のIDで短くする
  const board = gymId ? `${base}/my-fitpeak/gotore/b/${gymId}` : `${base}/my-fitpeak/gotore`;
  const profile = gymId ? `${base}/my-fitpeak/gotore/profile?b=${gymId}` : `${base}/my-fitpeak/gotore/profile`;
  const lead = !gymName
    ? '合トレナビでは、同じジム・同じエリアに通う人と合トレ仲間を探せます。'
    : watch
      ? `${gymName} で合トレ募集が出たら、このLINEでお知らせします。`
      : `${gymName} の合トレ掲示板はこちらです。`;
  return [
    '【合トレナビ】',
    'ご登録ありがとうございます！',
    lead,
    '',
    '▼掲示板を見る',
    board,
    '',
    '▼最初にプロフィールを設定（1分）',
    'ニックネームとトレーニング歴を登録すると、募集や「合トレしたい」を送れるようになります。',
    profile,
  ].join('\n');
}

// 案内の下のボタン：トークだけで募集を作る・近くの募集を見る（gotore-line-chat.cjs が受ける）
const INVITE_QUICK_REPLY = {
  items: [
    { type: 'action', action: { type: 'postback', label: 'LINEで募集する', data: 'action=gotore&s=start', displayText: 'LINEで募集する' } },
    { type: 'action', action: { type: 'postback', label: '近くの募集を見る', data: 'action=gotore&s=list', displayText: '近くの募集を見る' } },
  ],
};

function createGotoreLine(deps) {
  const base = deps.baseUrl;

  async function handle(lineUserId, click) {
    if (!lineUserId || !click || click.source_id !== (await deps.gotoreSourceId())) return false;
    if (!(await deps.rpc('gt_claim_invite', { p_click: click.click_id, p_line: lineUserId }))) return true;
    const key = validKey(click.utm_term);
    const gym = key ? (await deps.rpc('gt_gym_public', { p_handle: key })).gym : null;
    const watch = /watch/.test(click.utm_content || '');
    if (watch && gym) {
      const member = await deps.rpc('gt_member_for_line', { p_line: lineUserId });
      await deps.rpc('gt_watch', { p_member: member, p_handle: key, p_on: true });
    }
    await deps.pushLine(lineUserId, buildMessage({ base, gymName: gym && gym.name, gymId: gym && gym.id, watch }), { quickReply: INVITE_QUICK_REPLY });
    return true;
  }

  return {
    async onFollow({ lineUserId, trafficSourceId }) {
      if (!trafficSourceId || trafficSourceId !== (await deps.gotoreSourceId())) return false;
      return handle(lineUserId, await deps.latestClick(lineUserId, trafficSourceId));
    },
    async onLiffFriend({ lineUserId, clickId }) {
      return handle(lineUserId, await deps.loadClick(clickId));
    },
  };
}

function productionDeps() {
  const { getSupabase, getLineCredentials, DEFAULT_CHANNEL_ID } = require('./shared.cjs');
  const gotore = require('./gotore.cjs').productionDeps();
  let sourceId;
  const cols = 'click_id, source_id, utm_content, utm_term';
  return {
    baseUrl: gotore.baseUrl,
    rpc: gotore.rpc,
    async gotoreSourceId() {
      if (sourceId === undefined) {
        const { data } = await getSupabase().from('traffic_sources').select('id').eq('code', GOTORE_SOURCE_CODE).maybeSingle();
        sourceId = data?.id || null;
      }
      return sourceId;
    },
    async loadClick(clickId) {
      const { data } = await getSupabase().from('traffic_clicks').select(cols).eq('click_id', clickId).maybeSingle();
      return data || null;
    },
    async latestClick(lineUserId, srcId) {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data } = await getSupabase().from('traffic_clicks').select(cols)
        .eq('line_user_id', lineUserId).eq('source_id', srcId).gte('created_at', since)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      return data || null;
    },
    async pushLine(to, text, extra = {}) {
      const { accessToken } = await getLineCredentials(DEFAULT_CHANNEL_ID);
      if (!accessToken) throw new Error('LINEアクセストークンが未設定です');
      const r = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ to, messages: [{ type: 'text', text, ...extra }] }),
      });
      if (!r.ok) throw new Error(`LINE push ${r.status}: ${await r.text().catch(() => '')}`);
    },
  };
}

let prod;
const production = () => (prod ||= createGotoreLine(productionDeps()));

module.exports = { createGotoreLine, productionDeps, production, GOTORE_SOURCE_CODE, buildMessage };
