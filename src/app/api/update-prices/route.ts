// src/app/api/update-prices/route.ts
import { createAdminClient } from '../../../utils/supabase/admin';  // Admin client per cron (bypassa RLS)
import { NextResponse } from 'next/server';
import { LRUCache } from 'lru-cache';
import { sendTelegramMessage } from '../../../utils/sendTelegram';
import { getSymbolFromExpiryStrike, isFattibile } from '../../../utils/functions';  // Importa da functions.ts

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';  // Forza dynamic per job cron-like

const POLYGON_API_KEY = process.env.POLYGON_API_KEY!;

// Inizializzazione cache (LRU per options)
const cache = new LRUCache<string, { bid: number; ask: number; last_trade_price: number }>({ max: 1000, ttl: 1000 * 5 });

// Tipi allineati con functions.ts (campi obbligatori)
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
  user_id: string;  // Per multi-user
}

interface SentAlerts {
  [user_id: string]: { [ticker: string]: { [level: string]: boolean } };
}

interface AlertsEnabled {
  [user_id: string]: { [ticker: string]: boolean };
}

// Funzione per parsare Json da Supabase a OptionEntry[] (con validation e fallback)
function parseOptionEntries(json: any): OptionEntry[] {
  if (!Array.isArray(json)) return [];
  return json.filter((entry: any) => {
    return typeof entry === 'object' &&
      typeof entry.label === 'string' &&
      typeof entry.bid === 'number' &&
      typeof entry.ask === 'number' &&
      typeof entry.last_trade_price === 'number' &&
      typeof entry.strike === 'number' &&
      typeof entry.expiry === 'string' &&
      typeof entry.symbol === 'string';
  }).map((entry: any) => ({
    label: entry.label,
    bid: entry.bid,
    ask: entry.ask,
    last_trade_price: entry.last_trade_price,
    strike: entry.strike,
    expiry: entry.expiry,
    symbol: entry.symbol,
  }));
}

// Funzione per formattare strike
function formatStrike(strike: number): string {
  return String(Math.round(strike * 1000)).padStart(8, '0');
}

// Funzione per check mercato (America/New_York, 4:00-16:00 ET lun-ven)
function isMarketOpen(): boolean {
  try {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = {
      timeZone: 'America/New_York',
      weekday: 'long',
      hour: 'numeric',
      hour12: false,
    };
    const formatter = new Intl.DateTimeFormat('en-US', options);
    const parts = formatter.formatToParts(now);
    let day = '';
    let hour = -1;
    for (const part of parts) {
      if (part.type === 'weekday') day = part.value;
      if (part.type === 'hour') hour = parseInt(part.value, 10);
    }
    if (day === '' || hour === -1) return false;
    const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const isWeekday = weekdays.includes(day);
    const isMarketHours = hour >= 4 && hour < 16;
    return isWeekday && isMarketHours;
  } catch (error) {
    console.error("Errore nel determinare l'orario di mercato:", error);
    return false;
  }
}

