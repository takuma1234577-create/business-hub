import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const fitpeakSupabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Prevent Supabase from trying to exchange the ?code= URL parameter
    // as an OAuth/PKCE code. The ?code= param in my-fitpeak is an
    // auto_login_token, not a Supabase auth code.
    detectSessionInUrl: false,
  },
})
