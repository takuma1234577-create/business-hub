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
  var t0=Date.now();
  var buf=[];
  function docH(){return Math.max(document.body?document.body.scrollHeight:0,document.documentElement.scrollHeight,document.body?document.body.offsetHeight:0)||1;}
  function docW(){return Math.max(document.body?document.body.scrollWidth:0,document.documentElement.scrollWidth)||1;}
  function scrollPct(){return Math.min(1,(scrollY+innerHeight)/docH());}
  function base(){return{src:SRC,sid:sid,url:location.href,device:device,vw:innerWidth,vh:innerHeight,dw:docW(),dh:docH()};}
  function push(e){buf.push(e);if(buf.length>=20)flush(false);}
  push(Object.assign(base(),{t:'pageview'}));
  var recent=[];
  document.addEventListener('click',function(ev){
    var el=ev.target||{};
    var x=(ev.pageX||0)/docW(),y=(ev.pageY||0)/docH();
    var txt=((el.innerText||el.textContent||'')+'').replace(/\\s+/g,' ').trim().slice(0,80);
    var a=(el.closest?el.closest('a,button'):null);var href='';try{href=(a&&a.href)?a.href:(el.href||'');}catch(e){}
    var now=Date.now();recent.push({x:ev.clientX,y:ev.clientY,t:now});recent=recent.filter(function(c){return now-c.t<1000;});
    var rage=recent.filter(function(c){return Math.abs(c.x-ev.clientX)<30&&Math.abs(c.y-ev.clientY)<30;}).length>=3;
    push(Object.assign(base(),{t:rage?'rageclick':'click',x:x,y:y,txt:txt,sel:cssPath(el),href:(href+'').slice(0,300),sp:scrollPct(),dt:now-t0}));
  },true);
  var maxPct=0,lastSent=0;
  function onScroll(){var p=scrollPct();if(p>maxPct)maxPct=p;}
  addEventListener('scroll',throttle(onScroll,400),{passive:true});
  function recordScroll(){if(maxPct>lastSent){lastSent=maxPct;push(Object.assign(base(),{t:'scroll',pct:maxPct}));}}
  setInterval(function(){recordScroll();flush(false);},10000);
  addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden'){recordScroll();flush(true);}});
  addEventListener('pagehide',function(){recordScroll();flush(true);});
  function ve(a,extra){var m={a:a};if(extra)for(var k in extra)m[k]=extra[k];push(Object.assign(base(),{t:'video',meta:m}));}
  function trackVideo(v){
    if(!v||v.__hm)return;v.__hm=1;
    var ms={25:0,50:0,75:0,95:0};var wasMuted=(v.muted||v.volume===0);
    v.addEventListener('play',function(){ve('play');});
    v.addEventListener('pause',function(){if(!v.ended)ve('pause',{pct:v.duration?Math.round(v.currentTime/v.duration*100):0});});
    v.addEventListener('ended',function(){ve('ended');});
    v.addEventListener('volumechange',function(){var m=(v.muted||v.volume===0);if(wasMuted&&!m)ve('unmute');wasMuted=m;});
    v.addEventListener('webkitbeginfullscreen',function(){ve('fullscreen');});
    v.addEventListener('timeupdate',function(){if(!v.duration)return;var p=v.currentTime/v.duration*100;for(var k in ms){if(!ms[k]&&p>=+k){ms[k]=1;ve('progress',{pct:+k});}}});
  }
  function scanVideos(){try{var vs=document.querySelectorAll('video');for(var i=0;i<vs.length;i++)trackVideo(vs[i]);}catch(e){}}
  scanVideos();
  try{var mo=new MutationObserver(scanVideos);mo.observe(document.documentElement,{childList:true,subtree:true});}catch(e){}
  function fsH(){var fe=document.fullscreenElement||document.webkitFullscreenElement;if(fe&&(fe.tagName==='VIDEO'||(fe.querySelector&&fe.querySelector('video'))))ve('fullscreen');}
  document.addEventListener('fullscreenchange',fsH);document.addEventListener('webkitfullscreenchange',fsH);
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
      event_type: ['pageview', 'click', 'rageclick', 'deadclick', 'scroll', 'video'].includes(e.t) ? e.t : 'other',
      x_ratio: clamp01(e.x),
      y_ratio: clamp01(e.y),
      // click/rageclick は「クリック時点のスクロール深度(sp)」、scroll は最大到達(pct) を入れる
      scroll_pct: clamp01(e.pct != null ? e.pct : e.sp),
      doc_w: num(e.dw), doc_h: num(e.dh), vw: num(e.vw), vh: num(e.vh),
      el_text: str(e.txt, 120), el_selector: str(e.sel, 160),
      href: str(e.href, 300),
      meta: (e.meta && typeof e.meta === 'object') ? e.meta : (e.dt != null ? { dt: num(e.dt) } : null),
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

