// src/app/api/options/route.ts

import { NextResponse } from 'next/server'

const API_KEY = process.env.POLYGON_API_KEY as string
const BASE_URL = 'https://api.polygon.io'
const UNDERLYING = 'NVDA'
const CURRENT_CALL = {
  ticker: 'O:NVDA251121C00170000', // Polygon ticker format (no OPRA)
  strike: 170,
  expiry: '2025-11-21',
}

interface PolygonOptionContract {
  ticker: string
  strike_price: number
  expiration_date: string
  contract_type: string
  exercise_style: string
  underlying_ticker: string
}

interface SnapshotOption {
  details: {
    ticker: string
    greeks?: any
    last_quote?: { bid?: number; ask?: number }
  }
}

export async function GET() {
  try {
    const contractsRes = await fetch(
      `${BASE_URL}/v3/reference/options/contracts?underlying_ticker=${UNDERLYING}&contract_type=call&limit=1000&sort=ticker&order=asc&apiKey=${API_KEY}`
    )

    if (!contractsRes.ok) throw new Error('Errore nella fetch contracts')
    const contractsJson = (await contractsRes.json()) as { results: PolygonOptionContract[] }

    const calls = contractsJson.results.filter(
      (opt) => opt.exercise_style === 'american'
    )

    calls.sort((a, b) => {
      if (a.expiration_date === b.expiration_date) {
        return a.strike_price - b.strike_price
      }
      return a.expiration_date.localeCompare(b.expiration_date)
    })

    const currentIndex = calls.findIndex((c) => c.ticker === CURRENT_CALL.ticker)
    if (currentIndex === -1) throw new Error('Call attuale non trovata')

    const currentCall = calls[currentIndex]
    const currentExpiry = currentCall.expiration_date
    const currentStrike = currentCall.strike_price

    const future = calls.filter((c) =>
      c.expiration_date > currentExpiry && c.strike_price > currentStrike
    )

    const nextExpiries = Array.from(new Set(future.map((f) => f.expiration_date))).slice(0, 2)

    const futureOptions = nextExpiries.map((exp) =>
      future.find((f) => f.expiration_date === exp && f.strike_price > currentStrike)
    ).filter(Boolean) as PolygonOptionContract[]

    const earlier = calls.filter((c) =>
      c.expiration_date < currentExpiry && c.strike_price < currentStrike
    )

    const prevExpiries = Array.from(new Set(earlier.map((f) => f.expiration_date))).slice(-2)

    const earlierOptions = prevExpiries.map((exp) =>
      [...earlier].reverse().find((e) => e.expiration_date === exp && e.strike_price < currentStrike)
    ).filter(Boolean) as PolygonOptionContract[]

    // 2. Fetch snapshot prices
    const snapshotRes = await fetch(`${BASE_URL}/v3/snapshot/options/${UNDERLYING}?apiKey=${API_KEY}`)
    if (!snapshotRes.ok) throw new Error('Errore nella fetch snapshot')
    const snapshotJson = await snapshotRes.json()
    const snapshotOptions = snapshotJson.results as SnapshotOption[]

    const findPrice = (ticker: string) => {
      const match = snapshotOptions.find((opt) => opt.details.ticker === ticker)
      const quote = match?.details?.last_quote
      return quote?.bid ?? quote?.ask ?? 0
    }

    const spot = snapshotJson?.underlying?.last?.price ?? 0

    const formatLabel = (opt: PolygonOptionContract) => {
      const [y, m] = opt.expiration_date.split('-')
      const month = new Date(opt.expiration_date).toLocaleString('en-US', { month: 'short' }).toUpperCase()
      return `${month}${y.slice(2)} C${opt.strike_price}`
    }

    const result = [
      {
        ticker: UNDERLYING,
        spot,
        strike: currentStrike,
        expiry: 'NOV 25',
        currentCallPrice: findPrice(currentCall.ticker),
        earlier: earlierOptions.map((e) => ({
          label: formatLabel(e),
          price: findPrice(e.ticker),
          strike: e.strike_price,
        })),
        future: futureOptions.map((f) => ({
          label: formatLabel(f),
          price: findPrice(f.ticker),
          strike: f.strike_price,
        })),
      },
    ]

    return NextResponse.json(result)
  } catch (err) {
    console.error('Errore caricamento dati da Polygon:', err instanceof Error ? err.message : err)
    return NextResponse.json([], { status: 500 })
  }
}
