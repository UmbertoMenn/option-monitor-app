export async function sendTelegramMessage(message: string) {
  console.log('Invio Telegram client-side:', message);  // Log browser per debug
  try {
    const res = await fetch('/api/send-telegram-alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    const data = await res.json();
    if (!data.success) {
      console.error('Errore invio Telegram:', data.error);
    } else {
      console.log('Telegram inviato con successo');
    }
  } catch (err) {
    console.error('Errore fetch Telegram:', err);
  }
}