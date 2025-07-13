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
        return { symbol, error: true };
      }
      const json = await res.json();
      return {
        symbol: json.ticker,
        bid: json.last_quote?.bid ?? 0,
        ask: json.last_quote?.ask ?? 0,
        last_trade_price: json.last_trade?.price ?? 0
      };
    });

    const results = await Promise.all(fetches);

    const output: Record<string, { bid: number, ask: number, last_trade_price: number }> = {};
    for (const result of results) {
      if (!result.error) {
        output[result.symbol] = {
          bid: result.bid,
          ask: result.ask,
          last_trade_price: result.last_trade_price
        };
      }
    }

    console.log('Risposta elaborata:', output);
    return NextResponse.json(output);
  } catch (err: any) {
    console.error('❌ Errore /api/full-prices:', err.message);
    return NextResponse.json({}, { status: 500 });
  }
}