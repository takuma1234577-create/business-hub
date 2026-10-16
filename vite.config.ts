import { defineConfig, type UserConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const config: UserConfig = {
    plugins: [
      react({ jsxImportSource: '@business-hub/i18n' }),
      tailwindcss(),
      {
        name: 'local-i18n-runtime',
        enforce: 'post',
        config(config) {
          // React's plugin prebundles its JSX runtime by default. Our local runtime
          // must share the same language store as the selector during development.
          if (config.optimizeDeps?.include) {
            config.optimizeDeps.include = config.optimizeDeps.include.filter(id => !id.startsWith('@business-hub/i18n/'))
          }
        },
      },
    ],
    optimizeDeps: { exclude: ['@business-hub/i18n/jsx-runtime', '@business-hub/i18n/jsx-dev-runtime'] },
    resolve: { alias: { '@business-hub/i18n': fileURLToPath(new URL('./src/i18n', import.meta.url)) } },
    server: {
      proxy: {
        // 既定は3001。別ポートでAPIを立てたいときは API_PORT で上書きする
        '/api': `http://localhost:${process.env.API_PORT || 3001}`,
      },
    },
  }

  if (mode !== 'embed') return config

  // My FITPEAK の埋め込み用（fitpeak.co/a/my-fitpeak … Shopify アプリプロキシ）。`vite build --mode embed`
  // 通常のビルドの後に dist/ へ追加で出す（dist は消さない）。
  // - アセットは https://my.fitpeak.co/ 基準の絶対URL（fitpeak.co から読み込むため）
  // - dist/assets/myfp/ に出す（vercel.json で /assets/* に fitpeak.co 向けの CORS を付けている）
  // - エントリーのハッシュ名は dist/myfp-embed-manifest.json に出し、server/my-fitpeak-proxy.cjs が読む
  return {
    ...config,
    base: process.env.MYFP_ASSET_BASE || 'https://my.fitpeak.co/',
    publicDir: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      assetsDir: 'assets/myfp',
      manifest: 'myfp-embed-manifest.json',
      rollupOptions: {
        input: { 'my-fitpeak-embed': fileURLToPath(new URL('./src/my-fitpeak-embed.tsx', import.meta.url)) },
      },
    },
  }
})
