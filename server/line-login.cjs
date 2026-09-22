/**
 * LINE Login 経由の友だち追加（bot_prompt=aggressive）＋ 広告別の実追加集計
 *
 * 流れ:
 *   LPのCTA → GET /api/line-crm/go/:code?fbclid&fbp&fbc&utm_*&cid&lp
 *     → traffic_clicks にクリックを保存（click_id を発行）
 *     → LINE Login の認可URLへ 302（state=click_id, bot_prompt=aggressive）
 *   ユーザーが「許可」→ GET /api/line-crm/line-login/callback?code&state
 *     → トークン交換 → /v2/profile で userId → /friendship/v1/status で友だち判定
 *     → friends upsert（経路を確定）→ クリックを converted → Meta CAPI 送信 → LINEトークへ 302
 *
 * フォールバック: PC・Login失敗・キャンセル・未追加 → 従来の友だち追加URL（line.me/R/ti/p/@…）へ
 *
 * 設定（Business-hubの「API設定」から入力。環境変数はフォールバック）:
 *   LINE_LOGIN_CHANNEL_ID, LINE_LOGIN_CHANNEL_SECRET  LINE Developers の「LINEログイン」チャネル
 *   PUBLIC_BASE_URL                                  既定 https://business-hub-beige.vercel.app
 */

const express = require('express');
const crypto = require('crypto');
const { getSupabase, getLineCredentials, DEFAULT_CHANNEL_ID } = require('./shared.cjs');
const capi = require('./meta-capi.cjs');

const router = express.Router();

