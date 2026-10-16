// My FITPEAK を fitpeak.co（Shopify アプリプロキシ /a/my-fitpeak/...）に埋め込むときのエントリー。
// server/my-fitpeak-proxy.cjs が返す <div id="myfp-root"> にだけ描画する。社内ツール（App.tsx）は含めない。
// ビルド: vite build --mode embed（vite.config.ts）
import { originalDocument } from './my-fitpeak-embed-init'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './my-fitpeak-embed.css'
import MyFitpeak from './pages/MyFitpeak'
import { embedBasename } from './pages/my-fitpeak/lib/embed'

// 社内ツールの言語設定が書き換えたタイトル・lang を元（テーマが出した値）に戻す
document.title = originalDocument.title
if (originalDocument.lang) document.documentElement.lang = originalDocument.lang

const el = document.getElementById('myfp-root')
if (el) {
  createRoot(el).render(
    <StrictMode>
      <BrowserRouter basename={embedBasename()}>
        <Routes>
          <Route path="/my-fitpeak/*" element={<MyFitpeak />} />
        </Routes>
      </BrowserRouter>
    </StrictMode>,
  )
}
