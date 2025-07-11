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
    const json: { results?: any[]; next_url?: string } = await res.json()
    if (json.results) contracts.push(...json.results)
    if (json.next_url) {
      const nextCursor = new URL(json.next_url).searchParams.get('cursor')
      url = `${CONTRACTS_URL}?underlying_ticker=${UNDERLYING}&contract_type=call&limit=1000&cursor=${nextCursor}&apiKey=${POLYGON_API_KEY}`
    } else {
      url = null
    }
  }

  return contracts
}

export async function GET() {
  try {
    const contracts = await fetchFullChain()

    const result: Record<string, Record<string, number[]>> = {}

    for (const c of contracts) {
      const expiry = c.expiration_date
      if (!isThirdFriday(expiry)) continue

      const date = new Date(expiry)
      const year = date.getFullYear()
      const month = date.getMonth()

      if (year > 2030) continue

      const yearStr = year.toString()
      const monthStr = formatMonthName(month)

      if (!result[yearStr]) result[yearStr] = {}
      if (!result[yearStr][monthStr]) result[yearStr][monthStr] = []

      result[yearStr][monthStr].push(c.strike_price)
    }

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
