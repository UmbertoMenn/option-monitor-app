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
  return `${year}-${String(month).padStart(2, '0')}-15`
}

function normalizeExpiry(expiry: string): string {
  if (/^\d{4}-\d{2}$/.test(expiry)) {
    const [year, month] = expiry.split('-').map(Number)
    return getThirdFriday(year, month)
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
    return expiry
  }
  return expiry
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { ticker, strike, expiry, currentCallPrice } = body

    const normalizedExpiry = normalizeExpiry(expiry)

    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedExpiry)) {
      return NextResponse.json(
        { success: false, error: 'Formato data non valido' },
        { status: 400 }
      )
    }

    console.log('📤 Nuovo salvataggio:', {
      ticker,
      strike,
      normalizedExpiry,
      currentCallPrice,
    })

    const { error } = await supabase.from('positions').insert([
      {
        ticker,
        strike,
        expiry: normalizedExpiry,
        currentCallPrice,
        created_at: new Date().toISOString()
      }
    ])

    if (error) {
      console.error('❌ Errore Supabase INSERT:', error.message)
      return NextResponse.json({ success: false }, { status: 500 })
    }

    console.log('✅ Nuova riga inserita su Supabase')
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('❌ Errore route update-call:', err.message)
    return NextResponse.json({ success: false }, { status: 500 })
  }
}