// バズリサーチ(viral-research)のテスト。node server/__tests__/viral-research.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
process.env.VR_DATA_DIR = mkdtempSync(join(tmpdir(), 'vr-store-'));

// ---- outlier ----
const { median, baselineOf, outlierScore, rankOutliers, tier } = require('../viral-research/outlier.cjs');

test('median: 奇数・偶数・空', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
});

test('baselineOf: 対象動画自身を除いた中央値を普段の再生数とする', () => {
  const feed = [
    { id: 'a', views: 1000 }, { id: 'b', views: 2000 }, { id: 'c', views: 3000 },
    { id: 'hit', views: 2_000_000 },
  ];
  assert.equal(baselineOf(feed, 'hit'), 2000);
  // 再生数が取れていない動画は数えない
  assert.equal(baselineOf([{ id: 'x', views: null }, { id: 'y', views: 500 }], 'z'), 500);
  assert.equal(baselineOf([], 'z'), null);
});

test('outlierScore: 再生数 / 普段の再生数。普段が不明なら null', () => {
  assert.equal(outlierScore(2_800_000, 2500), 1120);
  assert.equal(outlierScore(1000, null), null);
  assert.equal(outlierScore(null, 1000), null);
  // 普段の再生数が極端に小さい(0や1)ときに無限大にしない
  assert.equal(outlierScore(500, 0), 5);
});

test('tier: スコアの段階', () => {
  assert.equal(tier(null), 'unknown');
  assert.equal(tier(1.2), 'normal');
  assert.equal(tier(3), 'good');
  assert.equal(tier(10), 'viral');
  assert.equal(tier(50), 'exceptional');
});

test('rankOutliers: スコア順、スコア不明は再生数順で後ろ', () => {
  const ranked = rankOutliers([
    { id: 'big-normal', views: 5_000_000, score: 1.1 },
    { id: 'small-outlier', views: 300_000, score: 40 },
    { id: 'unknown', views: 9_000_000, score: null },
  ]);
  assert.deepEqual(ranked.map((v) => v.id), ['small-outlier', 'big-normal', 'unknown']);
});

// ---- normalize ----
const { normalizeEntry, hashtagsOf, parseAccount, firstSecondsOfVtt } = require('../viral-research/normalize.cjs');

test('normalizeEntry: TikTokのフィード項目', () => {
  const v = normalizeEntry({
    id: '749', view_count: 32000, like_count: 273, comment_count: 4, timestamp: 1744186295,
    description: '正しいフォーム #筋トレ #トレーニング', duration: 23,
    url: 'https://www.tiktok.com/@fitpeakjapan/video/749',
  }, { platform: 'tiktok', handle: 'fitpeakjapan' });
  assert.equal(v.platform, 'tiktok');
  assert.equal(v.id, 'tiktok:749');
  assert.equal(v.views, 32000);
  assert.equal(v.creator, '@fitpeakjapan');
  assert.equal(v.publishedAt, '2025-04-09T08:11:35.000Z');
  assert.deepEqual(v.hashtags, ['筋トレ', 'トレーニング']);
  assert.equal(v.url, 'https://www.tiktok.com/@fitpeakjapan/video/749');
});

test('normalizeEntry: YouTube検索の項目(日時なし・チャンネルIDあり)', () => {
  const v = normalizeEntry({
    id: 'lpD3imRd2UY', view_count: 158524, duration: 230, title: 'クレアチンまとめ',
    channel: 'DaiGoの館', channel_id: 'UCrC1', url: 'https://www.youtube.com/watch?v=lpD3imRd2UY',
  }, { platform: 'youtube' });
  assert.equal(v.id, 'youtube:lpD3imRd2UY');
  assert.equal(v.creator, 'DaiGoの館');
  assert.equal(v.creatorId, 'UCrC1');
  assert.equal(v.publishedAt, null);
  assert.equal(v.url, 'https://www.youtube.com/watch?v=lpD3imRd2UY');
});

test('normalizeEntry: YouTubeショートはshorts URLになる', () => {
  const v = normalizeEntry({ id: 'abc', url: 'https://www.youtube.com/shorts/abc', view_count: 1 }, { platform: 'youtube' });
  assert.equal(v.url, 'https://www.youtube.com/shorts/abc');
  assert.equal(v.isShort, true);
});

