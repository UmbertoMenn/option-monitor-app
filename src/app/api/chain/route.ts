import { NextResponse } from 'next/server'

const POLYGON_API_KEY = process.env.POLYGON_API_KEY!
const CONTRACTS_URL = 'https://api.polygon.io/v3/reference/options/contracts'
const UNDERLYING = 'NVDA'

function isThirdFriday(dateStr: string): boolean {
  const date = new Date(dateStr)
  return date.getDay() === 5 && date.getDate() >= 15 && date.getDate() <= 21
}

function formatMonthName(month: number): string {
  const mesi = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC']
  return mesi[month]
}

async function fetchFullChain(): Promise<any[]> {
  let contracts: any[] = []
  let url: string | null = `${CONTRACTS_URL}?underlying_ticker=${UNDERLYING}&contract_type=call&limit=1000&apiKey=${POLYGON_API_KEY}`

  while (url) {
    const res: Response = await fetch(url)
    if (!res.ok) throw new Error(`Errore fetch chain: ${res.status}`)
    const json: any = await res.json()
    if (json.results) contracts.push(...json.results)
    url = json.next_url ? `${json.next_url}&apiKey=${POLYGON_API_KEY}` : null
  }

  return contracts
}

async function fetchSpot(): Promise<number> {
  const res: Response = await fetch(`https://api.polygon.io/v2/last/trade/stocks/${UNDERLYING}?apiKey=${POLYGON_API_KEY}`)
  if (!res.ok) throw new Error('Errore fetch spot')
  const json: any = await res.json()
  return json?.last?.price ?? 0
}

export async function GET() {
  try {
    const contracts = await fetchFullChain()
    const spot = await fetchSpot()

    const minStrike = spot * 0.5
    const maxStrike = spot * 2.0

    const result: Record<string, Record<string, number[]>> = {}

    for (const c of contracts) {
      const expiry = c.expiration_date
      if (!isThirdFriday(expiry)) continue

      const date = new Date(expiry)
      const year = date.getFullYear()
      const month = date.getMonth()

      if (year > 2027) continue
      if (c.strike_price < minStrike || c.strike_price > maxStrike) continue

      const yearStr = year.toString()
      const monthStr = formatMonthName(month)

      if (!result[yearStr]) result[yearStr] = {}
      if (!result[yearStr][monthStr]) result[yearStr][monthStr] = []

      result[yearStr][monthStr].push(c.strike_price)
    }

    // Ordina gli strike
    for (const year of Object.keys(result)) {
      for (const month of Object.keys(result[year])) {
        result[year][month].sort((a, b) => a - b)
      }
    }

    return NextResponse.json(result)
  } catch (err: any) {
    console.error('❌ Errore route /api/chain:', err.message)
    return NextResponse.json({}, { status: 500 })
  }
}
