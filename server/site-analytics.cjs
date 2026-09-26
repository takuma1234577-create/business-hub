/**
 * FITPEAK サイト分析（fitpeak.co 全体のアクセス解析）
 *
 * - 計測タグ fa.js を Shopify テーマ（theme.liquid）の </head> 直前に1行入れるだけで、
 *   全ページのページビュー・滞在時間・スクロール・クリック・カート追加・購入手続きを収集する。
 * - 画面は Business-hub の「FITPEAKサイト分析」（/site-analytics）。
 *   リアルタイム／サイト全体／ページ別／ヒートマップの4タブ。
 * - 保存先は Supabase の site_events。集計は DB 関数（site_overview / site_realtime / site_heatmap）。
 * - 集計の事前計算：pg_cron が15分ごとに site_rollup（1ページビュー1行の site_pageviews と
 *   クリックの時間集計 site_click_hourly を「1時間前」まで確定）と site_warm_cache（サイト全体の
 *   7日間・30日間・90日間を計算して site_report_cache に保存）を実行する。
 *   site_overview は確定済みの行＋直近の未確定分だけ生データから計算する（site_pv_rows）。
 * - 個人を特定する情報は保存しない（IPは保存せず、国・都市のみ。visitor_id はブラウザ内のランダムID）。
 * - 自分のアクセスを除外したいときは、fitpeak.co を ?fa_optout=1 付きで一度開く（?fa_optout=0 で解除）。
 * - 登録の分析（「登録」タブ）：
 *   公式LINE … テーマの LINE ボタンが送る記録URL（/api/line-crm/go/<経路コード>?mode=log）に
 *               fa.js が fa_vid / fa_sid を付ける → traffic_clicks に保存され、登録した訪問と結び付く。
 *   My FITPEAK … fa.js が my.fitpeak.co へのリンクに fa_vid / fa_sid / fa_from / fa_place / fa_t を付ける。
 *               my.fitpeak.co はそれを覚えておき、ログイン後に POST /signup-attr へ送る。
 *               ログインユーザーが「サイトのリンクを押した後に作られた」ときだけ新規登録として site_signups に残す。
 */
const express = require('express');
const crypto = require('crypto');
const { getSupabase } = require('./shared.cjs');

const publicRouter = express.Router();
const router = express.Router();
const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });

const DEFAULT_SITE = 'fitpeak.co';
const SITE_ORIGIN = 'https://fitpeak.co';
const SCREENSHOT_BUCKET = 'line-media';

