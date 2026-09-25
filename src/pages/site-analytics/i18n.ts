// ---------------------------------------------------------------------------
// FITPEAK サイト分析：日本語／英語の切り替え
//
// 画面に出す日本語をそのままキーにして引く。辞書に無い文字列は日本語のまま出る
// ので、訳を足し忘れても表示が壊れない。
// 言語は ?lang=en / ?lang=ja で上書きでき、選んだ言語は localStorage に残る。
// ---------------------------------------------------------------------------
import { useSyncExternalStore } from 'react'

export type Lang = 'ja' | 'en'

const STORAGE_KEY = 'sa_lang'

function initialLang(): Lang {
  try {
    const q = new URLSearchParams(window.location.search).get('lang')
    if (q === 'en' || q === 'ja') return q
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'ja') return saved
  } catch { /* noop */ }
  return 'ja'
}

let lang: Lang = initialLang()
const listeners = new Set<() => void>()

export const getLang = (): Lang => lang

export function setLang(next: Lang) {
  if (next === lang) return
  lang = next
  try { window.localStorage.setItem(STORAGE_KEY, next) } catch { /* noop */ }
  listeners.forEach((fn) => fn())
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** 言語が変わったら再描画する */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, () => 'ja' as Lang)
}

/** 数値・日付の表記に使うロケール */
export const locale = () => (lang === 'en' ? 'en-US' : 'ja-JP')

