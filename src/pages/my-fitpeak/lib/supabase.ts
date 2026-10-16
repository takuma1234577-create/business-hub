import { createClient } from '@supabase/supabase-js'
import { isEmbedded } from './embed'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const fitpeakSupabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Prevent Supabase from trying to exchange the ?code= URL parameter
    // as an OAuth/PKCE code. The ?code= param in my-fitpeak is an
    // auto_login_token, not a Supabase auth code.
    detectSessionInUrl: false,
    // fitpeak.co に埋め込んだときは専用のキーで保存する（他の保存データとぶつけない）。
    // my.fitpeak.co では従来のキーのまま（ログイン中の人がログアウトされないように）
    ...(isEmbedded() ? { storageKey: 'myfp-auth' } : {}),
  },
})