const FALLBACK_ADD_URL = 'https://line.me/R/ti/p/@956iyppc';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function baseUrl() {
  return (process.env.PUBLIC_BASE_URL || 'https://business-hub-beige.vercel.app').replace(/\/$/, '');
}
function callbackUrl() {
  return `${baseUrl()}/api/line-crm/line-login/callback`;
}
// LINE Loginチャネルの認証情報: Business-hubの「API設定」優先、無ければ環境変数
async function getLoginConfig() {
  let getActiveApiKey = null;
  try { ({ getActiveApiKey } = require('./settings.cjs')); } catch {}
  const pick = async (id, envVar) => {
    if (getActiveApiKey) { try { const v = await getActiveApiKey(id); if (v) return String(v).trim(); } catch {} }
    return process.env[envVar] || null;
  };
  const channelId = await pick('line_login_channel_id', 'LINE_LOGIN_CHANNEL_ID');
  const channelSecret = await pick('line_login_channel_secret', 'LINE_LOGIN_CHANNEL_SECRET');
  const liffId = await pick('line_liff_add_id', 'LINE_LIFF_ADD_ID');
  return { channelId, channelSecret, liffId, configured: !!(channelId && channelSecret) };
}
function isMobile(ua) {
  return /iPhone|iPad|iPod|Android/i.test(ua || '');
}
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim() || null;
}
// Meta（Facebook/Instagram）の広告審査クローラー判定。広告を公開・編集した直後に
// Meta のIP帯（AS32934）から数十件の「クリック」が来て集計を汚すので、entry='bot' として保存し集計から除く
const META_IP_PREFIXES = ['31.13.', '66.220.', '69.63.', '69.171.', '74.119.', '103.4.', '129.134.', '157.240.', '173.252.', '179.60.', '185.60.', '204.15.', '2a03:2880:'];
function isMetaCrawler(ip, ua) {
  const u = String(ua || '');
  if (/facebookexternalhit|facebookcatalog|Facebot|Dalvik\//i.test(u)) return true;
  const a = String(ip || '');
  return META_IP_PREFIXES.some(pfx => a.startsWith(pfx));
}
function str(v, max = 300) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

// 公式アカウントのBASIC ID（@付き）を解決。DB → Bot Info API → fallback の順
async function resolveBasicId(channelId) {
  const supabase = getSupabase();
  try {
    const { data: ch } = await supabase.from('line_channels').select('bot_basic_id').eq('id', channelId || DEFAULT_CHANNEL_ID).maybeSingle();
    if (ch?.bot_basic_id) return ch.bot_basic_id.startsWith('@') ? ch.bot_basic_id : `@${ch.bot_basic_id}`;
  } catch {}
  try {
    const { accessToken } = await getLineCredentials(channelId);
    if (accessToken) {
      const r = await fetch('https://api.line.me/v2/bot/info', { headers: { Authorization: `Bearer ${accessToken}` } });
      if (r.ok) {
        const j = await r.json();
        if (j.basicId) return j.basicId.startsWith('@') ? j.basicId : `@${j.basicId}`;
      }
    }
  } catch {}
  return '@956iyppc';
}
function addFriendUrl(basicId) {
  return `https://line.me/R/ti/p/${basicId}`;
}
function talkUrl(basicId) {
  // 追加済みのユーザーをそのままトーク画面へ（あいさつメッセージが見える）
  return `https://line.me/R/oaMessage/${encodeURIComponent(basicId)}/`;
}

// ── GET /go/:code ────────────────────────────────────────────────────────────
router.get('/go/:code', async (req, res) => {
  const supabase = getSupabase();
  let basicId = '@956iyppc';
  try {
    const { data: source, error: srcErr } = await supabase
      .from('traffic_sources')
      .select('id, code, click_count, channel_id, lp_url')
      .eq('code', req.params.code)
      .maybeSingle();
    if (srcErr) {
      // DB障害時でも友だち追加の導線は止めない
      console.error('[line-login] source lookup error:', srcErr.message);
      return res.redirect(FALLBACK_ADD_URL);
    }
    if (!source) return res.status(404).send('Not found');

    basicId = await resolveBasicId(source.channel_id);
    const q = req.query || {};
    const ua = req.headers['user-agent'] || '';
    const clickId = UUID_RE.test(String(q.cid || '')) ? String(q.cid).toLowerCase() : crypto.randomUUID();
    const row = {
      source_id: source.id,
      click_id: clickId,
      // entry: 'login'=LINE Login経由 / 'direct'=アプリ内ブラウザ等で従来の追加リンクへ（記録のみ）
      entry: isMetaCrawler(clientIp(req), ua) ? 'bot' : (String(q.entry || '') === 'direct' ? 'direct' : 'login'),
      ip_address: clientIp(req),
      user_agent: str(ua, 500),
      fbclid: str(q.fbclid, 500),
      fbc: str(q.fbc, 500),
      fbp: str(q.fbp, 200),
      utm_source: str(q.utm_source, 100),
      utm_campaign: str(q.utm_campaign, 200),
      utm_content: str(q.utm_content, 200),
      utm_term: str(q.utm_term, 200),
      landing_url: str(q.lp || req.headers.referer, 1000),
    };
    // click_id が既に使われていれば（同じボタンを2回押した等）新しいIDで保存
    let { error: insErr } = await supabase.from('traffic_clicks').insert(row);
    if (insErr) {
      row.click_id = crypto.randomUUID();
      ({ error: insErr } = await supabase.from('traffic_clicks').insert(row));
    }
    if (insErr) console.error('[line-login] click insert error:', insErr.message);
    supabase.from('traffic_sources').update({ click_count: (source.click_count || 0) + 1 }).eq('id', source.id)
      .then(() => {}, () => {});

    // mode=log: LP側のJSがLINE認可URLへ直接遷移する構成（コールドスタートの待ちを見せない）。
    // ここでは記録だけして 204 を返す
    if (String(q.mode || '') === 'log') {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Cache-Control', 'no-store');
      return res.status(204).end();
    }

    // PC / 未設定 → 従来の友だち追加URL（QRが出る）
    const login = await getLoginConfig();
    if (!login.configured || !isMobile(ua)) {
      return res.redirect(addFriendUrl(basicId));
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: login.channelId,
      redirect_uri: callbackUrl(),
      state: row.click_id,
      scope: 'profile openid',
      bot_prompt: 'aggressive',
    });
    return res.redirect(`https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`);
  } catch (err) {
    console.error('GET /go/:code error:', err.message);
    return res.redirect(addFriendUrl(basicId));
  }
});

