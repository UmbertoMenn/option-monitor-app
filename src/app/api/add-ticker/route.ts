import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '../../../utils/supabase/server';  // Usa la funzione corretta
import { normalizeExpiry } from '../../../utils/functions';  // Assumi esista

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();

  try {
    // Verifica sessione utente server-side
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      console.error('Sessione non valida in POST add-ticker:', sessionError);
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const user = session.user;

    const body = await req.json();
    const ticker = body?.ticker?.toUpperCase();

    if (!ticker) {
      return NextResponse.json({ success: false, error: 'Ticker è obbligatorio' }, { status: 400 });
    }

    // Validazione ticker
    if (!/^[A-Z]{1,5}$/.test(ticker)) {
      return NextResponse.json({ success: false, error: 'Ticker non valido: deve essere 1-5 lettere maiuscole (es. NVDA, AMZN)' }, { status: 400 });
    }

    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth() + 2;
    if (month > 11) {
      month -= 12;
      year += 1;
    }
    const nextExpiry = normalizeExpiry(`${year}-${String(month + 1).padStart(2, '0')}`);

    // Upsert in 'options' con user_id
    const { error: optionsError } = await supabase.from('options').upsert([
      { 
        ticker: ticker, 
        spot: 0, 
        strike: 100, 
        expiry: nextExpiry, 
        current_bid: 0,
        current_ask: 0,
        current_last_trade_price: 0,
        earlier: [],
        future: [],
        user_id: user.id
      }
    ], { onConflict: 'ticker,user_id' });

    if (optionsError) {
      console.error('Errore upsert options:', optionsError.message);
      throw new Error(`Errore upsert options: ${optionsError.message}`);
    }

    // Insert/Upsert in tickers (globale, senza user_id assumendo sia tabella condivisa)
    const { error: tickError } = await supabase.from('tickers').upsert([{ ticker: ticker }], { onConflict: 'ticker' });
    if (tickError) {
      console.error('Errore upsert tickers:', tickError.message);
      throw new Error(`Errore upsert tickers: ${tickError.message}`);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Errore in add-ticker:', { message: err.message, stack: err.stack });
    return NextResponse.json({ success: false, error: 'Errore interno del server' }, { status: 500 });
  }
}