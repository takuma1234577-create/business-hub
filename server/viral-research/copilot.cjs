'use strict';
// Copilot: 裏で Claude Code (claude -p) を呼ぶ。サブスク枠で動かすので API 料金はかからない
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { createInterface } = require('node:readline');

const ROOT = join(__dirname, '..', '..');
const CLI = 'node server/viral-research/cli.cjs';
const CLAUDE = process.env.VC_CLAUDE_BIN || 'claude';
const DEFAULT_MODEL = process.env.VC_MODEL || 'sonnet';

const SYSTEM_PROMPT = `あなたはショート動画(YouTubeショート/TikTok)のバズ研究コパイロットです。
利用者はフィットネス系ブランドの運営者で、自社や取引先のSNS用に「いま伸びている動画」を探し、フック・フォーマットを学び、台本やブリーフに落とします。

# 使えるコマンド(作業ディレクトリで Bash から実行。結果は JSON)
- ${CLI} search "<キーワード1>" "<キーワード2>" --period quarter --limit 15
  YouTubeのキーワード検索+ハッシュタグのショートから候補を集め、外れ値スコア順に返す。1キーワードにつき40秒ほどかかる。
  --period は week / month / quarter(初期値) / year / any。
- ${CLI} account <@TikTokID | YouTubeチャンネルURL | UC...> [--refresh]
  そのアカウントの直近30本を外れ値スコアつきで返す。TikTokはキーワード検索ができないので、TikTokを見たいときはこれを使う。
- ${CLI} tracked      登録済みの監視アカウント全部の、伸びた動画(スコア3以上)
- ${CLI} agents       登録済みリサーチエージェント(ニッチと検索語)の一覧
- ${CLI} results "agent:<エージェントid>"   そのエージェントの最新の検索結果
- ${CLI} detail <動画URL>    説明文・タグなど詳細
- ${CLI} hook <動画URL> [--seconds 6]   字幕から冒頭の発話(フック)を取り出す。字幕がない動画は null
- ${CLI} transcript <動画URL>   字幕の全文
- ${CLI} save-asset --title "<題名>" --kind script|brief|report <<'EOF'
  (本文 Markdown)
  EOF
  台本・ブリーフ・レポートを「保存物」に残す。台本やブリーフを作ったら必ず保存する。

# 用語
- score(外れ値スコア) = 再生数 ÷ その投稿者の普段の再生数(直近動画の中央値)。3以上=良い、10以上=バズ、30以上=例外的。
  大きいアカウントの平常運転より、小さいアカウントの突然のヒットを重視する。並べるときはスコアを主に、再生数を従に。
- tier: normal / good / viral / exceptional / unknown(普段の再生数が取れなかった)

# 進め方
- ニッチを言われたら、まず検索語を2〜4個自分で考えて search に渡す(類義語・ハッシュタグになりそうな語・悩みの言い方)。
- 答えは必ずデータに基づく。動画に触れるときは「投稿者 / 再生数 / スコア / URL」を添え、URLは省略しない。
- フックを分析するときは hook で実際の冒頭の発話を取りに行く。取れなければタイトルと説明文から推定し、推定だと明記する。
  フックの型の例: 疑問・衝撃の主張・共感(あるある)・ハウツー宣言・リスト・比較/対決・ビフォーアフター・失敗談・権威・テキストフック(画面文字)。
  フォーマットの例: 解説・レビュー・スキット(寸劇)・比較実験・ルーティン・ビフォーアフター・ランキング・ハウツー・街頭インタビュー・反応/リアクション。
- 台本は「フック / 導入 / 実演 / 見せ場 / CTA」の各ビートに秒数と、話す言葉・画面の文字・映像の指示を書く。元にした動画のURLを冒頭に書く。
- サプリ・健康食品の台本では効果効能を断定しない(「筋肉が増える」「痩せる」等は不可)。体験や使い方・気分の表現に留める。
- 数字の羅列で終わらず、「だから次に何を撮るべきか」まで言う。
- 日本語で、絵文字は使わない。見出しと箇条書き中心の Markdown。`;

function childEnv(env = process.env) {
  // API キーがあると従量課金に切り替わるので外す。起動元(デスクトップアプリ等)の接続設定も持ち込まない
  return Object.fromEntries(Object.entries(env).filter(([k]) => !/^(ANTHROPIC_|CLAUDE|USE_\w*OAUTH)/.test(k)));
}

