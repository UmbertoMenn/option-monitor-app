import { NextRequest, NextResponse } from 'next/server'
import axios from 'axios'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const ticker = searchParams.get('ticker')
  const apiKey = process.env.POLYGON_API_KEY

  if (!ticker || !apiKey) {
    return NextResponse.json({ error: 'Ticker o API key mancante' }, { status: 400 })
  }

  try {
    const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${apiKey}`
    const res = await axios.get(url)
    const snap = res.data.ticker

    return NextResponse.json({
      ticker: snap.ticker,
      lastPrice: snap.lastTrade.p,
      bid: snap.lastQuote.bp,
      ask: snap.lastQuote.ap,
      volume: snap.day.v,
    })
  } catch (err: any) {
    console.error('Errore Polygon:', err.response?.data || err.message)
    return NextResponse.json({ error: 'Ticker non trovato o errore Polygon' }, { status: 500 })
  }
}
