// My FITPEAK: スマホのブラウザ→LINEアプリでログインしたとき、元のブラウザへログインを引き渡す。
// node server/__tests__/myfp-login-handoff.test.cjs
const assert = require('node:assert/strict');
const { createHandoff, describeHandoff, approveHandoff, claimHandoff, memoryStore } = require('../my-fitpeak-login-handoff.cjs');

const T0 = Date.parse('2026-10-16T04:00:00Z');
const profile = { lineUserId: 'Uabc', displayName: 'たく', email: null };

(async () => {
  // 1) 承認前は待ち。承認後は合言葉(pollKey)を持つ元のブラウザだけが1回だけ受け取れる
  {
    const store = memoryStore();
    const h = await createHandoff(store, T0);
    assert.match(h.id, /^[A-Za-z0-9_-]{20,}$/);
    assert.match(h.pollKey, /^[A-Za-z0-9_-]{30,}$/);
    assert.match(h.code, /^\d{2}$/);

    assert.deepEqual(await claimHandoff(store, h.id, h.pollKey, T0 + 1000), { status: 'pending' });
    assert.deepEqual(await describeHandoff(store, h.id, T0 + 2000), { status: 'pending', code: h.code });

    assert.equal((await approveHandoff(store, h.id, profile, T0 + 3000)).ok, true);
    assert.equal((await claimHandoff(store, h.id, 'wrong-key', T0 + 4000)).status, 'invalid');

    const got = await claimHandoff(store, h.id, h.pollKey, T0 + 5000);
    assert.equal(got.status, 'approved');
    assert.equal(got.profile.lineUserId, 'Uabc');

    // 2回目は受け取れない
    assert.equal((await claimHandoff(store, h.id, h.pollKey, T0 + 6000)).status, 'invalid');
  }

  // 2) 期限(10分)を過ぎたら承認も受け取りもできない
  {
    const store = memoryStore();
    const h = await createHandoff(store, T0);
    assert.equal((await approveHandoff(store, h.id, profile, T0 + 11 * 60 * 1000)).ok, false);
    assert.equal((await describeHandoff(store, h.id, T0 + 11 * 60 * 1000)).status, 'expired');
    assert.equal((await claimHandoff(store, h.id, h.pollKey, T0 + 11 * 60 * 1000)).status, 'expired');
  }

  // 3) 承認は1回だけ（別のLINEアカウントで上書きされない）
  {
    const store = memoryStore();
    const h = await createHandoff(store, T0);
    assert.equal((await approveHandoff(store, h.id, profile, T0 + 1000)).ok, true);
    assert.equal((await approveHandoff(store, h.id, { lineUserId: 'Uother' }, T0 + 2000)).ok, false);
    const got = await claimHandoff(store, h.id, h.pollKey, T0 + 3000);
    assert.equal(got.profile.lineUserId, 'Uabc');
  }

  // 4) 存在しないID
  {
    const store = memoryStore();
    assert.equal((await describeHandoff(store, 'nope', T0)).status, 'invalid');
    assert.equal((await approveHandoff(store, 'nope', profile, T0)).ok, false);
    assert.equal((await claimHandoff(store, 'nope', 'x', T0)).status, 'invalid');
  }

  // 5) 合言葉はそのまま保存しない
  {
    const store = memoryStore();
    const h = await createHandoff(store, T0);
    const row = await store.get(h.id);
    assert.notEqual(row.poll_hash, h.pollKey);
    assert.equal(JSON.stringify(row).includes(h.pollKey), false);
  }

  console.log('myfp-login-handoff: ok');
})().catch(e => { console.error(e); process.exit(1); });
