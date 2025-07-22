import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

export async function POST(req: Request) {
  const { ticker, future, earlier } = await req.json();
  console.log(`[DEBUG-SAVE-START] Ticker: ${ticker}, Future: ${JSON.stringify(future)}, Earlier: ${JSON.stringify(earlier)}`);

  // Update principale su 'options'
  const { error: optionsError } = await supabase.from('options').update({ earlier, future }).eq('ticker', ticker);
  if (optionsError) {
    console.error('[DEBUG-SAVE-ERROR-OPTIONS]', optionsError);
    return NextResponse.json({ success: false }, { status: 500 });
  }
  console.log('[DEBUG-SAVE-SUCCESS-OPTIONS] Aggiornato options per', ticker);

  // Sincronizzazione opzionale con 'option_states' (se esiste)
  const { error: statesError } = await supabase.from('option_states').update({ earlier, future }).eq('ticker', ticker); // Assumi esista; rimuovi se non
  if (statesError) {
    console.warn('[DEBUG-SAVE-WARN-STATES] Errore update option_states (forse tabella inesistente):', statesError);
  } else {
    console.log('[DEBUG-SAVE-SUCCESS-STATES] Aggiornato option_states per', ticker);
  }

  return NextResponse.json({ success: true });
}