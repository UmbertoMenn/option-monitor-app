import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { normalizeExpiry } from '../../../utils/functions';  // Assumi esista, dal tuo codice

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

export async function POST(req: Request) {
    let ticker: string | undefined;
    try {
        const body = await req.json();
        ticker = body?.ticker?.toUpperCase();

        if (!ticker) {
            return NextResponse.json({ success: false, error: 'Ticker è obbligatorio' }, { status: 400 });
        }

        // Validazione ticker: solo lettere uppercase, 1-5 caratteri (tipico per OPRA tickers come NVDA, AMZN)
        if (!/^[A-Z]{1,5}$/.test(ticker)) {
            return NextResponse.json({ success: false, error: 'Ticker non valido: deve essere 1-5 lettere maiuscole (es. NVDA, AMZN)' }, { status: 400 });
        }

        const now = new Date();
        let year = now.getFullYear();
        let month = now.getMonth() + 2;
        if (month > 11) {
            month -= 12;
            year += 1;
        }
        const nextExpiry = normalizeExpiry(`${year}-${String(month + 1).padStart(2, '0')}`);

        // Upsert in 'options' con valori non null espliciti (sovrascrive se esiste già)
        const { error: optionsError } = await supabase.from('options').upsert([
            { 
                ticker, 
                spot: 0,  // Valore default non null
                strike: 100,  // Valore default non null
                expiry: nextExpiry, 
                current_bid: 0,
                current_ask: 0,
                current_last_trade_price: 0,
                earlier: [],
                future: []
            }
        ], { onConflict: 'ticker' });
        if (optionsError) {
            console.error('Errore upsert options:', optionsError.message);
            throw new Error(`Errore upsert options: ${optionsError.message}`);
        }

        // Insert/Upsert in tickers (evita duplicati)
        const { error: tickError } = await supabase.from('tickers').upsert([{ ticker }], { onConflict: 'ticker' });
        if (tickError) {
            console.error('Errore upsert tickers:', tickError.message);
            throw new Error(`Errore upsert tickers: ${tickError.message}`);
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('Errore in add-ticker:', { ticker, message: err.message, stack: err.stack });
        return NextResponse.json({ success: false, error: 'Errore interno del server' }, { status: 500 });
    }
}