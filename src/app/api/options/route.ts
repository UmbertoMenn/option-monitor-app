// src/app/api/options/route.ts

import { NextResponse } from 'next/server'

const POLYGON_API_KEY = process.env.POLYGON_API_KEY!
const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY!

const UNDERLYING = 'NVDA'
const CURRENT_EXPIRY = '2025-11-21'
const CURRENT_STRIKE = 170
const CONTRACTS_URL = 'https://api.polygon.io/v3/reference/options/contracts'

function padStrike(strike: number) {
  return (strike * 1000).toFixed(0).padStart(8, '0')
}

async function fetchContracts(): Promise<any[]> {
  const url = `${CONTRACTS_URL}?underlying_ticker=${UNDERLYING}&contract_type=call&limit=1000&apiKey=${POLYGON_API_KEY}`
  const res = await fetch(url)
  if (!res.ok) {
    const text = await res.text()
    console.error("Errore fetch contracts:", res.status, text)
    throw new Error('Errore fetch contracts')
  }
  const json = await res.json()
  return json.results!
}

async function fetchBid(symbol: string): Promise<number | null> {
  const res = await fetch(`https://api.polygon.io/v3/snapshot/options/${symbol}?apiKey=${POLYGON_API_KEY}`)
  if (!res.ok) return null
  const json = await res.json()
  return json?.results?.last_quote?.bid ?? null
}

async function fetchSpotAlphaVantage(ticker: string): Promise<number> {
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${ALPHA_VANTAGE_API_KEY}`
  const res = await fetch(url)
  if (!res.ok) {
    const text = await res.text()
    console.error("Errore fetch spot (Alpha Vantage):", res.status, text)
    throw new Error('Errore fetch spot price')
  }
  const json = await res.json()
  const price = parseFloat(json?.["Global Quote"]?.["05. price"] ?? '0')
  return isNaN(price) ? 0 : price
}

export async function GET() {
  try {
    const contracts = await fetchContracts()

    contracts.sort((a, b) =>
      a.expiration_date.localeCompare(b.expiration_date) ||
      a.strike_price - b.strike_price
    )

    const paddedStrike = padStrike(CURRENT_STRIKE)
    const currentIndex = contracts.findIndex(c =>
      c.expiration_date === CURRENT_EXPIRY &&
      c.ticker.includes(paddedStrike)
    )

    if (currentIndex < 0) throw new Error('Call attuale non trovata')

    const currentCall = contracts[currentIndex]
    const spot = await fetchSpotAlphaVantage(UNDERLYING)
    const currentBid = await fetchBid(currentCall.ticker)
    const currentCallPrice = currentBid ?? 0

    const uniqueExpiries = Array.from(new Set(contracts.map(c => c.expiration_date))).sort()
    const curExpiryIdx = uniqueExpiries.indexOf(CURRENT_EXPIRY)

    async function selectOption(expiry: string, strikeRef: number, higher: boolean) {
      const candidates = contracts.filter(c =>
        c.expiration_date === expiry &&
        (higher ? c.strike_price > strikeRef : c.strike_price < strikeRef)
      )
      if (candidates.length === 0) return null
      const sorted = candidates.sort((a, b) =>
        higher ? a.strike_price - b.strike_price : b.strike_price - a.strike_price
      )
      const best = sorted[0]
      const bid = await fetchBid(best.ticker)
      return {
        label: `${expiry.slice(5)} C${best.strike_price}`,
        strike: best.strike_price,
        price: bid ?? 0,
        expiry: expiry
      }
    }

    // FUTURE
    const futureExpiries = uniqueExpiries.slice(curExpiryIdx + 1)
    const future1 = await (async () => {
      for (const expiry of futureExpiries) {
        const f = await selectOption(expiry, CURRENT_STRIKE, true)
        if (f) return f
      }
      return null
    })()

    const future2 = await (async () => {
      if (!future1) return null
      const idx = uniqueExpiries.indexOf(future1.expiry)
      const nextExpiries = uniqueExpiries.slice(idx + 1)
      for (const expiry of nextExpiries) {
        const f = await selectOption(expiry, future1.strike, true)
        if (f) return f
      }
      return null
    })()

    // EARLIER
    const earlierExpiries = uniqueExpiries.slice(0, curExpiryIdx).reverse()
    const earlier1 = await (async () => {
      for (const expiry of earlierExpiries) {
        const f = await selectOption(expiry, CURRENT_STRIKE, false)
        if (f) return f
      }
      return null
    })()

    const earlier2 = await (async () => {
      if (!earlier1) return null
      const idx = earlierExpiries.indexOf(earlier1.expiry)
      const nextExpiries = earlierExpiries.slice(idx + 1)
      for (const expiry of nextExpiries) {
        const f = await selectOption(expiry, earlier1.strike, false)
        if (f) return f
      }
      return null
    })()

    return NextResponse.json([{
      ticker: UNDERLYING,
      spot,
      strike: CURRENT_STRIKE,
      expiry: CURRENT_EXPIRY,
      currentCallPrice,
      future: [
        future1 || { label: 'OPZIONE INESISTENTE', strike: 0, price: 0 },
        future2 || { label: 'OPZIONE INESISTENTE', strike: 0, price: 0 }
      ],
      earlier: [
        earlier1 || { label: 'OPZIONE INESISTENTE', strike: 0, price: 0 },
        earlier2 || { label: 'OPZIONE INESISTENTE', strike: 0, price: 0 }
      ]
    }])
  } catch (err: any) {
    console.error('Errore route options:', err.message)
    return NextResponse.json([], { status: 500 })
  }
}
