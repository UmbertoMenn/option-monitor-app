// QUESTA ROUTE FETCHA I PREZZI DA POLYGON, AGGIORNA LA TABELLA prices_cache SU SUPABASE, AGGIORNA OPTIONS E VERIFICA GLI ALERT (UNICO JOB)
import { NextResponse } from 'next/server';
import { supabaseClient } from '../../../lib/supabaseClient'; // Adatta il path
import { Receiver } from '@upstash/qstash'; // Per verifica manuale signature in App Router
import { qstash } from '../../../lib/qstash'; // Il client QStash
import { LRUCache } from 'lru-cache'; // npm install lru-cache se non hai
import { sendTelegramMessage } from '../../../utils/sendTelegram'; // Importa la funzione Telegram
import { getSymbolFromExpiryStrike, isFattibile } from '../../../utils/functions'; // Importa le funzioni necessarie

const POLYGON_API_KEY = process.env.POLYGON_API_KEY!;

// Inizializza Receiver per verifica signature
const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!
});

// Tipi dal tuo codice (definiti qui per evitare errori)
interface PricesData {
  [ticker: string]: {
    [symbol: string]: {
      bid: number;
      ask: number;
      last_trade_price: number;
    };
  };
}

interface SpotsData {
  [ticker: string]: { price: number; change_percent: number };
}

interface OptionEntry {
  label: string;
  bid: number;
  ask: number;
  last_trade_price: number;
  strike: number;
  expiry: string;
  symbol: string;
}

interface OptionData {
  ticker: string;
  spot: number;
  strike: number;
  expiry: string;
  current_bid: number;
  current_ask: number;
  current_last_trade_price: number;
  earlier: OptionEntry[];
  future: OptionEntry[];
  change_percent: number;
}

interface SentAlerts {
  [ticker: string]: { [level: string]: boolean };
}

// Funzioni dal tuo page.tsx (non globali)
function formatStrike(strike: number): string {
  return String(Math.round(strike * 1000)).padStart(8, '0');
}

// Cache LRU come nel tuo data/route.ts
const cache = new LRUCache<string, { bid: number; ask: number; last_trade_price: number }>({ max: 500, ttl: 1000 * 5 });

