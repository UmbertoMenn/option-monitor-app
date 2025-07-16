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

    // Batch fetch all tickers in one call for efficiency and real-time
    const res = await fetch(`https://api.polygon.io/v3/snapshot/stocks?tickers=${tickers}&apiKey=${POLYGON_API_KEY}`);
    if (!res.ok) {
      console.error(`Polygon error: ${res.status} - ${await res.text()}`);
      return NextResponse.json({}, { status: 500 });
    }
    const json = await res.json();
    const spots: { [key: string]: number } = {};
    json.results?.forEach((result: any) => {
      // Prioritize last quote price (real-time), fallback to session close or prev day close
      spots[result.ticker] = result.lastQuote?.P || result.session?.close || result.prevDay?.c || 0;
    });
    // Fill missing tickers with 0
    tickers.split(',').forEach(t => {
      if (!(t in spots)) spots[t] = 0;
    });
    return NextResponse.json(spots);
  } catch (err) {
    console.error('Error in /api/spots:', err);
    return NextResponse.json({}, { status: 500 });
  }
}