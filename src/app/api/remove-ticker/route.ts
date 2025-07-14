import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!)

export async function POST(req: Request) {
  try {
    const body = await req.json();
    let ticker = body?.ticker?.toUpperCase(); // Normalizza in uppercase per consistenza

    if (!ticker || typeof ticker !== 'string') {
      return NextResponse.json({ success: false, error: 'Ticker non valido o mancante' }, { status: 400 });
    }

    // Validazione ticker: solo lettere uppercase, 1-5 caratteri (tipico per OPRA tickers come NVDA, AMZN)
    if (!/^[A-Z]{1,5}$/.test(ticker)) {
      return NextResponse.json({ success: false, error: 'Ticker non valido: deve essere 1-5 lettere maiuscole (es. NVDA, AMZN)' }, { status: 400 });
    }

    // Remove from 'tickers'
    const { error: tickersError } = await supabase.from('tickers').delete().eq('ticker', ticker);
    if (tickersError) throw tickersError;

    // Remove positions for that ticker
    const { error: positionsError } = await supabase.from('positions').delete().eq('ticker', ticker);
    if (positionsError) throw positionsError;

    console.log(`Ticker '${ticker}' rimosso con successo da tickers e positions`);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Errore remove-ticker:', { message: err.message, stack: err.stack });
    return NextResponse.json({ success: false, error: 'Errore interno del server' }, { status: 500 });
  }
}