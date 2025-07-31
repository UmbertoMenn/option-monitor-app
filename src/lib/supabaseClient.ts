import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let supabaseClient: ReturnType<typeof createClient> | undefined;

if (typeof window !== 'undefined') {
  // Client-side: Usa globalThis per singleton
  if (!globalThis.supabaseClient) {
    globalThis.supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
  }
  supabaseClient = globalThis.supabaseClient;
} else {
  // Server-side: Crea sempre nuovo (ma nel tuo caso è client-side)
  supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
}

export { supabaseClient };