// ---------------------------------------------------------------------------
// 計測タグ fa.js
// ---------------------------------------------------------------------------
const TRACKER_JS = `(function(){
try{
  if(window.__fa)return;window.__fa=1;
  if(window.Shopify&&window.Shopify.designMode)return; // テーマエディタ内は計測しない
  var s=document.currentScript;
  var SITE=(s&&s.getAttribute('data-site'))||location.hostname.replace(/^www\\./,'');
  var API=(s&&s.src)?s.src.replace(/fa\\.js.*$/,'collect'):'/api/public/site-analytics/collect';
  var LS;try{LS=window.localStorage;LS.setItem('_fa_t','1');LS.removeItem('_fa_t');}catch(e){LS=null;}
  function g(k){try{return LS?LS.getItem(k):null;}catch(e){return null;}}
  function st(k,v){try{if(LS)LS.setItem(k,v);}catch(e){}}
  var qs=location.search||'';
  if(/[?&]fa_optout=1/.test(qs))st('fa_optout','1');
  if(/[?&]fa_optout=0/.test(qs)){try{LS&&LS.removeItem('fa_optout');}catch(e){}}
  if(g('fa_optout')==='1')return;
  if(/bot|crawl|spider|lighthouse|headless/i.test(navigator.userAgent||''))return;
  function rid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,10);}
  var newV=false,vid=g('fa_vid');if(!vid){vid=rid();newV=true;st('fa_vid',vid);}
  var now=Date.now(),newS=false,ses=null;
  try{ses=JSON.parse(g('fa_ses')||'null');}catch(e){}
  if(!ses||!ses.id||now-(ses.t||0)>30*60*1000){ses={id:rid(),t:now};newS=true;}
  function touch(){ses.t=Date.now();st('fa_ses',JSON.stringify(ses));}
  touch();
  var pvid=rid();
  var w=innerWidth;var device=w<768?'mobile':(w<1024&&('ontouchstart' in window)?'tablet':'desktop');
  function docH(){var b=document.body,d=document.documentElement;return Math.max(b?b.scrollHeight:0,d.scrollHeight,b?b.offsetHeight:0)||1;}
  function docW(){var b=document.body,d=document.documentElement;return Math.max(b?b.scrollWidth:0,d.scrollWidth)||1;}
  function sp(){return Math.min(1,(scrollY+innerHeight)/docH());}
  var maxSp=0;function upd(){var p=sp();if(p>maxSp)maxSp=p;}
  function base(t){return{t:t,site:SITE,vid:vid,sid:ses.id,pv:pvid,path:location.pathname,url:location.href.slice(0,500),title:(document.title||'').slice(0,200),device:device,vw:innerWidth,vh:innerHeight,dw:docW(),dh:docH()};}
  var buf=[];
  function push(e){buf.push(e);touch();if(buf.length>=15)flush(false);}
  function flush(beacon){if(!buf.length)return;var body=JSON.stringify({events:buf});buf=[];try{if(beacon&&navigator.sendBeacon){navigator.sendBeacon(API,new Blob([body],{type:'text/plain'}));}else{fetch(API,{method:'POST',headers:{'Content-Type':'text/plain'},body:body,keepalive:true}).catch(function(){});}}catch(e){}}
  // 表示時間（タブが見えている間だけ加算）
  var eng=0,visSince=document.visibilityState==='visible'?Date.now():0;
  function engaged(){return eng+(visSince?Date.now()-visSince:0);}
  // 熟読エリア：ページを20分割し、画面に映っていた時間を帯ごとに積算
  var att=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],lastA=Date.now();
  function accAtt(){var n=Date.now(),dt=n-lastA;lastA=n;if(!visSince||dt<=0||dt>5000)return;var h=docH(),top=scrollY/h,bot=(scrollY+innerHeight)/h;for(var i=0;i<20;i++){var a=i/20,b=(i+1)/20;if(b>top&&a<bot)att[i]+=dt;}}
  setInterval(accAtt,1000);
  var pvE=base('pageview');pvE.ref=(document.referrer||'').slice(0,500);pvE.nv=newV;pvE.ns=newS;
  push(pvE);flush(false);
  addEventListener('scroll',function(){upd();},{passive:true});
  // クリック
  var recent=[];
  document.addEventListener('click',function(ev){
    var el=ev.target||{};upd();
    var a=el.closest?el.closest('a,button,[role=button],input[type=submit],summary,label'):null;var t=a||el;
    var txt='';
    if(a){txt=(a.innerText||a.value||(a.getAttribute&&a.getAttribute('aria-label'))||'')+'';if(!txt.trim()){var im=a.querySelector&&a.querySelector('img[alt]');if(im)txt=im.alt;}}
    else if(el.tagName==='IMG'){txt=el.alt||'画像';}
    else if(el!==document.body&&el!==document.documentElement){for(var ci=0;ci<(el.childNodes||[]).length;ci++){var cn=el.childNodes[ci];if(cn.nodeType===3)txt+=cn.nodeValue;}}
    txt=txt.replace(/\\s+/g,' ').trim().slice(0,80);
    var href='';try{href=(a&&a.href)?a.href:'';}catch(e){}
    // My FITPEAK へのリンク：どのページ・どのリンクから来たかを my.fitpeak.co に渡す（登録の分析用）
    try{if(a&&a.tagName==='A'&&/^https?:\\/\\/my\\.fitpeak\\.co(\\/|$|\\?)/i.test(href)&&!/[?&]fa_sid=/.test(href)){var mu=new URL(href);mu.searchParams.set('fa_vid',vid);mu.searchParams.set('fa_sid',ses.id);mu.searchParams.set('fa_from',location.pathname.slice(0,300));mu.searchParams.set('fa_place',(txt||'').slice(0,60));mu.searchParams.set('fa_t',String(Date.now()));a.href=mu.toString();}}catch(e){}
    var n=Date.now();recent.push({x:ev.clientX,y:ev.clientY,t:n});recent=recent.filter(function(c){return n-c.t<1000;});
    var rage=recent.filter(function(c){return Math.abs(c.x-ev.clientX)<30&&Math.abs(c.y-ev.clientY)<30;}).length>=3;
    var e=base(rage?'rageclick':'click');e.x=(ev.pageX||0)/docW();e.y=(ev.pageY||0)/docH();e.txt=txt;e.sel=cssPath(t);e.href=(href+'').slice(0,300);e.sp=sp();
    push(e);
    // 購入手続きへ
    var nm=(t.getAttribute&&t.getAttribute('name'))||'';
    if(nm==='checkout'||/\\/checkout/.test(href)||/(購入手続き|レジに進む|ご購入手続き|checkout)/i.test(txt)){push(base('checkout'));flush(true);}
  },true);
  // カート追加（フォーム送信 / fetch / XHR いずれも拾う）
  var lastCart=0;function cart(){var n=Date.now();if(n-lastCart<1500)return;lastCart=n;push(base('cart_add'));flush(false);}
  document.addEventListener('submit',function(ev){try{var f=ev.target;if(f&&f.action&&/\\/cart\\/add/.test(f.action))cart();}catch(e){}},true);
  // 公式LINEボタンの記録URL（/api/line-crm/go/…）には訪問IDを付けて、登録した訪問と結び付ける
  function faDec(u){try{if(typeof u==='string'&&/\\/api\\/line-crm\\/go\\//.test(u)&&!/[?&]fa_sid=/.test(u)){u+=(u.indexOf('?')<0?'?':'&')+'fa_vid='+encodeURIComponent(vid)+'&fa_sid='+encodeURIComponent(ses.id)+'&fa_pv='+encodeURIComponent(pvid);}}catch(e){}return u;}
  try{var of=window.fetch;if(of){window.fetch=function(i,o){var args=Array.prototype.slice.call(arguments);try{var u=typeof i==='string'?i:(i&&i.url)||'';if(/\\/cart\\/add/.test(u))cart();if(typeof i==='string')args[0]=faDec(i);}catch(e){}return of.apply(this,args);};}}catch(e){}
  try{var oo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){try{if(/\\/cart\\/add/.test(u||''))cart();}catch(e){}return oo.apply(this,arguments);};}catch(e){}
  // 15秒ごとの生存通知（リアルタイム表示と滞在時間用）
  setInterval(function(){if(document.visibilityState!=='visible')return;upd();var e=base('ping');e.pct=maxSp;e.eng=engaged();push(e);flush(false);},15000);
  var left=false;
  function leave(){if(left)return;left=true;accAtt();upd();var e=base('leave');e.pct=maxSp;e.eng=engaged();e.meta={att:att.map(function(v){return Math.round(v);})};push(e);flush(true);}
  addEventListener('visibilitychange',function(){
    if(document.visibilityState==='hidden'){accAtt();if(visSince){eng+=Date.now()-visSince;visSince=0;}upd();var e=base('ping');e.pct=maxSp;e.eng=engaged();push(e);flush(true);}
    else{visSince=Date.now();lastA=Date.now();touch();}
  });
  addEventListener('pagehide',leave);
  function cssPath(el){if(!el||!el.tagName)return '';var p=[],n=el,d=0;while(n&&n.tagName&&d<4){var t=n.tagName.toLowerCase();if(n.id){p.unshift(t+'#'+n.id);break;}if(n.className&&typeof n.className==='string'){var c=n.className.trim().split(/\\s+/).slice(0,2).join('.');if(c)t+='.'+c;}p.unshift(t);n=n.parentElement;d++;}return p.join('>').slice(0,160);}
}catch(e){}
})();`;

