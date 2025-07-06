// ✅ /api/update-call/route.ts
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
)

function getThirdFriday(year: number, month: number): string {
  let count = 0
  for (let day = 1; day <= 31; day++) {
    const date = new Date(year, month - 1, day)
    if (date.getMonth() !== month - 1) break
    if (date.getDay() === 5) {
      count++
      if (count === 3) return date.toISOString().split('T')[0]
    }
  }
  return new Date(year, month - 1, 15).toISOString().split('T')[0]
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { ticker, strike, expiry, currentCallPrice } = body

    // ✅ Normalizza la data se è solo YYYY-MM
    let normalizedExpiry = expiry
    if (expiry.length === 7) {
      const [year, month] = expiry.split('-').map(Number)
      normalizedExpiry = getThirdFriday(year, month)
    }

    console.log('📤 Salvataggio su Supabase:', { ticker, strike, expiry: normalizedExpiry, currentCallPrice })

    const { error } = await supabase
      .from('positions')
      .insert([{ ticker, strike, expiry: normalizedExpiry, currentCallPrice }])

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
