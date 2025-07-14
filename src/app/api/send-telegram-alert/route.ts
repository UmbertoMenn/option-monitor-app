import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { message } = await req.json();  // Riceve { message } dal client
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID!
    console.log('Tentativo invio Telegram server:', { message });  // Log Vercel

    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message  // Usa message ricevuto
      })
    });

    const result = await res.json();
    console.log('Risposta Telegram:', result);  // Log Vercel

    if (!result.ok) {
      console.error('❌ Telegram API error:', result);
      return NextResponse.json({ success: false, error: result.description }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('❌ Errore send-telegram-alert:', err.message);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}