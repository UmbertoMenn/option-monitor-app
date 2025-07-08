// /src/app/api/full-prices/route.ts
import { NextResponse } from 'next/server'

const POLYGON_API_KEY = process.env.POLYGON_API_KEY!

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const symbols = searchParams.get('symbols') // es: "O:NVDA250920C00175000,O:NVDA251018C00180000,..."

    if (!symbols) {
      return NextResponse.json({ error: 'Missing symbols' }, { status: 400 })
    }

    const url = `https://api.polygon.io/v3/snapshot?tickers=${symbols}&apiKey=${POLYGON_API_KEY}`
    const res = await fetch(url)

    if (!res.ok) {
      throw new Error(`Errore fetch snapshot: ${res.status}`)
    }

    const json = await res.json()
    const results = json?.results ?? []

    const output: Record<string, { bid: number, ask: number }> = {}

    for (const opt of results) {
      const symbol = opt.ticker
      const bid = opt.last_quote?.bid ?? 0
      const ask = opt.last_quote?.ask ?? 0
      output[symbol] = { bid, ask }
    }

    return NextResponse.json(output)
  } catch (err: any) {
    console.error('❌ Errore /api/full-prices:', err.message)
    return NextResponse.json({}, { status: 500 })
  }
}
