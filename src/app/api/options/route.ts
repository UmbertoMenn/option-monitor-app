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
  if (!res.ok) throw new Error('Errore fetch contracts')
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
  const res = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${ALPHA_VANTAGE_API_KEY}`)
  if (!res.ok) throw new Error('Errore fetch spot')
  const json = await res.json()
  return parseFloat(json?.["Global Quote"]?.["05. price"] ?? '0')
}

export async function GET() {
  try {
    const contracts = await fetchContracts()
    contracts.sort((a, b) =>
      a.expiration_date.localeCompare(b.expiration_date) || a.strike_price - b.strike_price
    )

    const paddedStrike = padStrike(CURRENT_STRIKE)
    const current = contracts.find(c =>
      c.expiration_date === CURRENT_EXPIRY &&
      c.ticker.includes(paddedStrike)
    )
    if (!current) throw new Error('Call attuale non trovata')
    const currentCall = current

    const spot = await fetchSpotAlphaVantage(UNDERLYING)
    const currentCallPrice = (await fetchBid(currentCall.ticker)) ?? 0

    const uniqueExpiries = Array.from(new Set(contracts.map(c => c.expiration_date))).sort()
    const curIdx = uniqueExpiries.indexOf(CURRENT_EXPIRY)

    async function selectOption(expiry: string, strikeRef: number, higher: boolean) {
      const candidates = contracts
        .filter(c => c.expiration_date === expiry)
        .filter(c => higher ? c.strike_price > strikeRef : c.strike_price < strikeRef)
      if (!candidates.length) return null
      const best = candidates.sort((a, b) =>
        higher ? a.strike_price - b.strike_price : b.strike_price - a.strike_price
      )[0]
      const bid = await fetchBid(best.ticker)
      return { best, bid }
    }

    // FUTURE 1 & 2
    const futureList: any[] = []
    for (const expiry of uniqueExpiries.slice(curIdx + 1)) {
      const sel = await selectOption(expiry, CURRENT_STRIKE, true)
      if (sel) {
        console.log('🎯 Future found:', sel.best.ticker, sel.best.strike_price, expiry)
        futureList.push({ label: `${expiry.slice(5)} C${sel.best.strike_price}`, strike: sel.best.strike_price, price: sel.bid ?? 0, expiry })
        if (futureList.length === 2) break
      }
    }

    // EARLIER 1 & 2
    const earlierList: any[] = []
    for (const expiry of uniqueExpiries.slice(0, curIdx).reverse()) {
      const sel = await selectOption(expiry, CURRENT_STRIKE, false)
      if (sel) {
        console.log('🎯 Earlier found:', sel.best.ticker, sel.best.strike_price, expiry)
        earlierList.push({ label: `${expiry.slice(5)} C${sel.best.strike_price}`, strike: sel.best.strike_price, price: sel.bid ?? 0, expiry })
        if (earlierList.length === 2) break
      }
    }

    const output = [{
      ticker: UNDERLYING,
      spot,
      strike: CURRENT_STRIKE,
      expiry: CURRENT_EXPIRY,
      currentCallPrice,
      future: [
        futureList[0] || { label: 'OPZIONE INESISTENTE', strike: 0, price: 0 },
        futureList[1] || { label: 'OPZIONE INESISTENTE', strike: 0, price: 0 }
      ],
      earlier: [
        earlierList[0] || { label: 'OPZIONE INESISTENTE', strike: 0, price: 0 },
        earlierList[1] || { label: 'OPZIONE INESISTENTE', strike: 0, price: 0 }
      ]
    }]

    return NextResponse.json(output)
  } catch (err: any) {
    console.error('Errore route options:', err.message)
    return NextResponse.json([], { status: 500 })
  }
}

