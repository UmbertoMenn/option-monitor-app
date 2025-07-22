import { NextResponse } from 'next/server';

const POLYGON_API_KEY = process.env.POLYGON_API_KEY;

export async function GET(req: Request) {
  if (!POLYGON_API_KEY) {
    console.error('POLYGON_API_KEY not set in environment variables');
    return NextResponse.json({ error: 'API key missing' }, { status: 500 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const tickers = searchParams.get('tickers');
    if (!tickers) return NextResponse.json({}, { status: 400 });

    console.log(`[SPOTS-DEBUG-START] Tickers richiesti: ${tickers} | Timestamp: ${new Date().toISOString()}`);

    const polygonUrl = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickers}&apiKey=${POLYGON_API_KEY}`;
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

    const spots: Record<string, { price: number; changePercent: number }> = {};
    json.tickers?.forEach((result: any) => {
      const price = result.lastTrade?.p || result.day?.c || result.prevDay?.c || 0;
      const changePercent = result.todaysChangePerc || 0;
      spots[result.ticker] = { price, changePercent };
    });
    tickers.split(',').forEach(t => {
      if (!(t in spots)) spots[t] = { price: 0, changePercent: 0 };
    });

    console.log(`[SPOTS-DEBUG-END] Risposta elaborata: ${JSON.stringify(spots)}`);
    return NextResponse.json(spots);
  } catch (err) {
    console.error('[SPOTS-DEBUG-CATCH]', err);
    return NextResponse.json({}, { status: 500 });
  }
}