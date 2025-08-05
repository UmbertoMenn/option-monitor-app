// src/app/api/data/route.ts
import { createClient } from '../../../utils/supabase/server';  // Adatta path se necessario (es. '../../../utils/supabase/server')
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { LRUCache } from 'lru-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';  // Forza dynamic per auth e fetch esterni

const POLYGON_API_KEY = process.env.POLYGON_API_KEY!;

interface CacheData {
  symbol: string;
  bid: number;
  ask: number;
  last_trade_price: number;
}

const cache = new LRUCache<string, CacheData>({ max: 500, ttl: 1000 * 5 });  // Cache up to 500 items for 5 seconds

export async function GET(req: Request) {
  const supabase = await createClient();  // Crea client

  // Log cookies per debug
  const cookieStore = await cookies();
  console.log('Data Route: Cookies:', cookieStore.getAll());

  try {
    // Controllo sessione
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    // Log sessione
    console.log('Data Route: Sessione:', session ? 'Valida (user: ' + session.user.id + ')' : 'Null');
    console.log('Data Route: Session Error:', sessionError ? sessionError.message : 'No error');
    console.log('Data Route: Access Token:', session?.access_token || 'Null');

    if (sessionError || !session) {
      console.error('Sessione non valida in GET /api/data:', sessionError?.message || 'No error');
      return NextResponse.json({ prices: {}, spots: {} }, { status: 401 });
    }
    const user = session.user;

    const { searchParams } = new URL(req.url);
    let symbols = searchParams.get('symbols')?.split(',') || [];
    let tickers = searchParams.get('tickers')?.split(',') || [];

    console.log('Simboli richiesti:', symbols);
    console.log('Tickers richiesti:', tickers);

    if (symbols.length === 0 && tickers.length === 0) {
      return NextResponse.json({ error: 'Missing symbols or tickers' }, { status: 400 });
    }

    // Fetch tickers dell'utente per filtro multi-user da 'options'
    const { data: userOptions, error: optionsError } = await supabase.from('options').select('ticker').eq('user_id', user.id);
    if (optionsError) {
      console.error('Errore fetch user options:', optionsError.message);
      return NextResponse.json({ prices: {}, spots: {} }, { status: 500 });
    }
    const userTickers = userOptions.map(o => o.ticker);

    // Filtra tickers ai soli user's
    tickers = tickers.filter(t => userTickers.includes(t));
    if (tickers.length === 0) {
      console.warn('No valid tickers for user');
      return NextResponse.json({ prices: {}, spots: {} });
    }

    // Filtra symbols: solo quelli con ticker in userTickers
    symbols = symbols.filter(symbol => {
      const match = /^O:([A-Z]+)\d+C\d+$/.exec(symbol);
      return match && userTickers.includes(match[1]);
    });

    // Se tickers non forniti, derivarli da symbols (filtrati)
    if (tickers.length === 0) {
      tickers = [...new Set(symbols.map(symbol => {
        const match = /^O:([A-Z]+)\d+C\d+$/.exec(symbol);
        return match ? match[1] : null;
      }).filter((x): x is string => Boolean(x)))];

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