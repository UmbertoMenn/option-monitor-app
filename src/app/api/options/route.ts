import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseAnonKey)

const POLYGON_API_KEY = process.env.POLYGON_API_KEY!
const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY!

const UNDERLYING = 'NVDA'
const CONTRACTS_URL = 'https://api.polygon.io/v3/reference/options/contracts'

function padStrike(strike: number) {
  return (strike * 1000).toFixed(0).padStart(8, '0')
}

function isThirdFriday(dateStr: string): boolean {
  const date = new Date(dateStr)
  if (date.getDay() !== 5) return false
  const day = date.getDate()
  return day >= 15 && day <= 21
}

function formatExpiryLabel(dateStr: string): string {
  const date = new Date(dateStr)
  const mesi = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC']
  const mese = mesi[date.getMonth()]
  const anno = date.getFullYear().toString().slice(2)
  return `${mese} ${anno}`
}

async function fetchContracts(): Promise<any[]> {
  let contracts: any[] = []
  let url: string | null = `${CONTRACTS_URL}?underlying_ticker=${UNDERLYING}&contract_type=call&limit=1000&apiKey=${POLYGON_API_KEY}`

  while (url) {
    const res: Response = await fetch(url)
    if (!res.ok) throw new Error(`Errore fetch contracts: ${res.status}`)

    const json: any = await res.json()
    if (json.results) contracts.push(...json.results)

    url = json.next_url ? `${json.next_url}&apiKey=${POLYGON_API_KEY}` : null
  }

  console.log(`✅ Contratti totali scaricati: ${contracts.length}`)
  return contracts
}

async function fetchBid(symbol: string): Promise<number | null> {
  const res: Response = await fetch(`https://api.polygon.io/v3/snapshot/options/${symbol}?apiKey=${POLYGON_API_KEY}`)
  if (!res.ok) return null
  const json: any = await res.json()
  return json?.results?.last_quote?.bid ?? null
}

async function fetchAsk(symbol: string): Promise<number | null> {
  const res: Response = await fetch(`https://api.polygon.io/v3/snapshot/options/${symbol}?apiKey=${POLYGON_API_KEY}`)
  if (!res.ok) return null
  const json: any = await res.json()
  return json?.results?.last_quote?.ask ?? null
}

async function fetchSpotAlphaVantage(ticker: string): Promise<number> {
  const res: Response = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${ALPHA_VANTAGE_API_KEY}`)
  if (!res.ok) throw new Error('Errore fetch spot')
  const json: any = await res.json()
  return parseFloat(json?.["Global Quote"]?.["05. price"] ?? '0')
}

function buildExpiriesMap(contracts: any[]) {
  const map: Record<string, number[]> = {}
  for (const c of contracts) {
    if (!isThirdFriday(c.expiration_date)) continue
    if (!map[c.expiration_date]) {
      map[c.expiration_date] = []
    }
    map[c.expiration_date].push(c.strike_price)
  }
  for (const exp in map) {
    map[exp].sort((a, b) => a - b)
  }
  return map
}

type OptionObj = {
  label: string
  strike: number
  price: number
  expiry: string
  ticker: string
}

export async function GET() {
  try {
    const { data: rows, error } = await supabase
      .from('positions')
      .select('*')
      .order('id', { ascending: false })
      .limit(1)

    if (error || !rows || rows.length === 0) throw new Error('Errore fetch positions da Supabase')

    const saved = rows[0]
    const CURRENT_EXPIRY = saved.expiry
    const CURRENT_STRIKE = saved.strike

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

    const spot = await fetchSpotAlphaVantage(UNDERLYING)
    const currentCallPrice = (await fetchAsk(current.ticker)) ?? 0

    const expiriesMap = buildExpiriesMap(contracts)
    const monthlyExpiries = Object.keys(expiriesMap).sort()
    const curIdx = monthlyExpiries.indexOf(CURRENT_EXPIRY)

    async function findOption(expiry: string, strikeRef: number, higher: boolean): Promise<OptionObj | null> {
      const strikes = expiriesMap[expiry]
      if (!strikes) return null
      const filtered = strikes.filter(s => higher ? s > strikeRef : s < strikeRef)
      if (!filtered.length) return null
      const selectedStrike = higher ? filtered[0] : filtered[filtered.length - 1]
      const match = contracts.find(c => c.expiration_date === expiry && c.strike_price === selectedStrike)
      if (!match) return null
      const bid = await fetchBid(match.ticker)
      return {
        label: `${formatExpiryLabel(expiry)} C${selectedStrike}`,
        strike: selectedStrike,
        price: bid ?? 0,
        expiry,
        ticker: match.ticker
      }
    }

    let future1: OptionObj | null = null,
        future2: OptionObj | null = null,
        earlier1: OptionObj | null = null,
        earlier2: OptionObj | null = null

    for (let i = curIdx + 1; i < monthlyExpiries.length; i++) {
      const f1 = await findOption(monthlyExpiries[i], CURRENT_STRIKE, true)
      if (f1) {
        future1 = f1
        break
      }
    }

    if (future1) {
      const idx1 = monthlyExpiries.indexOf(future1.expiry)
      for (let i = idx1 + 1; i < monthlyExpiries.length; i++) {
        const f2 = await findOption(monthlyExpiries[i], future1.strike, true)
        if (f2) {
          future2 = f2
          break
        }
      }
    }

    for (let i = curIdx - 1; i >= 0; i--) {
      const e1 = await findOption(monthlyExpiries[i], CURRENT_STRIKE, false)
      if (e1) {
        earlier1 = e1
        break
      }
    }

    if (earlier1) {
      const idx1 = monthlyExpiries.indexOf(earlier1.expiry)
      for (let i = idx1 - 1; i >= 0; i--) {
        const e2 = await findOption(monthlyExpiries[i], earlier1.strike, false)
        if (e2) {
          earlier2 = e2
          break
        }
      }
    }

    const output = [{
      ticker: UNDERLYING,
      spot,
      strike: CURRENT_STRIKE,
      expiry: CURRENT_EXPIRY,
      currentCallPrice,
      future: [
        future1 || { label: 'OPZIONE INESISTENTE', strike: 0, price: 0, expiry: '', ticker: '' },
        future2 || { label: 'OPZIONE INESISTENTE', strike: 0, price: 0, expiry: '', ticker: '' }
      ],
      earlier: [
        earlier1 || { label: 'OPZIONE INESISTENTE', strike: 0, price: 0, expiry: '', ticker: '' },
        earlier2 || { label: 'OPZIONE INESISTENTE', strike: 0, price: 0, expiry: '', ticker: '' }
      ]
    }]

    return NextResponse.json(output)
  } catch (err: any) {
    console.error('❌ Errore route options:', err.message)
    return NextResponse.json([], { status: 500 })
  }
}