// Funzione unificata per fetch prezzi (con cache e batch, valori non-null)
async function fetchExternalPrices(symbols: string[], tickers: string[]): Promise<{
  optionsData: Record<string, { bid: number; ask: number; last_trade_price: number }>;
  spotsData: Record<string, { price: number; change_percent: number }>;
}> {
  const optionsData: Record<string, { bid: number; ask: number; last_trade_price: number }> = {};

  const pricesFetches = symbols.map(async (symbol) => {
    const cached = cache.get(symbol);
    if (cached) return cached;

    const match = /^O:([A-Z]+)\d+C\d+$/.exec(symbol);
    if (!match) return { bid: 0, ask: 0, last_trade_price: 0 };
    const ticker = match[1];
    const url = `https://api.polygon.io/v3/snapshot/options/${ticker}/${symbol}?apiKey=${POLYGON_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return { bid: 0, ask: 0, last_trade_price: 0 };
    const json = await res.json();
    if (json.status !== "OK" || !json.results) return { bid: 0, ask: 0, last_trade_price: 0 };
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
    optionsData[symbol] = pricesResults[index];
  });

  const spotsData: Record<string, { price: number; change_percent: number }> = {};
  if (tickers.length > 0) {
    const tickersQuery = tickers.join(',');
    const spotsUrl = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickersQuery}&apiKey=${POLYGON_API_KEY}`;
    const spotsResponse = await fetch(spotsUrl);
    if (spotsResponse.ok) {
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

// Handler GET per Vercel Cron
export async function GET() {
  const supabase = createAdminClient();

  if (!isMarketOpen()) {
    console.log('Mercato chiuso: skip update.');
    return NextResponse.json({ success: true, message: 'Market closed' });
  }

  try {
    // Fetch all options (multi-user)
    const { data: rawOptions, error: optionsError } = await supabase.from('options').select('*');
    if (optionsError) throw optionsError;

    // Usa parser per convertire Json a OptionEntry[]
    const allOptions: OptionData[] = rawOptions.map(row => ({
      ticker: row.ticker ?? '',
      spot: row.spot ?? 0,
      strike: row.strike ?? 0,
      expiry: row.expiry ?? '',
      current_bid: row.current_bid ?? 0,
      current_ask: row.current_ask ?? 0,
      current_last_trade_price: row.current_last_trade_price ?? 0,
      earlier: parseOptionEntries(row.earlier),
      future: parseOptionEntries(row.future),
      change_percent: row.change_percent ?? 0,
      user_id: row.user_id ?? '',
    }));

    const symbols = new Set<string>();
    const tickers = new Set<string>();
    allOptions.forEach((opt) => {
      tickers.add(opt.ticker);
      symbols.add(getSymbolFromExpiryStrike(opt.ticker, opt.expiry, opt.strike));
      opt.earlier.forEach((e) => symbols.add(e.symbol));
      opt.future.forEach((f) => symbols.add(f.symbol));
    });

    const { optionsData, spotsData } = await fetchExternalPrices(Array.from(symbols), Array.from(tickers));

    // Upsert prices_cache
    for (const [symbol, values] of Object.entries(optionsData)) {
      await supabase.from('prices_cache').upsert({
        key: symbol,
        type: 'option',
        bid: values.bid,
        ask: values.ask,
        last_trade_price: values.last_trade_price,
        updated_at: new Date().toISOString()
      }, { onConflict: 'key' });
    }

    for (const [ticker, values] of Object.entries(spotsData)) {
      await supabase.from('prices_cache').upsert({
        key: ticker,
        type: 'spot',
        price: values.price,
        change_percent: values.change_percent,
        updated_at: new Date().toISOString()
      }, { onConflict: 'key' });
    }

    // Update options
    for (const item of allOptions) {
      const spotData = spotsData[item.ticker] || { price: 0, change_percent: 0 };
      const currentSymbol = getSymbolFromExpiryStrike(item.ticker, item.expiry, item.strike);
      const currentData = optionsData[currentSymbol] || { bid: 0, ask: 0, last_trade_price: 0 };

      await supabase.from('options').update({
        spot: spotData.price,
        change_percent: spotData.change_percent,
        current_bid: currentData.bid,
        current_ask: currentData.ask,
        current_last_trade_price: currentData.last_trade_price,
        created_at: new Date().toISOString()
      }).eq('ticker', item.ticker).eq('user_id', item.user_id);
    }

    // Reload updated options with parser
    const { data: rawUpdatedOptions, error: reloadError } = await supabase.from('options').select('*');
    if (reloadError) throw reloadError;
    const updatedOptionsData: OptionData[] = rawUpdatedOptions.map(row => ({
      ticker: row.ticker ?? '',
      spot: row.spot ?? 0,
      strike: row.strike ?? 0,
      expiry: row.expiry ?? '',
      current_bid: row.current_bid ?? 0,
      current_ask: row.current_ask ?? 0,
      current_last_trade_price: row.current_last_trade_price ?? 0,
      earlier: parseOptionEntries(row.earlier),
      future: parseOptionEntries(row.future),
      change_percent: row.change_percent ?? 0,
      user_id: row.user_id ?? '',
    }));

    // Fetch alerts enabled
    const { data: alertsData, error: alertsError } = await supabase.from('alerts').select('*');
    if (alertsError) throw alertsError;
    const alertsEnabled: AlertsEnabled = alertsData.reduce((acc, { user_id, ticker, enabled }) => {
      if (user_id && ticker) {
        acc[user_id] = acc[user_id] || {};
        acc[user_id][ticker] = enabled;
      }
      return acc;
    }, {});

    // Fetch sent alerts
    const { data: sentData, error: sentError } = await supabase.from('alerts_sent').select('*');
    if (sentError) throw sentError;
    const sentAlerts: SentAlerts = sentData.reduce((acc, { user_id, ticker, level }) => {
      if (user_id && ticker) {
        acc[user_id] = acc[user_id] || {};
        acc[user_id][ticker] = acc[user_id][ticker] || {};
        acc[user_id][ticker][level] = true;
      }
      return acc;
    }, {});

    // pricesGrouped for isFattibile
    const pricesGrouped: PricesData = {};
    for (const [symbol, val] of Object.entries(optionsData)) {
      const match = /^O:([A-Z]+)\d+C\d+$/.exec(symbol);
      if (!match) continue;
      const ticker = match[1];
      pricesGrouped[ticker] = pricesGrouped[ticker] || {};
      pricesGrouped[ticker][symbol] = val;
    }

    // Verifica e invia alerts
    for (const item of updatedOptionsData) {
      const userAlerts = alertsEnabled[item.user_id] || {};
      if (!userAlerts[item.ticker] || item.spot <= 0) continue;

      const delta = ((item.strike - item.spot) / item.spot) * 100;
      const change_percent = item.change_percent;
      const changeSign = change_percent >= 0 ? '+' : '';
      const currentPrice = item.current_ask > 0 ? item.current_ask : (item.current_last_trade_price > 0 ? item.current_last_trade_price : 0);
      const [currYear, currMonth] = item.expiry.split('-');
      const monthNames = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
      const currMonthIndex = Number(currMonth) - 1;
      const currentLabel = `${monthNames[currMonthIndex] ?? ''} ${currYear.slice(2)} C${item.strike}`;
      const levels = [4, 3, 2, 1];
      const userSent = sentAlerts[item.user_id] || {};
      const tickerSent = userSent[item.ticker] || (userSent[item.ticker] = {});

      // Fetch chat_id
      const { data: userProfile, error: profileError } = await supabase.from('profiles').select('telegram_chat_id').eq('id', item.user_id).single();
      if (profileError || !userProfile?.telegram_chat_id) continue;
      const userChatId = userProfile.telegram_chat_id;

      // Alert Delta Basso
      for (const level of levels) {
        const f1 = item.future[0] ?? { label: 'N/A', bid: 0, ask: 0, last_trade_price: 0, strike: 0, expiry: '', symbol: '' };
        const f2 = item.future[1] ?? { label: 'N/A', bid: 0, ask: 0, last_trade_price: 0, strike: 0, expiry: '', symbol: '' };
        const f1Bid = pricesGrouped[item.ticker]?.[f1.symbol]?.bid ?? f1.bid;
        const f1Last = pricesGrouped[item.ticker]?.[f1.symbol]?.last_trade_price ?? f1.last_trade_price;
        const f1Price = f1Bid > 0 ? f1Bid : f1Last;
        const f2Bid = pricesGrouped[item.ticker]?.[f2.symbol]?.bid ?? f2.bid;
        const f2Last = pricesGrouped[item.ticker]?.[f2.symbol]?.last_trade_price ?? f2.last_trade_price;
        const f2Price = f2Bid > 0 ? f2Bid : f2Last;
        if (currentPrice > 0 && f1Price > 0 && f2Price > 0 && delta < level && !tickerSent[level]) {
          await supabase.from('alerts_sent').insert([{ ticker: item.ticker, level: level.toString(), user_id: item.user_id }]);
          tickerSent[level] = true;
          const f1Label = f1.label.replace(/C(\d+)/, '$1 CALL');
          const f2Label = f2.label.replace(/C(\d+)/, '$1 CALL');
          const currLabelFormatted = currentLabel.replace(/C(\d+)/, '$1 CALL');
          const alertMessage = `🔴 ${item.ticker} – DELTA: ${delta.toFixed(2)}% – Rollare\n\nSpot: ${item.spot} (${changeSign}${change_percent.toFixed(2)}%)\nStrike: ${item.strike}\nCurrent Call: ${currLabelFormatted} - ${currentPrice.toFixed(2)}\n\n#Future 1: ${f1Label} - ${f1Price.toFixed(2)}\n#Future 2: ${f2Label} - ${f2Price.toFixed(2)}`;
          sendTelegramMessage(alertMessage, userChatId);
        }
      }

      // Alert Fattibile Earlier
      const hasFattibileEarlier = item.earlier.some((opt) => isFattibile(opt, item, pricesGrouped));
      const e1 = item.earlier[0] ?? { label: 'N/A', bid: 0, ask: 0, last_trade_price: 0, strike: 0, expiry: '', symbol: '' };
      const e2 = item.earlier[1] ?? { label: 'N/A', bid: 0, ask: 0, last_trade_price: 0, strike: 0, expiry: '', symbol: '' };
      const e1Bid = pricesGrouped[item.ticker]?.[e1.symbol]?.bid ?? e1.bid;
      const e1Last = pricesGrouped[item.ticker]?.[e1.symbol]?.last_trade_price ?? e1.last_trade_price;
      const e1Price = e1Bid > 0 ? e1Bid : e1Last;
      const e2Bid = pricesGrouped[item.ticker]?.[e2.symbol]?.bid ?? e2.bid;
      const e2Last = pricesGrouped[item.ticker]?.[e2.symbol]?.last_trade_price ?? e2.last_trade_price;
      const e2Price = e2Bid > 0 ? e2Bid : e2Last;
      if (currentPrice > 0 && e1Price > 0 && e2Price > 0 && hasFattibileEarlier && !tickerSent['fattibile_high']) {
        await supabase.from('alerts_sent').insert([{ ticker: item.ticker, level: 'fattibile_high', user_id: item.user_id }]);
        tickerSent['fattibile_high'] = true;
        const e1Label = e1.label.replace(/C(\d+)/, '$1 CALL');
        const e2Label = e2.label.replace(/C(\d+)/, '$1 CALL');
        const currLabelFormatted = currentLabel.replace(/C(\d+)/, '$1 CALL');
        const alertMessage = `🟢 ${item.ticker} – DELTA: ${delta.toFixed(2)}% (Earlier fattibile disponibile)\n\nSpot: ${item.spot} (${changeSign}${change_percent.toFixed(2)}%)\nCurrent Call: ${currLabelFormatted} - ${currentPrice.toFixed(2)}\n\n#Earlier 1: ${e1Label} - ${e1Price.toFixed(2)}\n#Earlier 2: ${e2Label} - ${e2Price.toFixed(2)}`;
        sendTelegramMessage(alertMessage, userChatId);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Errore in update-prices:', err.message);
    return NextResponse.json({ error: 'Internal Server Error', details: err.message }, { status: 500 });
  }
}