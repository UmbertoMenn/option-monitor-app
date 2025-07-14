import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizeExpiry } from '../../../utils/functions'  // Assumi esista, dal tuo codice

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!)

export async function POST(req: Request) {
  let ticker: string | undefined;
  try {
    const body = await req.json();
    ticker = body?.ticker?.toUpperCase();

    if (!ticker) {
      return NextResponse.json({ success: false, error: 'Ticker è obbligatorio' }, { status: 400 })
    }

    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth() + 2;
    if (month > 11) {
      month -= 12;
      year += 1;
    }
    const nextExpiry = normalizeExpiry(`${year}-${String(month + 1).padStart(2, '0')}`);

    // Insert position
    const { error: posError } = await supabase.from('positions').insert([
      { ticker, strike: 100, expiry: nextExpiry, currentCallPrice: 0 }
    ]);
    if (posError) throw posError;

    // Insert/Upsert in tickers (evita duplicati)
    const { error: tickError } = await supabase.from('tickers').upsert([{ ticker }], { onConflict: 'ticker' });
    if (tickError) throw tickError;

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Errore in add-ticker:', { ticker, message: err.message });
    return NextResponse.json({ success: false, error: 'Errore interno' }, { status: 500 });
  }
}