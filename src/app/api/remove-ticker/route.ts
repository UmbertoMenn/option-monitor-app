import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!)

export async function POST(req: Request) {
  try {
    const body = await req.json();
    let ticker = body?.ticker?.toUpperCase();

    if (!ticker || typeof ticker !== 'string' || !/^[A-Z]{1,5}$/.test(ticker)) {
      return NextResponse.json({ success: false, error: 'Ticker non valido' }, { status: 400 });
    }

    // Remove from 'tickers'
    await supabase.from('tickers').delete().eq('ticker', ticker);

    // Remove from 'options'
    await supabase.from('options').delete().eq('ticker', ticker);

    // Cleanup alerts
    await supabase.from('alerts').delete().eq('ticker', ticker);
    await supabase.from('alert_sent').delete().eq('ticker', ticker);  // Rinominato alert-sent

    console.log(`Ticker '${ticker}' rimosso con successo`);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Errore remove-ticker:', err.message);
    return NextResponse.json({ success: false, error: 'Errore interno' }, { status: 500 });
  }
}