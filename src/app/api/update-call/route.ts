// ✅ update-call.ts (API route)
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabase = createClient(
  'https://nzduzobajwbufsfieujm.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56ZHV6b2JhandidWZzZmlldWptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE3MDQwNTksImV4cCI6MjA2NzI4MDA1OX0.c4A5ipwx5AXzuCPH7Au8Czr_nrh4hLwerFwU51HlkTs'
)

export async function POST(req: Request) {
  const body = await req.json()
  const { ticker, strike, expiry, currentCallPrice } = body

  const { error } = await supabase
    .from('positions')
    .upsert({ id: 1, ticker, strike, expiry, currentCallPrice })

  if (error) {
    console.error('Errore Supabase INSERT/UPSERT:', error.message)
    return NextResponse.json({ success: false }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function GET() {
  const { data, error } = await supabase.from('positions').select('*').eq('id', 1).single()

  if (error || !data) {
    console.error('Errore Supabase SELECT:', error?.message)
    return NextResponse.json({ success: false }, { status: 500 })
  }

  return NextResponse.json(data)
}