publicRouter.get('/fa.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.send(TRACKER_JS);
});

// ---------------------------------------------------------------------------
// 流入元の分類・UA解析
// ---------------------------------------------------------------------------
const SEARCH = /(^|\.)(google\.|bing\.com|yahoo\.|duckduckgo\.com|baidu\.com|naver\.com|ecosia\.org|search\.)/i;
const SNS = /(^|\.)(instagram\.com|facebook\.com|fb\.com|fb\.me|m\.facebook\.com|l\.facebook\.com|lm\.facebook\.com|t\.co|x\.com|twitter\.com|tiktok\.com|youtube\.com|youtu\.be|line\.me|lin\.ee|threads\.net|threads\.com|pinterest\.|note\.com|ameblo\.jp)$/i;
const AI = /(^|\.)(chatgpt\.com|chat\.openai\.com|openai\.com|perplexity\.ai|gemini\.google\.com|claude\.ai|copilot\.microsoft\.com|you\.com|phind\.com)$/i;

function classify({ refHost, ownHost, utmSource, utmMedium, url }) {
  const q = (() => { try { return new URL(url).searchParams; } catch { return new URLSearchParams(); } })();
  const med = (utmMedium || '').toLowerCase();
  const src = (utmSource || '').toLowerCase();
  if (q.get('fbclid') || q.get('gclid') || q.get('ttclid') || q.get('yclid') || q.get('twclid')
      || /^(cpc|ppc|paid|paidsocial|paid_social|ads?|display|cpm)$/.test(med)) return '広告';
  if (src && /chatgpt|openai|perplexity|gemini|claude|copilot/.test(src)) return 'AI';
  if (refHost && ownHost && (refHost === ownHost || refHost.endsWith('.' + ownHost)
      || /(^|\.)myshopify\.com$|(^|\.)shopify\.com$/.test(refHost))) return '内部';
  if (src || med) {
    if (/mail|newsletter/.test(src + med) || /^line$/.test(src)) return 'メール・LINE';
    if (/instagram|facebook|meta|tiktok|twitter|x$|youtube|threads/.test(src) || /social/.test(med)) return 'SNS';
    return 'キャンペーン';
  }
  if (!refHost) return '直接';
  if (AI.test(refHost)) return 'AI';
  if (/(^|\.)line\.me$|lin\.ee$/.test(refHost)) return 'メール・LINE';
  if (SEARCH.test(refHost)) return '自然検索';
  if (SNS.test(refHost)) return 'SNS';
  if (/mail\.|outlook\.|gmail/.test(refHost)) return 'メール・LINE';
  return '参照サイト';
}

