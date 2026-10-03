import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
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
})
