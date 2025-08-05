// src/utils/supabase/admin.ts
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../types/supabase';  // Importa il tuo tipo generato (adatta il path se necessario)

// NOTA: Questo client ha privilegi admin e usa la SERVICE_ROLE_KEY. Usalo SOLO nel cron job!

export function createAdminClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY non è definita nelle variabili d'ambiente. Aggiungila su Vercel!");
  }

  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}