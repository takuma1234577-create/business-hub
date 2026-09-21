/**
 * FITPEAK AIチャットウィジェット Shopify自動インストーラ
 *
 * channel_stores に保存済みの Shopify アクセストークンを使って、
 *   1. snippets/fitpeak-chat-widget.liquid をテーマにアップロード
 *   2. layout/theme.liquid の </body> 直前に {% render %} を挿入
 * を行う。
 *
 * 使い方:
 *   node scripts/install-shopify-chat-widget.cjs                 # 本番テーマへ
 *   node scripts/install-shopify-chat-widget.cjs --theme 1234567 # テーマID指定
 *   node scripts/install-shopify-chat-widget.cjs --uninstall     # 削除
 *
 * 必要な環境変数: SUPABASE_URL, SUPABASE_ANON_KEY
 */

require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { getSupabase } = require(path.join(__dirname, '..', 'server', 'shared.cjs'));

const API_VERSION = '2024-01';
const SNIPPET_KEY = 'snippets/fitpeak-chat-widget.liquid';
const LAYOUT_KEY = 'layout/theme.liquid';
const RENDER_TAG = "{% render 'fitpeak-chat-widget' %}";
const SNIPPET_FILE = path.join(__dirname, 'fitpeak-chat-widget.liquid');

const args = process.argv.slice(2);
const UNINSTALL = args.includes('--uninstall');
const themeArgIdx = args.indexOf('--theme');
const THEME_ID_OVERRIDE = themeArgIdx > -1 ? args[themeArgIdx + 1] : null;

function api(store) {
  return axios.create({
    baseURL: `https://${store.shop_domain}/admin/api/${API_VERSION}`,
    headers: {
      'X-Shopify-Access-Token': store.access_token,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });
}

async function getStore() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('channel_stores')
    .select('*')
    .eq('channel', 'SHOPIFY')
    .eq('is_active', true);
  if (error) throw new Error(`channel_stores取得失敗: ${error.message}`);
  if (!data || data.length === 0) throw new Error('有効なShopifyストアが見つかりません');
  if (data.length > 1) {
    console.log('[install] 複数ストアが見つかりました。1件目を使用します:', data.map((s) => s.shop_domain).join(', '));
  }
  return data[0];
}

async function getMainTheme(client) {
  if (THEME_ID_OVERRIDE) return { id: Number(THEME_ID_OVERRIDE), name: '(指定)' };
  const res = await client.get('/themes.json');
  const main = (res.data.themes || []).find((t) => t.role === 'main');
  if (!main) throw new Error('公開中テーマ(role=main)が見つかりません');
  return main;
}

async function getAsset(client, themeId, key) {
  try {
    const res = await client.get(`/themes/${themeId}/assets.json`, { params: { 'asset[key]': key } });
    return res.data.asset;
  } catch (err) {
    if (err.response && err.response.status === 404) return null;
    throw err;
  }
}

async function putAsset(client, themeId, key, value) {
  await client.put(`/themes/${themeId}/assets.json`, { asset: { key, value } });
}

async function deleteAsset(client, themeId, key) {
  await client.delete(`/themes/${themeId}/assets.json`, { params: { 'asset[key]': key } });
}

async function main() {
  const store = await getStore();
  console.log(`[install] ストア: ${store.shop_domain}`);
  const client = api(store);

  const theme = await getMainTheme(client);
  console.log(`[install] テーマ: ${theme.name} (id=${theme.id})`);

  const layout = await getAsset(client, theme.id, LAYOUT_KEY);
  if (!layout || typeof layout.value !== 'string') throw new Error(`${LAYOUT_KEY} を取得できませんでした`);

  if (UNINSTALL) {
    let v = layout.value;
    if (v.includes(RENDER_TAG)) {
      v = v.replace(new RegExp('\\s*' + RENDER_TAG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
      await putAsset(client, theme.id, LAYOUT_KEY, v);
      console.log('[install] theme.liquid から render タグを削除しました');
    } else {
      console.log('[install] theme.liquid に render タグはありませんでした');
    }
    try {
      await deleteAsset(client, theme.id, SNIPPET_KEY);
      console.log('[install] スニペットを削除しました');
    } catch (_) {
      console.log('[install] スニペットは存在しませんでした');
    }
    console.log('[install] アンインストール完了');
    return;
  }

  const snippet = fs.readFileSync(SNIPPET_FILE, 'utf8');
  await putAsset(client, theme.id, SNIPPET_KEY, snippet);
  console.log(`[install] ${SNIPPET_KEY} をアップロードしました (${snippet.length} 文字)`);

  if (layout.value.includes(RENDER_TAG)) {
    console.log('[install] theme.liquid には既に render タグがあります（スキップ）');
  } else if (!layout.value.includes('</body>')) {
    console.error('[install] theme.liquid に </body> が見つかりません。手動で次の1行を追加してください:');
    console.error(`  ${RENDER_TAG}`);
  } else {
    const updated = layout.value.replace('</body>', `  ${RENDER_TAG}\n  </body>`);
    await putAsset(client, theme.id, LAYOUT_KEY, updated);
    console.log('[install] theme.liquid の </body> 直前に render タグを挿入しました');
  }

  console.log('');
  console.log(`[install] 完了。https://${store.shop_domain} を開いて右下のボタンを確認してください。`);
  console.log('[install] API疎通確認: curl https://business-hub-beige.vercel.app/api/public/chat/health');
}

main().catch((err) => {
  const detail = err.response ? `${err.response.status} ${JSON.stringify(err.response.data).slice(0, 300)}` : err.message;
  console.error('[install] エラー:', detail);
  process.exit(1);
});
