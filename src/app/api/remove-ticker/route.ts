import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';  // Usa helper coerente
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';  // Forza dynamic per auth

export async function POST(req: Request) {
  const cookieStore = cookies();
  const supabase = createRouteHandlerClient({
    cookies: () => cookieStore
  });

  try {
    // Controllo autenticazione utente server-side
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      console.error('Sessione non valida in POST /api/remove-ticker:', sessionError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = session.user;

    const body = await req.json();
    let ticker = body?.ticker?.toUpperCase();

    if (!ticker || typeof ticker !== 'string' || !/^[A-Z]{1,5}$/.test(ticker)) {
      return NextResponse.json({ success: false, error: 'Ticker non valido' }, { status: 400 });
    }

    // Remove from 'alerts_sent' (child table, filtrato per user)
    const { error: alertsSentError } = await supabase.from('alerts_sent').delete().eq('ticker', ticker).eq('user_id', user.id);
    if (alertsSentError) {
      throw new Error(`Errore deleting alerts_sent: ${alertsSentError.message}`);
    }

    // Remove from 'alerts' (child table, filtrato per user)
    const { error: alertsError } = await supabase.from('alerts').delete().eq('ticker', ticker).eq('user_id', user.id);
    if (alertsError) {
      throw new Error(`Errore deleting alerts: ${alertsError.message}`);
    }

    // Remove from 'options' (parent table, filtrato per user)
    const { error: optionsError } = await supabase.from('options').delete().eq('ticker', ticker).eq('user_id', user.id);
    if (optionsError) {
      throw new Error(`Errore deleting options: ${optionsError.message}`);
    }

    // Remove from 'tickers' (rimane globale, senza user_id)
    const { error: tickersError } = await supabase.from('tickers').delete().eq('ticker', ticker);
    if (tickersError) {
      throw new Error(`Errore deleting tickers: ${tickersError.message}`);
    }

    console.log(`Ticker '${ticker}' rimosso con successo per user ${user.id}`);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Errore remove-ticker:', err.message);
    return NextResponse.json({ success: false, error: 'Errore interno' }, { status: 500 });
  }
}