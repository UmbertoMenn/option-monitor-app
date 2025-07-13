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

    // Endpoint corretto per multiple options snapshot: specifica underlying e ticker.any_of
    const url = `https://api.polygon.io/v3/snapshot/options/NVDA?ticker.any_of=${symbols}&apiKey=${POLYGON_API_KEY}`
    const res = await fetch(url)
    const json = await res.json()
    console.log('Risposta Polygon:', json)

    const results = json?.results ?? []
    if (!results.length) {
      return NextResponse.json({ error: 'Nessun dato per i simboli forniti' }, { status: 404 })
    }

    const output: Record<string, { bid: number, ask: number, last_trade_price: number }> = {}
    for (const opt of results) {
      const symbol = opt.ticker
      const bid = opt.last_quote?.bid ?? 0
      const ask = opt.last_quote?.ask ?? 0
      const last_trade_price = opt.last_trade?.price ?? 0
      output[symbol] = { bid, ask, last_trade_price }
    }

    return NextResponse.json(output)
  } catch (err: any) {
    console.error('❌ Errore /api/full-prices:', err.message)
    return NextResponse.json({}, { status: 500 })
  }
}