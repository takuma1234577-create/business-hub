// カスタマーサービス部門のLINE返信: 返信文の安全検査と、受信箱（未返信）の判定。node server/__tests__/cs-line.test.cjs
const assert = require('node:assert/strict');
process.env.SUPABASE_URL ||= 'http://localhost:54321'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'sb_secret_dummy';
const { checkReplyText, pendingThreads, textOf, withFooter, FOOTER } = require('../cs-ai.cjs');

// 返信文の検査
assert.equal(checkReplyText('サイズはMがおすすめです。詳しくは https://fitpeak.co/pages/size をご覧ください。'), null);
assert.match(checkReplyText(''), /空/);
assert.match(checkReplyText('あ'.repeat(901)), /長/);
assert.match(checkReplyText('090-1234-5678 までご連絡ください'), /個人情報/);
assert.match(checkReplyText('こちらをどうぞ https://evil.example.com/x'), /URL/);
assert.match(checkReplyText('原価は500円です'), /原価|利益/);
assert.match(checkReplyText('飲めば筋肉が増えます。絶対に効きます'), /効能|断定/);
assert.match(checkReplyText('これで痩せる商品です'), /効能|断定/);
assert.equal(checkReplyText('自己判断での使用はおすすめできません。医師にご相談ください。'), null);
assert.equal(withFooter('こんにちは'), `こんにちは${FOOTER}`);
assert.equal(withFooter(`こんにちは${FOOTER}`), `こんにちは${FOOTER}`);   // 二重に付けない

assert.equal(textOf({ text: 'hi' }), 'hi');
assert.equal(textOf({ messages: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] }), 'a\nb');
assert.equal(textOf(null), '');

// 受信箱: 友だちごとに、最後が「人の受信」で、その後に返信がなく、処理済みでないもの
const t = (m) => new Date(Date.UTC(2026, 9, 2, 12, m)).toISOString();
const rows = [
  { id: 'i1', friend_id: 'f1', direction: 'incoming', content: { text: 'サイズは？' }, created_at: t(0) },                         // 未返信
  { id: 'i2', friend_id: 'f2', direction: 'incoming', content: { text: 'ありがとう' }, created_at: t(1) },
  { id: 'o2', friend_id: 'f2', direction: 'outgoing', content: { text: 'いえいえ', source: 'crm_ui' }, created_at: t(2) },        // 人が返信済み
  { id: 'i3', friend_id: 'f3', direction: 'incoming', content: { text: '届きません' }, created_at: t(3) },
  { id: 'o3', friend_id: 'f3', direction: 'outgoing', content: { text: 'AI', source: 'fitpeak_rag_instant' }, created_at: t(3) }, // 旧AIが返信済み
  { id: 'i4', friend_id: 'f4', direction: 'incoming', content: { text: '返品したい' }, created_at: t(4) },                         // 処理済み
  { id: 'i5', friend_id: 'f5', direction: 'incoming', content: { text: '質問' }, created_at: t(5) },                              // 除外対象の友だち
  { id: 'i6', friend_id: 'f6', direction: 'incoming', content: { text: '質問2' }, created_at: t(5) },
  { id: 'o6', friend_id: 'f6', direction: 'outgoing', content: { text: '手動', source: 'crm_ui' }, created_at: t(-60) },             // 1時間前に人が返信（会話は人が持っている）
];
const opts = { handled: new Set(['i4']), excludeFriends: new Set(['f5']), humanWindowMs: 24 * 3600000, now: new Date(t(30)) };
// シャドー: 旧AIの返信は「返信済み」に数えない / ライブ: 数える
assert.deepEqual(pendingThreads(rows, { ...opts, aiCountsAsAnswer: false }).map((x) => x.incoming_id).sort(), ['i1', 'i3']);
assert.deepEqual(pendingThreads(rows, { ...opts, aiCountsAsAnswer: true }).map((x) => x.incoming_id).sort(), ['i1']);
const th = pendingThreads(rows, { ...opts, aiCountsAsAnswer: false })[0];
assert.equal(typeof th.text, 'string'); assert.equal('display_name' in th, false);
console.log('OK   cs-line');

// 約束の禁止（2026-10-06）: 人が動く約束・期限の約束は、送信前に弾く。通常の案内は通す
assert.match(checkReplyText('担当者から本日中にご連絡いたします。'), /約束/);
assert.match(checkReplyText('責任者から必ず連絡させていただきます。'), /約束/);
assert.match(checkReplyText('確認のうえ、折り返しご連絡します。'), /約束/);
assert.match(checkReplyText('明日までに発送いたします。'), /約束/);
assert.equal(checkReplyText('内容を確認のうえ、このLINEでお知らせします。お時間をいただく場合があります。'), null);
assert.equal(checkReplyText('サイズはMがおすすめです。'), null);
console.log('cs-line promise guard: OK');
