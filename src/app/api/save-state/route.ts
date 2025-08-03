import { NextResponse } from 'next/server';
import { supabaseClient } from '../../../lib/supabaseClient'; // Adatta il path, usa client condiviso per auth

export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    // Controllo autenticazione utente
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { ticker, future, earlier } = await req.json();
    console.log(`[DEBUG-SAVE-START] Ticker: ${ticker}, Future: ${JSON.stringify(future)}, Earlier: ${JSON.stringify(earlier)}`);

    // Fetch dati attuali per merge (evita sovrascrizione), filtrato per user
    const { data: currentData, error: fetchError } = await supabaseClient.from('options').select('*').eq('ticker', ticker).eq('user_id', user.id).single();
    if (fetchError || !currentData) {
      console.error('[DEBUG-SAVE-ERROR] Errore fetch dati attuali:', fetchError);
      return NextResponse.json({ success: false }, { status: 500 });
    }

    // Update solo campi specifici, mantenendo gli altri, filtrato per user
    const { error: optionsError } = await supabaseClient.from('options').update({ 
      earlier, 
      future,
      created_at: new Date().toISOString()  // Traccia update
    }).eq('ticker', ticker).eq('user_id', user.id);
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