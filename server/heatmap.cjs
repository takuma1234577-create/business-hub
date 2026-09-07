/**
 * LPヒートマップ分析（自前実装）
 *
 * - 計測タグ(hm.js)をLP(例: ShopifyのクレアショットティザーLP)に設置し、
 *   クリック座標・スクロール到達率・レイジクリック・デバイスを収集する。
 * - 収集APIは公開（顧客ブラウザから叩く）。集計/スクショ/AI分析は管理画面用。
 * - AI分析: 収集メトリクス + LPの構造/コピーをClaudeに渡し、ネックポイント(離脱箇所)
 *   と訴求ポイントのズレ、改善提案を出す。
 *
 * データは共有Supabase(fajqnrqfjugonbssssts, anonキー / getSupabase)。
 */
const express = require('express');
const cheerio = require('cheerio');
const { getSupabase, getAnthropicClient, DEFAULT_CHANNEL_ID } = require('./shared.cjs');

const router = express.Router();
const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });

const CLAUDE_MODEL = 'claude-sonnet-4-5';
const SCREENSHOT_BUCKET = 'line-media';

// ---------------------------------------------------------------------------
// 計測タグ hm.js（LPに設置する。data-source に流入経路の code を入れる）
// ---------------------------------------------------------------------------
const TRACKER_JS = `(function(){
  try{
  var s=document.currentScript;
  var SRC=(s&&s.getAttribute('data-source'))||'default';
  var API=(s&&s.src?s.src.replace(/hm\\.js.*$/,'collect'):'/api/line-crm/heatmap/collect');
  var sid;try{sid=sessionStorage.getItem('_hm_sid');if(!sid){sid=Date.now().toString(36)+Math.random().toString(36).slice(2,8);sessionStorage.setItem('_hm_sid',sid);}}catch(e){sid=Math.random().toString(36).slice(2);}
  var device=(window.matchMedia&&window.matchMedia('(max-width:767px)').matches)?'mobile':'desktop';
  var buf=[];
  function docH(){return Math.max(document.body?document.body.scrollHeight:0,document.documentElement.scrollHeight,document.body?document.body.offsetHeight:0)||1;}
  function docW(){return Math.max(document.body?document.body.scrollWidth:0,document.documentElement.scrollWidth)||1;}
  function base(){return{src:SRC,sid:sid,url:location.href,device:device,vw:innerWidth,vh:innerHeight,dw:docW(),dh:docH()};}
  function push(e){buf.push(e);if(buf.length>=20)flush(false);}
  push(Object.assign(base(),{t:'pageview'}));
  var recent=[];
  document.addEventListener('click',function(ev){
    var dw=docW(),dh=docH();
    var x=(ev.pageX||0)/dw,y=(ev.pageY||0)/dh;
    var el=ev.target||{};
    var txt=((el.innerText||el.textContent||'')+'').replace(/\\s+/g,' ').trim().slice(0,80);
    var now=Date.now();recent.push({x:ev.clientX,y:ev.clientY,t:now});recent=recent.filter(function(c){return now-c.t<1000;});
    var rage=recent.filter(function(c){return Math.abs(c.x-ev.clientX)<30&&Math.abs(c.y-ev.clientY)<30;}).length>=3;
    push(Object.assign(base(),{t:rage?'rageclick':'click',x:x,y:y,txt:txt,sel:cssPath(el)}));
  },true);
  var maxPct=0,lastSent=0;
  function onScroll(){var p=Math.min(1,(scrollY+innerHeight)/docH());if(p>maxPct)maxPct=p;}
  addEventListener('scroll',throttle(onScroll,400),{passive:true});
  function recordScroll(){if(maxPct>lastSent){lastSent=maxPct;push(Object.assign(base(),{t:'scroll',pct:maxPct}));}}
  setInterval(function(){recordScroll();flush(false);},10000);
  addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden'){recordScroll();flush(true);}});
  addEventListener('pagehide',function(){recordScroll();flush(true);});
  function flush(beacon){if(!buf.length)return;var body=JSON.stringify({events:buf});buf=[];try{if(beacon&&navigator.sendBeacon){navigator.sendBeacon(API,new Blob([body],{type:'text/plain'}));}else{fetch(API,{method:'POST',headers:{'Content-Type':'text/plain'},body:body,keepalive:true}).catch(function(){});}}catch(e){}}
  function throttle(fn,ms){var last=0,t;return function(){var n=Date.now();if(n-last>=ms){last=n;fn();}else{clearTimeout(t);t=setTimeout(function(){last=Date.now();fn();},ms-(n-last));}};}
  function cssPath(el){if(!el||!el.tagName)return '';var p=[],n=el,d=0;while(n&&n.tagName&&d<4){var t=n.tagName.toLowerCase();if(n.id){p.unshift(t+'#'+n.id);break;}if(n.className&&typeof n.className==='string'){var c=n.className.trim().split(/\\s+/).slice(0,2).join('.');if(c)t+='.'+c;}p.unshift(t);n=n.parentElement;d++;}return p.join('>').slice(0,120);}
  }catch(e){}
})();`;

