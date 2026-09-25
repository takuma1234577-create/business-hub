import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { Card } from './ui'

export const TAG_SNIPPET = `<!-- FITPEAK サイト分析（Business-hub） -->
<script src="https://my.fitpeak.co/api/public/site-analytics/fa.js" data-site="fitpeak.co" defer></script>`

export default function SetupTab() {
  const [copied, setCopied] = useState(false)
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card title="計測タグ">
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mb-3">
          Shopify管理画面 →「オンラインストア」→「テーマ」→ 公開中テーマの「…」→「コードを編集」→ <code>layout/theme.liquid</code> の <code>&lt;/head&gt;</code> の直前に貼り付けます。全ページで計測が始まります。
        </p>
        <div className="relative">
          <pre className="text-[11px] bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto whitespace-pre">{TAG_SNIPPET}</pre>
          <button
            onClick={() => { navigator.clipboard.writeText(TAG_SNIPPET); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
            className="absolute top-2 right-2 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-white/10 text-white hover:bg-white/20 cursor-pointer"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? 'コピーしました' : 'コピー'}
          </button>
        </div>
      </Card>

      <Card title="計測している内容">
        <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1.5 leading-relaxed list-disc pl-4">
          <li>ページビュー・ユーザー（新規／リピーター）・セッション（30分無操作で区切り）</li>
          <li>画面に表示していた時間（別タブに移っている間は数えない）</li>
          <li>スクロール到達率、ページの各部分が画面に映っていた時間（熟読エリア）</li>
          <li>クリック位置と要素、同じ場所の連打（イライラの兆候）</li>
          <li>カート追加・「購入手続きへ」のクリック</li>
          <li>流入元（自然検索／広告／SNS／AI／メール・LINE／参照サイト／直接）、utmパラメータ</li>
          <li>デバイス・ブラウザ（LINEやInstagramのアプリ内ブラウザも判別）・国・都市</li>
        </ul>
        <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
          IPアドレス・氏名・メールなど個人を特定する情報は保存しません。ボットのアクセスとテーマエディタでのプレビューは除外します。
        </p>
      </Card>

      <Card title="自分のアクセスを除外する">
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          自分のスマホやPCで一度だけ <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">https://fitpeak.co/?fa_optout=1</code> を開くと、そのブラウザからのアクセスは計測されなくなります。解除は <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">?fa_optout=0</code>。
        </p>
      </Card>

      <Card title="数字の見方">
        <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1.5 leading-relaxed list-disc pl-4">
          <li>時間の区切りは日本時間。「前期間比」は同じ長さの直前の期間との比較です。</li>
          <li>直帰率＝1ページだけ見て離脱したセッションの割合。離脱率＝そのページが最後に見られた割合。</li>
          <li>決済完了はShopifyの決済画面（別システム）で起きるため、ここでは「購入手続きへ」までを計測します。</li>
          <li>リアルタイムの「今見ている人」は、直近90秒以内に画面を開いていた人数です。</li>
        </ul>
      </Card>
    </div>
  )
}
