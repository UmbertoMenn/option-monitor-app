import { NextResponse } from 'next/server'

const POLYGON_API_KEY = process.env.POLYGON_API_KEY!

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const symbols = searchParams.get('symbols')
    console.log('Simboli richiesti:', symbols)

    if (!symbols) {
      return NextResponse.json({ error: 'Missing symbols' }, { status: 400 })
    }

    const symbolList = symbols.split(',');

    const fetches = symbolList.map(async (symbol) => {
      const url = `https://api.polygon.io/v3/snapshot/options/NVDA/${symbol}?apiKey=${POLYGON_API_KEY}`;
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`Errore fetch per ${symbol}: ${res.status}`);
        return null;  // Skip su errore
      }
      const json = await res.json();
      console.log(`Risposta per ${symbol}:`, json);
      if (json.status !== "OK" || !json.results) {
        console.error(`Risposta non valida per ${symbol}:`, json);
        return null;  // Skip su response non OK
      }
      return {
        bid: json.results.last_quote?.bid ?? 0,
        ask: json.results.last_quote?.ask ?? 0,
        last_trade_price: json.results.last_trade?.price ?? 0
      };
    });

    const results = await Promise.all(fetches);

    const output: Record<string, { bid: number, ask: number, last_trade_price: number }> = {};
    symbolList.forEach((symbol, index) => {
      const data = results[index];
      if (data) {
        output[symbol] = data;  // Usa symbol input come chiave sempre
      } else {
        output[symbol] = { bid: 0, ask: 0, last_trade_price: 0 };  // Fallback zero su skip
      }
    });

    console.log('Risposta elaborata:', output);
    return NextResponse.json(output);
  } catch (err: any) {
    console.error('❌ Errore /api/full-prices:', err.message);
    return NextResponse.json({}, { status: 500 });
  }
}