function buildArgs({ message, sessionId, model = DEFAULT_MODEL }) {
  const args = [
    '-p', message,
    '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--model', model,
    '--tools', 'Bash',
    '--allowedTools', `Bash(${CLI}:*)`,
    '--permission-mode', 'dontAsk',
    '--strict-mcp-config',
    '--setting-sources', 'project',
    '--disable-slash-commands',
    '--append-system-prompt', SYSTEM_PROMPT,
  ];
  if (sessionId) args.push('--resume', sessionId);
  return args;
}

function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  return '';
}

function videosIn(text) {
  try {
    const j = JSON.parse(text);
    const list = Array.isArray(j) ? j : Array.isArray(j?.videos) ? j.videos : null;
    if (list && list.length && list.every((v) => v && typeof v.url === 'string' && 'views' in v)) return list;
  } catch {}
  return null;
}

function errorMessageOf(text) {
  const t = String(text || '');
  if (/authenticat|401|OAuth|log ?in/i.test(t)) {
    return 'Claude Code のログインが切れています。ターミナルで claude を起動して /login を実行してから、もう一度送ってください。';
  }
  if (/usage limit|rate limit|429/i.test(t)) return 'サブスクの利用上限に達しました。時間をおいてから送ってください。';
  return t;
}

// claude の stream-json 1行 → 画面向けイベントの配列
function eventsFromLine(line) {
  const out = [];
  if (line.type === 'system' && line.subtype === 'init') out.push({ type: 'session', sessionId: line.session_id });
  if (line.type === 'stream_event' && line.event?.type === 'content_block_delta' && line.event.delta?.type === 'text_delta') {
    out.push({ type: 'text', text: line.event.delta.text });
  }
  if (line.type === 'assistant') {
    for (const c of line.message?.content || []) {
      if (c.type === 'tool_use') out.push({ type: 'tool', id: c.id, command: c.input?.command ?? c.name });
    }
  }
  if (line.type === 'user') {
    for (const c of line.message?.content || []) {
      if (c.type !== 'tool_result') continue;
      out.push({ type: 'tool_done', id: c.tool_use_id });
      const videos = videosIn(toolResultText(c.content));
      if (videos) out.push({ type: 'videos', videos });
    }
  }
  if (line.type === 'result' && line.is_error) out.push({ type: 'error', message: errorMessageOf(line.result) });
  if (line.type === 'result') out.push({ type: 'done', sessionId: line.session_id, isError: !!line.is_error });
  return out;
}

// 1回の発言を流す。onEvent に順にイベントを渡し、終わったら最終のセッションIDを返す
function runCopilot({ message, sessionId, model, onEvent, signal }) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE, buildArgs({ message, sessionId, model }), { cwd: ROOT, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    signal?.addEventListener('abort', () => child.kill('SIGTERM'));
    let sid = sessionId || null;
    let stderr = '';
    let gotResult = false;
    child.stderr.on('data', (d) => (stderr += d));
    createInterface({ input: child.stdout }).on('line', (raw) => {
      let line;
      try { line = JSON.parse(raw); } catch { return; }
      for (const ev of eventsFromLine(line)) {
        if (ev.sessionId) sid = ev.sessionId;
        if (ev.type === 'done') gotResult = true;
        onEvent(ev);
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && !gotResult && !signal?.aborted) return reject(new Error(errorMessageOf(stderr.trim().split('\n').pop()) || `claude が終了コード ${code} で止まりました`));
      resolve(sid);
    });
  });
}

// 一言の依頼文から検索語を作る(エージェント作成用)。ツールなしの1往復
async function suggestQueries(brief, { model = DEFAULT_MODEL } = {}) {
  const prompt = `次の依頼から、YouTubeショート/TikTokで日本の伸びている動画を探すための検索語を3〜5個作ってください。
依頼: ${brief}
条件: 1語〜2語の短い日本語(ハッシュタグとしても使える語を最低1つ)。商品名だけでなく、視聴者の悩みや場面の言い方も混ぜる。
出力: JSON の配列だけ。例 ["クレアチン","筋トレ サプリ","増量"]`;
  const text = await new Promise((resolve, reject) => {
    const child = spawn(CLAUDE, ['-p', prompt, '--output-format', 'text', '--model', model, '--tools', '', '--strict-mcp-config', '--setting-sources', 'project', '--disable-slash-commands'], { cwd: ROOT, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `終了コード ${code}`))));
  });
  const m = text.match(/\[[\s\S]*\]/);
  const list = m ? JSON.parse(m[0]) : [];
  return list.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()).slice(0, 5);
}

module.exports = { childEnv, buildArgs, errorMessageOf, eventsFromLine, runCopilot, suggestQueries, DEFAULT_MODEL, SYSTEM_PROMPT };
