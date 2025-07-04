// src/app/api/options/route.ts

import { NextResponse } from 'next/server'

const API_KEY = process.env.POLYGON_API_KEY as string
const BASE_URL = 'https://api.polygon.io/v3/reference/options/contracts'
const UNDERLYING = 'NVDA'
const CURRENT_CALL = {
  ticker: 'OPRA:NVDA251121C170.0',
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

export async function GET() {
  try {
    const url = `${BASE_URL}?underlying_ticker=${UNDERLYING}&contract_type=call&limit=1000&sort=ticker&order=asc&apiKey=${API_KEY}`
    const res = await fetch(url)

    if (!res.ok) throw new Error('Errore nella fetch Polygon')

    const json = (await res.json()) as { results: PolygonOptionContract[] }

    console.log('📦 Opzioni ricevute da Polygon:', json.results.length)
    console.log('🔍 Ticker ricevuti:', json.results.map(opt => opt.ticker))
    console.log('🔍 Strike + Expiry ricevuti:', json.results.map(opt => `${opt.strike_price} @ ${opt.expiration_date}`))

    const calls = json.results.filter(
      (opt) => opt.exercise_style === 'american'
    )

    calls.sort((a, b) => {
      if (a.expiration_date === b.expiration_date) {
        return a.strike_price - b.strike_price
      }
      return a.expiration_date.localeCompare(b.expiration_date)
    })

    const currentCall = calls.find(
      (c) =>
        c.strike_price === CURRENT_CALL.strike &&
        c.expiration_date === CURRENT_CALL.expiry
    )

    if (!currentCall) {
      console.error('❌ Call attuale non trovata. Strike:', CURRENT_CALL.strike, 'Expiry:', CURRENT_CALL.expiry)
      console.error('📦 Opzioni disponibili:', calls.map(c => `${c.strike_price} @ ${c.expiration_date}`))
      return NextResponse.json([], { status: 500 })
    }

    const currentExpiry = currentCall.expiration_date
    const currentStrike = currentCall.strike_price

    const future = calls.filter(
      (c) => c.expiration_date > currentExpiry && c.strike_price > currentStrike
    )

    const nextExpiries = Array.from(
      new Set(future.map((f) => f.expiration_date))
    ).slice(0, 2)

    const futureOptions = nextExpiries.map((exp) =>
      future.find(
        (f) => f.expiration_date === exp && f.strike_price > currentStrike
      )
    ).filter(Boolean) as PolygonOptionContract[]

    const earlier = calls.filter(
      (c) => c.expiration_date < currentExpiry && c.strike_price < currentStrike
    )

    const prevExpiries = Array.from(
      new Set(earlier.map((f) => f.expiration_date))
    ).slice(-2)

    const earlierOptions = prevExpiries.map((exp) =>
      [...earlier].reverse().find(
        (e) => e.expiration_date === exp && e.strike_price < currentStrike
      )
    ).filter(Boolean) as PolygonOptionContract[]

    const formatLabel = (opt: PolygonOptionContract) => {
      const [y, m] = opt.expiration_date.split('-')
      const month = new Date(opt.expiration_date).toLocaleString('en-US', {
        month: 'short',
      }).toUpperCase()
      return `${month}${y.slice(2)} C${opt.strike_price}`
    }

    const result = [
      {
        ticker: UNDERLYING,
        spot: 157.25, // Placeholder per ora
        strike: currentStrike,
        expiry: 'NOV 25',
        currentCallPrice: 12.6, // Placeholder per ora
        earlier: earlierOptions.map((e) => ({
          label: formatLabel(e),
          price: 10.5,
          strike: e.strike_price,
        })),
        future: futureOptions.map((f) => ({
          label: formatLabel(f),
          price: 13.2,
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
