#!/usr/bin/env node
// My FITPEAK の「通っているジム」検索用の店舗一覧（server/data/gym-directory.json）を、筋トレ最安ナビの店舗データから作る。
//   node scripts/build-gym-directory.cjs <fitpeak-price-api のフォルダ>
// 店舗レビュー記事のジムは別途サーバーが fitpeak.co から取る（server/my-fitpeak-account.cjs）。
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/build-gym-directory.cjs <fitpeak-price-api>'); process.exit(1); }
const chains = require(path.resolve(dir, 'lib/gym-stores.json'));
const indie = require(path.resolve(dir, 'lib/gym-indie.json'));
const seen = new Set();
const stores = [];
const add = (pref, city, name) => {
  if (!pref || !city || !name) return;
  const k = `${pref}:${city}:${name}`;
  if (seen.has(k)) return;
  seen.add(k);
  stores.push([pref, city, name]);
};
for (const [pref, v] of Object.entries(chains.prefectures)) for (const s of v.stores) add(pref, s[2], `${chains.chains[s[0]]} ${s[1]}`);
for (const [pref, list] of Object.entries(indie.prefectures)) for (const g of list) add(pref, g.city, g.name);
const out = { checked_at: [chains.checked_at, indie.checked_at].filter(Boolean).join(' / '), source: 'fitpeak-price-api lib/gym-stores.json + gym-indie.json', stores };
fs.writeFileSync(path.join(__dirname, '../server/data/gym-directory.json'), JSON.stringify(out));
console.log(`${stores.length} 店舗`);
