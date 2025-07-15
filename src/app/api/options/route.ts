import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!)

const POLYGON_API_KEY = process.env.POLYGON_API_KEY!
const CONTRACTS_URL = 'https://api.polygon.io/v3/reference/options/contracts'

function isThirdFriday(dateStr: string): boolean {
  const date = new Date(dateStr)
  return date.getDay() === 5 && date.getDate() >= 15 && date.getDate() <= 21
}

function formatExpiryLabel(dateStr: string): string {
  const date = new Date(dateStr)
  const mesi = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC']
  const mese = mesi[date.getMonth()]
  const anno = date.getFullYear().toString().slice(2)
  return `${mese} ${anno}`
}

function normalizeExpiry(expiry: string): string {
  if (expiry.length === 7) {
    const [year, month] = expiry.split('-').map(Number)
    return getThirdFriday(year, month).toISOString().split('T')[0]
  }
  return expiry
}

function getThirdFriday(year: number, month: number): Date {
  const firstDay = new Date(year, month - 1, 1)
  const firstFriday = new Date(firstDay)
  while (firstFriday.getDay() !== 5) firstFriday.setDate(firstFriday.getDate() + 1)
  firstFriday.setDate(firstFriday.getDate() + 14)
  return firstFriday
}

async function fetchContracts(ticker: string): Promise<any[]> {
  let contracts: any[] = []
  let url: string | null = `${CONTRACTS_URL}?underlying_ticker=${ticker}&contract_type=call&limit=1000&apiKey=${POLYGON_API_KEY}`

  while (url) {
    const res: Response = await fetch(url)
    if (!res.ok) throw new Error(`Errore fetch contracts per ${ticker}: ${res.status}`)
    const json: any = await res.json()
    if (json.results) contracts.push(...json.results)
    url = json.next_url ? `${json.next_url}&apiKey=${POLYGON_API_KEY}` : null
  }
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

async function fetchSpot(ticker: string): Promise<number> {
  const res: Response = await fetch(`https://api.polygon.io/v2/last/trade/${ticker}?apiKey=${POLYGON_API_KEY}`)
  if (!res.ok) throw new Error(`Errore fetch spot per ${ticker}`)
  const json: any = await res.json()
  return json?.results?.p ?? 0
}

function buildExpiriesMap(contracts: any[]) {
  const map: Record<string, number[]> = {}
  for (const c of contracts) {
    if (!isThirdFriday(c.expiration_date)) continue
    if (!map[c.expiration_date]) map[c.expiration_date] = []
    map[c.expiration_date].push(c.strike_price)
  }
  for (const exp in map) map[exp].sort((a, b) => a - b)
  return map
}

interface OptionEntry {
  label: string
  strike: number
  price: number
  expiry: string
  symbol: string
}

interface OptionData {
  ticker: string
  spot: number
  strike: number
  expiry: string
  currentCallPrice: number
  future: OptionEntry[]
  earlier: OptionEntry[]
  invalid?: boolean
}

export async function GET() {
  try {
    const { data: tickersData, error: tickersError } = await supabase.from('tickers').select('ticker')
    if (tickersError || !tickersData) throw new Error('Errore fetch tickers')
    const tickers = tickersData.map(row => row.ticker)

    const output: OptionData[] = []

    for (const ticker of tickers) {
      const { data: rows, error } = await supabase
        .from('positions')
        .select('*')
        .eq('ticker', ticker)
        .order('id', { ascending: false })
        .limit(1)

      if (error || !rows || rows.length === 0) {
        console.warn(`No position for ${ticker}, skipping`)
        continue
      }

      const saved = rows[0]
      const CURRENT_EXPIRY = normalizeExpiry(saved.expiry)
      const CURRENT_STRIKE = saved.strike

      const contracts = await fetchContracts(ticker)
      contracts.sort((a, b) => a.expiration_date.localeCompare(b.expiration_date) || a.strike_price - b.strike_price)

      const current = contracts.find(c =>
        isThirdFriday(c.expiration_date) &&
        Math.abs(c.strike_price - CURRENT_STRIKE) < 0.01 &&
        normalizeExpiry(c.expiration_date) === CURRENT_EXPIRY
      )

      if (!current) {
        output.push({
          ticker,
          spot: 0,
          strike: CURRENT_STRIKE,
          expiry: CURRENT_EXPIRY,
          currentCallPrice: 0,
          earlier: [],
          future: [],
          invalid: true
        })
        continue
      }

      const spot = await fetchSpot(ticker)
      const currentCallPrice = (await fetchAsk(current.ticker)) ?? 0

      const expiriesMap = buildExpiriesMap(contracts)
      const monthlyExpiries = Object.keys(expiriesMap).sort()
      const curIdx = monthlyExpiries.indexOf(CURRENT_EXPIRY)

      async function findOption(expiry: string, strikeRef: number, higher: boolean) {
        const strikes = expiriesMap[expiry]
        if (!strikes || strikes.length === 0) return null
        
        let selectedStrike: number | undefined
        
        if (higher) {
          // Preferisci > strikeRef, poi esatto, poi max disponibile
          selectedStrike = strikes.find((s: number) => s > strikeRef) ||
                           strikes.find((s: number) => s === strikeRef) ||
                           strikes[strikes.length - 1]
        } else {
          // Preferisci < strikeRef (dal max descending), poi esatto, poi min disponibile
          selectedStrike = [...strikes].reverse().find((s: number) => s < strikeRef) ||
                           strikes.find((s: number) => s === strikeRef) ||
                           strikes[0]
        }
        
        if (!selectedStrike) return null
        
        const match = contracts.find(c => c.expiration_date === expiry && c.strike_price === selectedStrike)
        if (!match) return null
        const bid = await fetchBid(match.ticker)
        return {
          label: `${formatExpiryLabel(expiry)} C${selectedStrike}`,
          strike: selectedStrike,
          price: bid ?? 0,
          expiry,
          symbol: match.ticker
        } as OptionEntry
      }

      let future1: OptionEntry | null = null
      let future2: OptionEntry | null = null
      let earlier1: OptionEntry | null = null
      let earlier2: OptionEntry | null = null

      // Per future: cerca la prima scadenza successiva con fallback
      for (let i = curIdx + 1; i < monthlyExpiries.length; i++) {
        const f1 = await findOption(monthlyExpiries[i], CURRENT_STRIKE, true)
        if (f1) { future1 = f1; break }
      }
      if (future1) {
        const idx1 = monthlyExpiries.indexOf(future1.expiry)
        for (let i = idx1 + 1; i < monthlyExpiries.length; i++) {
          const f2 = await findOption(monthlyExpiries[i], future1.strike, true)
          if (f2) { future2 = f2; break }
        }
      }

      // Per earlier: cerca la prima scadenza precedente con fallback
      for (let i = curIdx - 1; i >= 0; i--) {
        const e1 = await findOption(monthlyExpiries[i], CURRENT_STRIKE, false)
        if (e1) { earlier1 = e1; break }
      }
      if (earlier1) {
        const idx1 = monthlyExpiries.indexOf(earlier1.expiry)
        for (let i = idx1 - 1; i >= 0; i--) {
          const e2 = await findOption(monthlyExpiries[i], earlier1.strike, false)
          if (e2) { earlier2 = e2; break }
        }
      }

      output.push({
        ticker,
        spot,
        strike: CURRENT_STRIKE,
        expiry: CURRENT_EXPIRY,
        currentCallPrice,
        future: [future1 || { label: 'OPZIONE INESISTENTE', strike: 0, price: 0, expiry: '', symbol: '' },
                 future2 || { label: 'OPZIONE INESISTENTE', strike: 0, price: 0, expiry: '', symbol: '' }],
        earlier: [earlier1 || { label: 'OPZIONE INESISTENTE', strike: 0, price: 0, expiry: '', symbol: '' },
                  earlier2 || { label: 'OPZIONE INESISTENTE', strike: 0, price: 0, expiry: '', symbol: '' }]
      })
    }
    for (const item of output) {
      const { data: stateData, error: stateError } = await supabase
        .from('option_states')
        .select('state')
        .eq('ticker', item.ticker)
        .single();

      if (!stateError && stateData) {
        item.future = stateData.state.future || item.future;
        item.earlier = stateData.state.earlier || item.earlier;
      }
    }
    return NextResponse.json(output)
  } catch (err: any) {
    console.error('❌ Errore /api/options:', err.message)
    return NextResponse.json([], { status: 500 })
  }
}