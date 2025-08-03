import { NextResponse } from 'next/server';
import { LRUCache } from 'lru-cache';
import { supabaseClient } from '../../../lib/supabaseClient'; // Adatta il path, usa client condiviso per auth

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
  try {
    // Controllo autenticazione utente
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const symbolsParam = searchParams.get('symbols');
    console.log('Simboli richiesti:', symbolsParam);

    if (!symbolsParam) {
      return NextResponse.json({ error: 'Missing symbols' }, { status: 400 });
    }

    let symbolList = symbolsParam.split(',');

    // Fetch tickers dell'utente per filtro multi-user
    const { data: userOptions, error: optionsError } = await supabaseClient.from('options').select('ticker').eq('user_id', user.id);
    if (optionsError) {
      console.error('Errore fetch user options:', optionsError);
      return NextResponse.json({}, { status: 500 });
    }
    const userTickers = userOptions.map(o => o.ticker);

    // Filtra symbolList ai soli con ticker in userTickers
    symbolList = symbolList.filter(symbol => {
      const match = /^O:([A-Z]+)\d+C\d+$/.exec(symbol);
      return match && userTickers.includes(match[1]);
    });

    if (symbolList.length === 0) {
      console.warn('No valid symbols for user');
      return NextResponse.json({});
    }

    const fetches = symbolList.map(async (symbol) => {
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

    const results = await Promise.all(fetches);

    const output: Record<string, { bid: number, ask: number, last_trade_price: number }> = {};
    symbolList.forEach((symbol, index) => {
      const data = results[index];
      if (data) {
        output[symbol] = { bid: data.bid, ask: data.ask, last_trade_price: data.last_trade_price };
      } else {
        output[symbol] = { bid: 0, ask: 0, last_trade_price: 0 };
      }
    });

    console.log('Risposta elaborata:', output);
    return NextResponse.json(output);
  } catch (err: any) {
    console.error('❌ Errore /api/full-prices:', err.message);
    return NextResponse.json({}, { status: 500 });
  }
}