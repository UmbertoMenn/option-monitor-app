import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge';

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

async function fetchSpot(ticker: string): Promise<{ price: number; change_percent: number }> {
  try {
    const res: Response = await fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${POLYGON_API_KEY}`);
    if (!res.ok) return { price: 0, change_percent: 0 };
    const json: any = await res.json();
    const price = json?.ticker?.lastTrade?.p || json?.ticker?.day?.c || json?.ticker?.prevDay?.c || 0;
    const change_percent = json?.ticker?.todaysChangePerc || 0;
    return { price, change_percent };
  } catch (err) {
    console.error(`Fallback spot error for ${ticker}:`, err);
    return { price: 0, change_percent: 0 };
  }
}

async function fetchSnapshot(symbol: string): Promise<{ bid: number; ask: number; last_trade_price: number } | null> {
  const match = /^O:([A-Z]+)\d+C\d+$/.exec(symbol);
  if (!match) return null;
  const underlying = match[1];
  const res: Response = await fetch(`https://api.polygon.io/v3/snapshot/options/${underlying}/${symbol}?apiKey=${POLYGON_API_KEY}`);
  if (!res.ok) return null;
  const json: any = await res.json();
  if (json.status !== "OK" || !json.results) return null;
  return {
    bid: json.results.last_quote?.bid ?? json.results.last_trade?.price ?? 0,
    ask: json.results.last_quote?.ask ?? json.results.last_trade?.price ?? 0,
    last_trade_price: json.results.last_trade?.price ?? 0
  };
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
  bid: number
  ask: number
  last_trade_price: number
  expiry: string
  symbol: string
}

interface OptionData {
  ticker: string
  spot: number
  strike: number
  expiry: string
  current_bid: number
  current_ask: number
  current_last_trade_price: number
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
      const { data: saved, error } = await supabase
        .from('options')  
        .select('*')
        .eq('ticker', ticker)
        .single();  // Usa .single() invece di order/limit, poiché singleton per ticker

      if (error || !saved) {
        console.warn(`No data for ${ticker}, skipping`)
        continue
      }

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
          current_bid: 0,
          current_ask: 0,
          current_last_trade_price: 0,
          earlier: [],
          future: [],
          invalid: true
        })
        continue
      }

      const spotData = await fetchSpot(ticker)
      const currentPrices = await fetchSnapshot(current.ticker) ?? { bid: 0, ask: 0, last_trade_price: 0 };
      const expiriesMap = buildExpiriesMap(contracts)
      const monthlyExpiries = Object.keys(expiriesMap).sort()
      const curIdx = monthlyExpiries.indexOf(CURRENT_EXPIRY)

      async function findOption(expiry: string, strikeRef: number, higher: boolean) {
        const strikes = expiriesMap[expiry]
        if (!strikes || strikes.length === 0) return null

        let selectedStrike: number | undefined

        if (higher) {
          selectedStrike = strikes.find((s: number) => s > strikeRef) ||
            strikes.find((s: number) => s === strikeRef) ||
            strikes[strikes.length - 1]
        } else {
          selectedStrike = [...strikes].reverse().find((s: number) => s < strikeRef) ||
            strikes.find((s: number) => s === strikeRef) ||
            strikes[0]
        }

        if (!selectedStrike) return null

        const match = contracts.find(c => c.expiration_date === expiry && c.strike_price === selectedStrike)
        if (!match) return null
        const prices = await fetchSnapshot(match.ticker);
        if (!prices) return null;
        return {
          label: `${formatExpiryLabel(expiry)} C${selectedStrike}`,
          strike: selectedStrike,
          bid: prices.bid,
          ask: prices.ask,
          last_trade_price: prices.last_trade_price,
          expiry,
          symbol: match.ticker
        } as OptionEntry
      }

      let future1: OptionEntry | null = null
      let future2: OptionEntry | null = null
      let earlier1: OptionEntry | null = null
      let earlier2: OptionEntry | null = null

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
        spot: spotData.price,
        strike: CURRENT_STRIKE,
        expiry: CURRENT_EXPIRY,
        current_bid: currentPrices.bid,
        current_ask: currentPrices.ask,
        current_last_trade_price: currentPrices.last_trade_price,
        future: [future1 || { label: 'OPZIONE INESISTENTE', strike: 0, bid: 0, ask: 0, last_trade_price: 0, expiry: '', symbol: '' },
        future2 || { label: 'OPZIONE INESISTENTE', strike: 0, bid: 0, ask: 0, last_trade_price: 0, expiry: '', symbol: '' }],
        earlier: [earlier1 || { label: 'OPZIONE INESISTENTE', strike: 0, bid: 0, ask: 0, last_trade_price: 0, expiry: '', symbol: '' },
        earlier2 || { label: 'OPZIONE INESISTENTE', strike: 0, bid: 0, ask: 0, last_trade_price: 0, expiry: '', symbol: '' }]
      })
    }

    // Nuovo: Calcola change_percents async prima di upsert
    const change_percents = await Promise.all(output.map(async (o) => {
      const spotData = await fetchSpot(o.ticker);
      return spotData.change_percent || 0;
    }));

    // Salva persistente per alert
    const { error: upsertError } = await supabase.from('options').upsert(
      output.map((o, index) => ({
        ticker: o.ticker,
        spot: o.spot,
        change_percent: change_percents[index],
        strike: o.strike,
        expiry: o.expiry,
        current_bid: o.current_bid,
        current_ask: o.current_ask,
        current_last_trade_price: o.current_last_trade_price,
        earlier: o.earlier,
        future: o.future,
        created_at: new Date().toISOString()
      })),
      { onConflict: 'ticker' }
    );
    if (upsertError) console.error('❌ Errore upsert /api/options:', upsertError.message);

    return NextResponse.json(output)
  } catch (err: any) {
    console.error('❌ Errore /api/options:', err.message)
    return NextResponse.json([], { status: 500 })
  }
}