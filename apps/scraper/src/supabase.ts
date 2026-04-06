import { createClient, SupabaseClient } from '@supabase/supabase-js';
import 'dotenv/config';

let _supabase: SupabaseClient;

export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY が未設定です');
    _supabase = createClient(url, key);
  }
  return _supabase;
}