// ── 共通: state を解釈してクリック行を取得（無ければ作る） ─────────────────
function parseState(state) {
  const st = String(state || '');
  const dot = st.indexOf('.');
  const stateCode = dot > 0 ? st.slice(0, dot) : null;
  const stateClickId = (dot > 0 ? st.slice(dot + 1) : st).toLowerCase();
  return { stateCode, stateClickId: UUID_RE.test(stateClickId) ? stateClickId : null };
}

async function resolveClick(req, { stateCode, stateClickId }) {
  const supabase = getSupabase();
  const sel = 'id, click_id, source_id, converted_at, line_user_id';
  const findClick = () => supabase.from('traffic_clicks').select(sel).eq('click_id', stateClickId).maybeSingle();
  let { data: click } = await findClick();
  if (!click) {
    // LP側の裏記録（mode=log）がコールドスタートで遅れている場合に備えて少し待つ
    await new Promise(r => setTimeout(r, 700));
    ({ data: click } = await findClick());
  }
  if (!click && stateCode) {
    // 記録が届いていなければ経路コードから最低限の行を作る（広告パラメータは失われるが追加は確定させる）
    const { data: src } = await supabase.from('traffic_sources').select('id').eq('code', stateCode).maybeSingle();
    if (src) {
      const { data: ins } = await supabase.from('traffic_clicks').insert({
        source_id: src.id, click_id: stateClickId, entry: 'login',
        ip_address: clientIp(req), user_agent: str(req.headers['user-agent'], 500),
      }).select(sel).maybeSingle();
      click = ins || null;
    }
  }
  return click;
}

// ── 共通: 友だち追加を確定（friends upsert・経路確定・タグ・CAPI） ─────────────
async function finalizeAdd({ click, source, channelId, prof, friendFlag }) {
  const supabase = getSupabase();
  const lineUserId = prof.userId;
  await supabase.from('traffic_clicks').update({ line_user_id: lineUserId }).eq('id', click.id);
  if (!friendFlag) return { added: false };

  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from('friends')
    .select('id, traffic_source_id, first_click_id, status')
    .eq('line_user_id', lineUserId)
    .eq('channel_id', channelId)
    .maybeSingle();

  let friendId = existing?.id || null;
  let attributedNow = false;
  if (existing) {
    const upd = { status: 'active', updated_at: now };
    if (prof.displayName) upd.display_name = prof.displayName;
    if (prof.pictureUrl !== undefined) upd.picture_url = prof.pictureUrl || null;
    if (prof.statusMessage !== undefined) upd.status_message = prof.statusMessage || null;
    if (!existing.traffic_source_id && click.source_id) { upd.traffic_source_id = click.source_id; attributedNow = true; }
    if (!existing.first_click_id) upd.first_click_id = click.click_id;
    await supabase.from('friends').update(upd).eq('id', existing.id);
  } else {
    const { data: ins } = await supabase.from('friends').insert({
      line_user_id: lineUserId,
      display_name: prof.displayName || 'Unknown',
      picture_url: prof.pictureUrl || null,
      status_message: prof.statusMessage || null,
      status: 'active',
      channel_id: channelId,
      traffic_source_id: click.source_id,
      first_click_id: click.click_id,
      followed_at: now,
    }).select('id').maybeSingle();
    friendId = ins?.id || null;
    attributedNow = !!click.source_id;
  }

  if (attributedNow && source) {
    supabase.from('traffic_sources').update({ friend_count: (source.friend_count || 0) + 1 }).eq('id', source.id)
      .then(() => {}, () => {});
    const tagIds = Array.isArray(source.tag_ids) ? source.tag_ids.filter(Boolean) : [];
    if (friendId && tagIds.length) {
      try {
        const { data: have } = await supabase.from('friend_tags').select('tag_id').eq('friend_id', friendId);
        const hs = new Set((have || []).map(r => r.tag_id));
        const rows = tagIds.filter(t => !hs.has(t)).map(t => ({ friend_id: friendId, tag_id: t }));
        if (rows.length) await supabase.from('friend_tags').insert(rows);
      } catch (e) { console.error('[line-login] tag apply error:', e.message); }
    }
  }

  // 同じ人の2回目以降（ブロック→再追加など）は CAPI を送らない
  const { data: prior } = await supabase
    .from('traffic_clicks').select('id')
    .eq('line_user_id', lineUserId).not('converted_at', 'is', null).neq('id', click.id).limit(1);
  const alreadyConverted = (prior || []).length > 0;

  if (!click.converted_at) {
    await supabase.from('traffic_clicks').update({
      converted_at: now,
      friend_id: friendId,
      ...(alreadyConverted ? { capi_status: 'skipped: already converted user', capi_sent_at: now } : {}),
    }).eq('id', click.id);
    if (!alreadyConverted) {
      // レスポンスを遅らせないため waitUntil で送る（使えない環境では完了を待つ。失敗時は cron が再送）
      const p = capi.sendAndRecord(click.click_id, { contentName: source?.name || null })
        .catch(e => console.error('[line-login] capi error:', e.message));
      let deferred = false;
      try { const { waitUntil } = require('@vercel/functions'); if (typeof waitUntil === 'function') { waitUntil(p); deferred = true; } } catch {}
      if (!deferred) { try { await Promise.race([p, new Promise(r => setTimeout(r, 4000))]); } catch {} }
    }
  }
  console.log(`[line-login] ${prof.displayName} added via ${source?.name || click.source_id} (click ${click.click_id})`);
  return { added: true, friendId };
}

