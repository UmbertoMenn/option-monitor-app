import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { normalizeExpiry } from '../../../utils/functions'; // Verifica che il percorso sia corretto

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const ticker = body?.ticker?.toUpperCase();

    // Verifica che il ticker sia presente
    if (!ticker) {
      return NextResponse.json({ success: false, error: 'Ticker è obbligatorio' }, { status: 400 });
    }

    // Calcolo della data di scadenza
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth() + 2; // 0-based index, aggiungo 2 mesi

    // Gestione del passaggio d'anno
    if (month > 11) {
      month -= 12;
      year += 1;
    }

    // Normalizza la data per il terzo venerdì del mese
    const nextExpiry = normalizeExpiry(`${year}-${String(month + 1).padStart(2, '0')}`);

    // Transazione per inserire in 'tickers' e 'positions'
    const { error } = await supabase.rpc('add_ticker_and_position', {
      p_ticker: ticker,
      p_strike: 100,
      p_expiry: nextExpiry,
      p_current_call_price: 0,
    });

    if (error) {
      throw new Error(`Errore nel database: ${error.message}`);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Errore in add-ticker:', {
      message: err.message,
      stack: err.stack,
    });
    return NextResponse.json({ success: false, error: 'Errore interno del server' }, { status: 500 });
  }
}