// Funzione per fetchare prezzi (adattata dal tuo data/route.ts)
async function fetchExternalPrices(symbols: string[], tickers: string[]): Promise<{
  optionsData: Record<string, { bid: number; ask: number; last_trade_price: number }>;
  spotsData: Record<string, { price: number; change_percent: number }>;
}> {
  const optionsData: Record<string, { bid: number; ask: number; last_trade_price: number }> = {};

  // Fetch individuali per options (come nel tuo codice)
  const pricesFetches = symbols.map(async (symbol) => {
    const cached = cache.get(symbol);
    if (cached) {
      console.log(`Cache hit for ${symbol}`);
      return cached;
    }

    const match = /^O:([A-Z]+)\d+C\d+$/.exec(symbol);
    if (!match) {
      console.warn('❌ Simbolo non valido:', symbol);
      return { bid: 0, ask: 0, last_trade_price: 0 };
    }
    const ticker = match[1];
    const url = `https://api.polygon.io/v3/snapshot/options/${ticker}/${symbol}?apiKey=${POLYGON_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Errore fetch per ${symbol}: ${res.status}`);
      return { bid: 0, ask: 0, last_trade_price: 0 };
    }
    const json = await res.json();
    if (json.status !== "OK" || !json.results) {
      console.error(`Risposta non valida per ${symbol}:`, json);
      return { bid: 0, ask: 0, last_trade_price: 0 };
    }
    const data = {
      bid: json.results.last_quote?.bid ?? json.results.last_trade?.price ?? 0,
      ask: json.results.last_quote?.ask ?? json.results.last_trade?.price ?? 0,
      last_trade_price: json.results.last_trade?.price ?? 0
    };
    cache.set(symbol, data);
    return data;
  });

  const pricesResults = await Promise.all(pricesFetches);
  symbols.forEach((symbol, index) => {
    optionsData[symbol] = pricesResults[index] || { bid: 0, ask: 0, last_trade_price: 0 };
  });

  // Fetch batch per spot (come nel tuo codice)
  const spotsData: Record<string, { price: number; change_percent: number }> = {};
  if (tickers.length > 0) {
    const tickersQuery = tickers.join(',');
    const spotsUrl = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickersQuery}&apiKey=${POLYGON_API_KEY}`;
    const spotsResponse = await fetch(spotsUrl);
    if (!spotsResponse.ok) {
      console.error(`[SPOTS-ERROR] Status: ${spotsResponse.status}`);
    } else {
      const spotsJson = await spotsResponse.json();
      spotsJson.tickers?.forEach((result: any) => {
        const price = result.lastTrade?.p || result.day?.c || result.prevDay?.c || 0;
        const change_percent = result.todaysChangePerc || 0;
        spotsData[result.ticker] = { price, change_percent };
      });
    }
    tickers.forEach(t => {
      if (!(t in spotsData)) spotsData[t] = { price: 0, change_percent: 0 };
    });
  }

  return { optionsData, spotsData };
}

// Handler unico
async function updatePricesHandler(request: Request) {
  // Verifica manuale della signature per App Router
  const signature = request.headers.get('Upstash-Signature');
  const body = await request.text();
  if (!signature || !await receiver.verify({ signature, body })) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  try {
    // Raccogli symbols e tickers
    const { data: allOptions, error: optionsError } = await supabaseClient.from('options').select('*'); // Espandi select per includere tutti i campi necessari (spot, change_percent, etc.)
    if (optionsError) throw optionsError;

    const symbols = new Set<string>();
    const tickers = new Set<string>();
    allOptions.forEach((opt: OptionData) => {  // Tipo esplicito per opt
      tickers.add(opt.ticker);
      symbols.add(getSymbolFromExpiryStrike(opt.ticker, opt.expiry, opt.strike));
      opt.earlier.forEach((e: OptionEntry) => symbols.add(e.symbol)); // Tipo per e
      opt.future.forEach((f: OptionEntry) => symbols.add(f.symbol)); // Tipo per f
    });

    // Fetch dati
    const { optionsData, spotsData } = await fetchExternalPrices(Array.from(symbols), Array.from(tickers));

    // Upsert in prices_cache
    for (const [symbol, values] of Object.entries(optionsData) as [string, { bid: number; ask: number; last_trade_price: number }][]) {  // Tipo esplicito per entries
      await supabaseClient.from('prices_cache').upsert({
        key: symbol,
        type: 'option',
        bid: values.bid,
        ask: values.ask,
        last_trade_price: values.last_trade_price,
        updated_at: new Date().toISOString()
      }, { onConflict: 'key' });
    }

    for (const [ticker, values] of Object.entries(spotsData) as [string, { price: number; change_percent: number }][]) {  // Tipo esplicito per entries
      await supabaseClient.from('prices_cache').upsert({
        key: ticker,
        type: 'spot',
        price: values.price,
        change_percent: values.change_percent,
        updated_at: new Date().toISOString()
      }, { onConflict: 'key' });
    }

    // Aggiorna options con dati freschi
    for (const item of allOptions) {
      const ticker = item.ticker;
      const spotData = spotsData[ticker] || { price: 0, change_percent: 0 };
      const currentSymbol = getSymbolFromExpiryStrike(ticker, item.expiry, item.strike);
      const currentData = optionsData[currentSymbol] || { bid: 0, ask: 0, last_trade_price: 0 };

      const { error } = await supabaseClient.from('options').update({
        spot: spotData.price,
        change_percent: spotData.change_percent,
        current_bid: currentData.bid,
        current_ask: currentData.ask,
        current_last_trade_price: currentData.last_trade_price,
        created_at: new Date().toISOString()
      }).eq('ticker', ticker);

      if (error) console.error('Errore update options per ticker:', ticker, error);
    }

    // Ricarica options aggiornati
    const { data: updatedOptionsData, error: reloadError } = await supabaseClient.from('options').select('*');
    if (reloadError) throw reloadError;

    // Fetch alerts enabled
    const { data: alertsData, error: alertsError } = await supabaseClient.from('alerts').select('*');
    if (alertsError) throw alertsError;
    const alertsEnabled: { [ticker: string]: boolean } = alertsData.reduce((acc, { ticker, enabled }: { ticker: string; enabled: boolean }) => ({ ...acc, [ticker]: enabled }), {});

    // Fetch sent alerts
    const { data: sentData, error: sentError } = await supabaseClient.from('alerts_sent').select('*');
    if (sentError) throw sentError;
    const sentAlerts: SentAlerts = sentData.reduce((acc, { ticker, level }: { ticker: string; level: string }) => {
      if (!acc[ticker]) acc[ticker] = {};
      acc[ticker][level] = true;
      return acc;
    }, {});

    // Crea pricesGrouped per isFattibile (risolve il bug di tipo)
    const pricesGrouped: PricesData = {};
    for (const [symbol, val] of Object.entries(optionsData)) {
      const match = /^O:([A-Z]+)\d+C\d+$/.exec(symbol);
      if (!match) continue;
      const ticker = match[1];
      if (!pricesGrouped[ticker]) pricesGrouped[ticker] = {};
      pricesGrouped[ticker][symbol] = val;
    }

    // Verifica e invia alerts (logica completa da check-alerts, con tipi espliciti)
    for (const item of updatedOptionsData as OptionData[]) {  // Tipo esplicito per item
      if (!alertsEnabled[item.ticker] || item.spot <= 0) continue;
      const delta = ((item.strike - item.spot) / item.spot) * 100;
      const change_percent = item.change_percent || 0;
      const changeSign = change_percent >= 0 ? '+' : '';
      const currentPrice = item.current_ask > 0 ? item.current_ask : (item.current_last_trade_price > 0 ? item.current_last_trade_price : 0);
      const [currYear, currMonth] = item.expiry.split('-');
      const monthNames = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
      const currMonthIndex = Number(currMonth) - 1;
      const currentLabel = `${monthNames[currMonthIndex]} ${currYear.slice(2)} C${item.strike}`;
      const levels = [4, 3, 2, 1];
      if (!sentAlerts[item.ticker]) sentAlerts[item.ticker] = {};

      for (const level of levels) {
        const f1: OptionEntry = item.future[0] || { label: 'N/A', bid: 0, last_trade_price: 0, symbol: '', ask: 0, strike: 0, expiry: '' };
        const f2: OptionEntry = item.future[1] || { label: 'N/A', bid: 0, last_trade_price: 0, symbol: '', ask: 0, strike: 0, expiry: '' };
        const f1Bid = pricesGrouped[item.ticker]?.[f1.symbol]?.bid ?? f1.bid ?? 0;
        const f1Last = pricesGrouped[item.ticker]?.[f1.symbol]?.last_trade_price ?? f1.last_trade_price ?? 0;
        const f1Price = f1Bid > 0 ? f1Bid : f1Last;
        const f2Bid = pricesGrouped[item.ticker]?.[f2.symbol]?.bid ?? f2.bid ?? 0;
        const f2Last = pricesGrouped[item.ticker]?.[f2.symbol]?.last_trade_price ?? f2.last_trade_price ?? 0;
        const f2Price = f2Bid > 0 ? f2Bid : f2Last;
        if (currentPrice > 0 && f1Price > 0 && f2Price > 0 && delta < level && !sentAlerts[item.ticker][level]) {
          const { error } = await supabaseClient.from('alerts_sent').insert([{ ticker: item.ticker, level: level.toString() }]);
          if (error) console.error('Errore insert alert-sent:', error);
          else sentAlerts[item.ticker][level] = true;
          const f1Label = f1.label.replace(/C(\d+)/, '$1 CALL');
          const f2Label = f2.label.replace(/C(\d+)/, '$1 CALL');
          const currLabelFormatted = currentLabel.replace(/C(\d+)/, '$1 CALL');
          const alertMessage = `🔴 ${item.ticker} – DELTA: ${delta.toFixed(2)}% – Rollare\n\nSpot: ${item.spot}\nDelta Spot: ${item.spot} (${changeSign}${change_percent.toFixed(2)}%)\nStrike: ${item.strike}\nCurrent Call: ${currLabelFormatted} - ${currentPrice.toFixed(2)}\n\n#Future 1: ${f1Label} - ${f1Price.toFixed(2)}\n#Future 2: ${f2Label} - ${f2Price.toFixed(2)}`;
          sendTelegramMessage(alertMessage);
        }
      }

      const hasFattibileEarlier = item.earlier.some((opt: OptionEntry) => isFattibile(opt, item, pricesGrouped)); // Tipo esplicito per opt
      const e1: OptionEntry = item.earlier[0] || { label: 'N/A', bid: 0, last_trade_price: 0, symbol: '', ask: 0, strike: 0, expiry: '' };
      const e2: OptionEntry = item.earlier[1] || { label: 'N/A', bid: 0, last_trade_price: 0, symbol: '', ask: 0, strike: 0, expiry: '' };
      const e1Bid = pricesGrouped[item.ticker]?.[e1.symbol]?.bid ?? e1.bid ?? 0;
      const e1Last = pricesGrouped[item.ticker]?.[e1.symbol]?.last_trade_price ?? e1.last_trade_price ?? 0;
      const e1Price = e1Bid > 0 ? e1Bid : e1Last;
      const e2Bid = pricesGrouped[item.ticker]?.[e2.symbol]?.bid ?? e2.bid ?? 0;
      const e2Last = pricesGrouped[item.ticker]?.[e2.symbol]?.last_trade_price ?? e2.last_trade_price ?? 0;
      const e2Price = e2Bid > 0 ? e2Bid : e2Last;
      if (currentPrice > 0 && e1Price > 0 && e2Price > 0 && hasFattibileEarlier && !sentAlerts[item.ticker]['fattibile_high']) {
        const { error } = await supabaseClient.from('alerts_sent').insert([{ ticker: item.ticker, level: 'fattibile_high' }]);
        if (error) console.error('Errore insert alert-sent:', error);
        else sentAlerts[item.ticker]['fattibile_high'] = true;
        const e1Label = e1.label.replace(/C(\d+)/, '$1 CALL');
        const e2Label = e2.label.replace(/C(\d+)/, '$1 CALL');
        const currLabelFormatted = currentLabel.replace(/C(\d+)/, '$1 CALL');
        const alertMessage = `🟢 ${item.ticker} – DELTA: ${delta.toFixed(2)}% (Earlier fattibile disponibile)\n\nSpot: ${item.spot}\nDelta Spot: ${item.spot} (${changeSign}${change_percent.toFixed(2)}%)\nCurrent Call: ${currLabelFormatted} - ${currentPrice.toFixed(2)}\n\n#Earlier 1: ${e1Label} - ${e1Price.toFixed(2)}\n#Earlier 2: ${e2Label} - ${e2Price.toFixed(2)}`;
        sendTelegramMessage(alertMessage);
      }
    }

    // Ri-schedula il job successivo con delay 5 secondi
    await qstash.publishJSON({
      url: `${process.env.NEXT_PUBLIC_SITE_URL}/api/update-prices`,
      delay: '5s',
      headers: { 'Content-Type': 'application/json' }
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Errore in update-prices:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// Export
export const POST = updatePricesHandler; // Verifica manuale dentro, no wrapper