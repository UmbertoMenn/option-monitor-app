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
      const match = /^O:([A-Z]+)\d+C\d+$/.exec(symbol)
      if (!match) {
        console.warn('❌ Simbolo non valido:', symbol)
        return null;
      }
      const ticker = match[1]
      const url = `https://api.polygon.io/v3/snapshot/options/${ticker}/${symbol}?apiKey=${POLYGON_API_KEY}`;
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`Errore fetch per ${symbol}: ${res.status}`);
        return null;
      }
      const json = await res.json();
      if (json.status !== "OK" || !json.results) {
        console.error(`Risposta non valida per ${symbol}:`, json);
        return null;
      }
      return {
        symbol,
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
        output[symbol] = { bid: data.bid, ask: data.ask, last_trade_price: data.last_trade_price };
      } else {
        output[symbol] = { bid: 0, ask: 0, last_trade_price: 0 };
      }
    });

    console.log('Risposta elaborata:', output);
    return NextResponse.json(output);
  } catch (err: any) {
    console.error('❌ Errore /api/full-prices:', err.message);
    return NextResponse.json({}, { status: 500 });
  }
}