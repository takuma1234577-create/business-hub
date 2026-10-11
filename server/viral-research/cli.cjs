#!/usr/bin/env node
'use strict';
// バズリサーチのコマンド。Copilot(Claude)と人間の両方が使う。business-hub 直下で node server/viral-research/cli.cjs <コマンド>。結果は JSON で標準出力に出す
const { searchMany, accountOutliers, refreshAccount, videoDetail, transcript } = require('./sources.cjs');
const { parseAccount } = require('./normalize.cjs');
const store = require('./store.cjs');

const [cmd, ...rest] = process.argv.slice(2);
const flags = {};
const args = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[i + 1]?.startsWith('--') || rest[i + 1] === undefined ? true : rest[++i];
  else args.push(rest[i]);
}

// Claude に渡すときに長くなりすぎないよう、必要な項目だけに絞る
const slim = (v) => ({
  url: v.url, platform: v.platform, title: (v.title || '').slice(0, 140), creator: v.creator,
  views: v.views, likes: v.likes, comments: v.comments, followers: v.followers ?? null,
  baseline: v.baseline, score: v.score, tier: v.tier, publishedAt: v.publishedAt,
  duration: v.duration, hashtags: (v.hashtags || []).slice(0, 8),
});

const out = (x) => process.stdout.write(JSON.stringify(x, null, 1) + '\n');

const commands = {
  async search() {
    // 引数1つ = 1キーワード(空白を含むときは引用符で囲む)
    if (!args.length) throw new Error('使い方: search "<キーワード1>" ["<キーワード2>" ...] [--period week|month|quarter|year|any] [--limit 20]');
    const query = args.join(' / ');
    const videos = await searchMany(args, { period: flags.period || 'quarter', limit: Number(flags.limit || 20), onProgress: (m) => process.stderr.write(m + '\n') });
    await store.saveResults(`search:${query}`, videos);
    out(videos.map(slim));
  },
  async account() {
    const a = parseAccount(args[0]);
    if (!a) throw new Error('使い方: account <@tiktokID | YouTubeのURL | UC...>');
    const r = flags.refresh ? await refreshAccount(a) : await accountOutliers(a);
    out({ name: r.name, followers: r.followers, videos: r.videos.map(slim) });
  },
  async tracked() {
    const list = await store.listTracked();
    const res = [];
    for (const a of list) {
      try {
        const r = await accountOutliers(a);
        const top = r.videos.filter((v) => (v.score ?? 0) >= 3).sort((x, y) => y.score - x.score).slice(0, 5);
        res.push({ account: a.handle, platform: a.platform, name: r.name, outliers: top.map(slim) });
      } catch (e) { res.push({ account: a.handle, error: e.message }); }
    }
    out(res);
  },
  async detail() {
    const d = await videoDetail(args[0]);
    out({ ...slim(d), description: (d.description || '').slice(0, 1500), tags: d.tags });
  },
  async hook() {
    const text = await transcript(args[0], { seconds: Number(flags.seconds || 6) });
    out({ url: args[0], openingLine: text });
  },
  async transcript() {
    out({ url: args[0], transcript: await transcript(args[0], { full: true }) });
  },
  async agents() { out(await store.listAgents()); },
  async results() { out((await store.getResults(args.join(' ')))?.map(slim) ?? null); },
  async 'save-asset'() {
    const title = flags.title || '無題';
    const kind = flags.kind || 'script';
    const body = await new Promise((r) => { let s = ''; process.stdin.on('data', (c) => (s += c)); process.stdin.on('end', () => r(s)); });
    out(await store.saveAsset({ title, kind, body }));
  },
};

(async () => {
  try {
    if (!commands[cmd]) throw new Error(`コマンド: ${Object.keys(commands).join(', ')}`);
    await commands[cmd]();
  } catch (e) {
    process.stderr.write(`エラー: ${e.message}\n`);
    process.exit(1);
  }
})();
