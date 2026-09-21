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
  return { channelId, channelSecret, configured: !!(channelId && channelSecret) };
}
function isMobile(ua) {
  return /iPhone|iPad|iPod|Android/i.test(ua || '');
}
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim() || null;
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
      entry: 'login',
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

// ── GET /line-login/callback ────────────────────────────────────────────────
router.get('/line-login/callback', async (req, res) => {
  const supabase = getSupabase();
  const { code, state, error } = req.query || {};
  let basicId = '@956iyppc';
  try {
    if (!state || !UUID_RE.test(String(state))) return res.redirect(FALLBACK_ADD_URL);

    const { data: click } = await supabase
      .from('traffic_clicks')
      .select('id, click_id, source_id, converted_at, line_user_id')
      .eq('click_id', String(state).toLowerCase())
      .maybeSingle();
    if (!click) return res.redirect(FALLBACK_ADD_URL);

    const { data: source } = await supabase
      .from('traffic_sources')
      .select('id, name, channel_id, friend_count, tag_ids')
      .eq('id', click.source_id)
      .maybeSingle();
    const channelId = source?.channel_id || DEFAULT_CHANNEL_ID;
    basicId = await resolveBasicId(channelId);

    // キャンセル・エラー → 従来URLへ
    const login = await getLoginConfig();
    if (error || !code || !login.configured) {
      return res.redirect(addFriendUrl(basicId));
    }

    // トークン交換
    const tokenResp = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: callbackUrl(),
        client_id: login.channelId,
        client_secret: login.channelSecret,
      }),
    });
    if (!tokenResp.ok) {
      console.error('[line-login] token exchange failed:', tokenResp.status, await tokenResp.text().catch(() => ''));
      return res.redirect(addFriendUrl(basicId));
    }
    const token = await tokenResp.json();
    const auth = { Authorization: `Bearer ${token.access_token}` };

    // プロフィール（userId は Messaging API と同一プロバイダーなら一致する）
    const profResp = await fetch('https://api.line.me/v2/profile', { headers: auth });
    if (!profResp.ok) return res.redirect(addFriendUrl(basicId));
    const prof = await profResp.json();
    const lineUserId = prof.userId;

    // 友だち状態
    let friendFlag = false;
    try {
      const fr = await fetch('https://api.line.me/friendship/v1/status', { headers: auth });
      if (fr.ok) friendFlag = !!(await fr.json()).friendFlag;
    } catch {}

    // クリックに userId を記録（未追加でも）
    await supabase.from('traffic_clicks').update({ line_user_id: lineUserId }).eq('id', click.id);

    if (!friendFlag) {
      // 「友だち追加」のチェックを外して許可した人 → 追加画面へ
      return res.redirect(addFriendUrl(basicId));
    }

    // friends upsert（経路を確定）
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
      const upd = {
        display_name: prof.displayName || undefined,
        picture_url: prof.pictureUrl || null,
        status_message: prof.statusMessage || null,
        status: 'active',
        updated_at: now,
      };
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
      // 経路別タグ（付与のみ）
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
      .from('traffic_clicks')
      .select('id')
      .eq('line_user_id', lineUserId)
      .not('converted_at', 'is', null)
      .neq('id', click.id)
      .limit(1);
    const alreadyConverted = (prior || []).length > 0;

    if (!click.converted_at) {
      await supabase.from('traffic_clicks').update({
        converted_at: now,
        friend_id: friendId,
        ...(alreadyConverted ? { capi_status: 'skipped: already converted user', capi_sent_at: now } : {}),
      }).eq('id', click.id);
      if (!alreadyConverted) {
        // Vercel のサーバーレスはレスポンス後に処理が打ち切られるため、送信完了を待ってからリダイレクトする
        // （失敗しても10分cronの capi/retry が再送する）
        try {
          await Promise.race([
            capi.sendAndRecord(click.click_id, { contentName: source?.name || null }),
            new Promise(r => setTimeout(r, 4000)),
          ]);
        } catch (e) { console.error('[line-login] capi error:', e.message); }
      }
    }
    console.log(`[line-login] ${prof.displayName} added via ${source?.name || click.source_id} (click ${click.click_id})`);

    return res.redirect(talkUrl(basicId));
  } catch (err) {
    console.error('GET /line-login/callback error:', err.message);
    return res.redirect(addFriendUrl(basicId));
  }
});

// ── GET /line-login/status  設定状態（ダッシュボード用） ───────────────────────
router.get('/line-login/status', async (_req, res) => {
  const login = await getLoginConfig();
  const c = await capi.getConfig();
  res.json({
    login_configured: login.configured,
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
