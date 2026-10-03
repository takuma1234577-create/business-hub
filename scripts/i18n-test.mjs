import { createServer } from 'vite'

// Keep Vite and Chromium in the same process/network namespace in Cloud.
// These are deliberately fake values; no production credentials are needed.
process.env.VITE_SUPABASE_URL ||= 'https://example.invalid'
process.env.VITE_SUPABASE_ANON_KEY ||= 'i18n-test-placeholder'
const server = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true }, optimizeDeps: { noDiscovery: true } })
await server.listen()
try { await import('./i18n-smoke.mjs') }
finally { await server.close() }
