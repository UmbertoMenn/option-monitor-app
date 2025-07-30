import { createClient } from '@supabase/supabase-js';
import { sendTelegramMessage } from '../../../utils/sendTelegram';
import { getSymbolFromExpiryStrike, isFattibile, OptionEntry, OptionData, PricesData } from '../../../utils/functions';

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_ANON_KEY as string;
const supabase = createClient(supabaseUrl, supabaseKey);

interface SpotsData {
    [ticker: string]: { price: number; change_percent: number };
}

interface SentAlerts {
    [ticker: string]: { [level: string]: boolean };
}

function getThirdFriday(year: number, monthIndex: number): string {
  let count = 0;
  for (let day = 1; day <= 31; day++) {
    const date = new Date(year, monthIndex, day);
    if (date.getMonth() !== monthIndex) break;
    if (date.getDay() === 5) {
      count++;
      if (count === 3) {
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      }
    }
  }
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-15`;
}

async function updateOptionsData(optionsData: OptionData[]) {
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';

    const tickersStr = optionsData.map(item => item.ticker).join(',');
    if (!tickersStr) {
        console.log('[DEBUG-SPOTS-SKIP] Nessun ticker disponibile; salto fetch spots.');
        return;
    }
    const spotsUrl = `${baseUrl}/api/spots?tickers=${tickersStr}`;
    console.log(`[DEBUG-SPOTS-URL] ${spotsUrl}`);
    const spotsRes = await fetch(spotsUrl, { cache: 'no-store' });
    if (!spotsRes.ok) {
        const errorText = await spotsRes.text();
        console.error('Errore update spots:', errorText);
        return;
    }
    const spots: SpotsData = await spotsRes.json();

    let symbols: string[] = [];
    optionsData.forEach(item => {
        const currentSymbol = getSymbolFromExpiryStrike(item.ticker, item.expiry, item.strike);
        if (currentSymbol) symbols.push(currentSymbol);
        item.earlier.forEach(opt => opt.symbol && symbols.push(opt.symbol));
        item.future.forEach(opt => opt.symbol && symbols.push(opt.symbol));
    });
    symbols = [...new Set(symbols.filter(s => s))];
    if (symbols.length === 0) {
        console.log('[DEBUG-PRICES-SKIP] Nessun simbolo disponibile; salto fetch prices.');
        return;
    }

    const pricesUrl = `${baseUrl}/api/full-prices?symbols=${symbols.join(',')}`;
    console.log(`[DEBUG-PRICES-URL] ${pricesUrl}`);
    const pricesRes = await fetch(pricesUrl, { cache: 'no-store' });
    if (!pricesRes.ok) {
        const errorText = await pricesRes.text();
        console.error('Errore update prices:', errorText);
        return;
    }
    const allPrices = await pricesRes.json();

    const pricesGrouped: PricesData = {};
    for (const [symbol, val] of Object.entries(allPrices)) {
        const match = /^O:([A-Z]+)\d+C\d+$/.exec(symbol);
        if (!match) continue;
        const ticker = match[1];
        if (!pricesGrouped[ticker]) pricesGrouped[ticker] = {};
        pricesGrouped[ticker][symbol] = {
            bid: (val as any).bid ?? 0,
            ask: (val as any).ask ?? 0,
            last_trade_price: (val as any).last_trade_price ?? 0,
        };
    }

    for (const item of optionsData) {
        const ticker = item.ticker;
        const spotData = spots[ticker] || { price: 0, change_percent: 0 };
        const currentSymbol = getSymbolFromExpiryStrike(ticker, item.expiry, item.strike);
        const currentData = pricesGrouped[ticker]?.[currentSymbol] ?? { bid: 0, ask: 0, last_trade_price: 0 };

        const { error } = await supabase.from('options').update({
            spot: spotData.price,
            change_percent: spotData.change_percent,
            current_bid: currentData.bid,
            current_ask: currentData.ask,
            current_last_trade_price: currentData.last_trade_price,
            created_at: new Date().toISOString()
        }).eq('ticker', ticker);

        if (error) console.error('Errore update options per ticker:', ticker, error);
    }
}

export async function GET() {
    try {
        const { data: optionsData, error: optionsError } = await supabase.from('options').select('*');
        if (optionsError) {
            console.error('Errore fetch options:', optionsError);
            return new Response(JSON.stringify({ error: 'Failed to fetch options' }), { status: 500 });
        }

        if (optionsData.length > 0) {
            await updateOptionsData(optionsData);
        }

        const { data: updatedOptionsData, error: reloadError } = await supabase.from('options').select('*');
        if (reloadError) {
            console.error('Errore reload options:', reloadError);
            return new Response(JSON.stringify({ error: 'Failed to reload options' }), { status: 500 });
        }

        const { data: alertsData, error: alertsError } = await supabase.from('alerts').select('*');
        if (alertsError) {
            console.error('Errore fetch alerts:', alertsError);
            return new Response(JSON.stringify({ error: 'Failed to fetch alerts' }), { status: 500 });
        }
        const alertsEnabled: { [ticker: string]: boolean } = alertsData.reduce((acc: { [ticker: string]: boolean }, { ticker, enabled }: { ticker: string; enabled: boolean }) => ({ ...acc, [ticker]: enabled }), {});

        const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
        const tickersStr = updatedOptionsData.map((item: OptionData) => item.ticker).join(',');
        const spotsRes = await fetch(`${baseUrl}/api/spots?tickers=${tickersStr}`, { cache: 'no-store' });
        if (!spotsRes.ok) {
            const errorText = await spotsRes.text();
            console.error('Dettagli errore fetch spots:', errorText);
            return new Response(JSON.stringify({ error: 'Failed to fetch spots' }), { status: 500 });
        }
        const spots: SpotsData = await spotsRes.json();

        let symbols: string[] = [];
        updatedOptionsData.forEach((item: OptionData) => {
            const currentSymbol = getSymbolFromExpiryStrike(item.ticker, item.expiry, item.strike);
            if (currentSymbol) symbols.push(currentSymbol);
            item.earlier.forEach(opt => opt.symbol && symbols.push(opt.symbol));
            item.future.forEach(opt => opt.symbol && symbols.push(opt.symbol));
        });
        symbols = [...new Set(symbols.filter(s => s))];

        const pricesRes = await fetch(`${baseUrl}/api/full-prices?symbols=${symbols.join(',')}`, { cache: 'no-store' });
        if (!pricesRes.ok) {
            const errorText = await pricesRes.text();
            console.error('Dettagli errore fetch prices:', errorText);
            return new Response(JSON.stringify({ error: 'Failed to fetch prices' }), { status: 500 });
        }
        const allPrices = await pricesRes.json();

        const prices: PricesData = {};
        for (const [symbol, val] of Object.entries(allPrices)) {
            const match = /^O:([A-Z]+)\d+C\d+$/.exec(symbol);
            if (!match) continue;
            const ticker = match[1];
            if (!prices[ticker]) prices[ticker] = {};
            prices[ticker][symbol] = {
                bid: (val as any).bid ?? 0,
                ask: (val as any).ask ?? 0,
                last_trade_price: (val as any).last_trade_price ?? 0,
            };
        }

        const { data: sentData, error: sentError } = await supabase.from('alerts_sent').select('*');
        if (sentError) {
            console.error('Errore fetch sentAlerts:', sentError);
            return new Response(JSON.stringify({ error: 'Failed to fetch sent alerts' }), { status: 500 });
        }
        const sentAlerts: SentAlerts = sentData.reduce((acc: SentAlerts, { ticker, level }: { ticker: string; level: string }) => {
            if (!acc[ticker]) acc[ticker] = {};
            acc[ticker][level] = true;  // Assume sent=true since row exists
            return acc;
        }, {});

        for (const item of updatedOptionsData) {
            if (!alertsEnabled[item.ticker]) continue;
            if (item.spot <= 0) continue;
            const spotData = spots[item.ticker] || { price: 0, change_percent: 0 };
            const change_percent = spotData.change_percent;
            const changeSign = change_percent >= 0 ? '+' : '';
            const delta = ((item.strike - item.spot) / item.spot) * 100;
            const tickerPrices = prices[item.ticker] || {};
            const currentSymbol = getSymbolFromExpiryStrike(item.ticker, item.expiry, item.strike);
            const ask = tickerPrices[currentSymbol]?.ask ?? item.current_ask ?? 0;
            const last_trade_price = tickerPrices[currentSymbol]?.last_trade_price ?? item.current_last_trade_price ?? 0;
            const currentPrice = ask > 0 ? ask : (last_trade_price > 0 ? last_trade_price : 0);
            const [currYear, currMonth] = item.expiry.split('-');
            const monthNames = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
            const currMonthIndex = Number(currMonth) - 1;
            const currMonthName = monthNames[currMonthIndex];
            const currentLabel = `${currMonthName} ${currYear.slice(2)} C${item.strike}`;
            const levels = [4, 3, 2, 1];
            if (!sentAlerts[item.ticker]) sentAlerts[item.ticker] = {};

            for (const level of levels) {
                const f1 = item.future[0] || { label: 'N/A', bid: 0, last_trade_price: 0, symbol: '', ask: 0, strike: 0, expiry: '' };
                const f2 = item.future[1] || { label: 'N/A', bid: 0, last_trade_price: 0, symbol: '', ask: 0, strike: 0, expiry: '' };
                const f1Bid = tickerPrices[f1.symbol]?.bid ?? f1.bid ?? 0;
                const f1Last = tickerPrices[f1.symbol]?.last_trade_price ?? f1.last_trade_price ?? 0;
                const f1Price = f1Bid > 0 ? f1Bid : f1Last;
                const f2Bid = tickerPrices[f2.symbol]?.bid ?? f2.bid ?? 0;
                const f2Last = tickerPrices[f2.symbol]?.last_trade_price ?? f2.last_trade_price ?? 0;
                const f2Price = f2Bid > 0 ? f2Bid : f2Last;
                if (currentPrice > 0 && f1Price > 0 && f2Price > 0 && delta < level && !sentAlerts[item.ticker][level]) {
                    const { error } = await supabase.from('alerts_sent').insert([{ ticker: item.ticker, level: level.toString() }]);
                    if (error) console.error('Errore insert alert-sent:', error);
                    else sentAlerts[item.ticker][level] = true;
                    const f1Label = f1.label.replace(/C(\d+)/, '$1 CALL');
                    const f2Label = f2.label.replace(/C(\d+)/, '$1 CALL');
                    const currLabelFormatted = currentLabel.replace(/C(\d+)/, '$1 CALL');
                    const alertMessage = `🔴 ${item.ticker} – DELTA: ${delta.toFixed(2)}% – Rollare\n\nSpot: ${item.spot}\nDelta Spot: ${item.spot} (${changeSign}${change_percent.toFixed(2)}%)\nStrike: ${item.strike}\nCurrent Call: ${currLabelFormatted} - ${currentPrice.toFixed(2)}\n\n#Future 1: ${f1Label} - ${f1Price.toFixed(2)}\n#Future 2: ${f2Label} - ${f2Price.toFixed(2)}`;
                    sendTelegramMessage(alertMessage);
                }
            }

            const hasFattibileEarlier = item.earlier.some((opt: OptionEntry) => isFattibile(opt, item, prices));
            const e1 = item.earlier[0] || { label: 'N/A', bid: 0, last_trade_price: 0, symbol: '', ask: 0, strike: 0, expiry: '' };
            const e2 = item.earlier[1] || { label: 'N/A', bid: 0, last_trade_price: 0, symbol: '', ask: 0, strike: 0, expiry: '' };
            const e1Bid = tickerPrices[e1.symbol]?.bid ?? e1.bid ?? 0;
            const e1Last = tickerPrices[e1.symbol]?.last_trade_price ?? e1.last_trade_price ?? 0;
            const e1Price = e1Bid > 0 ? e1Bid : e1Last;
            const e2Bid = tickerPrices[e2.symbol]?.bid ?? e2.bid ?? 0;
            const e2Last = tickerPrices[e2.symbol]?.last_trade_price ?? e2.last_trade_price ?? 0;
            const e2Price = e2Bid > 0 ? e2Bid : e2Last;
            if (currentPrice > 0 && e1Price > 0 && e2Price > 0 && hasFattibileEarlier && !sentAlerts[item.ticker]['fattibile_high']) {
                const { error } = await supabase.from('alerts_sent').insert([{ ticker: item.ticker, level: 'fattibile_high' }]);
                if (error) console.error('Errore insert alert-sent:', error);
                else sentAlerts[item.ticker]['fattibile_high'] = true;
                const e1Label = e1.label.replace(/C(\d+)/, '$1 CALL');
                const e2Label = e2.label.replace(/C(\d+)/, '$1 CALL');
                const currLabelFormatted = currentLabel.replace(/C(\d+)/, '$1 CALL');
                const alertMessage = `🟢 ${item.ticker} – DELTA: ${delta.toFixed(2)}% (Earlier fattibile disponibile)\n\nSpot: ${item.spot}\nDelta Spot: ${item.spot} (${changeSign}${change_percent.toFixed(2)}%)\nCurrent Call: ${currLabelFormatted} - ${currentPrice.toFixed(2)}\n\n#Earlier 1: ${e1Label} - ${e1Price.toFixed(2)}\n#Earlier 2: ${e2Label} - ${e2Price.toFixed(2)}`;
                sendTelegramMessage(alertMessage);
            }
        }

        return new Response(JSON.stringify({ success: true }), { status: 200 });
    } catch (globalErr) {
        console.error('Errore globale in /api/check-alerts:', globalErr);
        return new Response(JSON.stringify({ success: false }), { status: 500 });
    }
}