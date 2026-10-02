// AI組織向けのカスタマーサービスAPI: 個人情報の伏せ字、応答の整形。node server/__tests__/cs-ai.test.cjs
const assert = require('node:assert/strict');
process.env.SUPABASE_URL ||= 'http://localhost:54321'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'sb_secret_dummy';
const { maskPii, publicEmailLog, publicChunk, slugOf } = require('../cs-ai.cjs');

assert.equal(maskPii('連絡は taro.yamada+x@example.co.jp まで'), '連絡は [メール] まで');
assert.equal(maskPii('電話 090-1234-5678 と 03(1234)5678'), '電話 [電話] と [電話]');
assert.equal(maskPii('09012345678にお願いします'), '[電話]にお願いします');
assert.equal(maskPii('〒150-0001 東京都渋谷区神宮前1-2-3 まで'), '[住所] まで');
assert.equal(maskPii('注文番号 #12345678 と 250-1234567-1234567'), '注文番号 [注文番号] と [注文番号]');
assert.equal(maskPii('山田太郎様、ありがとうございます'), 'お客様、ありがとうございます');
assert.equal(maskPii('Uabcdef0123456789abcdef0123456789 のLINE'), '[LINE ID] のLINE');
assert.equal(maskPii('サイズはMでよいですか'), 'サイズはMでよいですか');   // 普通の文は変えない
assert.equal(maskPii(null), '');

// ログ: 宛先のメールアドレスは返さず、本文は伏せる
const log = publicEmailLog({ id: 'l1', created_at: 't', status: 'sent', customer_email: 'a@b.com', subject: '山田様の件 a@b.com', customer_message: '090-1111-2222 に連絡', ai_reply: '山田様 承知しました', error: null, gmail_message_id: 'g1' });
assert.equal('customer_email' in log, false); assert.equal('gmail_message_id' in log, false);
assert.equal(log.subject.includes('a@b.com'), false); assert.equal(log.customer_message, '[電話] に連絡'); assert.equal(log.ai_reply, 'お客様 承知しました');
// ナレッジ: メタデータ（顧客のメール）と埋め込みは返さない
const ch = publicChunk({ id: 'c1', source: 'shopify_email', source_id: 'g1', category: 'message', title: 't', content: '質問: a@b.com\n回答: ok', metadata: { customer_email: 'a@b.com' }, embedding: [1], updated_at: 'u' });
assert.equal('metadata' in ch, false); assert.equal('embedding' in ch, false); assert.equal(ch.content.includes('a@b.com'), false);
assert.equal(slugOf('サイズ選び: リストラップ 60cm/90cm!'), 'サイズ選び-リストラップ-60cm-90cm');
console.log('OK   cs-ai');
