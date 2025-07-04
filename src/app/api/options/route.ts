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

function isThirdFriday(dateStr: string): boolean {
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getDay() === 5 && day >= 15 && day <= 21
}

async function fetchContracts(): Promise<any[]> {
  const url = `${CONTRACTS_URL}?underlying_ticker=${UNDERLYING}&contract_type=call&limit=1000&apiKey=${POLYGON_API_KEY}`
  const res = await fetch(url)
  if (!res.ok) {
    const text = await res.text()
    console.error("❌ Errore fetch contracts:", res.status, text)
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
    console.error("❌ Errore fetch spot (Alpha Vantage):", res.status, text)
    throw new Error('Errore fetch spot price')
  }
  const json = await res.json()
  const price = parseFloat(json?.["Global Quote"]?.["05. price"] ?? '0')
  return isNaN(price) ? 0 : price
}

async function selectOption(contracts: any[], expiry: string, strikeRef: number, higher: boolean) {
  const candidates = contracts.filter(c =>
    c.expiration_date === expiry &&
    (higher ? c.strike_price > strikeRef : c.strike_price < strikeRef)
  )
  console.log(`📊 ${candidates.length} opzioni trovate su ${expiry} con strike ${higher ? '>' : '<'} ${strikeRef}`)

  if (candidates.length === 0) return null
  const sorted = candidates.sort((a, b) =>
    higher ? a.strike_price - b.strike_price : b.strike_price - a.strike_price
  )
  const best = sorted[0]
  const bid = await fetchBid(best.ticker)
  console.log(`🎯 Opzione selezionata: ${best.ticker} | Strike ${best.strike_price} | Expiry ${expiry}`)
  return {
    label: `${expiry.slice(5)} C${best.strike_price}`,
    strike: best.strike_price,
    price: bid ?? 0,
    expiry: expiry
  }
}

export async function GET() {
  try {
    const contracts = await fetchContracts()

    contracts.sort((a, b) =>
      a.expiration_date.localeCompare(b.expiration_date) ||
      a.strike_price - b.strike_price
    )

    const allExpiries = Array.from(new Set(contracts.map(c => c.expiration_date))).sort()
    const monthlyExpiries = allExpiries.filter(isThirdFriday)
    const curExpiryIdx = monthlyExpiries.indexOf(CURRENT_EXPIRY)

    let future1Idx = -1

    // FUTURE 1
    const future1 = await (async () => {
      const futureExpiries = monthlyExpiries.slice(curExpiryIdx + 1)
      for (let i = 0; i < futureExpiries.length; i++) {
        const expiry = futureExpiries[i]
        console.log(`➡️ Cercando FUTURE 1 su expiry ${expiry}, strike > ${CURRENT_STRIKE}`)
        const f = await selectOption(contracts, expiry, CURRENT_STRIKE, true)
        if (f) {
          console.log(`✅ FUTURE 1 trovata: ${f.label}`)
          future1Idx = curExpiryIdx + 1 + i
          return f
        }
      }
      console.log(`❌ FUTURE 1 non trovata`)
      return null
    })()

    // FUTURE 2
    const future2 = await (async () => {
      if (!future1 || future1Idx === -1) return null
      const nextExpiries = monthlyExpiries.slice(future1Idx + 1)
      for (const expiry of nextExpiries) {
        console.log(`➡️ Cercando FUTURE 2 su expiry ${expiry}, strike > ${future1.strike}`)
        const f = await selectOption(contracts, expiry, future1.strike, true)
        if (f) {
          console.log(`✅ FUTURE 2 trovata: ${f.label}`)
          return f
        }
      }
      console.log(`❌ FUTURE 2 non trovata`)
      return null
    })()

    // EARLIER 1
    const earlier1 = await (async () => {
      const earlierExpiries = monthlyExpiries.slice(0, curExpiryIdx).reverse()
      for (const expiry of earlierExpiries) {
        const f = await selectOption(contracts, expiry, CURRENT_STRIKE, false)
        if (f) return f
      }
      return null
    })()

    // EARLIER 2
    const earlier2 = await (async () => {
      if (!earlier1) return null
      const idx = monthlyExpiries.indexOf(earlier1.expiry)
      const nextExpiries = monthlyExpiries.slice(0, idx).reverse()
      for (const expiry of nextExpiries) {
        const f = await selectOption(contracts, expiry, earlier1.strike, false)
        if (f) return f
      }
      return null
    })()

    const spot = await fetchSpotAlphaVantage(UNDERLYING)

    return NextResponse.json([{
      ticker: UNDERLYING,
      spot,
      strike: CURRENT_STRIKE,
      expiry: CURRENT_EXPIRY,
      currentCallPrice: 0,
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
    console.error('❌ Errore route options:', err.message)
    return NextResponse.json([], { status: 500 })
  }
}
