
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from '../../types/supabase';  // Adatta path se src/types/supabase.ts

export const createClient = () => createBrowserClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);