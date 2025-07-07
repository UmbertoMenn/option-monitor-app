// /src/app/api/full-prices/route.ts
import { NextResponse } from 'next/server'

const POLYGON_API_KEY = process.env.POLYGON_API_KEY!
const SNAPSHOT_URL = `https://api.polygon.io/v3/snapshot/options/NVDA?apiKey=${POLYGON_API_KEY}`

function isThirdFriday(dateStr: string): boolean {
  const date = new Date(dateStr)
  return date.getDay() === 5 && date.getDate() >= 15 && date.getDate() <= 21
}

export async function GET() {
  try {
    const res = await fetch(SNAPSHOT_URL)
    if (!res.ok) throw new Error(`Errore fetch snapshot: ${res.status}`)

    const json = await res.json()
    const options = json?.results ?? []

    const filtered = options.filter((opt: any) => {
      return (
        opt.details?.exercise_style === 'american' &&
        opt.details?.contract_type === 'call'
      )
    })

    const output: Record<string, Record<string, {
      bid: number,
      ask: number,
      symbol: string
    }>> = {}

    for (const opt of filtered) {
      const expiry = opt.details.expiration_date
      const strike = opt.details.strike_price.toFixed(2)
      const bid = opt.last_quote?.bid ?? 0
      const ask = opt.last_quote?.ask ?? 0
      const symbol = opt.details?.symbol ?? ''

      if (!output[expiry]) output[expiry] = {}
      output[expiry][strike] = { bid, ask, symbol }
    }

    return NextResponse.json(output)
  } catch (err: any) {
    console.error('❌ Errore /api/full-prices:', err.message)
    return NextResponse.json({}, { status: 500 })
  }
}