// 集計はDB関数 heatmap_summary で行う。
// PostgRESTは1リクエスト最大1000行のため、生イベントを取得してJSで数えると
// 古い1000行しか読めず、新しいセッションが反映されなくなる（実際に発生した）。
async function aggregate(sourceCode, device, days) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase.rpc('heatmap_summary', {
    p_source: sourceCode,
    p_device: device === 'desktop' || device === 'mobile' ? device : 'all',
    p_since: since,
  });
  if (error) throw new Error('heatmap_summary: ' + error.message);
  return data;
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
    // 遅延読み込み対策で最後までスクロールしてから戻す（画像・遅延要素を読み込ませる）
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let y = 0; const step = () => { window.scrollBy(0, 1200); y += 1200; if (y < document.body.scrollHeight && y < 40000) setTimeout(step, 120); else { window.scrollTo(0, 0); setTimeout(resolve, 400); } };
        step();
      });
    });
    // Webフォントの読み込み完了を待つ（文字抜け・グリフ落ち対策）
    try {
      await page.evaluate(() => (document.fonts && document.fonts.ready ? document.fonts.ready.then(() => undefined) : undefined));
      await page.evaluate(() => new Promise((r) => setTimeout(r, 1200)));
    } catch { /* noop */ }
    const buf = await page.screenshot({ fullPage: true, type: 'jpeg', quality: 82 });
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
    `- 追跡型CTAボタン（LINE登録ボタン等）: ${agg.cta.clicks}クリック` + (agg.cta.avg_scroll_at_click != null ? ` / 平均してスクロール${pct(agg.cta.avg_scroll_at_click)}地点で押されている` : '') + (agg.cta.clicks > 0 ? '（＝ユーザーがLPのどの深さでCTAを押しているか。浅い位置なら上部CTAが効いている／深い位置でしか押されないなら上部の訴求が弱い可能性）' : ''),
    `- 動画エンゲージメント: 再生${agg.video.plays}／音量ON(ミュート解除)${agg.video.unmutes}／全画面${agg.video.fullscreens}／最後まで視聴${agg.video.completed}。視聴到達 25%:${agg.video.reach[25]} 50%:${agg.video.reach[50]} 75%:${agg.video.reach[75]} 95%:${agg.video.reach[95]}（再生に対して途中で離脱する割合＝動画の中だるみ/長さの問題を示す）`,
    '',
    '## LPの中身',
    lpInfo,
    '',
    '## 出力（日本語・Markdown。簡潔かつ具体的に。一般論ではなくこのデータ/LPに即して）',
    '### 1. ネックポイント（離脱が起きている箇所と推定原因）',
    'スクロール到達率が急落する位置を特定し、その直前にある見出し/セクションの内容と結びつけて、なぜ離脱するのかを推定する。',
    '### 2. 訴求ポイントのズレ',
    'よくクリックされている要素と、本来押させたいCTAのズレ、CTAが押されるスクロール深度（上部CTAが効いているか）、動画の再生率・音量ON率・視聴到達率（動画が訴求として機能しているか／途中離脱していないか）、読まれずに離脱されている訴求、レイジクリックが示す使いにくさなどを指摘する。',
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
