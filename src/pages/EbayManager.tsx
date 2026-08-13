import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, RefreshCw, AlertTriangle, Package, ShoppingCart,
  TrendingUp, Settings as SettingsIcon, Save, Play, StopCircle,
  RotateCcw, ExternalLink, Clock, Download,
} from 'lucide-react'

// ── 型 ──────────────────────────────────────────────────
interface Source {
  id: string
  listing_id: string
  source: 'yahoo' | 'mercari' | 'suruga' | 'rakuten' | 'amazon' | 'kitamura'
  search_keyword: string
  exclude_words: string | null
  last_price_jpy: number | null
  last_count: number | null
  last_available: boolean
  last_checked_at: string | null
  last_error: string | null
  last_title: string | null
  url: string | null            // 特定商品への直リンク（人が手で登録した場合）
  last_url: string | null       // 巡回時にスクレイパーが実際に叩いた検索URL（相場を見る用）
  last_item_url: string | null  // 選定した個体のURL（実際に買う用）
  last_item_title: string | null
  last_item_total_jpy: number | null
  last_item_reason: string | null  // なぜその個体を選んだか
  enabled: boolean
}

// 仕入先URLからの取り込み結果
interface ImportResult {
  import_id: string
  supplier: {
    source: string; url: string; item_id: string
    title_ja: string; price_jpy: number | null; condition_ja: string | null
    available: boolean; genre: string | null; description_ja: string
    image_urls: string[]; image_count: number; fetched_at: string
  }
  listing: {
    title_en: string; description_html: string
    condition_id: number; condition_en: string
    item_specifics: Record<string, string>
  }
  pricing: { price_usd: number; regions?: { name: string; profit_jpy: number; margin_pct: number }[] } | null
  bundle_suspect: boolean
  warnings: string[]
}

interface ImportRow {
  id: string
  source: string; source_url: string
  title_ja: string; title_en: string | null
  price_jpy: number | null; condition_ja: string | null; genre: string | null
  image_urls: string[] | null
  bundle_suspect: boolean
  warnings: string[] | null
  fetched_at: string | null
  listing_id: string | null
  auto: boolean
}

interface Listing {
  id: string
  ebay_item_id: string | null
  sku: string | null
  kataban: string
  title_en: string
  category: string
  price_usd: number
  weight_kg: number
  cost_basis_jpy: number | null
  ebay_draft_id: string | null   // Seller Hubの下書き（未公開）。公開後は ebay_item_id
  status: 'draft' | 'active' | 'paused' | 'end_recommended' | 'ended'
  last_margin_pct: number | null
  last_min_price_jpy: number | null
  last_checked_at: string | null
  alert: string | null
  sources?: Source[]
}

interface Order {
  id: string
  ebay_order_id: string | null
  kataban: string | null
  title_en: string | null
  sold_price_usd: number | null
  sold_at: string | null
  ship_by: string | null
  procurement_status: 'pending' | 'ordered' | 'received' | 'shipped' | 'cancelled'
  procurement_cost_jpy: number | null
  tracking_no: string | null
}

interface Watch {
  // 「安い1点が出たら買う」運用のための検知結果。
  // verdict は中央値ベース（無在庫で継続仕入れできるか）で、こちらとは用途が違う
  opportunity?: boolean
  opp_price_jpy?: number | null
  opp_profit_jpy?: number | null
  opp_margin_pct?: number | null
  opp_url?: string | null
  opp_title?: string | null
  opp_reason?: string | null
  id: string
  kataban: string
  keyword_ja: string
  keyword_en: string
  category: string
  weight_kg: number
  ebay_sold_median_jpy: number | null
  ebay_sold_count: number | null
  best_source: string | null
  best_price_jpy: number | null
  yahoo_price_jpy: number | null
  mercari_price_jpy: number | null
  suruga_price_jpy: number | null
  rakuten_price_jpy: number | null
  amazon_price_jpy: number | null
  supply_count: number | null
  profit_jpy: number | null
  margin_pct: number | null
  median_price_jpy: number | null
  profit_median_jpy: number | null
  margin_median_pct: number | null
  verdict: string | null
  cost_ratio_pct: number | null
  best_title: string | null
  median_title: string | null
  enabled: boolean
  last_checked_at: string | null
}

interface Stats {
  listings: { total: number; active: number; end_recommended: number; ended: number; draft: number }
  orders: { total: number; pending: number; overdue: number }
  watch: { total: number; good: number }
  settings: { enabled: boolean; auto_end_listing: boolean; last_run_at: string | null }
  ebay_api_connected: boolean
}

const SOURCE_LABEL: Record<string, string> = { yahoo: 'ヤフオク', mercari: 'メルカリ', suruga: '駿河屋', rakuten: '楽天', amazon: 'Amazon', kitamura: 'キタムラ' }

// server/ebay-manager.cjs のスクレイパーと同じ検索URLを組み立てる。
// last_url が無い（まだ一度も巡回していない）仕入先でもクリックできるようにするため。
// キタムラはスクレイパーが無くURL形式も未確認なので、あえてリンクにしない。
const SOURCE_SEARCH_URL: Record<string, (kw: string) => string> = {
  yahoo: (kw) => `https://auctions.yahoo.co.jp/search/search?p=${encodeURIComponent(kw)}&n=50`,
  mercari: (kw) => `https://jp.mercari.com/search?keyword=${encodeURIComponent(kw)}&status=on_sale`,
  suruga: (kw) => `https://www.suruga-ya.jp/search?search_word=${encodeURIComponent(kw)}`,
  rakuten: (kw) => `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(kw)}/`,
  amazon: (kw) => `https://www.amazon.co.jp/s?k=${encodeURIComponent(kw)}`,
}

/**
 * 仕入先バッジのリンク先＝検索結果（相場を見る用）。
 * 巡回は「その型番をまだ採算内で仕入れられるか」を見るものなので、
 * 特定の1件に固定すると、その出品が終わっただけで在庫なし扱いになってしまう。
 */
