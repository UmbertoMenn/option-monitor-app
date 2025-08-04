import { createServerClient } from '@supabase/ssr';  // Usa 'createServerClient' invece della versione deprecata 'createClient'
import { cookies } from 'next/headers';
import type { Database } from '../../types/supabase';  // Importa il tipo generato

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();  // Usa 'await' per ottenere il cookie store

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {  // Usa 'getAll' invece di 'get' per compatibilità non deprecata
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: any }>) {  // Usa 'setAll' invece di 'set/remove'
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch (error) {
            // Ignora errori durante SSR
          }
        },
      },
    }
  );
}