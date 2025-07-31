import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'edge';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    let ticker = body?.ticker?.toUpperCase();

    if (!ticker || typeof ticker !== 'string' || !/^[A-Z]{1,5}$/.test(ticker)) {
      return NextResponse.json({ success: false, error: 'Ticker non valido' }, { status: 400 });
    }

    // Remove from 'alerts_sent' (child table)
    const { error: alertsSentError } = await supabase.from('alerts_sent').delete().eq('ticker', ticker);
    if (alertsSentError) {
      throw new Error(`Errore deleting alerts_sent: ${alertsSentError.message}`);
    }

    // Remove from 'alerts' (child table)
    const { error: alertsError } = await supabase.from('alerts').delete().eq('ticker', ticker);
    if (alertsError) {
      throw new Error(`Errore deleting alerts: ${alertsError.message}`);
    }

    // Remove from 'options' (parent table)
    const { error: optionsError } = await supabase.from('options').delete().eq('ticker', ticker);
    if (optionsError) {
      throw new Error(`Errore deleting options: ${optionsError.message}`);
    }

    // Remove from 'tickers'
    const { error: tickersError } = await supabase.from('tickers').delete().eq('ticker', ticker);
    if (tickersError) {
      throw new Error(`Errore deleting tickers: ${tickersError.message}`);
    }

    console.log(`Ticker '${ticker}' rimosso con successo`);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Errore remove-ticker:', err.message);
    return NextResponse.json({ success: false, error: 'Errore interno' }, { status: 500 });
  }
}