import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';  // Usa helper coerente con middleware
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';  // Forza dynamic per auth e update

export async function POST(req: Request) {
  const cookieStore = cookies();
  const supabase = createRouteHandlerClient({
    cookies: () => cookieStore
  });

  try {
    // Controllo autenticazione utente server-side
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      console.error('Sessione non valida in POST /api/save-state:', sessionError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = session.user;

    const { ticker, future, earlier } = await req.json();
    console.log(`[DEBUG-SAVE-START] Ticker: ${ticker}, Future: ${JSON.stringify(future)}, Earlier: ${JSON.stringify(earlier)}`);

    // Fetch dati attuali per merge (evita sovrascrizione), filtrato per user
    const { data: currentData, error: fetchError } = await supabase.from('options').select('*').eq('ticker', ticker).eq('user_id', user.id).single();
    if (fetchError || !currentData) {
      console.error('[DEBUG-SAVE-ERROR] Errore fetch dati attuali:', fetchError);
      return NextResponse.json({ success: false }, { status: 500 });
    }

    // Update solo campi specifici, mantenendo gli altri, filtrato per user
    const { error: optionsError } = await supabase.from('options').update({ 
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