/**
 * eBay OAuth（Authorization Code Grant）の受け口。
 *
 * eBayの同意画面を通すと認可コードが返ってくるので、それをリフレッシュトークンに
 * 交換して api_keys に保存する。トークンを人が目で見てコピペする必要がなくなる。
 *
 *   GET /api/ebay-oauth/login     … 同意画面へ飛ばす（要ログイン）
 *   GET /api/ebay-oauth/callback  … eBayからの戻り先（公開・要state検証）
 *   GET /api/ebay-oauth/privacy   … 同意画面に出すプライバシーポリシー（公開）
 *
 * ── なぜ callback を公開にするか ────────────────────────
 * eBayはユーザーのブラウザをここへリダイレクトする。その時点ではbusiness-hubの
 * セッションを持っているとは限らないので、認証必須にすると流れが切れる。
 * 代わりに state を署名付きで発行し、戻ってきたものを検証する。
 * state が一致しない限りトークンは保存しない。
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const { getSupabase, awaitApiKeys } = require('./shared.cjs');

// 出品の作成・更新に必要な最小限のスコープ。余分な権限は要求しない
const SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
];

const isSandbox = () => String(process.env.EBAY_ENV || 'production').toLowerCase() === 'sandbox';
const authHost = () => (isSandbox() ? 'auth.sandbox.ebay.com' : 'auth.ebay.com');
const apiHost = () => (isSandbox() ? 'api.sandbox.ebay.com' : 'api.ebay.com');

const baseUrl = () =>
  process.env.PUBLIC_BASE_URL || 'https://business-hub-beige.vercel.app';

/** state は署名付き。改ざんされたものや古いものは弾く */
function makeState() {
  const secret = process.env.EBAY_CLIENT_SECRET || process.env.SUPABASE_ANON_KEY || 'fallback';
  const payload = `${Date.now()}.${crypto.randomBytes(12).toString('hex')}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 32);
  return `${payload}.${sig}`;
}

function verifyState(state) {
  if (!state) return false;
  const parts = String(state).split('.');
  if (parts.length !== 3) return false;
  const [ts, nonce, sig] = parts;
  const secret = process.env.EBAY_CLIENT_SECRET || process.env.SUPABASE_ANON_KEY || 'fallback';
  const expect = crypto.createHmac('sha256', secret).update(`${ts}.${nonce}`).digest('hex').slice(0, 32);
  // timingSafeEqual は長さが違うと例外を投げる。長さの時点で不一致なら先に落とす
  if (sig.length !== expect.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return false;
  // 15分で失効させる。放置されたURLが後から使われるのを防ぐ
  return Date.now() - Number(ts) < 15 * 60 * 1000;
}

/** settings.cjs と同じ方式で暗号化する（キーの保存先を統一するため） */
function encryptApiKey(value) {
  const secret = process.env.BANK_CREDENTIAL_ENCRYPTION_KEY || process.env.SUPABASE_ANON_KEY || 'default-key';
  const key = crypto.scryptSync(secret, 'api-keys-salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let enc = cipher.update(value, 'utf8', 'hex');
  enc += cipher.final('hex');
  return JSON.stringify({ iv: iv.toString('hex'), data: enc, tag: cipher.getAuthTag().toString('hex') });
}

const page = (title, body) => `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;max-width:44rem;margin:3rem auto;padding:0 1.5rem;line-height:1.8;color:#111}
h1{font-size:1.4rem}h2{font-size:1.05rem;margin-top:2rem}code{background:#f4f4f5;padding:.15rem .4rem;border-radius:4px;font-size:.9em}
.ok{color:#15803d}.ng{color:#b91c1c}</style></head><body>${body}</body></html>`;

// ── 同意画面へ飛ばす ────────────────────────────────────
router.get('/login', async (req, res) => {
  await awaitApiKeys();
  const clientId = process.env.EBAY_CLIENT_ID;
  const ruName = process.env.EBAY_RUNAME;
  if (!clientId || !ruName) {
    return res.status(400).send(page('設定不足', `<h1>設定が足りません</h1>
      <p>API設定画面で以下を登録してください。</p><ul>
      <li>eBay App ID（クライアントID）: ${clientId ? '<span class="ok">設定済み</span>' : '<span class="ng">未設定</span>'}</li>
      <li>eBay RuName: ${ruName ? '<span class="ok">設定済み</span>' : '<span class="ng">未設定</span>'}</li></ul>`));
  }
  const url = `https://${authHost()}/oauth2/authorize?client_id=${encodeURIComponent(clientId)}`
    + `&redirect_uri=${encodeURIComponent(ruName)}`
    + `&response_type=code&scope=${encodeURIComponent(SCOPES.join(' '))}`
    + `&state=${encodeURIComponent(makeState())}`;
  res.redirect(url);
});

// ── eBayからの戻り先 ────────────────────────────────────
router.get('/callback', async (req, res) => {
  await awaitApiKeys();
  const { code, state, error, error_description: desc } = req.query;

  if (error) {
    return res.status(400).send(page('連携できませんでした',
      `<h1>連携できませんでした</h1><p>eBayからの応答: <code>${String(error)}</code></p><p>${String(desc || '')}</p>`));
  }
  if (!verifyState(state)) {
    // 自分で開始していないリクエストではトークンを保存しない
    return res.status(400).send(page('検証に失敗',
      `<h1>検証に失敗しました</h1><p>この画面は業務ツールの「eBayと連携」から開始してください。15分で失効します。</p>`));
  }
  if (!code) return res.status(400).send(page('コードがありません', '<h1>認可コードがありません</h1>'));

  try {
    const clientId = process.env.EBAY_CLIENT_ID;
    const clientSecret = process.env.EBAY_CLIENT_SECRET;
    const ruName = process.env.EBAY_RUNAME;
    if (!clientId || !clientSecret || !ruName) throw new Error('App ID / Cert ID / RuName のいずれかが未設定です');

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const r = await fetch(`https://${apiHost()}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: ruName,
      }),
    });
    const j = await r.json();
    if (!r.ok || !j.refresh_token) {
      throw new Error(j.error_description || j.error || `トークン交換に失敗 (HTTP ${r.status})`);
    }

    // リフレッシュトークンを暗号化して保存。以降はここから自動更新する
    const sb = getSupabase();
    await sb.from('api_keys').upsert({
      id: 'ebay_refresh_token',
      api_key_encrypted: encryptApiKey(j.refresh_token),
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    process.env.EBAY_REFRESH_TOKEN = j.refresh_token;

    const days = Math.round((j.refresh_token_expires_in || 0) / 86400);
    res.send(page('連携しました', `<h1 class="ok">eBayと連携しました</h1>
      <p>リフレッシュトークンを暗号化して保存しました。画面に値は表示していません。</p>
      <ul>
        <li>環境: <code>${isSandbox() ? 'サンドボックス' : '本番'}</code></li>
        <li>有効期限: 約 ${days} 日（アクセストークンは自動で更新されます）</li>
        <li>権限: 出品の作成・更新、注文の閲覧</li>
      </ul>
      <p>業務ツールに戻って、eBay管理の「下書きを作る」から出品を作成できます。</p>`));
  } catch (e) {
    res.status(500).send(page('連携に失敗', `<h1 class="ng">連携に失敗しました</h1><p><code>${e.message}</code></p>`));
  }
});

// ── 同意画面に表示するプライバシーポリシー ──────────────
// eBayはhttpsで到達できるURLを要求する。eBay自身のURLは指定できない
router.get('/privacy', (_req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8').send(page('プライバシーポリシー', `
    <h1>プライバシーポリシー</h1>
    <p>本ツール（以下「本ツール」）は、合同会社SVPコーポレーションが自社のeBay出品業務のために
    運用する社内向けアプリケーションです。第三者に提供・販売するものではありません。</p>

    <h2>取得する情報</h2>
    <p>本ツールは、利用者がeBayアカウントで連携を許可した場合に限り、eBayのAPIを通じて
    次の情報を取得します。</p>
    <ul>
      <li>出品情報（商品タイトル、説明、価格、在庫数、商品の状態）</li>
      <li>注文情報（注文番号、注文日時、購入された商品、発送期限）</li>
      <li>アカウントの出品ポリシー設定（支払い・配送・返品）</li>
    </ul>

    <h2>利用目的</h2>
    <p>取得した情報は、出品の作成と更新、在庫の同期、発送期限の管理という
    運用上の目的にのみ使用します。広告、プロファイリング、第三者への提供、
    販売のいずれにも使用しません。</p>

    <h2>保管</h2>
    <p>情報は暗号化された通信経路を通じて取得し、アクセス制御を設定した
    データベース（Supabase）に保管します。認証情報は暗号化して保存し、
    画面に表示しません。</p>

    <h2>保持期間と削除</h2>
    <p>情報は業務上必要な期間のみ保持します。eBayからアカウント削除通知
    （Marketplace Account Deletion Notification）を受領した場合、
    該当するアカウントに紐づく情報を削除します。</p>

    <h2>連携の解除</h2>
    <p>eBayの「マイeBay → アカウント設定 → サインインとセキュリティ →
    サードパーティアプリへのアクセス」から、いつでも本ツールの連携を解除できます。
    解除後、本ツールはeBayの情報にアクセスできなくなります。</p>

    <h2>お問い合わせ</h2>
    <p>合同会社SVPコーポレーション</p>
  `));
});

module.exports = router;