function parseUa(ua = '') {
  let browser = 'その他';
  if (/Line\//i.test(ua)) browser = 'LINE内ブラウザ';
  else if (/Instagram/i.test(ua)) browser = 'Instagram内ブラウザ';
  else if (/FBAN|FBAV|FB_IAB/i.test(ua)) browser = 'Facebook内ブラウザ';
  else if (/musical_ly|TikTok|BytedanceWebview/i.test(ua)) browser = 'TikTok内ブラウザ';
  else if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/SamsungBrowser/i.test(ua)) browser = 'Samsung Internet';
  else if (/CriOS|Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/FxiOS|Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua)) browser = 'Safari';
  let os = 'その他';
  if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Linux/i.test(ua)) os = 'Linux';
  return { browser, os };
}

const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|preview|lighthouse|headless|pingdom|uptime/i;

// ---------------------------------------------------------------------------
// 収集（公開・sendBeacon のため text/plain で受ける）
// ---------------------------------------------------------------------------
publicRouter.post('/collect', express.text({ type: '*/*', limit: '512kb' }), async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const ua = req.headers['user-agent'] || '';
    if (BOT_UA.test(ua)) return res.status(204).end();
    let payload = req.body;
    if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { payload = null; } }
    const events = payload && Array.isArray(payload.events) ? payload.events.slice(0, 50) : [];
    if (!events.length) return res.status(204).end();

    const { browser, os } = parseUa(ua);
    const country = (req.headers['x-vercel-ip-country'] || '').toString().slice(0, 8) || null;
    let city = (req.headers['x-vercel-ip-city'] || '').toString();
    try { city = decodeURIComponent(city); } catch { /* noop */ }
    city = city.slice(0, 80) || null;

    const num = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v) : null);
    const r01 = (v) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1, v)) : null);
    const str = (v, n) => (v == null || v === '' ? null : String(v).slice(0, n));
    const TYPES = ['pageview', 'ping', 'leave', 'click', 'rageclick', 'cart_add', 'checkout'];

    const rows = [];
    for (const e of events) {
      if (!e || !TYPES.includes(e.t)) continue;
      const url = str(e.url, 500);
      let ownHost = null, utmSource = null, utmMedium = null, utmCampaign = null;
      try {
        const u = new URL(url);
        ownHost = u.hostname.replace(/^www\./, '');
        utmSource = str(u.searchParams.get('utm_source'), 80);
        utmMedium = str(u.searchParams.get('utm_medium'), 80);
        utmCampaign = str(u.searchParams.get('utm_campaign'), 120);
      } catch { /* noop */ }
      let refHost = null;
      if (e.ref) { try { refHost = new URL(e.ref).hostname.replace(/^www\./, ''); } catch { /* noop */ } }
      const row = {
        site: str(e.site, 60) || DEFAULT_SITE,
        event_type: e.t,
        visitor_id: str(e.vid, 40), session_id: str(e.sid, 40), pageview_id: str(e.pv, 40),
        path: str(e.path, 300), url, title: str(e.title, 200),
        device: ['mobile', 'tablet', 'desktop'].includes(e.device) ? e.device : 'desktop',
        browser, os, country, city,
        vw: num(e.vw), vh: num(e.vh), doc_w: num(e.dw), doc_h: num(e.dh),
      };
      if (e.t === 'pageview') {
        Object.assign(row, {
          is_new_visitor: !!e.nv, is_new_session: !!e.ns,
          referrer: str(e.ref, 500), ref_host: refHost,
          utm_source: utmSource, utm_medium: utmMedium, utm_campaign: utmCampaign,
          channel: classify({ refHost, ownHost, utmSource, utmMedium, url }),
        });
      }
      if (e.t === 'click' || e.t === 'rageclick') {
        Object.assign(row, {
          x_ratio: r01(e.x), y_ratio: r01(e.y), scroll_pct: r01(e.sp),
          el_text: str(e.txt, 120), el_selector: str(e.sel, 160), href: str(e.href, 300),
        });
      }
      if (e.t === 'ping' || e.t === 'leave') {
        row.scroll_pct = r01(e.pct);
        row.engaged_ms = num(e.eng) != null ? Math.max(0, Math.min(num(e.eng), 3600000)) : null;
      }
      if (e.t === 'leave' && e.meta && Array.isArray(e.meta.att)) {
        row.meta = { att: e.meta.att.slice(0, 20).map((v) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(Math.round(v), 3600000)) : 0)) };
      }
      rows.push(row);
    }
    if (rows.length) {
      const { error } = await supabase.rpc('site_collect', { p_rows: rows });
      if (error) console.error('[site-analytics/collect] rpc error:', error.message);
    }
    return res.status(204).end();
  } catch (err) {
    console.error('[site-analytics/collect] error:', err.message);
    return res.status(204).end();
  }
});

