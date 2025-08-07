// src/app/api/save-state/route.ts
import { createClient } from '../../../utils/supabase/server';  // Path che funziona
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';  // Forza dynamic per auth e update

export async function POST(req: Request) {
  const supabase = await createClient();  // Crea client

  // Log cookies per debug
  const cookieStore = await cookies();
  console.log('Save-State Route: Cookies:', cookieStore.getAll());

  try {
    // Controllo sessione
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    // Log sessione
    console.log('Save-State Route: Sessione:', session ? 'Valida (user: ' + session.user.id + ')' : 'Null');
    console.log('Save-State Route: Session Error:', sessionError ? sessionError.message : 'No error');
    console.log('Save-State Route: Access Token:', session?.access_token || 'Null');

    if (sessionError || !session) {
      console.error('Sessione non valida in POST /api/save-state:', sessionError?.message || 'No error');
      return NextResponse.json({ error: 'Unauthorized', details: sessionError?.message || 'No details' }, { status: 401 });
    }
    const user = session.user;

    const { ticker, future, earlier } = await req.json();
    console.log(`[DEBUG-SAVE-START] Ticker: ${ticker}, Future: ${JSON.stringify(future)}, Earlier: ${JSON.stringify(earlier)}`);

    // Fetch dati attuali per merge (evita sovrascrizione), filtrato per user_id
    const { data: currentData, error: fetchError } = await supabase.from('options').select('*').eq('ticker', ticker).eq('user_id', user.id).single();
    if (fetchError || !currentData) {
      console.error('[DEBUG-SAVE-ERROR] Errore fetch dati attuali:', fetchError?.message);
      return NextResponse.json({ success: false, error: 'Errore fetch dati attuali', details: fetchError?.message }, { status: 500 });
    }

    // Nuova validazione
    console.log('[DEBUG-SAVE-VALIDATE] Validazione earlier:', earlier, 'future:', future);

    // Guardia: verifica se earlier e future sono array validi (almeno 2 elementi, expiry non vuota, strike non null)
    if (!Array.isArray(earlier) || earlier.length < 2 || !Array.isArray(future) || future.length < 2 ||
        earlier.some(opt => !opt || !opt.expiry || opt.strike === null) ||
        future.some(opt => !opt || !opt.expiry || opt.strike === null)) {
      console.error('[DEBUG-SAVE-ERROR] Array earlier/future invalidi:', earlier, future);
      return NextResponse.json({ success: false, error: 'Dati earlier/future invalidi' }, { status: 400 });
    }

    // Update solo campi specifici, mantenendo gli altri, filtrato per user_id
    const { error: optionsError } = await supabase.from('options').update({ 
      earlier: JSON.stringify(earlier), 
      future: JSON.stringify(future),
      created_at: new Date().toISOString()  // Traccia update
    }).eq('ticker', ticker).eq('user_id', user.id);
    if (optionsError) {
      console.error('[DEBUG-SAVE-ERROR-OPTIONS]', optionsError.message);
      return NextResponse.json({ success: false, error: 'Errore update options', details: optionsError.message }, { status: 500 });
    }
    console.log('[DEBUG-SAVE-SUCCESS-OPTIONS] Aggiornato options per', ticker);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[DEBUG-SAVE-CATCH]', err.message);
    return NextResponse.json({ success: false, error: 'Errore interno', details: err.message }, { status: 500 });
  }
}