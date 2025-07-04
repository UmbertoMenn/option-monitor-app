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

function formatSymbol(expiry: string, strike: number) {
  const [y, m, d] = expiry.split('-')
  return `${UNDERLYING}${y.slice(2)}${m}${d}C${padStrike(strike)}`
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
  if (!res.ok) throw new Error('Errore fetch spot price')
  const json = await res.json()
  return parseFloat(json?.["Global Quote"]?.["05. price"] ?? '0')
}

export async function GET() {
  try {
    const contracts = await fetchContracts()
    contracts.sort((a: any, b: any) =>
      a.expiration_date.localeCompare(b.expiration_date) ||
      a.strike_price - b.strike_price
    )

    const currentOpra = formatSymbol(CURRENT_EXPIRY, CURRENT_STRIKE)
    const currentIndex = contracts.findIndex((c: any) => c.ticker === currentOpra)
    if (currentIndex < 0) throw new Error('Call attuale non trovata')

    const spot = await fetchSpotAlphaVantage(UNDERLYING)
    const currentBid = await fetchBid(currentOpra)
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

    // FUTURE 1: primo strike superiore a CURRENT_STRIKE con scadenza successiva
    const future1 = await (async () => {
      for (const expiry of uniqueExpiries.slice(curExpiryIdx + 1)) {
        const opt = await selectOption(expiry, CURRENT_STRIKE, true)
        if (opt) return opt
      }
      return null
    })()

    // FUTURE 2: primo strike superiore a future1.strike con scadenza > future1.expiry
    const future2 = await (async () => {
      if (!future1) return null
      const startIdx = uniqueExpiries.indexOf(future1.expiry) + 1
      for (const expiry of uniqueExpiries.slice(startIdx)) {
        const opt = await selectOption(expiry, future1.strike, true)
        if (opt) return opt
      }
      return null
    })()

    // EARLIER 1: primo strike inferiore con scadenza precedente
    const earlier1 = await (async () => {
      for (const expiry of uniqueExpiries.slice(0, curExpiryIdx).reverse()) {
        const opt = await selectOption(expiry, CURRENT_STRIKE, false)
        if (opt) return opt
      }
      return null
    })()

    // EARLIER 2: secondo strike inferiore con scadenza precedente
    const earlier2 = await (async () => {
      if (!earlier1) return null
      for (const expiry of uniqueExpiries.slice(0, curExpiryIdx).reverse()) {
        const opt = await selectOption(expiry, earlier1.strike, false)
        if (opt) return opt
      }
      return null
    })()

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
        earlier1 || { label: 'OPZIONE INESISTENTE', strike: 0, price: 0 },
        earlier2 || { label: 'OPZIONE INESISTENTE', strike: 0, price: 0 }
      ]
    }]

    return NextResponse.json(output)
  } catch (err: any) {
    console.error('Errore route options:', err.message)
    return NextResponse.json([], { status: 500 })
  }
}
