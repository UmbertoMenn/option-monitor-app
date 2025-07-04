// src/app/api/options/route.ts

import { NextResponse } from 'next/server'

const API_KEY = process.env.POLYGON_API_KEY!
const CONTRACTS_URL = 'https://api.polygon.io/v3/reference/options/contracts'

// Call attuale pre-configurata
const UNDERLYING = 'NVDA'
const CURRENT_EXPIRY = '2025-11-21'
const CURRENT_STRIKE = 170

function padStrike(strike: number) {
  return (strike * 1000).toFixed(0).padStart(8, '0') // es: 170 -> "00170000"
}

function formatSymbol(expiry: string, strike: number) {
  const [y, m, d] = expiry.split('-')
  return `${UNDERLYING}${y.slice(2)}${m}${d}C${padStrike(strike)}`
}

async function fetchContracts(): Promise<any[]> {
  const url = `${CONTRACTS_URL}?underlying_ticker=${UNDERLYING}&contract_type=call&limit=1000&apiKey=${API_KEY}`
  console.log("URL chiamata contracts:", url)
  const res = await fetch(url)
  if (!res.ok) {
    const text = await res.text()
    console.error("Errore dettagliato:", res.status, text)
    throw new Error('Errore fetch contracts')
  }
  const json = await res.json()
  return json.results!
}

async function fetchBid(symbol: string): Promise<number | null> {
  const res = await fetch(`https://api.polygon.io/v3/snapshot/options/${symbol}?apiKey=${API_KEY}`)
  if (!res.ok) return null
  const json = await res.json()
  return json?.results?.last_quote?.bid ?? null
}

export async function GET() {
  try {
    const contracts = await fetchContracts()
    console.log("Esempio ticker disponibili:", contracts.slice(0, 20).map(c => c.ticker))

    contracts.sort((a: any, b: any) =>
      a.expiration_date.localeCompare(b.expiration_date) ||
      a.strike_price - b.strike_price
    )

    const currentOpra = formatSymbol(CURRENT_EXPIRY, CURRENT_STRIKE)
    const paddedStrike = padStrike(CURRENT_STRIKE)
    console.log("Ticker cercato (OPRA):", currentOpra)
    console.log("Strike pad:", paddedStrike)

    const possibili = contracts.filter((c: any) => c.expiration_date === CURRENT_EXPIRY)
    console.log("Contratti con expiry giusta:", possibili.map(c => c.ticker))

    // Fallback match per ticker con paddedStrike e expiry corretti
    const currentIndex = contracts.findIndex((c: any) =>
      c.expiration_date === CURRENT_EXPIRY &&
      c.ticker.includes(paddedStrike)
    )

    if (currentIndex < 0) throw new Error('Call attuale non trovata')

    const currentCall = contracts[currentIndex]
    const spotRes = await fetch(`https://api.polygon.io/v3/last/trade/${UNDERLYING}?apiKey=${API_KEY}`)
    const spotJson = await spotRes.json()
    const spot = spotJson?.results?.price ?? 0

    const currentBid = await fetchBid(currentCall.ticker)
    const currentCallPrice = currentBid ?? 0

    const uniqueExpiries = Array.from(new Set(contracts.map((c: any) => c.expiration_date))).sort()
    const curExpiryIdx = uniqueExpiries.indexOf(CURRENT_EXPIRY)

    async function selectOption(expiry: string, strikeRef: number, higher: boolean) {
      const candidates = contracts.filter((c: any) =>
        c.expiration_date === expiry &&
        (higher ? c.strike_price > strikeRef : c.strike_price < strikeRef)
      )
      if (candidates.length === 0) return null
      const sorted = candidates.sort((a: any, b: any) =>
        higher ? a.strike_price - b.strike_price : b.strike_price - a.strike_price
      )
      const c0 = sorted[0]
      const bid = await fetchBid(c0.ticker)
      return {
        label: `${expiry.slice(5)} C${c0.strike_price}`,
        strike: c0.strike_price,
        price: bid ?? 0,
        expiry
      }
    }

    const future1 = curExpiryIdx + 1 < uniqueExpiries.length
      ? await selectOption(uniqueExpiries[curExpiryIdx + 1], CURRENT_STRIKE, true)
      : null

    const future2 = future1 && curExpiryIdx + 2 < uniqueExpiries.length
      ? await selectOption(uniqueExpiries[curExpiryIdx + 2], future1.strike, true)
      : null

    const earlier1 = curExpiryIdx - 1 >= 0
      ? await selectOption(uniqueExpiries[curExpiryIdx - 1], CURRENT_STRIKE, false)
      : null

    const earlier2 = earlier1 && curExpiryIdx - 2 >= 0
      ? await selectOption(uniqueExpiries[curExpiryIdx - 2], earlier1.strike, false)
      : null

    const output = [{
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
        earlier2 || { label: 'OPZIONE INESISTENTE', strike: 0, price: 0 },
        earlier1 || { label: 'OPZIONE INESISTENTE', strike: 0, price: 0 }
      ]
    }]

    return NextResponse.json(output)
  } catch (err: any) {
    console.error('Errore route options:', err.message)
    return NextResponse.json([], { status: 500 })
  }
}
