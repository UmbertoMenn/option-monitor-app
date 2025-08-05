// src/app/api/add-ticker/route.ts
import { createClient } from '../../../utils/supabase/server';  // Adatta path se necessario (es. '../../../utils/supabase/server')
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { normalizeExpiry } from '../../../utils/functions';  // Mantenuto import esistente

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const supabase = await createClient();  // Crea client server-side con cookie automatici

  // Log cookies per debug
  const cookieStore = await cookies();
  console.log('Add-Ticker Route: Cookies:', cookieStore.getAll());

  try {
    // Controllo autenticazione con getSession
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    // Log sessione
    console.log('Add-Ticker Route: Sessione:', session ? 'Valida (user: ' + session.user.id + ')' : 'Null');
    console.log('Add-Ticker Route: Session Error:', sessionError ? sessionError.message : 'No error');
    console.log('Add-Ticker Route: Access Token:', session?.access_token || 'Null');

    if (sessionError || !session) {
      console.error('Sessione non valida in POST /api/add-ticker:', sessionError?.message || 'No error');
      return NextResponse.json({ success: false, error: 'Unauthorized', details: sessionError?.message || 'No details' }, { status: 401 });
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

    // Upsert in 'options' con user_id (filtrato per multi-user)
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
      return NextResponse.json({ success: false, error: `Errore upsert options: ${optionsError.message}` }, { status: 500 });
    }

    // Insert/Upsert in tickers (globale, senza user_id assumendo sia tabella condivisa)
    const { error: tickError } = await supabase.from('tickers').upsert([{ ticker: ticker }], { onConflict: 'ticker' });
    if (tickError) {
      console.error('Errore upsert tickers:', tickError.message);
      return NextResponse.json({ success: false, error: `Errore upsert tickers: ${tickError.message}` }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Errore in add-ticker:', { message: err.message, stack: err.stack });
    return NextResponse.json({ success: false, error: 'Errore interno del server', details: err.message }, { status: 500 });
  }
}