router.get('/hm.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(TRACKER_JS);
});

// ---------------------------------------------------------------------------
// 収集エンドポイント（公開・CORSはグローバル設定）
// text/plain で送られてくる（sendBeaconのプリフライト回避のため）
// ---------------------------------------------------------------------------
router.post('/collect', express.text({ type: '*/*', limit: '1mb' }), async (req, res) => {
  try {
    let payload = req.body;
    if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { payload = null; } }
    const events = payload && Array.isArray(payload.events) ? payload.events : [];
    if (events.length === 0) return res.status(204).end();

    const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
    const clamp01 = (v) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1, v)) : null);
    const str = (v, n) => (v == null ? null : String(v).slice(0, n));
    const rows = events.slice(0, 100).map((e) => ({
      source_code: str(e.src, 80) || 'default',
      page_url: str(e.url, 500),
      session_id: str(e.sid, 80),
      device: e.device === 'mobile' ? 'mobile' : 'desktop',
      event_type: ['pageview', 'click', 'rageclick', 'deadclick', 'scroll'].includes(e.t) ? e.t : 'other',
      x_ratio: clamp01(e.x),
      y_ratio: clamp01(e.y),
      scroll_pct: clamp01(e.pct),
      doc_w: num(e.dw), doc_h: num(e.dh), vw: num(e.vw), vh: num(e.vh),
      el_text: str(e.txt, 120), el_selector: str(e.sel, 160),
    }));
    await supabase.from('heatmap_events').insert(rows);
    return res.status(204).end();
  } catch (err) {
    console.error('[heatmap/collect] error:', err.message);
    return res.status(204).end(); // 収集は常に握りつぶす（LP側でエラーを出さない）
  }
});

// ---------------------------------------------------------------------------
// 集計ヘルパー
// ---------------------------------------------------------------------------
function screenshotUrl(sourceCode, device) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!base) return null;
  return `${base}/storage/v1/object/public/${SCREENSHOT_BUCKET}/heatmaps/${encodeURIComponent(sourceCode)}_${device}.jpg`;
}

async function aggregate(sourceCode, device, days) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  let q = supabase.from('heatmap_events')
    .select('session_id, event_type, device, scroll_pct, x_ratio, y_ratio, el_text, el_selector')
    .eq('source_code', sourceCode)
    .gte('created_at', since)
    .limit(40000);
  if (device === 'desktop' || device === 'mobile') q = q.eq('device', device);
  const { data: rows } = await q;
  const ev = rows || [];

  const sessions = new Set();
  const maxScrollBySession = {};
  const deviceBySession = {};
  const clicks = [];
  const elCount = {};
  let rageClicks = 0;

  for (const e of ev) {
    if (e.session_id) {
      sessions.add(e.session_id);
      if (!deviceBySession[e.session_id]) deviceBySession[e.session_id] = e.device || 'desktop';
    }
    if (e.event_type === 'scroll' && e.session_id != null && e.scroll_pct != null) {
      const cur = maxScrollBySession[e.session_id] || 0;
      if (e.scroll_pct > cur) maxScrollBySession[e.session_id] = e.scroll_pct;
    }
    if (e.event_type === 'click' || e.event_type === 'rageclick') {
      if (e.x_ratio != null && e.y_ratio != null) clicks.push({ x: e.x_ratio, y: e.y_ratio, rage: e.event_type === 'rageclick' });
      if (e.event_type === 'rageclick') rageClicks++;
      const key = (e.el_text && e.el_text.trim()) || e.el_selector || '(不明)';
      elCount[key] = (elCount[key] || 0) + 1;
    }
  }

  const sessionIds = Array.from(sessions);
  const totalSessions = sessionIds.length;
  const maxScrolls = sessionIds.map((s) => maxScrollBySession[s] || 0);
  const avgScroll = maxScrolls.length ? maxScrolls.reduce((a, b) => a + b, 0) / maxScrolls.length : 0;

  const funnel = [];
  for (let d = 10; d <= 100; d += 10) {
    const count = maxScrolls.filter((v) => v * 100 >= d - 0.001).length;
    funnel.push({ depth: d, count, pct: totalSessions ? count / totalSessions : 0 });
  }

  const topElements = Object.entries(elCount)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  let desktopS = 0, mobileS = 0;
  for (const s of sessionIds) { (deviceBySession[s] === 'mobile' ? mobileS++ : desktopS++); }

  return {
    sessions: totalSessions,
    avg_scroll_pct: avgScroll,
    funnel,
    clicks: clicks.slice(0, 4000),
    click_total: clicks.length,
    top_elements: topElements,
    rage_clicks: rageClicks,
    device_split: { desktop: desktopS, mobile: mobileS },
  };
}

