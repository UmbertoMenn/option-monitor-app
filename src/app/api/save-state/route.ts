import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const runtime = 'edge';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

export async function POST(req: Request) {
  try {
    const { ticker, future, earlier } = await req.json();
    console.log(`[DEBUG-SAVE-START] Ticker: ${ticker}, Future: ${JSON.stringify(future)}, Earlier: ${JSON.stringify(earlier)}`);

    // Fetch dati attuali per merge (evita sovrascrizione)
    const { data: currentData, error: fetchError } = await supabase.from('options').select('*').eq('ticker', ticker).single();
    if (fetchError || !currentData) {
      console.error('[DEBUG-SAVE-ERROR] Errore fetch dati attuali:', fetchError);
      return NextResponse.json({ success: false }, { status: 500 });
    }

    // Update solo campi specifici, mantenendo gli altri
    const { error: optionsError } = await supabase.from('options').update({ 
      earlier, 
      future,
      created_at: new Date().toISOString()  // Traccia update
    }).eq('ticker', ticker);
    if (optionsError) {
      console.error('[DEBUG-SAVE-ERROR-OPTIONS]', optionsError);
      return NextResponse.json({ success: false }, { status: 500 });
    }
    console.log('[DEBUG-SAVE-SUCCESS-OPTIONS] Aggiornato options per', ticker);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[DEBUG-SAVE-CATCH]', err.message);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}