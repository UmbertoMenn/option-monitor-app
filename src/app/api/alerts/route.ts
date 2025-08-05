// src/app/api/alerts/route.ts
import { createClient } from '../../../utils/supabase/server';  // Adatta path se necessario (es. '../../../utils/supabase/server')
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';  // Forza dynamic per auth

export async function GET() {
  const supabase = await createClient();  // Crea client server-side con cookie automatici

  // Log cookies per debug
  const cookieStore = await cookies();
  console.log('Alerts Route: Cookies:', cookieStore.getAll());

  try {
    // Controllo autenticazione con getSession
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    // Log sessione
    console.log('Alerts Route: Sessione:', session ? 'Valida (user: ' + session.user.id + ')' : 'Null');
    console.log('Alerts Route: Session Error:', sessionError ? sessionError.message : 'No error');
    console.log('Alerts Route: Access Token:', session?.access_token || 'Null');

    if (sessionError || !session) {
      console.error('Sessione non valida in GET /api/alerts:', sessionError?.message || 'No error');
      return NextResponse.json({ error: 'Unauthorized', details: sessionError?.message || 'No details' }, { status: 401 });
    }
    const user = session.user;

    // Query filtrata per user_id
    const { data, error } = await supabase.from('alerts').select('*').eq('user_id', user.id);
    if (error) throw error;

    // Riduci i dati come nel tuo codice originale, con fix per enabled null -> false
    return NextResponse.json(data.reduce((acc: Record<string, boolean>, row) => { 
      acc[row.ticker] = row.enabled ?? false;  // Fix: default a false se null
      return acc; 
    }, {}));
  } catch (err: any) {
    console.error('Errore imprevisto in GET /api/alerts:', err.message);
    return NextResponse.json({ error: 'Internal Server Error', details: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const supabase = await createClient();  // Crea client

  // Log cookies per debug
  const cookieStore = await cookies();
  console.log('Alerts POST Route: Cookies:', cookieStore.getAll());

  try {
    // Controllo sessione
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    // Log sessione
    console.log('Alerts POST Route: Sessione:', session ? 'Valida (user: ' + session.user.id + ')' : 'Null');
    console.log('Alerts POST Route: Session Error:', sessionError ? sessionError.message : 'No error');
    console.log('Alerts POST Route: Access Token:', session?.access_token || 'Null');

    if (sessionError || !session) {
      console.error('Sessione non valida in POST /api/alerts:', sessionError?.message || 'No error');
      return NextResponse.json({ error: 'Unauthorized', details: sessionError?.message || 'No details' }, { status: 401 });
    }
    const user = session.user;

    // Leggi body
    const { ticker, enabled } = await req.json();

    // Upsert filtrata per user_id
    const { error } = await supabase.from('alerts').upsert({ ticker, enabled, user_id: user.id }, { onConflict: 'ticker,user_id' });
    if (error) {
      console.error('Errore upsert alerts:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!enabled) {
      // Pulisci alert-sent su disable, filtrato per user_id
      const { error: deleteErr } = await supabase.from('alerts_sent').delete().eq('ticker', ticker).eq('user_id', user.id);
      if (deleteErr) console.error('Errore pulizia alert-sent su toggle off:', deleteErr.message);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Errore imprevisto in POST /api/alerts:', err.message);
    return NextResponse.json({ error: 'Internal Server Error', details: err.message }, { status: 500 });
  }
}