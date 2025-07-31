import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!)

export async function GET() {
  try {
    const { data, error } = await supabase.from('tickers').select('ticker')
    if (error) throw error
    return NextResponse.json(data.map(row => row.ticker))
  } catch (err: any) {
    console.error('Errore fetch tickers:', err.message)
    return NextResponse.json([], { status: 500 })
  }
}