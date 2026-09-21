/**
 * Meta Conversions API（CAPI）送信
 *
 * 目的: LINE友だち追加が「確定」した瞬間に、サーバーから Meta へ CompleteRegistration を送る。
 *       広告セットの最適化イベント（登録完了）と一致させ、Metaに「ボタンを押す人」ではなく
 *       「LINEを追加する人」を探させる。
 *
 * 設定（Business-hubの「API設定」から入力。環境変数はフォールバック）:
 *   META_PIXEL_ID            イベントマネージャの「Fitpeak's pixel」のID
 *   META_CAPI_ACCESS_TOKEN   イベントマネージャ → 設定 → コンバージョンAPI → アクセストークン
 *   META_CAPI_TEST_CODE      テスト中のみ（イベントマネージャ「テストイベント」のコード）
 *   META_CAPI_EVENT_NAME     既定 CompleteRegistration（広告セット側を「リード」に変えるなら Lead）
 */

const crypto = require('crypto');
const { getSupabase } = require('./shared.cjs');

const GRAPH_VERSION = 'v21.0';

// 設定はBusiness-hubの「API設定」（api_keysテーブル・暗号化）優先、無ければ環境変数
async function getConfig() {
  let getActiveApiKey = null;
  try { ({ getActiveApiKey } = require('./settings.cjs')); } catch {}
  const pick = async (id, envVar) => {
    if (getActiveApiKey) { try { const v = await getActiveApiKey(id); if (v) return String(v).trim(); } catch {} }
    return process.env[envVar] || null;
  };
  return {
    pixelId: await pick('meta_pixel_id', 'META_PIXEL_ID'),
    token: await pick('meta_capi_access_token', 'META_CAPI_ACCESS_TOKEN'),
    testCode: await pick('meta_capi_test_code', 'META_CAPI_TEST_CODE'),
    eventName: (await pick('meta_capi_event_name', 'META_CAPI_EVENT_NAME')) || 'CompleteRegistration',
  };
}

function sha256(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  return crypto.createHash('sha256').update(s).digest('hex');
}

async function isConfigured() {
  const c = await getConfig();
  return !!(c.pixelId && c.token);
}

async function eventName() {
  return (await getConfig()).eventName;
}

// fbclid → fbc（fb.1.<クリック時刻ms>.<fbclid>）。fbc Cookie があればそちら優先
function buildFbc({ fbc, fbclid, clickedAt }) {
  if (fbc && /^fb\.1\.\d+\./.test(fbc)) return fbc;
  if (fbclid) {
    const ts = clickedAt ? new Date(clickedAt).getTime() : Date.now();
    return `fb.1.${ts}.${fbclid}`;
  }
  return null;
}

/**
 * traffic_clicks の1行（converted済み）から CAPI イベントを組み立てて送信する。
 * 戻り値: { ok: boolean, status: string, response?: any }
 */
async function sendConversionForClick(click, opts = {}) {
  const cfg = await getConfig();
  if (!cfg.pixelId || !cfg.token) return { ok: false, status: 'not_configured' };
  if (!click || !click.converted_at) return { ok: false, status: 'not_converted' };

  const name = opts.eventName || click.capi_event_name || cfg.eventName;
  const userData = {};
  const fbc = buildFbc({ fbc: click.fbc, fbclid: click.fbclid, clickedAt: click.created_at });
  if (fbc) userData.fbc = fbc;
  if (click.fbp) userData.fbp = click.fbp;
  if (click.ip_address) userData.client_ip_address = String(click.ip_address).split(',')[0].trim();
  if (click.user_agent) userData.client_user_agent = click.user_agent;
  const ext = sha256(click.line_user_id);
  if (ext) userData.external_id = [ext];

  const event = {
    event_name: name,
    event_time: Math.floor(new Date(click.converted_at).getTime() / 1000),
    event_id: click.click_id,
    action_source: 'website',
    event_source_url: click.landing_url || undefined,
    user_data: userData,
    custom_data: {
      content_name: opts.contentName || click.source_name || undefined,
      currency: 'JPY',
      value: 0,
    },
  };

  const body = { data: [event] };
  if (cfg.testCode) body.test_event_code = cfg.testCode;

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${cfg.pixelId}/events?access_token=${encodeURIComponent(cfg.token)}`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await resp.json().catch(() => ({}));
    if (resp.ok && !json.error) {
      return { ok: true, status: 'ok', response: json };
    }
    const msg = json?.error?.message || `HTTP ${resp.status}`;
    return { ok: false, status: msg.slice(0, 500), response: json };
  } catch (err) {
    return { ok: false, status: `fetch: ${err.message}`.slice(0, 500) };
  }
}

/**
 * click_id を指定して送信し、結果を traffic_clicks に記録する。
 */
async function sendAndRecord(clickId, opts = {}) {
  const supabase = getSupabase();
  const { data: click } = await supabase
    .from('traffic_clicks')
    .select('id, click_id, created_at, converted_at, fbclid, fbc, fbp, ip_address, user_agent, landing_url, line_user_id, capi_event_name, capi_attempts, source_id')
    .eq('click_id', clickId)
    .maybeSingle();
  if (!click) return { ok: false, status: 'click_not_found' };

  let sourceName = null;
  if (click.source_id) {
    const { data: src } = await supabase.from('traffic_sources').select('name').eq('id', click.source_id).maybeSingle();
    sourceName = src?.name || null;
  }

  const result = await sendConversionForClick({ ...click, source_name: sourceName }, opts);
  await supabase.from('traffic_clicks').update({
    capi_event_name: opts.eventName || click.capi_event_name || (await eventName()),
    capi_attempts: (click.capi_attempts || 0) + 1,
    capi_status: result.status,
    ...(result.ok ? { capi_sent_at: new Date().toISOString() } : {}),
  }).eq('id', click.id);
  if (!result.ok) console.error('[meta-capi] send failed:', clickId, result.status);
  return result;
}

/**
 * 未送信（converted済み・capi_sent_at なし・試行5回未満）を再送。cronから呼ぶ。
 */
async function retryPending(limit = 50) {
  if (!(await isConfigured())) return { sent: 0, failed: 0, skipped: 'not_configured' };
  const supabase = getSupabase();
  const { data: rows } = await supabase
    .from('traffic_clicks')
    .select('click_id')
    .not('converted_at', 'is', null)
    .is('capi_sent_at', null)
    .lt('capi_attempts', 5)
    .order('converted_at', { ascending: true })
    .limit(limit);
  let sent = 0, failed = 0;
  for (const r of rows || []) {
    const res = await sendAndRecord(r.click_id);
    if (res.ok) sent++; else failed++;
  }
  return { sent, failed };
}

module.exports = { getConfig, isConfigured, eventName, buildFbc, sendConversionForClick, sendAndRecord, retryPending };