// ---------------------------------------------------------------------------
// 管理画面用API（要ログイン）
// ---------------------------------------------------------------------------
function range(q) {
  const now = new Date();
  let from, to;
  if (q.from && q.to) {
    from = new Date(q.from); to = new Date(q.to);
  } else {
    const preset = q.preset || '7d';
    // 日本時間の0時基準
    const jstNow = new Date(now.getTime() + 9 * 3600000);
    const jstMidnightUtc = Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate()) - 9 * 3600000;
    if (preset === 'today') { from = new Date(jstMidnightUtc); to = now; }
    else if (preset === 'yesterday') { from = new Date(jstMidnightUtc - 86400000); to = new Date(jstMidnightUtc); }
    else if (preset === '24h') { from = new Date(now.getTime() - 86400000); to = now; }
    else {
      const days = parseInt(preset, 10) || 7;
      from = new Date(jstMidnightUtc - (days - 1) * 86400000); to = now;
    }
  }
  if (isNaN(from) || isNaN(to) || to <= from) throw new Error('期間の指定が不正です');
  return { from: from.toISOString(), to: to.toISOString() };
}

const siteOf = (q) => (q.site ? String(q.site).slice(0, 60) : DEFAULT_SITE);
const deviceOf = (v) => (['mobile', 'desktop', 'tablet'].includes(v) ? v : 'all');

