// src/app/api/tickers/route.ts
import { createClient } from '../../../utils/supabase/server';  // Adatta path se necessario
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  console.log('Route /api/tickers: Inizio chiamata');  // Log 1: Conferma che la route è chiamata

  try {
    console.log('Route /api/tickers: Creo client Supabase');  // Log 2: Prima di createClient
    const supabase = await createClient();
    console.log('Route /api/tickers: Client creato con successo');  // Log 3: Dopo createClient

    // Log cookies
    const cookieStore = await cookies();
    console.log('Route: Cookies:', cookieStore.getAll());  // Log 4: Cookie disponibili?

    console.log('Route /api/tickers: Chiamo getSession');  // Log 5: Prima di getSession
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    console.log('Route /api/tickers: getSession completata');  // Log 6: Dopo getSession

    // Log sessione
    console.log('Route: Sessione:', session ? 'Valida (user: ' + session.user.id + ')' : 'Null');
    console.log('Route: Session Error:', sessionError ? sessionError.message : 'No error');
    console.log('Route: Access Token:', session?.access_token || 'Null');

    if (sessionError || !session) {
      console.error('Sessione non valida in GET /api/tickers:', sessionError?.message || 'No error');
      return NextResponse.json({ error: 'Unauthorized', details: sessionError?.message || 'No details' }, { status: 401 });
    }
    const user = session.user;

    console.log('Route /api/tickers: Query su tabella tickers per user_id:', user.id);  // Log 7: Prima della query
    const { data, error } = await supabase.from('tickers').select('ticker').eq('user_id', user.id);
    console.log('Route /api/tickers: Query completata');  // Log 8: Dopo la query

    if (error) {
      console.error('Errore query tickers:', error.message);
      throw error;
    }
    return NextResponse.json(data.map(row => row.ticker));
  } catch (err: any) {
    console.error('Errore generale in /api/tickers:', err.message, err.stack);  // Log 9: Catch con stack per debug
    return NextResponse.json({ error: 'Internal Server Error', details: err.message }, { status: 500 });
  }
}