// ── follow webhook から呼ぶ: LIFFで「未友だち」だった人が、その後に友だち追加したら確定する ──
// LIFFページは友だち判定が false のとき line_user_id だけ記録して友だち追加画面へ送る。
// 追加が完了すると follow webhook が来るので、その userId の未確定Loginクリック（24時間以内）を
// ここで確定し（経路・タグ・CAPI）、広告単位の実追加として集計する。
async function confirmFollowByUser({ lineUserId, channelId, prof }) {
  const supabase = getSupabase();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: click } = await supabase
    .from('traffic_clicks').select('id, click_id, source_id, converted_at, line_user_id')
    .eq('line_user_id', lineUserId).eq('entry', 'login').is('converted_at', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!click) return null;
  const { data: source } = await supabase
    .from('traffic_sources').select('id, name, channel_id, friend_count, tag_ids')
    .eq('id', click.source_id).maybeSingle();
  return finalizeAdd({ click, source, channelId: channelId || source?.channel_id || DEFAULT_CHANNEL_ID, prof: { userId: lineUserId, ...(prof || {}) }, friendFlag: true });
}

// ── GET /line-login/callback（LINE Login Web フロー） ─────────────────────────
router.get('/line-login/callback', async (req, res) => {
  const supabase = getSupabase();
  const { code, state, error } = req.query || {};
  let basicId = '@956iyppc';
  try {
    const st = parseState(state);
    if (!st.stateClickId) return res.redirect(FALLBACK_ADD_URL);
    const click = await resolveClick(req, st);
    if (!click) return res.redirect(FALLBACK_ADD_URL);

    const { data: source } = await supabase
      .from('traffic_sources').select('id, name, channel_id, friend_count, tag_ids')
      .eq('id', click.source_id).maybeSingle();
    const channelId = source?.channel_id || DEFAULT_CHANNEL_ID;
    basicId = await resolveBasicId(channelId);

    const login = await getLoginConfig();
    if (error || !code || !login.configured) return res.redirect(addFriendUrl(basicId));

    const tokenResp = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code: String(code), redirect_uri: callbackUrl(),
        client_id: login.channelId, client_secret: login.channelSecret,
      }),
    });
    if (!tokenResp.ok) {
      console.error('[line-login] token exchange failed:', tokenResp.status, await tokenResp.text().catch(() => ''));
      return res.redirect(addFriendUrl(basicId));
    }
    const token = await tokenResp.json();
    const auth = { Authorization: `Bearer ${token.access_token}` };
    const profResp = await fetch('https://api.line.me/v2/profile', { headers: auth });
    if (!profResp.ok) return res.redirect(addFriendUrl(basicId));
    const prof = await profResp.json();
    let friendFlag = false;
    try { const fr = await fetch('https://api.line.me/friendship/v1/status', { headers: auth }); if (fr.ok) friendFlag = !!(await fr.json()).friendFlag; } catch {}

    const r = await finalizeAdd({ click, source, channelId, prof, friendFlag });
    return res.redirect(r.added ? talkUrl(basicId) : addFriendUrl(basicId));
  } catch (err) {
    console.error('GET /line-login/callback error:', err.message);
    return res.redirect(addFriendUrl(basicId));
  }
});

