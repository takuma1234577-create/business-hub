/**
 * eBay Marketplace Account Deletion/Closure Notification のエンドポイント。
 *
 * eBayはProductionキーセットを有効化する条件として、この通知の受け口を要求する。
 * 受け口が無いとキーセットが「無効」のままになり、Sell APIが一切使えない。
 *
 * ── 2つのリクエストが来る ──────────────────────────────
 * 1. GET  ?challenge_code=xxx
 *      登録時とその後の定期検証。
 *      sha256(challengeCode + verificationToken + endpointURL) を16進で返す。
 *      連結の順序と、endpointURLがeBayに登録した文字列と完全一致することが条件。
 *      1文字でも違うと検証が通らない。
 *
 * 2. POST 本体に削除通知
 *      eBayユーザーがアカウントを削除したときに飛んでくる。
 *      2xxを返さないとeBayはリトライを続け、最終的にキーセットが止められる。
 *
 * ── 署名検証について ────────────────────────────────
 * POSTの真正性は x-ebay-signature で検証できるが、公開鍵の取得に
 * アプリトークンが要る。キーセットが有効になるまでトークンが取れないため、
 * 初期状態では検証できない。
 *
 * そこで「検証できないうちは削除を実行しない」方針にしてある。
 * 通知は必ず記録して2xxを返す（リトライを止める）が、実際のデータ削除は
 * 署名を検証できるようになってから行う。偽の通知でデータを消すほうが、
 * 削除が遅れるより損害が大きい。
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const { getSupabase } = require('./shared.cjs');

/**
 * eBayに登録するエンドポイントURL。ハッシュの材料になるので、
 * eBayの管理画面に入れた文字列と1文字も違ってはいけない。
 * 末尾スラッシュやクエリの有無でも変わる。
 */
function endpointUrl() {
  return (
    process.env.EBAY_DELETION_ENDPOINT_URL ||
    'https://business-hub-beige.vercel.app/api/ebay-notifications/account-deletion'
  );
}

function verificationToken() {
  return process.env.EBAY_VERIFICATION_TOKEN || '';
}

/** eBayの仕様どおりの順序で連結してSHA-256（16進） */
function challengeResponse(challengeCode) {
  return crypto
    .createHash('sha256')
    .update(challengeCode)
    .update(verificationToken())
    .update(endpointUrl())
    .digest('hex');
}

// ── 1. 検証チャレンジ ───────────────────────────────────
router.get('/account-deletion', (req, res) => {
  const code = req.query.challenge_code;
  if (!code) return res.status(400).json({ error: 'challenge_code がありません' });
  if (!verificationToken()) {
    // 設定漏れに気づけるようにする。ここで200を返すと検証が通らない理由が分からなくなる
    return res.status(500).json({ error: 'EBAY_VERIFICATION_TOKEN が未設定です' });
  }
  res.set('Content-Type', 'application/json');
  res.status(200).json({ challengeResponse: challengeResponse(String(code)) });
});

// ── 2. 削除通知の受信 ───────────────────────────────────
router.post('/account-deletion', async (req, res) => {
  // 先に2xxを返す。処理に時間がかかるとeBayがリトライしてしまう
  res.status(204).end();

  try {
    const body = req.body || {};
    const d = body.notification?.data || {};
    const sb = getSupabase();
    await sb.from('ebay_deletion_notifications').insert({
      notification_id: body.notification?.notificationId || null,
      ebay_username: d.username || null,
      ebay_user_id: d.userId || null,
      eias_token: d.eiasToken || null,
      // 署名は保存しておく。検証できるようになってから遡って確認するため
      signature: req.get('x-ebay-signature') || null,
      verified: false,
      payload: body,
    });
  } catch (e) {
    // 記録に失敗しても2xxは返済み。ログだけ残す
    console.error('[ebay-deletion] 通知の記録に失敗:', e.message);
  }
});

/** 設定が正しいかを自分で確認するための補助。トークン自体は返さない */
router.get('/account-deletion/selftest', (req, res) => {
  const sample = 'test_challenge_code';
  res.json({
    endpoint_url: endpointUrl(),
    token_configured: !!verificationToken(),
    token_length: verificationToken().length,
    sample_challenge_code: sample,
    sample_response: verificationToken() ? challengeResponse(sample) : null,
    note: 'endpoint_url がeBayに登録した文字列と完全一致しているか確認してください',
  });
});

module.exports = router;
module.exports.challengeResponse = challengeResponse;
module.exports.endpointUrl = endpointUrl;
