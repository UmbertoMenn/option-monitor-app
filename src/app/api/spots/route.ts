import { NextResponse } from 'next/server'

const POLYGON_API_KEY = process.env.POLYGON_API_KEY!

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const tickers = searchParams.get('tickers')
    if (!tickers) return NextResponse.json({}, { status: 400 })
    const res = await fetch(`https://api.polygon.io/v3/snapshot/stocks?tickers=${tickers}&apiKey=${POLYGON_API_KEY}`)
    if (!res.ok) return NextResponse.json({}, { status: 500 })
    const json = await res.json()
    const spots: Record<string, number> = {}
    json.results.forEach((r: any) => {
      spots[r.ticker] = r.lastQuote?.P || r.session?.close || r.prevDay?.c || 0
    })
    return NextResponse.json(spots)
  } catch (err) {
    return NextResponse.json({}, { status: 500 })
  }
}