// ── LIFF フロー（LINEアプリ内で開く。アプリ内ブラウザ経由でもLINEアプリに遷移できる） ──
// GET /liff/add : LIFFのエンドポイント（HTML）。liff.init → 自動ログイン（友だち追加オプション aggressive）→ /liff/confirm
router.get('/liff/add', async (req, res) => {
  // 既定は「FITPEAK 友だち追加（クレアショットLP）」LIFF（LIFF IDは秘密情報ではない）
  const liffId = str(req.query.liff_id) || (await getLoginConfig()).liffId || '2006537445-rcvSBpCP';
  const basicId = await resolveBasicId(DEFAULT_CHANNEL_ID);
  res.set('Cache-Control', 'no-store');
  res.type('html').send(`<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>FITPEAK 公式LINE</title>
<style>
  html,body{margin:0;background:#fff;font-family:"Noto Sans JP","Hiragino Sans",-apple-system,sans-serif;color:#222}
  .wrap{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 24px;text-align:center;box-sizing:border-box}
  .logo{font-weight:900;font-size:22px;letter-spacing:.04em;color:#3F9403;margin-bottom:18px}
  h1{font-size:20px;margin:0 0 10px}
  p{font-size:14px;line-height:1.7;color:#555;margin:0 0 22px}
  .btn{display:block;width:100%;max-width:360px;padding:16px;border-radius:12px;background:#06C755;color:#fff;font-weight:700;font-size:17px;text-decoration:none;box-sizing:border-box}
  .spinner{width:36px;height:36px;border:4px solid #e6ecd8;border-top-color:#06C755;border-radius:50%;animation:s 1s linear infinite;margin:0 auto 18px}
  @keyframes s{to{transform:rotate(360deg)}}
  .hidden{display:none}
</style></head>
<body><div class="wrap">
  <div class="logo">//FITPEAK</div>
  <div id="loading"><div class="spinner"></div><p>LINEに接続しています…</p></div>
  <div id="done" class="hidden"><h1>友だち追加ありがとうございます！</h1><p>40％OFFクーポンと先行予約のご案内は、公式LINEのトークにお送りします。</p><a class="btn" id="talk" href="https://line.me/R/oaMessage/${encodeURIComponent(basicId)}/">トークを開く</a></div>
  <div id="notfriend" class="hidden"><h1>あと1タップで完了です</h1><p>公式LINEを友だち追加すると、40％OFFクーポンと先行予約のご案内が届きます。</p><a class="btn" href="https://line.me/R/ti/p/${basicId}">友だち追加する</a></div>
  <div id="fail" class="hidden"><h1>LINEを開けませんでした</h1><p>下のボタンから友だち追加してください。</p><a class="btn" href="https://line.me/R/ti/p/${basicId}">友だち追加する</a></div>
</div>
<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
<script>
(function(){
  var LIFF_ID = ${JSON.stringify(liffId)};
  function show(id){ ['loading','done','notfriend','fail'].forEach(function(k){ document.getElementById(k).className = (k===id?'':'hidden'); }); }
  // liff.init 後は LIFF URL に付けたクエリ（?cid=…&code=…）が location.search に復元される
  function qp(k){ var q = new URLSearchParams(location.search); var v = q.get(k); if (v) return v;
    try { var st = q.get('liff.state'); if (st) { var q2 = new URLSearchParams(st.charAt(0) === '?' ? st.slice(1) : st); return q2.get(k) || ''; } } catch (e) {} return ''; }
  function state(){ return (qp('code')||'ytq6hwej') + '.' + (qp('cid')||''); }
  if (!LIFF_ID || !window.liff) { show('fail'); return; }
  liff.init({ liffId: LIFF_ID }).then(function(){
    if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }
    return liff.getFriendship().catch(function(){ return { friendFlag: false }; }).then(function(fr){
      // 記録（経路確定・CAPI）は裏で送り、画面はすぐ次へ進める
      try {
        fetch('/api/line-crm/liff/confirm', { method:'POST', headers:{'Content-Type':'application/json'}, keepalive: true,
          body: JSON.stringify({ accessToken: liff.getAccessToken(), state: state(), friendFlag: !!fr.friendFlag, ua: navigator.userAgent }) }).catch(function(){});
      } catch (e) {}
      if (fr.friendFlag) {
        show('done');
        setTimeout(function(){ location.href = document.getElementById('talk').href; }, 700);
      } else {
        show('notfriend');
      }
    });
  }).catch(function(e){ console.error(e); show('fail'); });
})();
</script></body></html>`);
});

