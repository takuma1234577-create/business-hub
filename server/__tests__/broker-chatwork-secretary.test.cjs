// 仲介窓口: チャットワーク。秘書（Macの claude 鍵）だけが、全ルームの一覧とメッセージを読める。書き込みは従来どおり発注ルームだけ。
// node server/__tests__/broker-chatwork-secretary.test.cjs
const assert = require('node:assert/strict');
process.env.SUPABASE_URL ||= 'http://localhost:54321'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'sb_secret_dummy';
delete process.env.BROKER_CHATWORK_ROOMS;
const { matchRule, SERVICES } = require('../broker.cjs');

const cw = SERVICES.chatwork;
const tier = (m, p) => matchRule('chatwork', m, p)?.tier ?? null;
const ok = (m, p, caller) => cw.scope(p, { method: m, caller });

// ルームの一覧（未読数・メンション数）は、読み取り
assert.equal(tier('GET', '/v2/rooms'), 'free');

// 秘書（claude）は、どのルームのメッセージも読める
assert.equal(ok('GET', '/v2/rooms', 'claude'), true);
assert.equal(ok('GET', '/v2/rooms/111222/messages', 'claude'), true);
// ただし、メッセージ以外（メンバー・ファイル等）は発注ルームだけ
assert.equal(ok('GET', '/v2/rooms/111222/files', 'claude'), false);
// 書き込みは、秘書でも発注ルームだけ
assert.equal(ok('POST', '/v2/rooms/111222/messages', 'claude'), false);
assert.equal(ok('POST', '/v2/rooms/445627173/messages', 'claude'), true);

// AI組織（org）は、従来どおり発注ルームだけ
assert.equal(ok('GET', '/v2/rooms', 'org'), false);
assert.equal(ok('GET', '/v2/rooms/111222/messages', 'org'), false);
assert.equal(ok('GET', '/v2/rooms/445627173/messages', 'org'), true);

console.log('broker chatwork secretary: ok');
