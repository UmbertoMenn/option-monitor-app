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

    // Use v2 snapshot endpoint for stocks, which supports comma-separated tickers
    const res = await fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickers}&apiKey=${POLYGON_API_KEY}`);
    if (!res.ok) {
      const errorText = await res.text();
      console.error(`Polygon error: ${res.status} - ${errorText}`);
      return NextResponse.json({}, { status: 500 });
    }
    const json = await res.json();
    const spots: Record<string, { price: number; changePercent: number }> = {};
    json.tickers?.forEach((result: any) => {
      // Prioritize last trade price (real-time), fallback to day's close or previous day's close
      const price = result.lastTrade?.p || result.day?.c || result.prevDay?.c || 0;
      // Use today's change percent
      const changePercent = result.todaysChangePerc || 0;
      spots[result.ticker] = { price, changePercent };
    });
    // Fill missing tickers with defaults
    tickers.split(',').forEach(t => {
      if (!(t in spots)) spots[t] = { price: 0, changePercent: 0 };
    });
    return NextResponse.json(spots);
  } catch (err) {
    console.error('Error in /api/spots:', err);
    return NextResponse.json({}, { status: 500 });
  }
}