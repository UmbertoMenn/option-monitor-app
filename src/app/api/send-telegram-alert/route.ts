import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { message } = await req.json();  // Riceve { message } dal client
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!
    const TELEGRAM_CHAT_IDS = process.env.TELEGRAM_CHAT_IDS!.split(',');  // Parse array da env (es. id1,id2)
    console.log('Tentativo invio Telegram server:', { message });  // Log Vercel

    // Loop per inviare a ogni CHAT_ID
    for (const chat_id of TELEGRAM_CHAT_IDS) {
      const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chat_id.trim(),  // Trim per sicurezza
          text: message  // Usa message ricevuto
        })
      });

      const result = await res.json();
      console.log(`Risposta Telegram per chat ${chat_id}:`, result);  // Log per ogni

      if (!result.ok) {
        console.error(`❌ Telegram API error per chat ${chat_id}:`, result);
        // Continua con altri, non blocca
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('❌ Errore send-telegram-alert:', err.message);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}