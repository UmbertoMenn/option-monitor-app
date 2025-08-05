// src/app/api/update-call/route.ts
import { createClient } from '../../../utils/supabase/server';  // Path che funziona
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';  // Forza dynamic per auth

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
  const supabase = await createClient();  // Crea client

  // Log cookies per debug
  const cookieStore = await cookies();
  console.log('Update-Call Route: Cookies:', cookieStore.getAll());

  try {
    // Controllo sessione
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    // Log sessione
    console.log('Update-Call Route: Sessione:', session ? 'Valida (user: ' + session.user.id + ')' : 'Null');
    console.log('Update-Call Route: Session Error:', sessionError ? sessionError.message : 'No error');
    console.log('Update-Call Route: Access Token:', session?.access_token || 'Null');

    if (sessionError || !session) {
      console.error('Sessione non valida in POST /api/update-call:', sessionError?.message || 'No error');
      return NextResponse.json({ success: false, error: 'Autenticazione richiesta', details: sessionError?.message || 'No details' }, { status: 401 });
    }
    const user = session.user;
    const userId = user.id;

    const body = await req.json()
    const { ticker, strike, expiry, current_bid, current_ask, current_last_trade_price } = body

    const normalizedExpiry = normalizeExpiry(expiry)

    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedExpiry)) {
      return NextResponse.json(
        { success: false, error: 'Formato data non valido' },
        { status: 400 }
      )
    }

    console.log('📤 Nuovo salvataggio per utente:', {
      user_id: userId,
      ticker,
      strike,
      normalizedExpiry,
      current_bid,
      current_ask,
      current_last_trade_price,
    })

    const { error } = await supabase.from('options').upsert([
      {
        user_id: userId,
        ticker,
        strike,
        expiry: normalizedExpiry,
        current_bid,
        current_ask,
        current_last_trade_price,
        created_at: new Date().toISOString()
      }
    ], { onConflict: 'user_id,ticker' })

    if (error) {
      console.error('❌ Errore Supabase UPSERT:', error.message)
      return NextResponse.json({ success: false, error: 'Errore upsert options', details: error.message }, { status: 500 })
    }

    // Pulisci alert-sent su update call, filtrando per user_id
    const { error: deleteErr } = await supabase.from('alerts_sent').delete()
      .eq('user_id', userId)
      .eq('ticker', ticker)
    if (deleteErr) console.error('Errore pulizia alert-sent su update-call:', deleteErr.message)

    console.log('✅ Riga aggiornata su Supabase per utente:', userId)
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('❌ Errore route update-call:', err.message)
    return NextResponse.json({ success: false, error: 'Errore interno', details: err.message }, { status: 500 })
  }
}