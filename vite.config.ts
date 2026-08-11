import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // 既定は3001。別ポートでAPIを立てたいときは API_PORT で上書きする
      '/api': `http://localhost:${process.env.API_PORT || 3001}`,
    },
  },
})