// GET /summary?source_code=&device=desktop&days=30
router.get('/summary', async (req, res) => {
  try {
    const sourceCode = req.query.source_code;
    if (!sourceCode) return res.status(400).json({ error: 'source_code required' });
    const device = req.query.device === 'mobile' ? 'mobile' : 'desktop';
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);

    const { data: src } = await supabase.from('traffic_sources')
      .select('name, lp_url').eq('code', sourceCode).maybeSingle();

    const agg = await aggregate(sourceCode, device, days);
    return res.json({
      name: src?.name || null,
      lp_url: src?.lp_url || null,
      device,
      screenshot_url: screenshotUrl(sourceCode, device),
      ...agg,
    });
  } catch (err) {
    console.error('[heatmap/summary] error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// LPスクリーンショット生成（puppeteer + @sparticuz/chromium）
// POST /screenshot { source_code, device }
// ---------------------------------------------------------------------------
async function launchBrowser(width, height) {
  const chromium = require('@sparticuz/chromium');
  const puppeteer = require('puppeteer-core');
  const executablePath = await chromium.executablePath();
  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width, height },
    executablePath,
    headless: chromium.headless,
  });
}

router.post('/screenshot', async (req, res) => {
  const { source_code: sourceCode, device = 'desktop' } = req.body || {};
  if (!sourceCode) return res.status(400).json({ error: 'source_code required' });
  const { data: src } = await supabase.from('traffic_sources').select('lp_url').eq('code', sourceCode).maybeSingle();
  const url = (req.body && req.body.url) || src?.lp_url;
  if (!url) return res.status(400).json({ error: 'lp_url未設定' });

  const isMobile = device === 'mobile';
  const width = isMobile ? 390 : 1280;
  let browser;
  try {
    browser = await launchBrowser(width, isMobile ? 844 : 900);
    const page = await browser.newPage();
    if (isMobile) await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    // 遅延読み込み対策で軽くスクロールしてから戻す
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let y = 0; const step = () => { window.scrollBy(0, 1200); y += 1200; if (y < document.body.scrollHeight && y < 40000) setTimeout(step, 120); else { window.scrollTo(0, 0); setTimeout(resolve, 400); } };
        step();
      });
    });
    const buf = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 70 });
    await browser.close(); browser = null;

    const path = `heatmaps/${sourceCode}_${isMobile ? 'mobile' : 'desktop'}.jpg`;
    const { error: upErr } = await supabase.storage.from(SCREENSHOT_BUCKET)
      .upload(path, buf, { contentType: 'image/jpeg', upsert: true, cacheControl: '3600' });
    if (upErr) return res.status(500).json({ error: 'アップロード失敗: ' + upErr.message });
    const { data: pub } = supabase.storage.from(SCREENSHOT_BUCKET).getPublicUrl(path);
    return res.json({ url: `${pub.publicUrl}?t=${Date.now()}` });
  } catch (err) {
    console.error('[heatmap/screenshot] error:', err.message);
    try { if (browser) await browser.close(); } catch {}
    return res.status(500).json({ error: 'スクリーンショット生成に失敗しました: ' + err.message });
  }
});

// ---------------------------------------------------------------------------
// LPの構造/コピーを取得（AI分析の材料）
// ---------------------------------------------------------------------------
async function scrapeLp(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FitpeakHeatmapBot/1.0)' } });
    const html = await r.text();
    const $ = cheerio.load(html);
    $('script,style,noscript,svg').remove();
    const title = ($('title').first().text() || '').trim().slice(0, 200);
    const headings = [];
    $('h1,h2,h3').each((_, el) => { const t = $(el).text().replace(/\s+/g, ' ').trim(); if (t) headings.push(t.slice(0, 120)); });
    const ctas = [];
    $('a,button').each((_, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      if (t && t.length <= 40) ctas.push(t);
    });
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 6000);
    const uniq = (arr) => Array.from(new Set(arr));
    return {
      title,
      headings: headings.slice(0, 40),
      ctas: uniq(ctas).slice(0, 25),
      bodyText,
    };
  } catch (err) {
    console.error('[heatmap/scrapeLp] error:', err.message);
    return null;
  }
}

