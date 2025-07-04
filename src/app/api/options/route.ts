// src/app/api/options/route.ts

import { NextResponse } from 'next/server'

const API_KEY = process.env.POLYGON_API_KEY as string
const CONTRACTS_URL = 'https://api.polygon.io/v3/reference/options/contracts'
const SNAPSHOT_URL = 'https://api.polygon.io/v3/snapshot/options'
const SPOT_URL = 'https://api.polygon.io/v2/last/trade/NVDA?apiKey=' + API_KEY
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
  underlying_ticker: string
}

interface SnapshotResult {
  results: {
    details: { ticker: string }
    last_quote: { bid: number; ask: number }
  }
}

export async function GET() {
  try {
    const contractsRes = await fetch(
      `${CONTRACTS_URL}?underlying_ticker=${UNDERLYING}&contract_type=call&limit=1000&sort=ticker&order=asc&apiKey=${API_KEY}`
    )

    if (!contractsRes.ok) throw new Error('Errore nella fetch Polygon Contracts')

    const json = await contractsRes.json() as { results: PolygonOptionContract[] }
    const calls = json.results

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

    const spotRes = await fetch(SPOT_URL)
    const spotJson = await spotRes.json()
    const spotPrice = spotJson?.results?.p ?? 0

    const future = calls.filter(
      (c) => c.expiration_date > currentExpiry && c.strike_price > currentStrike
    )
    const nextExpiries = Array.from(new Set(future.map((f) => f.expiration_date))).slice(0, 2)
    const futureOptions = nextExpiries.map((exp) =>
      future.find((f) => f.expiration_date === exp && f.strike_price > currentStrike)
    ).filter(Boolean) as PolygonOptionContract[]

    const earlier = calls.filter(
      (c) => c.expiration_date < currentExpiry && c.strike_price < currentStrike
    )
    const prevExpiries = Array.from(new Set(earlier.map((f) => f.expiration_date))).slice(-2)
    const earlierOptions = prevExpiries.map((exp) =>
      [...earlier].reverse().find((e) => e.expiration_date === exp && e.strike_price < currentStrike)
    ).filter(Boolean) as PolygonOptionContract[]

    const priceTickers = [CURRENT_CALL.ticker, ...futureOptions, ...earlierOptions].map((o: any) => o.ticker)
    const fetchSnapshots = await Promise.all(
      priceTickers.map((ticker) =>
        fetch(`${SNAPSHOT_URL}/${ticker}?apiKey=${API_KEY}`).then((res) => res.json())
      )
    )

    const priceMap: Record<string, number> = {}
    fetchSnapshots.forEach((snap: SnapshotResult) => {
      const ticker = snap?.results?.details?.ticker
      const bid = snap?.results?.last_quote?.bid ?? 0
      if (ticker) priceMap[ticker] = bid
    })

    const formatLabel = (opt: PolygonOptionContract) => {
      const [y, m] = opt.expiration_date.split('-')
      const month = new Date(opt.expiration_date).toLocaleString('en-US', { month: 'short' }).toUpperCase()
      return `${month}${y.slice(2)} C${opt.strike_price}`
    }

    const result = [
      {
        ticker: UNDERLYING,
        spot: spotPrice,
        strike: currentStrike,
        expiry: 'NOV 25',
        currentCallPrice: priceMap[CURRENT_CALL.ticker] ?? 0,
        earlier: earlierOptions.map((e) => ({
          label: formatLabel(e),
          price: priceMap[e.ticker] ?? 0,
          strike: e.strike_price,
        })),
        future: futureOptions.map((f) => ({
          label: formatLabel(f),
          price: priceMap[f.ticker] ?? 0,
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