const EN: Record<string, string> = {
  // 画面全体
  'FITPEAK サイト分析': 'FITPEAK Site Analytics',
  'ホームへ戻る': 'Back to home',
  'リアルタイム': 'Realtime',
  'サイト全体': 'Site overview',
  'ページ別': 'By page',
  'ヒートマップ': 'Heatmap',
  '設置方法': 'Install',
  '今日': 'Today',
  '昨日': 'Yesterday',
  '7日間': 'Last 7 days',
  '30日間': 'Last 30 days',
  '90日間': 'Last 90 days',
  'すべて': 'All',
  'スマホ': 'Mobile',
  'PC': 'Desktop',
  'タブレット': 'Tablet',
  '不明': 'Unknown',
  '日本語': 'Japanese',
  '英語': 'English',
  '読み込み中…': 'Loading…',
  '集計中…': 'Calculating…',
  'データがありません': 'No data',
  'データがまだありません': 'No data yet',
  '取得に失敗しました': 'Could not load the data',
  'コピー': 'Copy',
  'コピーしました': 'Copied',
  '閉じる': 'Close',
  '表示': 'Show',
  '描画': 'Render',

  // 指標
  'ユーザー': 'Users',
  '新規ユーザー': 'New users',
  'セッション': 'Sessions',
  'ページビュー': 'Pageviews',
  '直帰率': 'Bounce rate',
  '離脱率': 'Exit rate',
  '平均滞在': 'Avg. time',
  '平均滞在時間': 'Avg. time on page',
  '平均閲覧時間': 'Avg. time viewed',
  '平均スクロール': 'Avg. scroll',
  '平均スクロール到達': 'Avg. scroll depth',
  'ページ/セッション': 'Pages / session',
  'カート追加': 'Add to cart',
  '購入手続きへ': 'Checkout started',
  '新規': 'New',
  'リピーター': 'Returning',
  '新規／リピーター': 'New vs returning',
  '入口数': 'Entrances',
  '入口になった回数': 'Times used as entry page',
  'クリック': 'Clicks',
  '連打': 'Rage clicks',
  '連打（イライラの兆候）': 'Rage clicks (sign of frustration)',
  'スクロール': 'Scroll',
  '推移': 'Trend',
  'ページ': 'Page',
  'ページ目': 'Page',
  '件）': ' items)',
  '人': '',
  '回': '',
  '分': ' min',
  '順': '',

  // 見出し・説明
  'ページビューの推移': 'Pageviews over time',
  '流入チャネル': 'Traffic channels',
  '流入チャネル（セッション）': 'Traffic channels (sessions)',
  '参照元サイト': 'Referring sites',
  'キャンペーン（utm_source / campaign）': 'Campaigns (utm_source / campaign)',
  'デバイス': 'Devices',
  'ブラウザ': 'Browsers',
  '国': 'Countries',
  '都市': 'Cities',
  '入口ページ（最初に見たページ）': 'Entry pages (first page viewed)',
  '離脱ページ（最後に見たページ）': 'Exit pages (last page viewed)',
  '直前に見ていたページ': 'Previous page',
  '次に見たページ': 'Next page',
  'スクロール到達率': 'Scroll depth',
  'スクロール到達率（どこまで読まれたか）': 'Scroll depth (how far people read)',
  '曜日×時間帯': 'Day of week × hour',
  '購入までの流れ（セッション）': 'Path to purchase (sessions)',
  'よくクリックされている要素': 'Most clicked elements',
  'よくクリックされている要素（サイト全体）': 'Most clicked elements (whole site)',
  'クリックされている要素': 'Clicked elements',
  '熟読エリア': 'Attention',
  'ページ上の分布': 'Distribution on the page',
  'レイジクリック（連打）の位置': 'Where rage clicks happen',
  'ページのスクリーンショット': 'Page screenshot',
  'ヒートマップを見る': 'Open heatmap',
  'ページを開く': 'Open page',
  'ページを撮影する': 'Capture this page',
  'スクショを撮り直す': 'Recapture screenshot',
  '撮影中…（30秒ほど）': 'Capturing… (about 30 seconds)',
  'スクリーンショットの撮影に失敗しました：': 'Could not capture the screenshot: ',
  '数字の見方': 'How to read these numbers',
  '計測している内容': 'What is measured',
  '計測タグ': 'Tracking tag',
  '自分のアクセスを除外する': 'Exclude your own visits',
  '前期間比': 'vs. previous period',
  '前期間 0': 'previous period 0',
  'このページ（期間内）': 'This page (in range)',
  'このページから入り、他のページを見ずに離脱した割合': 'Share of sessions that entered here and left without viewing another page',
  'このページが最後に見られたページだった割合': 'Share of sessions where this was the last page viewed',
  'このページを画面に表示していた時間の平均': 'Average time this page was on screen',
  '行をクリックするとページ別の詳細とヒートマップを開きます': 'Click a row to open page details and the heatmap',
  'すべて表示（': 'Show all (',
  '（テキストなし）': '(no text)',
  '（期間内のアクセスなし）': '(no visits in this range)',
  'クリックのデータがまだありません': 'No click data yet',
  '（連打': '(rage ',
  'がここまで到達': ' reached this depth',
  '前の段階から ': 'from previous step ',
  'ページの半分まで読まれた割合：': 'Share who read to the halfway point: ',
  'ページだけ見て離脱したセッションの割合': 'Share of sessions that viewed only this page and left',
  'セッションで画面を見ていた時間の平均': 'Average time on screen per session',
  '時台：': ':00 — ',
  '注目度 ': 'attention ',
  '滞在 ': 'time ',
  '滞在順': 'By time on page',
  'カート追加順': 'By add to cart',
  '離脱率順': 'By exit rate',
  'クリック 少': 'fewer clicks',
  '到達 少': 'lower reach',
  '注目 少': 'less attention',
  '多': 'more',
  '直接': 'Direct',
  '日本時間。濃いほどページビューが多い時間帯': 'Japan time. Darker means more pageviews.',
  '時間の区切りは日本時間。「前期間比」は同じ長さの直前の期間との比較です。':
    'Hours and days are in Japan time. “vs. previous period” compares with the immediately preceding period of the same length.',
  '直帰率＝1ページだけ見て離脱したセッションの割合。離脱率＝そのページが最後に見られた割合。':
    'Bounce rate = share of sessions that viewed a single page and left. Exit rate = share of sessions where the page was the last one viewed.',
  '決済完了はShopifyの決済画面（別システム）で起きるため、ここでは「購入手続きへ」までを計測します。':
    'Checkout completion happens on Shopify’s own checkout, so this report measures up to “checkout started”.',
  '決済完了はShopifyの決済画面側のため、ここでは「購入手続きへ」までを計測':
    'Checkout completion happens on Shopify’s checkout, so this measures up to “checkout started”',
  'この期間のデータはまだありません。計測タグの設置後、アクセスがあると集計されます（「設置方法」タブ参照）。':
    'No data for this period yet. Once the tracking tag is installed, visits start appearing here (see the Install tab).',

  // リアルタイム
  '今サイトを見ている人': 'People on the site right now',
  '今見られているページ': 'Pages being viewed now',
  '流入元（今いる人）': 'Traffic sources (right now)',
  'デバイス（今いる人）': 'Devices (right now)',
  'いまサイトにいる人（行動の詳細）': 'People on the site right now (activity detail)',
  'ライブ行動ログ（直近30分）': 'Live activity log (last 30 minutes)',
  '今は誰も見ていません': 'Nobody is on the site right now',
  '直近30分のアクセスはありません': 'No visits in the last 30 minutes',
  '直近30分のページビュー（1分ごと）': 'Pageviews in the last 30 minutes (per minute)',
  '直近90秒以内に画面を開いていた人数（5秒ごとに自動更新）': 'People with a page open in the last 90 seconds (refreshes every 5 seconds)',
  'リアルタイムの「今見ている人」は、直近90秒以内に画面を開いていた人数です。':
    '“People on the site right now” counts everyone with a page open in the last 90 seconds.',
  '分のPV': 'min pageviews',
  '分のユーザー': 'min users',
  '分のカート追加': 'min add to cart',

  // ヒートマップ
  'まだページの画像がありません。右上の「ページを撮影する」で、実際の画面の上に重ねて表示できます。':
    'No screenshot for this page yet. Use “Capture this page” at the top right to overlay the data on the real screen.',
  'で見られたときのデータです。クリック位置はページ全体の縦横比で記録しているため、ページの構成を大きく変えた後は撮り直してください。':
    '. Click positions are stored as a ratio of the whole page, so recapture the screenshot after a big layout change.',
  'かパスを入力（例：/products/xxx）': ' or type a path (e.g. /products/xxx)',

  // 設置方法
  'の直前に貼り付けます。全ページで計測が始まります。': '. Measurement starts on every page.',
  '管理画面 →「オンラインストア」→「テーマ」→ 公開中テーマの「…」→「コードを編集」→':
    'Shopify admin → Online Store → Themes → “…” on the live theme → Edit code →',
  'ページビュー・ユーザー（新規／リピーター）・セッション（30分無操作で区切り）':
    'Pageviews, users (new / returning) and sessions (split after 30 minutes of inactivity)',
  '流入元（自然検索／広告／SNS／AI／メール・LINE／参照サイト／直接）、utmパラメータ':
    'Traffic source (organic search / ads / social / AI / email and LINE / referral / direct) and utm parameters',
  'スクロール到達率、ページの各部分が画面に映っていた時間（熟読エリア）':
    'Scroll depth and how long each part of the page stayed on screen (attention)',
  'クリック位置と要素、同じ場所の連打（イライラの兆候）':
    'Click positions and elements, plus repeated clicks in one spot (a sign of frustration)',
  'カート追加・「購入手続きへ」のクリック': 'Add to cart and “checkout” clicks',
  'デバイス・ブラウザ（LINEやInstagramのアプリ内ブラウザも判別）・国・都市':
    'Device, browser (including the in-app browsers of LINE and Instagram), country and city',
  'アドレス・氏名・メールなど個人を特定する情報は保存しません。ボットのアクセスとテーマエディタでのプレビューは除外します。':
    'No personally identifying information (address, name, email) is stored. Bot traffic and theme-editor previews are excluded.',
  '自分のスマホやPCで一度だけ': 'Open this once on your own phone or computer: ',
  'を開くと、そのブラウザからのアクセスは計測されなくなります。解除は': '. That browser stops being counted. To undo it, use ',

  // 共有リンク
  '共有リンク': 'Share link',
  '広告主向け共有リンク': 'Share link for advertisers',
  '新しいリンクを発行': 'Create a new link',
  '発行する': 'Create',
  '発行中…': 'Creating…',
  'リンク名（社名など）': 'Link name (e.g. company name)',
  '有効期限': 'Expires',
  '失効させる': 'Revoke',
  '失効済み': 'Revoked',
  '期限切れ': 'Expired',
  '有効': 'Active',
  '発行日': 'Created',
  '閲覧数': 'Views',
  'まだ共有リンクはありません。': 'No share links yet.',
  '7日後に自動で見られなくなります。': 'The link stops working automatically after 7 days.',
  'このリンクを知っている人は、ログインなしでサイト全体とページ別の数字を閲覧できます（リアルタイムとヒートマップは含みません）。':
    'Anyone with this link can view the site overview and per-page numbers without logging in. Realtime and heatmap are not included.',
  'このリンクは失効しています。FITPEAKにご連絡ください。': 'This link is no longer valid. Please contact FITPEAK.',
  'このリンクは有効期限が切れています。FITPEAKにご連絡ください。': 'This link has expired. Please contact FITPEAK.',
  '閲覧専用': 'View only',
  'まで有効': 'Valid until ',
  '残り': '',
  '日': ' days',
  // 追記：区切り記号・単位（英語では半角に寄せる）
  '：': ': ',
  '（': ' (',
  '）': ')',
  '。': '.',
  '曜': '',
  ' の ': ' and paste the tag just before ',

  // 追記：指標・並び順
  'PV順': 'By pageviews',
  '閲覧': 'View',
  '% がここまで到達': '% reached this depth',
  '1セッションで画面を見ていた時間の平均': 'Average time on screen per session',
  '1ページだけ見て離脱したセッションの割合': 'Share of sessions that viewed a single page and left',
  '30分のユーザー': 'Users (30 min)',
  '30分のPV': 'Pageviews (30 min)',
  '30分のカート追加': 'Add to cart (30 min)',

  // 追記：流入チャネル（サーバーが返すラベル）
  '自然検索': 'Organic search',
  '広告': 'Ads',
  'SNS': 'Social',
  'メール・LINE': 'Email / LINE',
  '参照サイト': 'Referral',
  'キャンペーン': 'Campaign',
  '内部': 'Internal',
  'その他': 'Other',

  // 追記：ブラウザ（サーバーが返すラベル）
  'LINE内ブラウザ': 'LINE in-app browser',
  'Instagram内ブラウザ': 'Instagram in-app browser',
  'Facebook内ブラウザ': 'Facebook in-app browser',
  'TikTok内ブラウザ': 'TikTok in-app browser',

  // 追記：設置方法
  'Shopify管理画面 →「オンラインストア」→「テーマ」→ 公開中テーマの「…」→「コードを編集」→':
    'Shopify admin → Online Store → Themes → “…” on the live theme → Edit code →',
  'IPアドレス・氏名・メールなど個人を特定する情報は保存しません。ボットのアクセスとテーマエディタでのプレビューは除外します。':
    'No personally identifying information (IP address, name, email) is stored. Bot traffic and theme-editor previews are excluded.',
  '画面に表示していた時間（別タブに移っている間は数えない）':
    'Time the page was actually on screen (time spent in other tabs is not counted)',
}

/** 画面用の文字列を今の言語で返す。辞書に無ければ日本語のまま。 */
export function t(ja: string): string {
  return lang === 'en' ? (EN[ja] ?? ja) : ja
}

/** 言語の変更で再描画しつつ t を使うためのフック */
export function useT() {
  useLang()
  return t
}
