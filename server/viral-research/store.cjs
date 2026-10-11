'use strict';
// JSON ファイルの保存領域(このMacの中だけ)
const { mkdir, readFile, writeFile, rename } = require('node:fs/promises');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');

// business-hub 直下の data/viral-research(git管理外)。このMacの中だけに残る
const DIR = process.env.VR_DATA_DIR || join(__dirname, '..', '..', 'data', 'viral-research');

async function load(name, fallback) {
  try { return JSON.parse(await readFile(join(DIR, `${name}.json`), 'utf8')); } catch { return fallback; }
}
async function save(name, value) {
  await mkdir(DIR, { recursive: true });
  const file = join(DIR, `${name}.json`);
  await writeFile(`${file}.tmp`, JSON.stringify(value, null, 1));
  await rename(`${file}.tmp`, file);
}

// 監視アカウント
const listTracked = () => load('tracked', []);
async function addTracked(account) {
  const list = await listTracked();
  if (!list.some((a) => a.platform === account.platform && a.handle === account.handle)) {
    list.push({ ...account, addedAt: new Date().toISOString() });
    await save('tracked', list);
  }
  return list;
}
async function removeTracked(platform, handle) {
  await save('tracked', (await listTracked()).filter((a) => !(a.platform === platform && a.handle === handle)));
}

// リサーチエージェント(ニッチごとの検索設定)
const listAgents = () => load('agents', []);
async function saveAgent(agent) {
  const list = await listAgents();
  const now = new Date().toISOString();
  const next = { ...agent, id: agent.id || randomUUID(), createdAt: agent.createdAt || now, updatedAt: now };
  const i = list.findIndex((a) => a.id === next.id);
  if (i >= 0) list[i] = next; else list.push(next);
  await save('agents', list);
  return next;
}
async function deleteAgent(id) {
  await save('agents', (await listAgents()).filter((a) => a.id !== id));
}

// 検索結果(キーごとに最新のみ)
async function saveResults(key, videos) {
  const all = await load('results', {});
  all[key] = { at: new Date().toISOString(), videos };
  await save('results', all);
}
async function getResults(key) {
  return (await load('results', {}))[key]?.videos ?? null;
}
async function getResultsMeta(key) {
  return (await load('results', {}))[key] ?? null;
}

// 保存物(台本・ブリーフ・レポート)
async function listAssets() {
  return (await load('assets', [])).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
async function saveAsset({ title, kind, body }) {
  const list = await load('assets', []);
  const asset = { id: randomUUID(), title, kind, body, createdAt: new Date().toISOString() };
  list.push(asset);
  await save('assets', list);
  return asset;
}
async function deleteAsset(id) {
  await save('assets', (await load('assets', [])).filter((a) => a.id !== id));
}

// チャットのスレッド(Claude のセッションIDと表示用の履歴)
const listThreads = () => load('threads', []);
async function saveThread(thread) {
  const list = await listThreads();
  const i = list.findIndex((t) => t.id === thread.id);
  const next = { ...thread, updatedAt: new Date().toISOString() };
  if (i >= 0) list[i] = next; else list.unshift(next);
  await save('threads', list.slice(0, 100));
  return next;
}
async function getThread(id) {
  return (await listThreads()).find((t) => t.id === id) ?? null;
}

module.exports = { addTracked, removeTracked, saveAgent, deleteAgent, saveResults, getResults, getResultsMeta, listAssets, saveAsset, deleteAsset, saveThread, getThread, listTracked, listAgents, listThreads };