const sourceHref = (s: Source): string | null =>
  s.last_url || SOURCE_SEARCH_URL[s.source]?.(s.search_keyword) || null

/** 実際に買う1点へのリンク。手で登録した直リンクがあればそれを最優先する */
const sourceItemHref = (s: Source): string | null => s.url || s.last_item_url || null

const jpy = (n: number | null | undefined) => (n == null ? '—' : `¥${n.toLocaleString()}`)
const ago = (iso: string | null) => {
  if (!iso) return '未チェック'
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'たった今'
  if (min < 60) return `${min}分前`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}時間前`
  return `${Math.round(h / 24)}日前`
}

export default function EbayManager() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'stock' | 'import' | 'orders' | 'watch' | 'settings'>('stock')
  const [importUrl, setImportUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importErr, setImportErr] = useState<string | null>(null)
  const [imports, setImports] = useState<ImportRow[]>([])
  // 画像ビューア。レンズの状態判断は原寸で見ないと分からないため
  const [viewer, setViewer] = useState<{ urls: string[]; index: number; title: string } | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [listings, setListings] = useState<Listing[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [watch, setWatch] = useState<Watch[]>([])
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, l, o, w, cfg] = await Promise.all([
        fetch('/api/ebay/stats').then((r) => r.json()),
        fetch('/api/ebay/listings').then((r) => r.json()),
        fetch('/api/ebay/orders').then((r) => r.json()),
        fetch('/api/ebay/watch').then((r) => r.json()),
        fetch('/api/ebay/settings').then((r) => r.json()),
      ])
      setStats(s)
      setListings(Array.isArray(l) ? l : [])
      setOrders(Array.isArray(o) ? o : [])
      setWatch(Array.isArray(w) ? w : [])
      setSettings(cfg)
    } catch (e) {
      setMsg(`読み込みに失敗しました: ${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    // 10分巡回に合わせて画面も自動更新
    const t = setInterval(load, 120000)
    return () => clearInterval(t)
  }, [load])

  const loadImports = useCallback(async () => {
    try {
      const r = await fetch('/api/ebay/imports').then((x) => x.json())
      setImports(Array.isArray(r) ? r : [])
    } catch { /* 一覧が取れなくても取り込み自体は使えるので握りつぶす */ }
  }, [])

  useEffect(() => { if (tab === 'import') loadImports() }, [tab, loadImports])

  const runImport = async () => {
    const url = importUrl.trim()
    if (!url) return
    setImporting(true); setImportErr(null); setImportResult(null)
    try {
      const r = await fetch('/api/ebay/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || '取り込みに失敗しました')
      setImportResult(j)
      loadImports()
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
    }
  }

  /** 取り込み1件から出品レコードを作り、在庫追従に載せる */
  const makeListing = async (r: ImportRow, force = false) => {
    setBusyId(r.id)
    try {
      const res = await fetch(`/api/ebay/imports/${r.id}/listing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })
      const j = await res.json()
      if (res.status === 409 && j.needs_force) {
        // セット出品の疑いは黙って通さない。人が確認してから作る
        if (confirm(`${j.error}\n\n${r.title_ja}\n\nこのまま作成しますか？`)) return makeListing(r, true)
        return
      }
      if (!res.ok) throw new Error(j.error || '作成に失敗しました')
      setMsg(`出品を作成しました: ${j.listing.sku} / $${Number(j.listing.price_usd).toFixed(2)}（写真は別途必要です）`)
      loadImports(); load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  const checkOne = async (id: string) => {
    setBusyId(id)
    try {
      const r = await fetch(`/api/ebay/listings/${id}/check`, { method: 'POST' }).then((x) => x.json())
      setMsg(r.reason ? `${r.action}: ${r.reason}` : '在庫あり・利益条件クリア')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const endOne = async (id: string) => {
    if (!confirm('この出品をeBayから取り下げます。よろしいですか？')) return
    setBusyId(id)
    try {
      const r = await fetch(`/api/ebay/listings/${id}/end`, { method: 'POST' }).then((x) => x.json())
      setMsg(r.ended ? 'eBayの出品を終了しました' : `eBay API未接続のため手動で終了してください（${r.reason}）`)
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const resumeOne = async (id: string) => {
    setBusyId(id)
    try {
      await fetch(`/api/ebay/listings/${id}/resume`, { method: 'POST' })
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const refreshWatch = async (id: string) => {
    setBusyId(id)
    try {
      await fetch(`/api/ebay/watch/${id}/refresh`, { method: 'POST' })
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const saveSettings = async () => {
    if (!settings) return
    setLoading(true)
    try {
      await fetch('/api/ebay/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      setMsg('設定を保存しました')
      await load()
    } finally {
      setLoading(false)
    }
  }

  const updateOrder = async (id: string, patch: Partial<Order>) => {
    await fetch(`/api/ebay/orders/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    await load()
  }

  const alerts = listings.filter((l) => l.status === 'end_recommended')
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* 画像ビューア。前玉のカビ・クモリ、鏡胴のスレは原寸で見ないと判断できない。
          サムネイルは切り抜いて縮小しているので、状態確認には使えない */}
      {viewer && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex flex-col"
          onClick={() => setViewer(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setViewer(null)
            if (e.key === 'ArrowRight') setViewer((v) => v && { ...v, index: (v.index + 1) % v.urls.length })
            if (e.key === 'ArrowLeft') setViewer((v) => v && { ...v, index: (v.index - 1 + v.urls.length) % v.urls.length })
          }}
          tabIndex={-1}
          ref={(el) => el?.focus()}
        >
          <div className="flex items-center justify-between px-4 py-2 text-white text-sm shrink-0">
            <span className="truncate">{viewer.title}</span>
            <span className="shrink-0 ml-4 text-gray-300">
              {viewer.index + 1} / {viewer.urls.length}
              <span className="ml-3 text-xs text-gray-400">← → で移動 / Esc で閉じる</span>
            </span>
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center px-4 pb-4" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setViewer((v) => v && { ...v, index: (v.index - 1 + v.urls.length) % v.urls.length })}
              className="shrink-0 px-3 py-6 text-white/60 hover:text-white text-2xl"
              aria-label="前の画像"
            >‹</button>
            {/* object-contain。切り抜かずに全体を出す */}
            <img
              src={viewer.urls[viewer.index]}
              alt=""
              referrerPolicy="no-referrer"
              className="max-h-full max-w-full object-contain"
            />
            <button
              onClick={() => setViewer((v) => v && { ...v, index: (v.index + 1) % v.urls.length })}
              className="shrink-0 px-3 py-6 text-white/60 hover:text-white text-2xl"
              aria-label="次の画像"
            >›</button>
          </div>
          <div className="shrink-0 flex gap-1 overflow-x-auto px-4 pb-3" onClick={(e) => e.stopPropagation()}>
            {viewer.urls.map((u, i) => (
              <button key={i} onClick={() => setViewer((v) => v && { ...v, index: i })} className="shrink-0">
                <img
                  src={u}
                  alt=""
                  referrerPolicy="no-referrer"
                  className={`w-14 h-14 object-cover rounded ${i === viewer.index ? 'ring-2 ring-white' : 'opacity-50'}`}
                />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* ヘッダ */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/')} className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800">
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">eBay 無在庫管理</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              japan_hikari_store / 仕入先を10分ごとに巡回し、在庫が消えた出品を自動で落とします
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-sm disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            更新
          </button>
        </div>

        {msg && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-200 text-sm flex justify-between">
            <span>{msg}</span>
            <button onClick={() => setMsg(null)}>×</button>
          </div>
        )}

        {/* 最優先アラート */}
        {alerts.length > 0 && (
          <div className="mb-6 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4">
            <div className="flex items-center gap-2 mb-3 text-red-800 dark:text-red-200 font-semibold">
              <AlertTriangle size={18} />
              今すぐ取り下げが必要な出品 {alerts.length}件
            </div>
            <div className="space-y-2">
              {alerts.map((l) => (
                <div key={l.id} className="flex items-center gap-3 text-sm bg-white dark:bg-gray-900 rounded-lg px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{l.kataban}</div>
                    <div className="text-red-600 dark:text-red-400 text-xs">{l.alert}</div>
                  </div>
                  <button
                    onClick={() => endOne(l.id)}
                    disabled={busyId === l.id}
                    className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs disabled:opacity-50"
                  >
                    取り下げる
                  </button>
                  <button
                    onClick={() => resumeOne(l.id)}
                    disabled={busyId === l.id}
                    className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-xs disabled:opacity-50"
                  >
                    継続
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* サマリ */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <Card label="出品中" value={stats.listings.active} icon={<Package size={16} />} />
            <Card label="要取り下げ" value={stats.listings.end_recommended} tone={stats.listings.end_recommended ? 'danger' : 'normal'} icon={<AlertTriangle size={16} />} />
            <Card label="未仕入の受注" value={stats.orders.pending} tone={stats.orders.pending ? 'warn' : 'normal'} icon={<ShoppingCart size={16} />} />
            <Card label="発送期限超過" value={stats.orders.overdue} tone={stats.orders.overdue ? 'danger' : 'normal'} icon={<Clock size={16} />} />
            <Card label="利益◎○の候補" value={stats.watch.good} tone="good" icon={<TrendingUp size={16} />} />
          </div>
        )}

        {stats && !stats.ebay_api_connected && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 text-sm">
            eBay APIが未接続です。環境変数 <code className="font-mono">EBAY_OAUTH_TOKEN</code> を設定すると、在庫消失時に自動で出品を終了できます。
            未設定の間は「要取り下げ」として通知するだけなので、取り下げは手動になります。
          </div>
        )}

        {/* タブ */}
        <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-800">
          {([
            ['stock', '在庫追従', <Package key="a" size={15} />],
            ['import', 'URL取り込み', <Download key="e" size={15} />],
            ['orders', '売れた商品', <ShoppingCart key="b" size={15} />],
            ['watch', '利益ウォッチ', <TrendingUp key="c" size={15} />],
            ['settings', '設定', <SettingsIcon key="d" size={15} />],
          ] as const).map(([k, label, icon]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`flex items-center gap-2 px-4 py-2 text-sm border-b-2 -mb-px ${
                tab === k
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        {/* ── 在庫追従 ── */}
        {tab === 'stock' && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-950/50 text-gray-500 text-xs">
                  <tr>
                    <Th>型番 / タイトル</Th>
                    <Th>状態</Th>
                    <Th right>売価</Th>
                    <Th right>仕入(最安)</Th>
                    <Th right>利益率</Th>
                    <Th>仕入先</Th>
                    <Th>最終チェック</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {listings.map((l) => (
                    <tr key={l.id} className={l.status === 'end_recommended' ? 'bg-red-50/60 dark:bg-red-950/20' : ''}>
                      <td className="px-3 py-2">
                        <div className="font-medium">{l.kataban}</div>
                        <div className="text-xs text-gray-500 truncate max-w-xs">{l.title_en}</div>
                        {/* eBay側の出品先。未公開なら下書き、公開後はItemIDのページへ飛ぶ */}
                        {(l.ebay_draft_id || l.ebay_item_id) && (
                          <a
                            href={l.ebay_item_id
                              ? `https://www.ebay.com/itm/${l.ebay_item_id}`
                              : `https://www.ebay.com/lstng?draftId=${l.ebay_draft_id}&mode=AddItem`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs hover:underline ${
                              l.ebay_item_id
                                ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
                                : 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                            }`}
                          >
                            {l.ebay_item_id ? 'eBay 公開中' : 'eBay 下書き'}
                            <ExternalLink size={9} className="opacity-60" />
                          </a>
                        )}
                        {l.alert && <div className="text-xs text-red-600 dark:text-red-400 mt-0.5">{l.alert}</div>}
                      </td>
                      <td className="px-3 py-2"><StatusBadge status={l.status} /></td>
                      <td className="px-3 py-2 text-right">${Number(l.price_usd).toFixed(2)}</td>
                      <td className="px-3 py-2 text-right">
                        {jpy(l.last_min_price_jpy)}
                        {l.cost_basis_jpy != null && l.last_min_price_jpy != null && l.last_min_price_jpy > l.cost_basis_jpy && (
                          <span className="text-xs text-amber-600 ml-1">
                            +{Math.round(((l.last_min_price_jpy - l.cost_basis_jpy) / l.cost_basis_jpy) * 100)}%
                          </span>
                        )}
                        {(() => {
                          // 採用した最安値がどの商品かを出す。キーワード規則だけでは
                          // 別商品（ソフト・周辺機器）の混入を防ぎきれないため目視できるようにする
                          const t = (l.sources || []).find((s) => s.last_price_jpy === l.last_min_price_jpy)?.last_title
                          return t ? <div className="text-xs text-gray-400 font-normal max-w-[16rem] truncate" title={t}>{t}</div> : null
                        })()}
                      </td>
                      <td className={`px-3 py-2 text-right font-medium ${
                        l.last_margin_pct == null ? '' : l.last_margin_pct >= 15 ? 'text-green-600' : l.last_margin_pct > 0 ? 'text-amber-600' : 'text-red-600'
                      }`}>
                        {l.last_margin_pct == null ? '—' : `${l.last_margin_pct}%`}
                      </td>
                      <td className="px-3 py-2">
                        {/* 選定した「実際に買う1点」。最安ではなく信頼性と価格のバランスで選ぶ */}
                        {(() => {
                          const withItem = (l.sources || []).filter((s) => sourceItemHref(s))
                          if (!withItem.length) return null
                          return (
                            <div className="mb-1.5 flex flex-col gap-1">
                              {withItem.map((s) => {
                                const url = sourceItemHref(s)!
                                return (
                                  <div key={`item-${s.id}`} className="max-w-[22rem]">
                                    <a
                                      href={url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title={s.last_item_reason || '仕入れる個体'}
                                      className="inline-flex items-center gap-1 text-xs text-blue-700 dark:text-blue-300 hover:underline max-w-full"
                                    >
                                      <span className="px-1 rounded bg-blue-100 dark:bg-blue-950 shrink-0">仕入れる</span>
                                      <span className="truncate">
                                        {s.last_item_total_jpy != null ? jpy(s.last_item_total_jpy) : ''}
                                        {s.last_item_title ? ` ${s.last_item_title}` : ''}
                                      </span>
                                      <ExternalLink size={9} className="opacity-60 shrink-0" />
                                    </a>
                                    {/* URLは目で読めて選択・コピーできる状態で出す。
                                        仕入れは人が実行するので、リンクだけだと別端末に渡せない */}
                                    <div className="flex items-center gap-1">
                                      <code className="text-[10px] text-gray-500 dark:text-gray-400 truncate select-all" title={url}>
                                        {url}
                                      </code>
                                      <button
                                        onClick={() => {
                                          navigator.clipboard?.writeText(url)
                                          setMsg('仕入先URLをコピーしました')
                                        }}
                                        title="URLをコピー"
                                        className="shrink-0 px-1 rounded text-[10px] text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                                      >
                                        コピー
                                      </button>
                                    </div>
                                    {s.last_item_reason && (
                                      <div className="text-[10px] text-gray-400 truncate" title={s.last_item_reason}>
                                        {s.last_item_reason}
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )
                        })()}
                        <div className="flex flex-wrap gap-1">
                          {(l.sources || []).map((s) => {
                            // 未チェックを「在庫なし」と見せない。緑＝確認済みで在庫あり、だけにする
                            const unchecked = !s.last_checked_at
                            // 「読めなかった(灰)」と「在庫が無い(赤)」は必ず見た目で分ける
                            const unreadable = !!s.last_error
                            const cls = unchecked || unreadable
                              ? 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                              : s.last_available
                                ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
                                : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                            const label = unchecked
                              ? ' 未チェック'
                              : unreadable
                                ? ' 取得不可'
                                : s.last_price_jpy
                                  ? ` ${jpy(s.last_price_jpy)}`
                                  : ' 在庫なし'
                            const href = sourceHref(s)
                            const tip = `${s.search_keyword} / ${s.last_count ?? '—'}件 / ${ago(s.last_checked_at)}`
                              + `${s.last_error ? ` / ${s.last_error}` : ''}`
                              + `${s.last_title ? `\n最安: ${s.last_title}` : ''}`
                              + `${href ? '\nクリックで検索結果（相場）を開く' : ''}`
                            const body = (
                              <>
                                {SOURCE_LABEL[s.source] || s.source}
                                {label}
                              </>
                            )
                            // 巡回で読めなかった仕入先（メルカリ・駿河屋）ほど人が手で見に行く必要がある。
                            // バッジ自体をリンクにして、価格の根拠になった検索結果へ直接飛べるようにする
                            return href ? (
                              <a
                                key={s.id}
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`px-1.5 py-0.5 rounded text-xs inline-flex items-center gap-0.5 hover:underline hover:brightness-95 ${cls}`}
                                title={tip}
                              >
                                {body}
                                <ExternalLink size={9} className="opacity-50" />
                              </a>
                            ) : (
                              <span key={s.id} className={`px-1.5 py-0.5 rounded text-xs ${cls}`} title={tip}>
                                {body}
                              </span>
                            )
                          })}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">{ago(l.last_checked_at)}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1 justify-end">
                          <IconBtn title="今すぐ巡回" onClick={() => checkOne(l.id)} disabled={busyId === l.id}>
                            <Play size={14} />
                          </IconBtn>
                          {l.status === 'ended' ? (
                            <IconBtn title="監視に戻す" onClick={() => resumeOne(l.id)} disabled={busyId === l.id}>
                              <RotateCcw size={14} />
                            </IconBtn>
                          ) : (
                            <IconBtn title="取り下げる" onClick={() => endOne(l.id)} disabled={busyId === l.id} danger>
                              <StopCircle size={14} />
                            </IconBtn>
                          )}
                          {/* 公開済みならItemID、未公開なら下書きIDで開く。
                              下書きは出品ボタンを押す手前の状態なので、写真を足してそのまま公開できる */}
                          {l.ebay_item_id ? (
                            <a
                              href={`https://www.ebay.com/itm/${l.ebay_item_id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                              title="eBayで見る（公開中）"
                            >
                              <ExternalLink size={14} />
                            </a>
                          ) : l.ebay_draft_id ? (
                            <a
                              href={`https://www.ebay.com/lstng?draftId=${l.ebay_draft_id}&mode=AddItem`}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1.5 rounded text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950"
                              title="eBayの下書きを開く（未公開）"
                            >
                              <ExternalLink size={14} />
                            </a>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!listings.length && (
                    <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400">出品が登録されていません</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── URL取り込み ── */}
        {tab === 'import' && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
              <div className="flex gap-2">
                <input
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') runImport() }}
                  placeholder="https://page.auctions.yahoo.co.jp/jp/auction/..."
                  className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent"
                />
                <button
                  onClick={runImport}
                  disabled={importing || !importUrl.trim()}
                  className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white disabled:opacity-40 flex items-center gap-2"
                >
                  {importing ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
                  取り込む
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                現在ヤフオクの商品ページに対応。商品名・価格・状態区分・ジャンル・説明・画像URLを保存し、英語の出品案を生成します。
                画像そのものは取り込みません（転載になるため）。出品用の写真は別途用意してください。
              </p>
              {importErr && (
                <div className="mt-3 text-sm text-red-600 bg-red-50 dark:bg-red-950/40 rounded-lg px-3 py-2">{importErr}</div>
              )}
            </div>

            {importResult && (
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-4">
                {importResult.warnings.length > 0 && (
                  <div className={`rounded-lg px-3 py-2 text-sm ${
                    importResult.bundle_suspect
                      ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                      : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                  }`}>
                    <div className="flex items-center gap-1.5 font-medium mb-1"><AlertTriangle size={14} />確認してください</div>
                    <ul className="list-disc pl-5 space-y-0.5">
                      {importResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs font-medium text-gray-500 mb-2">仕入先から取り込んだ情報</div>
                    <dl className="text-sm space-y-1">
                      <Row k="商品名">{importResult.supplier.title_ja}</Row>
                      <Row k="価格">{jpy(importResult.supplier.price_jpy)}</Row>
                      <Row k="状態">
                        {importResult.supplier.condition_ja || '—'}
                        <span className="text-gray-400"> → {importResult.listing.condition_en}</span>
                      </Row>
                      <Row k="ジャンル"><span className="text-xs">{importResult.supplier.genre || '—'}</span></Row>
                      <Row k="在庫">{importResult.supplier.available ? 'あり' : '終了'}</Row>
                      <Row k="仕入先">
                        <a href={importResult.supplier.url} target="_blank" rel="noopener noreferrer"
                           className="text-blue-600 hover:underline inline-flex items-center gap-1">
                          ページを開く <ExternalLink size={11} />
                        </a>
                      </Row>
                    </dl>
                    {importResult.supplier.description_ja && (
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer text-gray-500">出品者の説明（原文・参照用）</summary>
                        <p className="mt-1 whitespace-pre-wrap text-gray-600 dark:text-gray-400">{importResult.supplier.description_ja}</p>
                      </details>
                    )}
                    {importResult.supplier.image_count > 0 && (
                      <div className="mt-3">
                        <div className="text-xs text-gray-500 mb-1">
                          仕入先の画像 {importResult.supplier.image_count}枚（状態確認用。出品には使えません）
                        </div>
                        {/* 仕入先から直接読み込んで並べる。コピーは保存しない。
                            1枚ずつタブで開かなくても、前玉のカビや外観のスレを一覧で見比べられる */}
                        <div className="grid grid-cols-4 gap-1">
                          {importResult.supplier.image_urls.map((u, i) => (
                            <button
                              key={i}
                              onClick={() => setViewer({
                                urls: importResult.supplier.image_urls,
                                index: i,
                                title: importResult.supplier.title_ja,
                              })}
                              title={`${i + 1}枚目（クリックで原寸表示）`}
                              className="block aspect-square rounded overflow-hidden bg-gray-100 dark:bg-gray-800 hover:ring-2 hover:ring-blue-500"
                            >
                              <img
                                src={u}
                                alt={`${i + 1}枚目`}
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover"
                              />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="text-xs font-medium text-gray-500 mb-2">生成した出品案</div>
                    <dl className="text-sm space-y-1">
                      <Row k="英語タイトル">
                        {importResult.listing.title_en}
                        <span className="text-xs text-gray-400"> ({importResult.listing.title_en.length}/80)</span>
                      </Row>
                      {importResult.pricing && (
                        <Row k="推奨売価">
                          <span className="font-medium">${importResult.pricing.price_usd.toFixed(2)}</span>
                          <span className="text-xs text-gray-400"> 米国基準・送料無料・利益率20%</span>
                        </Row>
                      )}
                    </dl>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {Object.entries(importResult.listing.item_specifics).map(([k, v]) => (
                        <span key={k} className="px-1.5 py-0.5 rounded text-xs bg-gray-100 dark:bg-gray-800">
                          <span className="text-gray-500">{k}:</span> {v}
                        </span>
                      ))}
                    </div>
                    {importResult.pricing?.regions && (
                      <table className="mt-3 w-full text-xs">
                        <tbody>
                          {importResult.pricing.regions.map((g) => (
                            <tr key={g.name} className="border-t border-gray-100 dark:border-gray-800">
                              <td className="py-1 text-gray-500">{g.name}</td>
                              <td className="py-1 text-right">{jpy(g.profit_jpy)}</td>
                              <td className="py-1 text-right text-gray-400 w-14">{g.margin_pct}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <details className="mt-3 text-xs">
                      <summary className="cursor-pointer text-gray-500">英語の説明文</summary>
                      <textarea
                        readOnly
                        value={importResult.listing.description_html}
                        className="mt-1 w-full h-40 text-xs font-mono p-2 rounded border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950"
                      />
                    </details>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
              <div className="px-4 py-2 text-xs font-medium text-gray-500 border-b border-gray-100 dark:border-gray-800">
                取り込み履歴（{imports.length}件）
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-950 text-xs text-gray-500">
                    <tr>
                      <Th>取り込み</Th><Th>商品名（原文）</Th><Th>英語タイトル</Th>
                      <Th right>仕入値</Th><Th>状態</Th><Th>ジャンル</Th><Th>画像</Th><Th> </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {imports.length === 0 && (
                      <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">まだ取り込みがありません</td></tr>
                    )}
                    {imports.map((r) => (
                      <tr key={r.id} className="border-t border-gray-100 dark:border-gray-800 align-top">
                        <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{ago(r.fetched_at)}</td>
                        <td className="px-3 py-2 max-w-[20rem]">
                          <a href={r.source_url} target="_blank" rel="noopener noreferrer"
                             className="hover:underline inline-flex items-start gap-1">
                            <span className="line-clamp-2">{r.title_ja}</span>
                            <ExternalLink size={10} className="mt-1 shrink-0 opacity-50" />
                          </a>
                          {r.bundle_suspect && (
                            <span className="ml-1 px-1 rounded text-xs bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">セット疑い</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs max-w-[18rem]">{r.title_en || '—'}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">{jpy(r.price_jpy)}</td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap">{r.condition_ja || '—'}</td>
                        <td className="px-3 py-2 text-xs text-gray-500 max-w-[14rem] truncate" title={r.genre || ''}>{r.genre || '—'}</td>
                        <td className="px-3 py-2">
                          {r.image_urls?.length ? (
                            <div className="flex items-center gap-0.5">
                              {r.image_urls.slice(0, 3).map((u, i) => (
                                <button
                                  key={i}
                                  onClick={() => setViewer({ urls: r.image_urls!, index: i, title: r.title_ja })}
                                  title={`${i + 1}枚目（クリックで原寸表示）`}
                                >
                                  <img
                                    src={u}
                                    alt=""
                                    loading="lazy"
                                    referrerPolicy="no-referrer"
                                    className="w-9 h-9 rounded object-cover bg-gray-100 dark:bg-gray-800 hover:ring-2 hover:ring-blue-500"
                                  />
                                </button>
                              ))}
                              {r.image_urls.length > 3 && (
                                <button
                                  onClick={() => setViewer({ urls: r.image_urls!, index: 3, title: r.title_ja })}
                                  className="text-[10px] text-gray-400 ml-0.5 hover:text-gray-600 dark:hover:text-gray-200"
                                >
                                  +{r.image_urls.length - 3}
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1 justify-end">
                            {r.listing_id ? (
                              <span className="px-2 py-1 rounded text-xs bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300 whitespace-nowrap">
                                出品作成済み
                              </span>
                            ) : (
                              <button
                                onClick={() => makeListing(r)}
                                disabled={busyId === r.id || r.price_jpy == null}
                                title={r.price_jpy == null ? '仕入値が取れていないため売価を決められません' : '出品レコードを作り、在庫追従に載せます'}
                                className="px-2 py-1 rounded text-xs bg-blue-600 text-white disabled:opacity-40 whitespace-nowrap"
                              >
                                下書きを作る
                              </button>
                            )}
                            <IconBtn title="履歴から削除" danger onClick={async () => {
                              await fetch(`/api/ebay/imports/${r.id}`, { method: 'DELETE' })
                              loadImports()
                            }}><StopCircle size={13} /></IconBtn>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── 売れた商品 ── */}
        {tab === 'orders' && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-950/50 text-gray-500 text-xs">
                  <tr>
                    <Th>受注</Th>
                    <Th>型番</Th>
                    <Th right>売価</Th>
                    <Th>発送期限</Th>
                    <Th>仕入進捗</Th>
                    <Th right>仕入額</Th>
                    <Th>追跡番号</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {orders.map((o) => {
                    const overdue = o.ship_by && o.ship_by < today && o.procurement_status !== 'shipped'
                    return (
                      <tr key={o.id} className={overdue ? 'bg-red-50/60 dark:bg-red-950/20' : ''}>
                        <td className="px-3 py-2">
                          <div className="font-mono text-xs">{o.ebay_order_id || '—'}</div>
                          <div className="text-xs text-gray-500">{o.sold_at?.slice(0, 10)}</div>
                        </td>
                        <td className="px-3 py-2">{o.kataban}</td>
                        <td className="px-3 py-2 text-right">{o.sold_price_usd ? `$${Number(o.sold_price_usd).toFixed(2)}` : '—'}</td>
                        <td className={`px-3 py-2 text-xs ${overdue ? 'text-red-600 font-semibold' : ''}`}>
                          {o.ship_by || '—'}{overdue && ' 超過'}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={o.procurement_status}
                            onChange={(e) => updateOrder(o.id, { procurement_status: e.target.value as Order['procurement_status'] })}
                            className="text-xs rounded border border-gray-300 dark:border-gray-700 bg-transparent px-2 py-1"
                          >
                            <option value="pending">未仕入</option>
                            <option value="ordered">仕入先に発注済</option>
                            <option value="received">倉庫着</option>
                            <option value="shipped">発送済</option>
                            <option value="cancelled">キャンセル</option>
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right">{jpy(o.procurement_cost_jpy)}</td>
                        <td className="px-3 py-2">
                          <input
                            defaultValue={o.tracking_no || ''}
                            placeholder="追跡番号"
                            onBlur={(e) => e.target.value !== (o.tracking_no || '') && updateOrder(o.id, { tracking_no: e.target.value })}
                            className="text-xs w-32 rounded border border-gray-300 dark:border-gray-700 bg-transparent px-2 py-1"
                          />
                        </td>
                      </tr>
                    )
                  })}
                  {!orders.length && (
                    <tr><td colSpan={7} className="px-3 py-10 text-center text-gray-400">受注はまだありません</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── 利益ウォッチ ── */}
        {tab === 'watch' && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="px-4 py-3 text-xs text-gray-500 border-b border-gray-100 dark:border-gray-800">
              国内3サイトの価格を10分ごとに取り直し、eBayのSold相場と突き合わせて利益を再計算します。
              <strong>最安</strong>は「いま出ている1点で受注をさばけるか」、<strong>中央値</strong>は「その型番を継続的に仕入れ続けられるか」。
              判定は中央値で出します（最安だけで判断すると、2個目が仕入れられない型番を出品してしまうため）。<strong>仕入比率</strong>（国内仕入値÷eBay相場）が<strong>44%以下</strong>でないと、米国基準・送料無料の価格が相場を超えて売れません。<strong>採用した商品名も必ず確認してください</strong>（あいまい検索でソフトや周辺機器が混ざることがあります）。
              eBay相場が未登録の行は判定を出しません（推測値では埋めません）。
              メルカリはクライアント描画のため、駿河屋はアクセス制限のため、サーバーからは取得できず常に「—」になります。AmazonはSP-APIの中古オファーを見るため AMAZON_SP_REFRESH_TOKEN が必要です。
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-950/50 text-gray-500 text-xs">
                  <tr>
                    <Th>型番</Th>
                    <Th right>eBay相場</Th>
                    <Th right>Sold</Th>
                    <Th right>ヤフオク</Th>
                    <Th right>メルカリ</Th>
                    <Th right>駿河屋</Th>
                    <Th right>楽天</Th>
                    <Th right>Amazon</Th>
                    <Th right>最安</Th>
                    <Th right>最安粗利</Th>
                    <Th right>中央値</Th>
                    <Th right>中央値粗利</Th>
                    <Th right>中央値率</Th>
                    <Th right>仕入比率</Th>
                    <Th>判定</Th>
                    <Th>更新</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {watch.map((w) => (
                    <tr key={w.id}>
                      <td className="px-3 py-2 font-medium">{w.kataban}</td>
                      <td className="px-3 py-2 text-right">{jpy(w.ebay_sold_median_jpy)}</td>
                      <td className="px-3 py-2 text-right">{w.ebay_sold_count ?? '—'}</td>
                      <td className="px-3 py-2 text-right">{jpy(w.yahoo_price_jpy)}</td>
                      <td className="px-3 py-2 text-right">{jpy(w.mercari_price_jpy)}</td>
                      <td className="px-3 py-2 text-right">{jpy(w.suruga_price_jpy)}</td>
                      <td className="px-3 py-2 text-right">{jpy(w.rakuten_price_jpy)}</td>
                      <td className="px-3 py-2 text-right">{jpy(w.amazon_price_jpy)}</td>
                      <td className="px-3 py-2 text-right font-medium">
                        {jpy(w.best_price_jpy)}
                        {w.best_source && <div className="text-xs text-gray-500">{SOURCE_LABEL[w.best_source]}</div>}
                        {/* 中央値では✕でも、いま買える1点が基準を満たすことがある。
                            ニッチ高単価では出品が薄いので、この機会検知が主戦力になる */}
                        {w.opportunity && w.opp_url && (
                          <a href={w.opp_url} target="_blank" rel="noopener noreferrer"
                             title={w.opp_reason || ''}
                             className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 hover:underline">
                            買い時 {jpy(w.opp_price_jpy)} → 粗利{jpy(w.opp_profit_jpy)}
                            <ExternalLink size={9} className="opacity-60" />
                          </a>
                        )}
                        {w.best_title && (
                          <div className="text-xs text-gray-400 font-normal text-left max-w-[14rem] truncate" title={w.best_title}>
                            {w.best_title}
                          </div>
                        )}
                      </td>
                      <td className={`px-3 py-2 text-right ${
                        w.profit_jpy == null ? '' : w.profit_jpy > 0 ? 'text-gray-600 dark:text-gray-300' : 'text-red-600'
                      }`}>
                        {jpy(w.profit_jpy)}
                        {w.margin_pct != null && <div className="text-xs text-gray-400">{w.margin_pct}%</div>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {jpy(w.median_price_jpy)}
                        {w.median_title && (
                          <div className="text-xs text-gray-400 font-normal text-left max-w-[14rem] truncate" title={w.median_title}>
                            {w.median_title}
                          </div>
                        )}
                      </td>
                      <td className={`px-3 py-2 text-right font-medium ${
                        w.profit_median_jpy == null ? '' : w.profit_median_jpy >= 5000 ? 'text-green-600' : w.profit_median_jpy > 0 ? 'text-amber-600' : 'text-red-600'
                      }`}>{jpy(w.profit_median_jpy)}</td>
                      <td className="px-3 py-2 text-right">{w.margin_median_pct == null ? '—' : `${w.margin_median_pct}%`}</td>
                      <td className={`px-3 py-2 text-right font-medium ${
                        w.cost_ratio_pct == null ? '' : w.cost_ratio_pct <= 44 ? 'text-green-600' : 'text-red-600'
                      }`} title="国内仕入値 ÷ eBay相場。米国基準・送料無料で出すなら44%以下が必要">
                        {w.cost_ratio_pct == null ? '—' : `${w.cost_ratio_pct}%`}
                      </td>
                      <td className="px-3 py-2 text-center text-lg">{w.verdict || '—'}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{ago(w.last_checked_at)}</td>
                      <td className="px-3 py-2">
                        <IconBtn title="今すぐ更新" onClick={() => refreshWatch(w.id)} disabled={busyId === w.id}>
                          <RefreshCw size={14} className={busyId === w.id ? 'animate-spin' : ''} />
                        </IconBtn>
                      </td>
                    </tr>
                  ))}
                  {!watch.length && (
                    <tr><td colSpan={18} className="px-3 py-10 text-center text-gray-400">監視候補が登録されていません</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── 設定 ── */}
        {tab === 'settings' && settings && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-5 max-w-3xl">
            <Toggle
              label="巡回を有効にする"
              hint="OFFにすると10分ごとのcronが何もしません"
              checked={!!settings.enabled}
              onChange={(v) => setSettings({ ...settings, enabled: v })}
            />
            <Toggle
              label="在庫が消えたらeBay出品を自動で取り下げる"
              hint="無在庫では「取り下げないまま売れる」ほうが致命的なので、既定でONです。EBAY_OAUTH_TOKEN未設定時は通知のみになります"
              checked={!!settings.auto_end_listing}
              onChange={(v) => setSettings({ ...settings, auto_end_listing: v })}
            />

            <div className="grid grid-cols-2 gap-4">
              <Num label="利益率の下限(%)" hint="これを下回ったら取り下げ" value={settings.margin_floor_pct as number} onChange={(v) => setSettings({ ...settings, margin_floor_pct: v })} />
              <Num label="仕入値の上昇警告(%)" hint="想定仕入からこの%上がったら警告" value={settings.price_jump_pct as number} onChange={(v) => setSettings({ ...settings, price_jump_pct: v })} />
              <Num label="1回の巡回件数" value={settings.max_checks_per_run as number} onChange={(v) => setSettings({ ...settings, max_checks_per_run: v })} />
              <Num label="USD/JPY" value={settings.usd_jpy as number} step={0.1} onChange={(v) => setSettings({ ...settings, usd_jpy: v })} />
              <Num label="為替の安全率" value={settings.fx_safety as number} step={0.01} onChange={(v) => setSettings({ ...settings, fx_safety: v })} />
              <Num label="米国向け関税(%)" hint="DDU（バイヤー負担）に変えるなら0" value={settings.duty_us_pct as number} step={0.5} onChange={(v) => setSettings({ ...settings, duty_us_pct: v })} />
              <Num label="送料 〜1kg(円)" value={settings.ship_tier1_jpy as number} onChange={(v) => setSettings({ ...settings, ship_tier1_jpy: v })} />
              <Num label="送料 1〜2kg(円)" value={settings.ship_tier2_jpy as number} onChange={(v) => setSettings({ ...settings, ship_tier2_jpy: v })} />
              <Num label="送料 2〜3kg(円)" value={settings.ship_tier3_jpy as number} onChange={(v) => setSettings({ ...settings, ship_tier3_jpy: v })} />
              <Num label="送料 3kg超(円)" value={settings.ship_tier4_jpy as number} onChange={(v) => setSettings({ ...settings, ship_tier4_jpy: v })} />
            </div>

            <Toggle
              label="Amazon(SP-API)を巡回に含める"
              hint="1件あたりの所要が最も長く、巡回できる件数がほぼ半分になります。中古カメラ・レトロゲームでは寄与が小さいため既定はOFF"
              checked={!!settings.use_amazon}
              onChange={(v) => setSettings({ ...settings, use_amazon: v })}
            />
            <Toggle
              label="利益が出た型番を自動で取り込む"
              hint="利益ウォッチが◎/○になったら、そのとき最安で買える個体の商品ページを自動で取り込みます（商品名・説明・ジャンル・画像URL）。同じ個体は二重に取り込みません。仕入先の画像そのものは保存せず、URLのみ控えます"
              checked={!!settings.auto_import_on_good}
              onChange={(v) => setSettings({ ...settings, auto_import_on_good: v })}
            />
            <Toggle
              label="Slackに通知する"
              checked={!!settings.notify_slack}
              onChange={(v) => setSettings({ ...settings, notify_slack: v })}
            />

            <button onClick={saveSettings} disabled={loading} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50">
              <Save size={16} />
              保存
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 小物 ────────────────────────────────────────────────
/** 取り込み結果の「項目名: 値」1行 */
function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-gray-500">{k}</dt>
      <dd className="flex-1 min-w-0 break-words">{children}</dd>
    </div>
  )
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 font-medium ${right ? 'text-right' : 'text-left'}`}>{children}</th>
}

function Card({ label, value, tone = 'normal', icon }: { label: string; value: number; tone?: 'normal' | 'good' | 'warn' | 'danger'; icon?: React.ReactNode }) {
  const toneCls = {
    normal: 'text-gray-900 dark:text-gray-100',
    good: 'text-green-600 dark:text-green-400',
    warn: 'text-amber-600 dark:text-amber-400',
    danger: 'text-red-600 dark:text-red-400',
  }[tone]
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">{icon}{label}</div>
      <div className={`text-2xl font-bold ${toneCls}`}>{value}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: Listing['status'] }) {
  const map: Record<string, [string, string]> = {
    draft: ['下書き', 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'],
    active: ['出品中', 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'],
    paused: ['停止中', 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'],
    end_recommended: ['要取り下げ', 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'],
    ended: ['取り下げ済', 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400'],
  }
  const [label, cls] = map[status] || ['—', '']
  return <span className={`px-2 py-0.5 rounded text-xs ${cls}`}>{label}</span>
}

function IconBtn({ children, onClick, disabled, title, danger }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; title?: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 ${danger ? 'text-red-600' : ''}`}
    >
      {children}
    </button>
  )
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1" />
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-gray-500">{hint}</div>}
      </div>
    </label>
  )
}

function Num({ label, hint, value, step, onChange }: { label: string; hint?: string; value: number; step?: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="text-sm font-medium mb-1">{label}</div>
      <input
        type="number"
        step={step || 1}
        value={value ?? 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-1.5 text-sm"
      />
      {hint && <div className="text-xs text-gray-500 mt-0.5">{hint}</div>}
    </label>
  )
}
