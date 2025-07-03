import { NextRequest, NextResponse } from 'next/server'
import yahooFinance from 'yahoo-finance2'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const ticker = searchParams.get('ticker')

  if (!ticker) {
    return NextResponse.json({ error: 'Ticker mancante' }, { status: 400 })
  }

  try {
    const quote = await yahooFinance.quote(ticker)

    return NextResponse.json({
      ticker: quote.symbol,
      lastPrice: quote.regularMarketPrice,
      bid: quote.bid,
      ask: quote.ask,
      volume: quote.regularMarketVolume,
    })
  } catch (err: any) {
    console.error('Errore Yahoo:', err.message)
    return NextResponse.json({ error: 'Ticker non trovato o errore Yahoo Finance' }, { status: 500 })
  }
}
