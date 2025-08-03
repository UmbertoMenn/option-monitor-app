import { NextResponse } from 'next/server';
import { supabaseClient } from '../../../lib/supabaseClient'; // Adatta il path, usa client condiviso per auth

export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    // Controllo autenticazione utente
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    let ticker = body?.ticker?.toUpperCase();

    if (!ticker || typeof ticker !== 'string' || !/^[A-Z]{1,5}$/.test(ticker)) {
      return NextResponse.json({ success: false, error: 'Ticker non valido' }, { status: 400 });
    }

    // Remove from 'alerts_sent' (child table, filtrato per user)
    const { error: alertsSentError } = await supabaseClient.from('alerts_sent').delete().eq('ticker', ticker).eq('user_id', user.id);
    if (alertsSentError) {
      throw new Error(`Errore deleting alerts_sent: ${alertsSentError.message}`);
    }

    // Remove from 'alerts' (child table, filtrato per user)
    const { error: alertsError } = await supabaseClient.from('alerts').delete().eq('ticker', ticker).eq('user_id', user.id);
    if (alertsError) {
      throw new Error(`Errore deleting alerts: ${alertsError.message}`);
    }

    // Remove from 'options' (parent table, filtrato per user)
    const { error: optionsError } = await supabaseClient.from('options').delete().eq('ticker', ticker).eq('user_id', user.id);
    if (optionsError) {
      throw new Error(`Errore deleting options: ${optionsError.message}`);
    }

    // Remove from 'tickers' (rimane globale, senza user_id)
    const { error: tickersError } = await supabaseClient.from('tickers').delete().eq('ticker', ticker);
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