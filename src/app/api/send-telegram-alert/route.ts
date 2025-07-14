import { NextRequest, NextResponse } from 'next/server'  // Aggiungi questo per fixare NextRequest

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID!
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`

export async function POST(req: NextRequest) {
  try {
    const { ticker, strike, spot, level } = await req.json()

    const message = `⚠️ ALERT\n\n📈 ${ticker}\nStrike: ${strike}\nSpot: ${spot}\nDelta < ${level * 100}%`

    console.log('Tentativo invio Telegram:', { message });  // Log server-side per Vercel

    const res = await fetch(TELEGRAM_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message
      })
    })

    const result = await res.json()
    console.log('Risposta Telegram:', result);  // Log response

    if (!result.ok) {
      console.error('❌ Telegram API error:', result);
      return NextResponse.json({ success: false }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('❌ Errore send-telegram-alert:', err.message)
    return NextResponse.json({ success: false }, { status: 500 })
  }
}