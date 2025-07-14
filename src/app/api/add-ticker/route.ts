import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getThirdFriday, normalizeExpiry } from '../../../utils/functions'  // Path corretto per src/utils/functions.ts

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!)

export async function POST(req: Request) {
  try {
    const { ticker } = await req.json()
    if (!ticker) return NextResponse.json({ success: false }, { status: 400 })

    // Aggiungi a 'tickers'
    const { error: tickersError } = await supabase.from('tickers').insert({ ticker: ticker.toUpperCase() })
    if (tickersError) throw tickersError

    // Crea entry default in 'positions' per nuovo ticker (expiry next third Friday, strike 100)
    const now = new Date()
    const nextMonth = now.getMonth() + 2  // Next-next per safe
    const nextExpiry = normalizeExpiry(`${now.getFullYear()}-${String(nextMonth).padStart(2, '0')}`)
    const { error: positionsError } = await supabase.from('positions').insert({
      ticker: ticker.toUpperCase(),
      strike: 100,
      expiry: nextExpiry,
      currentCallPrice: 0
    })
    if (positionsError) throw positionsError

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('Errore add-ticker:', err.message)
    return NextResponse.json({ success: false }, { status: 500 })
  }
}