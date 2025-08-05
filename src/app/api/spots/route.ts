// src/app/api/spots/route.ts
import { createClient } from '../../../utils/supabase/server';  // Path che funziona
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';  // Forza dynamic per auth e fetch

const POLYGON_API_KEY = process.env.POLYGON_API_KEY;

export async function GET(req: Request) {
  const supabase = await createClient();  // Crea client

  // Log cookies per debug
  const cookieStore = await cookies();
  console.log('Spots Route: Cookies:', cookieStore.getAll());

  try {
    // Controllo sessione
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    // Log sessione
    console.log('Spots Route: Sessione:', session ? 'Valida (user: ' + session.user.id + ')' : 'Null');
    console.log('Spots Route: Session Error:', sessionError ? sessionError.message : 'No error');
    console.log('Spots Route: Access Token:', session?.access_token || 'Null');

    if (sessionError || !session) {
      console.error('Sessione non valida in GET /api/spots:', sessionError?.message || 'No error');
      return NextResponse.json({ error: 'Unauthorized', details: sessionError?.message || 'No details' }, { status: 401 });
    }
    const user = session.user;

    if (!POLYGON_API_KEY) {
      console.error('POLYGON_API_KEY not set in environment variables');
      return NextResponse.json({ error: 'API key missing' }, { status: 500 });
    }

    const { searchParams } = new URL(req.url);
    const requestedTickers = searchParams.get('tickers')?.split(',') || [];
    if (requestedTickers.length === 0) return NextResponse.json({}, { status: 400 });

    // Fetch alert tickers dell'utente da Supabase per filtrare (da 'options' per multi-user)
    const { data: userOptions, error: tickError } = await supabase.from('options').select('ticker').eq('user_id', user.id);
    if (tickError) {
      console.error('[SPOTS-DEBUG-ERROR] Error fetching user tickers:', tickError.message);
      return NextResponse.json({ error: 'Error fetching user tickers', details: tickError.message }, { status: 500 });
    }

    const userTickers = userOptions.map(o => o.ticker);
    // Filtra i tickers richiesti: solo quelli che l'utente ha
    const filteredTickers = requestedTickers.filter(t => userTickers.includes(t));
    if (filteredTickers.length === 0) {
      // Se nessun ticker valido, restituisci oggetto vuoto o con valori di default per i richiesti
      const spots: Record<string, { price: number; change_percent: number }> = {};
      requestedTickers.forEach(t => {
        spots[t] = { price: 0, change_percent: 0 };
      });
      return NextResponse.json(spots);
    }

    console.log(`[SPOTS-DEBUG-START] Tickers filtrati per utente: ${filteredTickers.join(',')} | Timestamp: ${new Date().toISOString()}`);

    const polygonUrl = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${filteredTickers.join(',')}&apiKey=${POLYGON_API_KEY}`;
    console.log(`[SPOTS-DEBUG-URL] ${polygonUrl.replace(POLYGON_API_KEY, '***')}`); // Nascondi key per sicurezza

    const res = await fetch(polygonUrl);
    console.log(`[SPOTS-DEBUG-STATUS] ${res.status}`);

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[SPOTS-DEBUG-ERROR] Status: ${res.status} | Dettagli: ${errorText}`);
      return NextResponse.json({}, { status: 500 });
    }

    const json = await res.json();
    console.log(`[SPOTS-DEBUG-DATA] ${JSON.stringify(json)}`); // Log dati grezzi per verifica

    const spots: Record<string, { price: number; change_percent: number }> = {};
    json.tickers?.forEach((result: any) => {
      const price = result.lastTrade?.p || result.day?.c || result.prevDay?.c || 0;
      const change_percent = result.todaysChangePerc || 0;
      spots[result.ticker] = { price, change_percent };
    });

    // Aggiungi valori di default per tickers richiesti ma non filtrati o non trovati
    requestedTickers.forEach(t => {
      if (!(t in spots)) spots[t] = { price: 0, change_percent: 0 };
    });

    console.log(`[SPOTS-DEBUG-END] Risposta elaborata: ${JSON.stringify(spots)}`);
    return NextResponse.json(spots);
  } catch (err: any) {
    console.error('[SPOTS-DEBUG-CATCH]', err.message);
    return NextResponse.json({}, { status: 500 });
  }
}