function buildAnalysisPrompt(name, lp, agg) {
  const pct = (v) => (v * 100).toFixed(0) + '%';
  const funnelLines = agg.funnel.map((f) => `  ${f.depth}%到達: ${pct(f.pct)}（${f.count}セッション）`).join('\n');
  const topClicks = agg.top_elements.map((e, i) => `  ${i + 1}. 「${e.label}」 ${e.count}クリック`).join('\n');
  const lpInfo = lp ? [
    `LPタイトル: ${lp.title}`,
    `見出し（上から順）:\n${lp.headings.map((h, i) => `  ${i + 1}. ${h}`).join('\n')}`,
    `ボタン/リンク文言: ${lp.ctas.join(' / ')}`,
    `本文抜粋: ${lp.bodyText.slice(0, 3500)}`,
  ].join('\n\n') : '（LP本文の取得に失敗）';

  return [
    `あなたはLPのCRO（コンバージョン率最適化）の専門家です。以下は「${name || 'LP'}」というティザーLPの、実ユーザーのヒートマップ計測データとLPの中身です。これを基に、離脱のネックポイントと、訴求ポイントのズレを具体的に分析してください。`,
    '',
    '## 計測データ',
    `- 総セッション: ${agg.sessions}`,
    `- デバイス: PC ${agg.device_split.desktop} / スマホ ${agg.device_split.mobile}`,
    `- 平均スクロール到達率: ${pct(agg.avg_scroll_pct)}`,
    `- レイジクリック（連打・イライラの兆候）: ${agg.rage_clicks}回`,
    '- スクロール到達率（ファネル。急落する箇所が離脱ポイント）:',
    funnelLines,
    '- よくクリックされている要素:',
    topClicks || '  （データなし）',
    '',
    '## LPの中身',
    lpInfo,
    '',
    '## 出力（日本語・Markdown。簡潔かつ具体的に。一般論ではなくこのデータ/LPに即して）',
    '### 1. ネックポイント（離脱が起きている箇所と推定原因）',
    'スクロール到達率が急落する位置を特定し、その直前にある見出し/セクションの内容と結びつけて、なぜ離脱するのかを推定する。',
    '### 2. 訴求ポイントのズレ',
    'よくクリックされている要素と、本来押させたいCTAのズレ、読まれずに離脱されている訴求、レイジクリックが示す使いにくさなどを指摘する。',
    '### 3. 改善提案（優先順位つき・3〜6個）',
    '各提案は「何を・どう変えるか」を具体的に。番号付きで、効果が大きい順に。',
    '',
    '注意: 絵文字は使わない。データが乏しい場合はその旨を明記し、断定を避ける。',
  ].join('\n');
}

// POST /analyze { source_code, device, days }
router.post('/analyze', async (req, res) => {
  try {
    const sourceCode = req.body?.source_code;
    if (!sourceCode) return res.status(400).json({ error: 'source_code required' });
    const device = req.body?.device === 'mobile' ? 'mobile' : (req.body?.device === 'all' ? 'all' : 'desktop');
    const days = Math.min(Math.max(parseInt(req.body?.days, 10) || 30, 1), 365);

    const { data: src } = await supabase.from('traffic_sources').select('name, lp_url').eq('code', sourceCode).maybeSingle();
    const agg = await aggregate(sourceCode, device, days);
    if (agg.sessions === 0) {
      return res.status(400).json({ error: '計測データがまだありません。LPに計測タグを設置し、アクセスが溜まってから実行してください。' });
    }
    const lp = src?.lp_url ? await scrapeLp(src.lp_url) : null;
    const prompt = buildAnalysisPrompt(src?.name, lp, agg);

    const anthropic = await getAnthropicClient();
    const completion = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2200,
      messages: [{ role: 'user', content: prompt }],
    });
    const textBlock = (completion.content || []).find((b) => b.type === 'text');
    const result = (textBlock?.text || '').trim() || '分析結果を生成できませんでした。';

    const { data: saved } = await supabase.from('heatmap_analyses')
      .insert({ source_code: sourceCode, result, metrics: { device, days, sessions: agg.sessions, avg_scroll_pct: agg.avg_scroll_pct } })
      .select().single();

    return res.json({ result, created_at: saved?.created_at || new Date().toISOString(), sessions: agg.sessions });
  } catch (err) {
    console.error('[heatmap/analyze] error:', err.message);
    return res.status(500).json({ error: 'AI分析に失敗しました: ' + err.message });
  }
});

// GET /analysis?source_code= - 直近の分析結果
router.get('/analysis', async (req, res) => {
  try {
    const sourceCode = req.query.source_code;
    if (!sourceCode) return res.status(400).json({ error: 'source_code required' });
    const { data } = await supabase.from('heatmap_analyses')
      .select('result, created_at, metrics')
      .eq('source_code', sourceCode)
      .order('created_at', { ascending: false })
      .limit(1).maybeSingle();
    return res.json(data || null);
  } catch (err) {
    console.error('[heatmap/analysis] error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
