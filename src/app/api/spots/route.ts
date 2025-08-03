import { NextResponse } from 'next/server';
import { supabaseClient } from '../../../lib/supabaseClient'; // Adatta il path se necessario

export const runtime = 'edge';

const POLYGON_API_KEY = process.env.POLYGON_API_KEY;

export async function GET(req: Request) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!POLYGON_API_KEY) {
    console.error('POLYGON_API_KEY not set in environment variables');
    return NextResponse.json({ error: 'API key missing' }, { status: 500 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const requestedTickers = searchParams.get('tickers')?.split(',') || [];
    if (requestedTickers.length === 0) return NextResponse.json({}, { status: 400 });

    // Fetcha i tickers dell'utente da Supabase per filtrare
    const { data: userOptions, error: tickError } = await supabaseClient.from('options').select('ticker').eq('user_id', user.id);
    if (tickError) {
      console.error('[SPOTS-DEBUG-ERROR] Error fetching user tickers:', tickError);
      return NextResponse.json({ error: 'Error fetching user tickers' }, { status: 500 });
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
  } catch (err) {
    console.error('[SPOTS-DEBUG-CATCH]', err);
    return NextResponse.json({}, { status: 500 });
  }
}