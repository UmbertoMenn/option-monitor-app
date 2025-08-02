import { NextResponse } from 'next/server';
import { LRUCache } from 'lru-cache';

export const runtime = 'edge';

const POLYGON_API_KEY = process.env.POLYGON_API_KEY!;

interface CacheData {
  symbol: string;
  bid: number;
  ask: number;
  last_trade_price: number;
}

const cache = new LRUCache<string, CacheData>({ max: 500, ttl: 1000 * 5 });  // Cache up to 500 items for 5 seconds

export async function GET(req: Request) {
    // Aggiunto: Check orario (13:00-22:00 CEST = 11:00-20:00 UTC)
    const currentHourUTC = new Date().getUTCHours();
    if (currentHourUTC < 11 || currentHourUTC > 20) {
        console.log('Fuori orario (13:00-22:00 CEST): richiesta API saltata.');
        return NextResponse.json({ prices: {}, spots: {}, message: 'Fuori orario operativo' }, { status: 200 });
    }

    try {
        const { searchParams } = new URL(req.url);
        const symbols = searchParams.get('symbols')?.split(',') || [];
        let tickers = searchParams.get('tickers')?.split(',') || [];

        console.log('Simboli richiesti:', symbols);
        console.log('Tickers richiesti:', tickers);

        if (symbols.length === 0 && tickers.length === 0) {
            return NextResponse.json({ error: 'Missing symbols or tickers' }, { status: 400 });
        }

        // Se tickers non forniti, derivarli da symbols (es. estrai ticker da O:TICKER...)
        if (tickers.length === 0) {
            tickers = [...new Set(symbols.map(symbol => {
                const match = /^O:([A-Z]+)\d+C\d+$/.exec(symbol);
                return match ? match[1] : null;
            }).filter((x): x is string => Boolean(x)))];  // Type guard per rimuovere null
        }

        // Logica per full-prices (prezzi opzioni)
        const pricesFetches = symbols.map(async (symbol) => {
            const cached = cache.get(symbol);
            if (cached) {
                console.log(`Cache hit for ${symbol}`);
                return cached;
            }

            const match = /^O:([A-Z]+)\d+C\d+$/.exec(symbol);
            if (!match) {
                console.warn('❌ Simbolo non valido:', symbol);
                return null;
            }
            const ticker = match[1];
            const url = `https://api.polygon.io/v3/snapshot/options/${ticker}/${symbol}?apiKey=${POLYGON_API_KEY}`;
            const res = await fetch(url);
            if (!res.ok) {
                console.error(`Errore fetch per ${symbol}: ${res.status}`);
                return null;
            }
            const json = await res.json();
            if (json.status !== "OK" || !json.results) {
                console.error(`Risposta non valida per ${symbol}:`, json);
                return null;
            }
            const data: CacheData = {
                symbol,
                bid: json.results.last_quote?.bid ?? json.results.last_trade?.price ?? 0,
                ask: json.results.last_quote?.ask ?? json.results.last_trade?.price ?? 0,
                last_trade_price: json.results.last_trade?.price ?? 0
            };
            cache.set(symbol, data);
            return data;
        });

        const pricesResults = await Promise.all(pricesFetches);
        const pricesOutput: Record<string, { bid: number, ask: number, last_trade_price: number }> = {};
        symbols.forEach((symbol, index) => {
            const data = pricesResults[index];
            if (data) {
                pricesOutput[symbol] = { bid: data.bid, ask: data.ask, last_trade_price: data.last_trade_price };
            } else {
                pricesOutput[symbol] = { bid: 0, ask: 0, last_trade_price: 0 };
            }
        });

        // Logica per spots (prezzi spot azioni)
        const polygonUrl = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickers.join(',')}&apiKey=${POLYGON_API_KEY}`;
        const spotsRes = await fetch(polygonUrl);
        if (!spotsRes.ok) {
            console.error(`[SPOTS-DEBUG-ERROR] Status: ${spotsRes.status}`);
            return NextResponse.json({ prices: pricesOutput, spots: {} }, { status: 500 });
        }
        const spotsJson = await spotsRes.json();
        const spotsOutput: Record<string, { price: number; change_percent: number }> = {};
        spotsJson.tickers?.forEach((result: any) => {
            const price = result.lastTrade?.p || result.day?.c || result.prevDay?.c || 0;
            const change_percent = result.todaysChangePerc || 0;
            spotsOutput[result.ticker] = { price, change_percent };
        });
        tickers.forEach(t => {
            if (!(t in spotsOutput)) spotsOutput[t] = { price: 0, change_percent: 0 };
        });

        // Risposta combinata
        console.log('Risposta elaborata:', { prices: pricesOutput, spots: spotsOutput });
        return NextResponse.json({ prices: pricesOutput, spots: spotsOutput });
    } catch (err: any) {
        console.error('❌ Errore /api/data:', err.message);
        return NextResponse.json({ prices: {}, spots: {} }, { status: 500 });
    }
}