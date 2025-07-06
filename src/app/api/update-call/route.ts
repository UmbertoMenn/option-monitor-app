import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
)

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { ticker, strike, expiry, currentCallPrice } = body

    console.log('📤 Ricevuto per salvataggio:', { ticker, strike, expiry, currentCallPrice })

    const { error } = await supabase
      .from('positions')
      .insert([{ ticker, strike, expiry, currentCallPrice }])

    if (error) {
      console.error('❌ Errore Supabase INSERT:', error.message)
      return NextResponse.json({ success: false }, { status: 500 })
    }

    console.log('✅ Riga salvata su Supabase')
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('❌ Errore route update-call:', err.message)
    return NextResponse.json({ success: false }, { status: 500 })
  }
}