router.get('/realtime', async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('site_realtime', { p_site: siteOf(req.query), p_active_seconds: 90 });
    if (error) throw new Error(error.message);
    res.setHeader('Cache-Control', 'no-store');
    return res.json(data);
  } catch (err) {
    console.error('[site-analytics/realtime]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// 集計結果の保存（site_report_cache）。7日間以上の期間は、保存済みの結果が20分以内なら即返す。
// サイト全体の7日間・30日間・90日間は pg_cron（site_warm_cache）が15分ごとに更新している。
const CACHE_TTL_MS = 20 * 60 * 1000;
const CACHEABLE_PRESETS = new Set(['7d', '30d', '90d']);
async function readCache(key) {
  try {
    const { data } = await supabase.from('site_report_cache').select('data, created_at').eq('key', key).maybeSingle();
    if (data && Date.now() - new Date(data.created_at).getTime() < CACHE_TTL_MS) return data.data;
  } catch { /* noop */ }
  return null;
}
function writeCache(key, data) {
  supabase.from('site_report_cache')
    .upsert({ key, data, created_at: new Date().toISOString() }, { onConflict: 'key' })
    .then(() => {}, () => {});
}

router.get('/overview', async (req, res) => {
  try {
    const site = siteOf(req.query);
    const device = deviceOf(req.query.device);
    const pagePath = req.query.path ? String(req.query.path) : null;
    const preset = req.query.preset || '7d';
    const cacheKey = !req.query.from && CACHEABLE_PRESETS.has(preset)
      ? `overview|${site}|${preset}|${device}|${pagePath || ''}` : null;
    if (cacheKey && req.query.fresh !== '1') {
      const hit = await readCache(cacheKey);
      if (hit) return res.json(hit);
    }
    const { from, to } = range(req.query);
    const { data, error } = await supabase.rpc('site_overview', {
      p_site: site, p_from: from, p_to: to, p_device: device, p_path: pagePath,
    });
    if (error) throw new Error(error.message);
    const body = { from, to, cached_at: new Date().toISOString(), ...data };
    if (cacheKey) writeCache(cacheKey, body);
    return res.json(body);
  } catch (err) {
    console.error('[site-analytics/overview]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// 公式サイト経由の登録（公式LINE・My FITPEAK）
router.get('/signups', async (req, res) => {
  try {
    const { from, to } = range(req.query);
    const site = siteOf(req.query);
    const args = {
      p_site: site, p_device: deviceOf(req.query.device),
      p_path: req.query.path ? String(req.query.path) : null,
      p_include_ads: req.query.ads === '1',
    };
    const span = new Date(to).getTime() - new Date(from).getTime();
    const prevFrom = new Date(new Date(from).getTime() - span).toISOString();
    const [cur, prev] = await Promise.all([
      supabase.rpc('site_signups_report', { ...args, p_from: from, p_to: to }),
      // 前期間はKPIだけ（軽量モード）
      supabase.rpc('site_signups_report', { ...args, p_from: prevFrom, p_to: from, p_kpis_only: true }),
    ]);
    if (cur.error) throw new Error(cur.error.message);
    return res.json({ from, to, ...cur.data, prev_kpis: prev.data?.kpis || null });
  } catch (err) {
    console.error('[site-analytics/signups]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// 1回の訪問の足どり（登録した人がどのページを見てきたか）
router.get('/journey', async (req, res) => {
  try {
    const sid = String(req.query.session || '').slice(0, 40);
    if (!sid) return res.status(400).json({ error: 'session が必要です' });
    const { data, error } = await supabase.rpc('site_session_journey', { p_session: sid });
    if (error) throw new Error(error.message);
    return res.json({ session_id: sid, events: data || [] });
  } catch (err) {
    console.error('[site-analytics/journey]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// my.fitpeak.co から：サイトのリンク経由で来た人がログインしたら送られてくる。
// ログインユーザーが「リンクを押した後（2分の余裕）に作られた」なら新規登録として記録する。
const ATTR_MAX_AGE_MS = 3 * 86400000;
publicRouter.post('/signup-attr', express.json({ limit: '8kb' }), async (req, res) => {
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return res.status(401).json({ error: 'ログインが必要です' });
    const { data: got, error: uErr } = await getSupabase().auth.getUser(token);
    const user = got?.user;
    if (uErr || !user) return res.status(401).json({ error: 'ログインを確認できませんでした' });

    const a = req.body || {};
    const clickedMs = Number(a.t) || 0;
    const now = Date.now();
    if (!clickedMs || clickedMs > now + 300000 || now - clickedMs > ATTR_MAX_AGE_MS) {
      return res.json({ recorded: false, reason: 'expired' });
    }
    const createdMs = new Date(user.created_at).getTime();
    if (!(createdMs >= clickedMs - 120000)) return res.json({ recorded: false, reason: 'existing_user' });

    const { data: member } = await supabase.from('members').select('id').eq('auth_user_id', user.id).maybeSingle();
    const isLine = user.user_metadata?.provider === 'line' || /@line\.fitpeak\.co$/i.test(user.email || '');
    const s = (v, n) => (v == null || v === '' ? null : String(v).slice(0, n));
    const fromPath = s(a.from, 300);
    const row = {
      site: DEFAULT_SITE,
      kind: 'myfitpeak',
      created_at: new Date(createdMs).toISOString(),
      auth_user_id: user.id,
      member_id: member?.id || null,
      method: isLine ? 'line' : 'email',
      visitor_id: s(a.vid, 40),
      session_id: s(a.sid, 40),
      from_path: fromPath && fromPath.startsWith('/') ? fromPath : null,
      from_url: fromPath && fromPath.startsWith('/') ? SITE_ORIGIN + fromPath : null,
      place: s(a.place, 120),
      clicked_at: new Date(clickedMs).toISOString(),
    };
    const { error } = await supabase.from('site_signups').upsert(row, { onConflict: 'auth_user_id', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return res.json({ recorded: true });
  } catch (err) {
    console.error('[site-analytics/signup-attr]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

function shotPath(site, pagePath, device) {
  const h = crypto.createHash('sha1').update(`${site}${pagePath}`).digest('hex').slice(0, 16);
  return `site-heatmaps/${h}_${device === 'mobile' ? 'mobile' : 'desktop'}.jpg`;
}

router.get('/heatmap', async (req, res) => {
  try {
    const pagePath = req.query.path ? String(req.query.path) : '/';
    const device = req.query.device === 'desktop' ? 'desktop' : 'mobile';
    const { from, to } = range(req.query);
    const site = siteOf(req.query);
    const { data, error } = await supabase.rpc('site_heatmap', {
      p_site: site, p_path: pagePath, p_device: device, p_from: from, p_to: to,
    });
    if (error) throw new Error(error.message);
    const p = shotPath(site, pagePath, device);
    const { data: list } = await supabase.storage.from(SCREENSHOT_BUCKET)
      .list('site-heatmaps', { search: p.split('/')[1] });
    const hit = (list || []).find((f) => `site-heatmaps/${f.name}` === p);
    let screenshot_url = null;
    if (hit) {
      const { data: pub } = supabase.storage.from(SCREENSHOT_BUCKET).getPublicUrl(p);
      screenshot_url = `${pub.publicUrl}?t=${new Date(hit.updated_at || hit.created_at || Date.now()).getTime()}`;
    }
    return res.json({ path: pagePath, device, from, to, screenshot_url, page_url: SITE_ORIGIN + pagePath, ...data });
  } catch (err) {
    console.error('[site-analytics/heatmap]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ページのスクリーンショットを撮り直す（ヒートマップの背景）
router.post('/screenshot', async (req, res) => {
  const pagePath = (req.body && req.body.path) ? String(req.body.path) : '/';
  const device = req.body?.device === 'desktop' ? 'desktop' : 'mobile';
  const site = siteOf(req.body || {});
  const isMobile = device === 'mobile';
  let browser;
  try {
    const chromium = require('@sparticuz/chromium');
    const puppeteer = require('puppeteer-core');
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: isMobile ? 390 : 1280, height: isMobile ? 844 : 900 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
    const page = await browser.newPage();
    // Shopify のボット対策で「There was a problem loading this website」になるのを避けるため、
    // 通常のブラウザと同じ見え方（UA・言語・webdriver フラグ）にする
    await page.setUserAgent(isMobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
      : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8' });
    await page.evaluateOnNewDocument(() => {
      try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch { /* noop */ }
      try { Object.defineProperty(navigator, 'languages', { get: () => ['ja-JP', 'ja'] }); } catch { /* noop */ }
      // 計測タグが撮影アクセスを数えないように opt-out 状態で開く
      try { localStorage.setItem('fa_optout', '1'); } catch { /* noop */ }
    });
    let resp = await page.goto(SITE_ORIGIN + pagePath, { waitUntil: 'networkidle2', timeout: 45000 });
    // ボット判定の画面が出たら少し待って1回だけ読み直す
    const blocked = async () => page.evaluate(() => /There was a problem loading this website|Checking your browser/i.test(document.body ? document.body.innerText : ''));
    if ((resp && resp.status() >= 400) || await blocked()) {
      await new Promise((r) => setTimeout(r, 4000));
      resp = await page.goto(SITE_ORIGIN + pagePath, { waitUntil: 'networkidle2', timeout: 45000 });
      if (await blocked()) {
        await browser.close(); browser = null;
        return res.status(502).json({ error: 'Shopify側のボット対策で撮影できませんでした。時間をおいて再度お試しください。' });
      }
    }
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let y = 0;
        const step = () => { window.scrollBy(0, 900); y += 900; if (y < document.body.scrollHeight && y < 40000) setTimeout(step, 150); else { window.scrollTo(0, 0); setTimeout(resolve, 500); } };
        step();
      });
    });
    try {
      await page.evaluate(() => (document.fonts && document.fonts.ready ? document.fonts.ready.then(() => undefined) : undefined));
      await new Promise((r) => setTimeout(r, 1200));
    } catch { /* noop */ }
    const buf = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 80 });
    await browser.close(); browser = null;
    const p = shotPath(site, pagePath, device);
    const { error: upErr } = await supabase.storage.from(SCREENSHOT_BUCKET)
      .upload(p, buf, { contentType: 'image/jpeg', upsert: true, cacheControl: '60' });
    if (upErr) return res.status(500).json({ error: 'アップロード失敗: ' + upErr.message });
    const { data: pub } = supabase.storage.from(SCREENSHOT_BUCKET).getPublicUrl(p);
    return res.json({ url: `${pub.publicUrl}?t=${Date.now()}` });
  } catch (err) {
    console.error('[site-analytics/screenshot]', err.message);
    try { if (browser) await browser.close(); } catch { /* noop */ }
    return res.status(500).json({ error: 'スクリーンショット生成に失敗しました: ' + err.message });
  }
});

module.exports = { publicRouter, router, classify, parseUa };
