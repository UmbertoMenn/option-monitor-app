import { createServerClient } from '@supabase/ssr';  // Usa questo pacchetto raccomandato
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';  // Forza dynamic per auth

export async function GET() {
  // Crea client Supabase server-side con cookies (gestione asincrona)
  const cookieStore = await cookies();  // Await per gestire asincronicità
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;  // Solo 'get' per lettura sessione
        },
      },
    }
  );

  try {
    // Controllo autenticazione utente server-side
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      console.error('Sessione non valida in GET /api/tickers:', sessionError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = session.user;

    const { data, error } = await supabase.from('tickers').select('ticker').eq('user_id', user.id);
    if (error) throw error;
    return NextResponse.json(data.map(row => row.ticker));
  } catch (err: any) {
    console.error('Errore fetch tickers:', err.message);
    return NextResponse.json([], { status: 500 });
  }
}