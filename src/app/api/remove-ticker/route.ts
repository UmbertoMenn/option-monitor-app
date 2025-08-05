// src/app/api/remove-ticker/route.ts
import { createClient } from '../../../utils/supabase/server';  // Path che funziona
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';  // Forza dynamic per auth

export async function POST(req: Request) {
  const supabase = await createClient();  // Crea client

  // Log cookies per debug
  const cookieStore = await cookies();
  console.log('Remove-Ticker Route: Cookies:', cookieStore.getAll());

  try {
    // Controllo sessione
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    // Log sessione
    console.log('Remove-Ticker Route: Sessione:', session ? 'Valida (user: ' + session.user.id + ')' : 'Null');
    console.log('Remove-Ticker Route: Session Error:', sessionError ? sessionError.message : 'No error');
    console.log('Remove-Ticker Route: Access Token:', session?.access_token || 'Null');

    if (sessionError || !session) {
      console.error('Sessione non valida in POST /api/remove-ticker:', sessionError?.message || 'No error');
      return NextResponse.json({ error: 'Unauthorized', details: sessionError?.message || 'No details' }, { status: 401 });
    }
    const user = session.user;

    const body = await req.json();
    let ticker = body?.ticker?.toUpperCase();

    if (!ticker || typeof ticker !== 'string' || !/^[A-Z]{1,5}$/.test(ticker)) {
      return NextResponse.json({ success: false, error: 'Ticker non valido' }, { status: 400 });
    }

    // Remove from 'alerts_sent' (child table, filtrato per user_id)
    const { error: alertsSentError } = await supabase.from('alerts_sent').delete().eq('ticker', ticker).eq('user_id', user.id);
    if (alertsSentError) {
      console.error(`Errore deleting alerts_sent: ${alertsSentError.message}`);
      return NextResponse.json({ success: false, error: `Errore deleting alerts_sent: ${alertsSentError.message}` }, { status: 500 });
    }

    // Remove from 'alerts' (child table, filtrato per user_id)
    const { error: alertsError } = await supabase.from('alerts').delete().eq('ticker', ticker).eq('user_id', user.id);
    if (alertsError) {
      console.error(`Errore deleting alerts: ${alertsError.message}`);
      return NextResponse.json({ success: false, error: `Errore deleting alerts: ${alertsError.message}` }, { status: 500 });
    }

    // Remove from 'options' (parent table, filtrato per user_id)
    const { error: optionsError } = await supabase.from('options').delete().eq('ticker', ticker).eq('user_id', user.id);
    if (optionsError) {
      console.error(`Errore deleting options: ${optionsError.message}`);
      return NextResponse.json({ success: false, error: `Errore deleting options: ${optionsError.message}` }, { status: 500 });
    }

    // Remove from 'tickers' (rimane globale, senza user_id assumendo sia tabella condivisa)
    const { error: tickersError } = await supabase.from('tickers').delete().eq('ticker', ticker);
    if (tickersError) {
      console.error(`Errore deleting tickers: ${tickersError.message}`);
      return NextResponse.json({ success: false, error: `Errore deleting tickers: ${tickersError.message}` }, { status: 500 });
    }

    console.log(`Ticker '${ticker}' rimosso con successo per user ${user.id}`);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Errore remove-ticker:', err.message);
    return NextResponse.json({ success: false, error: 'Errore interno', details: err.message }, { status: 500 });
  }
}