// POST /liff/confirm : LIFFのアクセストークンを検証して友だち追加を確定
router.options('/liff/confirm', (_req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.status(204).end();
});
router.post('/liff/confirm', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  try {
    const supabase = getSupabase();
    const { accessToken, state } = req.body || {};
    if (!accessToken) return res.status(400).json({ ok: false, error: 'accessToken required' });
    const st = parseState(state);
    if (!st.stateClickId) return res.status(400).json({ ok: false, error: 'bad state' });

    // トークン検証（このLoginチャネルで発行されたものか）
    const login = await getLoginConfig();
    const v = await fetch(`https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`);
    if (!v.ok) return res.status(401).json({ ok: false, error: 'invalid token' });
    const vj = await v.json();
    if (login.channelId && String(vj.client_id) !== String(login.channelId)) return res.status(401).json({ ok: false, error: 'token channel mismatch' });

    const auth = { Authorization: `Bearer ${accessToken}` };
    const profResp = await fetch('https://api.line.me/v2/profile', { headers: auth });
    if (!profResp.ok) return res.status(401).json({ ok: false, error: 'profile failed' });
    const prof = await profResp.json();
    let friendFlag = false;
    try { const fr = await fetch('https://api.line.me/friendship/v1/status', { headers: auth }); if (fr.ok) friendFlag = !!(await fr.json()).friendFlag; } catch {}

    const click = await resolveClick(req, st);
    if (!click) return res.status(404).json({ ok: false, error: 'click not found' });
    const { data: source } = await supabase
      .from('traffic_sources').select('id, name, channel_id, friend_count, tag_ids')
      .eq('id', click.source_id).maybeSingle();
    const channelId = source?.channel_id || DEFAULT_CHANNEL_ID;
    const r = await finalizeAdd({ click, source, channelId, prof, friendFlag });
    res.json({ ok: true, added: r.added, friendFlag });
  } catch (err) {
    console.error('POST /liff/confirm error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /line-login/status  設定状態（ダッシュボード用） ───────────────────────
router.get('/line-login/status', async (_req, res) => {
  const login = await getLoginConfig();
  const c = await capi.getConfig();
  res.set('Access-Control-Allow-Origin', '*');
  res.json({
    login_configured: login.configured,
    login_channel_id: login.configured ? login.channelId : null,
    liff_add_id: login.liffId || null,
    capi_configured: !!(c.pixelId && c.token),
    capi_event_name: c.eventName,
    capi_test_mode: !!c.testCode,
    callback_url: callbackUrl(),
  });
});

// ── GET /traffic-sources/ads?days=N&channel_id=  広告別の実追加 ─────────────────
router.get('/traffic-sources/ads', async (req, res) => {
  try {
    const supabase = getSupabase();
    const days = Math.max(1, Math.min(365, parseInt(req.query.days, 10) || 30));
    const channelId = req.query.channel_id || DEFAULT_CHANNEL_ID;
    const since = new Date(Date.now() - days * 86400000);
    const sinceIso = since.toISOString();

    const { data: sources } = await supabase.from('traffic_sources').select('id, name').eq('channel_id', channelId);
    const sourceIds = (sources || []).map(s => s.id);
    const nameById = Object.fromEntries((sources || []).map(s => [s.id, s.name]));
    if (!sourceIds.length) return res.json({ days, ads: [], campaigns: [], totals: { clicks: 0, friends: 0, spend: 0 } });

    const { data: clicks } = await supabase
      .from('traffic_clicks')
      .select('source_id, entry, utm_campaign, utm_content, utm_term, converted_at, capi_sent_at, user_agent')
      .in('source_id', sourceIds)
      .neq('entry', 'bot')
      .gte('created_at', sinceIso)
      .limit(20000);

    const { data: spendRows } = await supabase
      .from('ad_spend')
      .select('ad_id, ad_name, spend, spend_date')
      .gte('spend_date', since.toISOString().slice(0, 10));
    const spendByAd = {};
    const adNameById = {};
    for (const r of spendRows || []) {
      spendByAd[r.ad_id] = (spendByAd[r.ad_id] || 0) + Number(r.spend || 0);
      if (r.ad_name) adNameById[r.ad_id] = r.ad_name;
    }

    const ads = {};
    const campaigns = {};
    let totalClicks = 0, totalFriends = 0;
    for (const c of clicks || []) {
      const isBot = /bot|crawler|spider|facebookexternalhit|preview/i.test(c.user_agent || '');
      if (isBot) continue;
      const adId = c.utm_content || '(広告ID不明)';
      const campId = c.utm_campaign || '(キャンペーン不明)';
      ads[adId] = ads[adId] || { ad_id: adId, ad_name: adNameById[adId] || null, campaign_id: campId, adset_id: c.utm_term || null, source: nameById[c.source_id] || null, clicks: 0, friends: 0, capi_sent: 0 };
      campaigns[campId] = campaigns[campId] || { campaign_id: campId, clicks: 0, friends: 0 };
      ads[adId].clicks++; campaigns[campId].clicks++; totalClicks++;
      if (c.converted_at) { ads[adId].friends++; campaigns[campId].friends++; totalFriends++; }
      if (c.capi_sent_at) ads[adId].capi_sent++;
    }
    const adList = Object.values(ads).map(a => {
      const spend = spendByAd[a.ad_id] || 0;
      return {
        ...a,
        spend,
        add_rate: a.clicks ? Math.round((a.friends / a.clicks) * 1000) / 10 : 0,
        cpa: a.friends && spend ? Math.round(spend / a.friends) : null,
      };
    }).sort((x, y) => y.friends - x.friends || y.clicks - x.clicks);
    const campList = Object.values(campaigns).map(c => ({ ...c, add_rate: c.clicks ? Math.round((c.friends / c.clicks) * 1000) / 10 : 0 }))
      .sort((x, y) => y.friends - x.friends);
    const totalSpend = Object.values(spendByAd).reduce((s, v) => s + v, 0);
    res.json({ days, ads: adList, campaigns: campList, totals: { clicks: totalClicks, friends: totalFriends, spend: totalSpend, cpa: totalFriends && totalSpend ? Math.round(totalSpend / totalFriends) : null } });
  } catch (err) {
    console.error('GET /traffic-sources/ads error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /ad-spend  広告費の手入力（[{ad_id, ad_name?, spend_date, spend}]） ────
router.post('/ad-spend', async (req, res) => {
  try {
    const supabase = getSupabase();
    const items = Array.isArray(req.body?.items) ? req.body.items : [req.body];
    const rows = items
      .filter(it => it && it.ad_id && it.spend_date)
      .map(it => ({ ad_id: String(it.ad_id).trim(), ad_name: it.ad_name ? String(it.ad_name).slice(0, 200) : null, spend_date: it.spend_date, spend: Number(it.spend || 0), updated_at: new Date().toISOString() }));
    if (!rows.length) return res.status(400).json({ error: 'ad_id と spend_date は必須です' });
    const { error } = await supabase.from('ad_spend').upsert(rows, { onConflict: 'ad_id,spend_date' });
    if (error) throw error;
    res.json({ ok: true, count: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /line-login/capi/retry  未送信のCAPI再送（cron） ────────────────────────
router.get('/line-login/capi/retry', async (_req, res) => {
  try {
    const r = await capi.retryPending(50);
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.confirmFollowByUser = confirmFollowByUser;
module.exports.isMetaCrawler = isMetaCrawler;
