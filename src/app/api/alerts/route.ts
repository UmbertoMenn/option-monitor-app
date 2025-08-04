import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';  // Usa helper coerente con middleware
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';  // Forza dynamic rendering per sessioni

export async function GET() {
  const cookieStore = cookies();
  const supabase = createRouteHandlerClient({
    cookies: () => cookieStore
  });

  try {
    // Verifica sessione e utente server-side
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      console.error('Sessione non valida in GET /api/alerts:', sessionError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = session.user;

    // Query filtrata per user_id
    const { data, error } = await supabase.from('alerts').select('*').eq('user_id', user.id);
    if (error) {
      console.error('Errore fetch alerts:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Riduci i dati come nel tuo codice originale
    return NextResponse.json(data.reduce((acc: Record<string, boolean>, row) => { acc[row.ticker] = row.enabled; return acc; }, {}));
  } catch (err: any) {
    console.error('Errore imprevisto in GET /api/alerts:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const cookieStore = cookies();
  const supabase = createRouteHandlerClient({
    cookies: () => cookieStore
  });

  try {
    // Verifica sessione e utente server-side
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      console.error('Sessione non valida in POST /api/alerts:', sessionError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = session.user;

    // Leggi body
    const { ticker, enabled } = await req.json();

    // Upsert filtrato per user_id
    const { error } = await supabase.from('alerts').upsert({ ticker, enabled, user_id: user.id }, { onConflict: 'ticker,user_id' });
    if (error) {
      console.error('Errore upsert alerts:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!enabled) {
      // Pulisci alert-sent su disable, filtrato per user_id
      const { error: deleteErr } = await supabase.from('alerts_sent').delete().eq('ticker', ticker).eq('user_id', user.id);
      if (deleteErr) console.error('Errore pulizia alert-sent su toggle off:', deleteErr);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Errore imprevisto in POST /api/alerts:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}