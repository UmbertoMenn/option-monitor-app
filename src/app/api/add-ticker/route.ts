import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizeExpiry } from '../../../utils/functions'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!)

export async function POST(req: Request) {
    let ticker: string | undefined;
    try {
        const body = await req.json();
        ticker = body?.ticker?.toUpperCase();

        if (!ticker) {
            return NextResponse.json({ success: false, error: 'Ticker è obbligatorio' }, { status: 400 })
        }

        const now = new Date();
        let year = now.getFullYear();
        let month = now.getMonth() + 2;

        if (month > 11) {
            month -= 12;
            year += 1;
        }

        const nextExpiry = normalizeExpiry(`${year}-${String(month + 1).padStart(2, '0')}`);

        const { error } = await supabase.rpc('add_ticker_and_position', {
            p_currentCallPrice: 0,
            p_expiry: nextExpiry,
            p_strike: 100,
            p_ticker: ticker
        });

        if (error) {
            throw new Error(`Errore nel database: ${error.message}`);
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('Errore in add-ticker:', {
            ticker,
            message: err.message,
            stack: err.stack,
        });
        return NextResponse.json({ success: false, error: 'Errore interno del server' }, { status: 500 });
    }
}