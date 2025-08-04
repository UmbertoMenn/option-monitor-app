import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';  // Usa helper coerente con middleware
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';  // Forza dynamic per auth

export async function GET() {
  const cookieStore = cookies();  // Gestione cookies con helper
  const supabase = createRouteHandlerClient({
    cookies: () => cookieStore
  });

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