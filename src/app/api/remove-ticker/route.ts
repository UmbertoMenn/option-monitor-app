import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!)

export async function POST(req: Request) {
  try {
    const { ticker } = await req.json()
    if (!ticker) return NextResponse.json({ success: false }, { status: 400 })

    // Remove from 'tickers'
    const { error: tickersError } = await supabase.from('tickers').delete().eq('ticker', ticker)
    if (tickersError) throw tickersError

    // Remove positions for that ticker
    const { error: positionsError } = await supabase.from('positions').delete().eq('ticker', ticker)
    if (positionsError) throw positionsError

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('Errore remove-ticker:', err.message)
    return NextResponse.json({ success: false }, { status: 500 })
  }
}