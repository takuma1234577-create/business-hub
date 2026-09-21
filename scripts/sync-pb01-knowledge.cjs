/**
 * FITPEAK PB-01（スライドピラティスボード）ナレッジ同期スクリプト
 *
 * 手書きのナレッジ（pb01-knowledge.json）を Voyage AI で埋め込み、
 * knowledge_chunks テーブルに upsert する。
 *
 * 使い方:
 *   node scripts/sync-pb01-knowledge.cjs
 *
 * 必要な環境変数:
 *   SUPABASE_URL, SUPABASE_ANON_KEY
 *   VOYAGE_API_KEY
 *
 * 備考:
 *   Voyage 無料枠は 3 RPM のため 22 秒間隔で 1 件ずつ処理します（12件で約5分）。
 */

require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { getSupabase } = require(path.join(__dirname, '..', 'server', 'shared.cjs'));
const { embedText } = require(path.join(__dirname, '..', 'server', 'fitpeak-rag.cjs'));

const SOURCE = 'fitpeak-manual';
const KNOWLEDGE_FILE = path.join(__dirname, 'pb01-knowledge.json');
const EMBED_INTERVAL_MS = 22_000;
const MAX_RETRIES = 3;
const PRODUCT_URL = 'https://fitpeak.co/products/pilates-board-pb01';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function embedWithRetry(text) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await embedText(text, 'document');
    } catch (err) {
      lastErr = err;
      const is429 = /\b429\b/.test(err.message || '');
      if (!is429 || attempt === MAX_RETRIES) throw err;
      const waitMs = 25_000 * attempt;
      console.log(`    [retry] 429: ${waitMs / 1000}s待機してリトライ (${attempt}/${MAX_RETRIES})`);
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

async function main() {
  const supabase = getSupabase();

  const raw = fs.readFileSync(KNOWLEDGE_FILE, 'utf8');
  const items = JSON.parse(raw);
  console.log(`[pb01] ナレッジ件数: ${items.length}`);

  const rows = items.map((it) => ({
    source: SOURCE,
    source_id: it.source_id,
    category: it.category,
    title: it.title,
    content: it.content,
    metadata: {
      product: 'FITPEAK スライドピラティスボード PB-01',
      sku: 'FP-PB-01',
      url: PRODUCT_URL,
      updated_by: 'sync-pb01-knowledge',
    },
  }));

  const estMin = Math.ceil((rows.length * EMBED_INTERVAL_MS) / 60000);
  console.log(`[pb01] 埋め込み生成: ${rows.length} 件（逐次・約${estMin}分）`);

  let ok = 0;
  let ng = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const start = Date.now();
    try {
      row.embedding = await embedWithRetry(`${row.title}\n${row.content}`);
      ok++;
      console.log(`  [${i + 1}/${rows.length}] ok: ${row.source_id}`);
    } catch (err) {
      console.error(`  [${i + 1}/${rows.length}] fail: ${row.source_id}: ${String(err.message).slice(0, 140)}`);
      ng++;
    }
    if (i < rows.length - 1) {
      const wait = Math.max(0, EMBED_INTERVAL_MS - (Date.now() - start));
      if (wait > 0) await sleep(wait);
    }
  }
  console.log(`[pb01] 埋め込み完了 ok=${ok} ng=${ng}`);

  const embedded = rows.filter((r) => Array.isArray(r.embedding));
  if (embedded.length === 0) {
    console.error('[pb01] upsert対象がありません。VOYAGE_API_KEY を確認してください。');
    process.exit(1);
  }

  const payload = embedded.map((r) => ({ ...r, updated_at: new Date().toISOString() }));
  const { error } = await supabase
    .from('knowledge_chunks')
    .upsert(payload, { onConflict: 'source,source_id' });

  if (error) {
    console.error('[pb01] upsert失敗:', error.message);
    process.exit(1);
  }

  console.log(`[pb01] upsert完了: ${payload.length} 件`);
  console.log('[pb01] 完了しました。LINEで「ピラティスボードの厚さは？」等を送って動作確認してください。');
}

main().catch((err) => {
  console.error('[pb01] エラー:', err);
  process.exit(1);
});