test('hashtagsOf: 重複・##を整理', () => {
  assert.deepEqual(hashtagsOf('a #筋トレ ##筋トレ #Gym #gym'), ['筋トレ', 'Gym']);
  assert.deepEqual(hashtagsOf(null), []);
});

test('parseAccount: URL・@・UCを判別', () => {
  assert.deepEqual(parseAccount('@fitpeakjapan'), { platform: 'tiktok', handle: 'fitpeakjapan', url: 'https://www.tiktok.com/@fitpeakjapan' });
  assert.deepEqual(parseAccount('https://www.tiktok.com/@foo.bar?lang=ja'), { platform: 'tiktok', handle: 'foo.bar', url: 'https://www.tiktok.com/@foo.bar' });
  assert.deepEqual(parseAccount('https://www.youtube.com/@KinnikuTV/shorts'), { platform: 'youtube', handle: '@KinnikuTV', url: 'https://www.youtube.com/@KinnikuTV' });
  assert.deepEqual(parseAccount('UCrC1UpIzo41ZUtdBefuue4A'), { platform: 'youtube', handle: 'UCrC1UpIzo41ZUtdBefuue4A', url: 'https://www.youtube.com/channel/UCrC1UpIzo41ZUtdBefuue4A' });
  assert.equal(parseAccount('yt:@KinnikuTV').platform, 'youtube');
  assert.equal(parseAccount(''), null);
});

