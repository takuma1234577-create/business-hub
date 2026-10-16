// 埋め込み用エントリー（my-fitpeak-embed.tsx）で最初に読み込む。ほかのモジュールより先に動く必要がある。
// - window.__MYFP__（アプリプロキシの liquid が入れる basename / embedded）を読み取る
// - #lt=（LINEログインの1回限りトークン）をすぐURLから消す
// - 社内ツール用の言語設定がページのタイトルと lang を書き換えるので、元の値を覚えておく
import { initEmbed } from './pages/my-fitpeak/lib/embed'

export const originalDocument = { title: document.title, lang: document.documentElement.lang }

initEmbed((window as unknown as { __MYFP__?: unknown }).__MYFP__)
