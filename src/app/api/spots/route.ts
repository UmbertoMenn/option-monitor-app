import { NextResponse } from 'next/server'

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
    const tickerList = tickers.split(',');
    const spots: { [key: string]: number } = {};
    for (const t of tickerList) {
      const res = await fetch(`https://api.polygon.io/v2/aggs/ticker/${t}/prev?apiKey=${POLYGON_API_KEY}`);
      if (!res.ok) {
        spots[t] = 0;
        continue;
      }
      const json = await res.json();
      spots[t] = json.results?.[0]?.c || 0;
    }
    return NextResponse.json(spots);
  } catch (err) {
    console.error('Error in /api/spots:', err);
    return NextResponse.json({}, { status: 500 });
  }
}