test('firstSecondsOfVtt: 冒頭N秒の字幕を重複なしでつなぐ', () => {
  const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
クレアチンを飲んでる人

00:00:01.500 --> 00:00:03.000
クレアチンを飲んでる人
これだけは知って

00:00:06.000 --> 00:00:08.000
ここは対象外`;
  assert.equal(firstSecondsOfVtt(vtt, 5), 'クレアチンを飲んでる人 これだけは知って');
});

test('isJapanese: ひらがな・カタカナを含むか', async () => {
  const { isJapanese } = require('../viral-research/normalize.cjs');
  assert.equal(isJapanese('クレアチンの効果？ #ジム'), true);
  assert.equal(isJapanese('Día 1 usando creatina'), false);
  assert.equal(isJapanese('肌肉训练'), false);
  assert.equal(isJapanese(''), false);
});

// ---- copilot ----
const { eventsFromLine, childEnv, buildArgs } = require('../viral-research/copilot.cjs');

test('init 行からセッションIDを取る', () => {
  assert.deepEqual(eventsFromLine({ type: 'system', subtype: 'init', session_id: 's1' }), [{ type: 'session', sessionId: 's1' }]);
});

test('文字の差分はそのまま text イベント', () => {
  const line = { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'こんにちは' } } };
  assert.deepEqual(eventsFromLine(line), [{ type: 'text', text: 'こんにちは' }]);
});

test('Bash の呼び出しは何をしているかの tool イベントになる', () => {
  const line = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'node server/viral-research/cli.cjs search "クレアチン"' } }] } };
  assert.deepEqual(eventsFromLine(line), [{ type: 'tool', id: 't1', command: 'node server/viral-research/cli.cjs search "クレアチン"' }]);
});

test('検索結果(動画の配列)は videos イベントになる', () => {
  const videos = [{ url: 'https://www.youtube.com/shorts/a', views: 1, score: 30 }];
  const line = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: JSON.stringify(videos) }] } };
  assert.deepEqual(eventsFromLine(line), [{ type: 'tool_done', id: 't1' }, { type: 'videos', videos }]);
});

test('アカウント結果({videos})も videos イベント。動画でない結果は出さない', () => {
  const videos = [{ url: 'https://www.tiktok.com/@a/video/1', views: 5 }];
  const ok = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: JSON.stringify({ name: 'a', videos }) }] }] } };
  assert.deepEqual(eventsFromLine(ok).at(-1), { type: 'videos', videos });
  const other = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't3', content: '{"openingLine":"x"}' }] } };
  assert.deepEqual(eventsFromLine(other), [{ type: 'tool_done', id: 't3' }]);
});

test('認証切れの result は分かる言葉の error にする', async () => {
  const { errorMessageOf } = require('../viral-research/copilot.cjs');
  assert.match(errorMessageOf('Failed to authenticate. API Error: 401 {"type":"error"}'), /ログイン/);
  assert.equal(errorMessageOf('何か別のエラー'), '何か別のエラー');
  const ev = eventsFromLine({ type: 'result', session_id: 's1', is_error: true, result: 'Failed to authenticate. API Error: 401' });
  assert.equal(ev[0].type, 'error');
  assert.match(ev[0].message, /ログイン/);
});

test('result 行は done', () => {
  assert.deepEqual(eventsFromLine({ type: 'result', session_id: 's1', is_error: false, result: 'x' }), [{ type: 'done', sessionId: 's1', isError: false }]);
});

test('子プロセスには API キーを渡さない(サブスク枠だけで動かすため)', () => {
  const env = childEnv({ ANTHROPIC_API_KEY: 'sk-x', ANTHROPIC_AUTH_TOKEN: 't', ANTHROPIC_BASE_URL: 'http://x', CLAUDECODE: '1', CLAUDE_CODE_OAUTH_TOKEN: 'o', USE_STAGING_OAUTH: '1', PATH: '/bin', HOME: '/h' });
  // 起動元(デスクトップアプリ等)の接続設定も引き継がない
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDECODE', 'CLAUDE_CODE_OAUTH_TOKEN', 'USE_STAGING_OAUTH']) assert.equal(env[k], undefined, k);
  assert.equal(env.PATH, '/bin');
});

test('buildArgs: Bash は viral-research の cli.cjs だけ許可し、続きの会話なら resume', () => {
  const a = buildArgs({ message: 'hi', sessionId: 's9', model: 'sonnet' });
  assert.ok(a.includes('-p'));
  assert.equal(a[a.indexOf('--tools') + 1], 'Bash');
  assert.equal(a[a.indexOf('--allowedTools') + 1], 'Bash(node server/viral-research/cli.cjs:*)');
  assert.equal(a[a.indexOf('--resume') + 1], 's9');
  assert.ok(!buildArgs({ message: 'hi' }).includes('--resume'));
});

// ---- store ----
const store = require('../viral-research/store.cjs');

test('監視アカウント: 追加・重複しない・削除', async () => {
  await store.addTracked({ platform: 'tiktok', handle: 'foo', url: 'https://www.tiktok.com/@foo' });
  await store.addTracked({ platform: 'tiktok', handle: 'foo', url: 'https://www.tiktok.com/@foo' });
  assert.equal((await store.listTracked()).length, 1);
  await store.removeTracked('tiktok', 'foo');
  assert.equal((await store.listTracked()).length, 0);
});

test('エージェント: 保存すると id と作成日時がつき、更新できる', async () => {
  const a = await store.saveAgent({ name: 'クレアショット', brief: 'クレアチンのバズ', queries: ['クレアチン'], schedule: 'daily' });
  assert.ok(a.id);
  assert.ok(a.createdAt);
  await store.saveAgent({ ...a, queries: ['クレアチン', '筋トレ サプリ'] });
  const list = await store.listAgents();
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].queries, ['クレアチン', '筋トレ サプリ']);
  await store.deleteAgent(a.id);
  assert.equal((await store.listAgents()).length, 0);
});

test('検索結果: キーごとに最新を保存・取得', async () => {
  await store.saveResults('search:x', [{ id: '1' }]);
  await store.saveResults('search:x', [{ id: '2' }]);
  assert.deepEqual(await store.getResults('search:x'), [{ id: '2' }]);
  assert.equal(await store.getResults('search:none'), null);
});

test('保存物(台本など): 新しい順', async () => {
  await store.saveAsset({ title: 'A', kind: 'script', body: 'a' });
  await new Promise((r) => setTimeout(r, 5));
  await store.saveAsset({ title: 'B', kind: 'brief', body: 'b' });
  const list = await store.listAssets();
  assert.deepEqual(list.map((x) => x.title), ['B', 'A']);
});
