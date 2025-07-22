import { createClient } from '@supabase/supabase-js';
import { sendTelegramMessage } from '../../../utils/sendTelegram';
import { getSymbolFromExpiryStrike, isFattibile, OptionEntry, OptionData, PricesData } from '../../../utils/functions';

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_ANON_KEY as string;
const supabase = createClient(supabaseUrl, supabaseKey);

interface SpotsData {
    [ticker: string]: { price: number; changePercent: number };
}

interface SentAlerts {
    [ticker: string]: { [level: string]: boolean };
}

async function updateOptionsData(optionsData: OptionData[]) {
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
    console.log(`[DEBUG-START] Timestamp: ${new Date().toISOString()} | Tickers processati: ${optionsData.map(item => item.ticker).join(', ')}`);

    const tickersStr = optionsData.map(item => item.ticker).join(',');
    const spotsUrl = `${baseUrl}/api/spots?tickers=${tickersStr}`;
    console.log(`[DEBUG-SPOTS-URL] ${spotsUrl}`);
    const spotsRes = await fetch(spotsUrl, { cache: 'no-store' });
    console.log(`[DEBUG-SPOTS-STATUS] ${spotsRes.status}`);
    if (!spotsRes.ok) {
        const errorText = await spotsRes.text();
        console.error(`[DEBUG-SPOTS-ERROR] ${errorText}`);
        return;
    }
    const spots: SpotsData = await spotsRes.json();
    console.log(`[DEBUG-SPOTS-DATA] ${JSON.stringify(spots)}`);

    let symbols: string[] = [];
    optionsData.forEach(item => {
        const currentSymbol = getSymbolFromExpiryStrike(item.ticker, item.expiry, item.strike);
        if (currentSymbol) symbols.push(currentSymbol);
        item.earlier.forEach(opt => opt.symbol && symbols.push(opt.symbol));
        item.future.forEach(opt => opt.symbol && symbols.push(opt.symbol));
    });
    symbols = [...new Set(symbols.filter(s => s))];
    console.log(`[DEBUG-SYMBOLS] ${symbols.join(',')}`);

    const pricesUrl = `${baseUrl}/api/full-prices?symbols=${symbols.join(',')}`;
    console.log(`[DEBUG-PRICES-URL] ${pricesUrl}`);
    const pricesRes = await fetch(pricesUrl, { cache: 'no-store' });
    console.log(`[DEBUG-PRICES-STATUS] ${pricesRes.status}`);
    if (!pricesRes.ok) {
        const errorText = await pricesRes.text();
        console.error(`[DEBUG-PRICES-ERROR] ${errorText}`);
        return;
    }
    const allPrices = await pricesRes.json();
    console.log(`[DEBUG-PRICES-DATA] ${JSON.stringify(allPrices)}`);

    const prices: PricesData = {};
    // ... (mantieni il codice esistente per grouping prices)

    for (const item of optionsData) {
        const ticker = item.ticker;
        const spotData = spots[ticker] || { price: 0, changePercent: 0 };
        const currentSymbol = getSymbolFromExpiryStrike(ticker, item.expiry, item.strike);
        const currentData = prices[ticker]?.[currentSymbol] ?? { bid: 0, ask: 0, last_trade_price: 0 };
        console.log(`[DEBUG-UPDATE-PRE] Ticker: ${ticker} | New Spot: ${spotData.price} | Bid: ${currentData.bid} | Ask: ${currentData.ask}`);

        const { error } = await supabase.from('options').update({
            spot: spotData.price,
            current_bid: currentData.bid,
            current_ask: currentData.ask,
            current_last_trade_price: currentData.last_trade_price
        }).eq('ticker', ticker);

        if (error) {
            console.error(`[DEBUG-UPDATE-ERROR] Ticker: ${ticker} | Error: ${JSON.stringify(error)}`);
        } else {
            console.log(`[DEBUG-UPDATE-SUCCESS] Ticker: ${ticker} | Updated successfully`);
        }
    }
    console.log('[DEBUG-END]');
}

export async function GET() {
    // Fetch dati options da Supabase
    const { data: optionsData, error: optionsError } = await supabase.from('options').select('*');
    if (optionsError) {
        console.error('Errore fetch options:', optionsError);
        return new Response(JSON.stringify({ error: 'Failed to fetch options' }), { status: 500 });
    }

    if (optionsData.length > 0) {
        await updateOptionsData(optionsData); // Aggiorna dati prima di alert
    }

    // Ricarica optionsData aggiornati
    const { data: updatedOptionsData, error: reloadError } = await supabase.from('options').select('*');
    if (reloadError) {
        console.error('Errore reload options:', reloadError);
        return new Response(JSON.stringify({ error: 'Failed to reload options' }), { status: 500 });
    }

    // Fetch alertsEnabled da Supabase (assumi tabella 'alerts' con ticker e enabled)
    const { data: alertsData, error: alertsError } = await supabase.from('alerts').select('*');
    if (alertsError) {
        console.error('Errore fetch alerts:', alertsError);
        return new Response(JSON.stringify({ error: 'Failed to fetch alerts' }), { status: 500 });
    }
    const alertsEnabled: { [ticker: string]: boolean } = alertsData.reduce((acc: { [ticker: string]: boolean }, { ticker, enabled }: { ticker: string; enabled: boolean }) => ({ ...acc, [ticker]: enabled }), {});

    // Fetch spots (chiama endpoint interno - usa absolute URL for server-side, senza headers inutili)
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
    const tickersStr = updatedOptionsData.map((item: OptionData) => item.ticker).join(',');
    const spotsRes = await fetch(`${baseUrl}/api/spots?tickers=${tickersStr}`, { cache: 'no-store' });
    if (!spotsRes.ok) {
        const errorText = await spotsRes.text();
        console.error('Dettagli errore fetch spots:', errorText);
        return new Response(JSON.stringify({ error: 'Failed to fetch spots' }), { status: 500 });
    }
    const spots: SpotsData = await spotsRes.json();

    // Raccolta tutti i symbols per prices
    let symbols: string[] = [];
    updatedOptionsData.forEach((item: OptionData) => {
        const currentSymbol = getSymbolFromExpiryStrike(item.ticker, item.expiry, item.strike);
        if (currentSymbol) symbols.push(currentSymbol);
        item.earlier.forEach(opt => opt.symbol && symbols.push(opt.symbol));
        item.future.forEach(opt => opt.symbol && symbols.push(opt.symbol));
    });
    symbols = [...new Set(symbols.filter(s => s))]; // Unique e non vuoti

    // Fetch prices (chiama endpoint interno, assumendo non richieda headers specifici)
    const pricesRes = await fetch(`${baseUrl}/api/full-prices?symbols=${symbols.join(',')}`, { cache: 'no-store' });
    if (!pricesRes.ok) {
        const errorText = await pricesRes.text();
        console.error('Dettagli errore fetch prices:', errorText);
        return new Response(JSON.stringify({ error: 'Failed to fetch prices' }), { status: 500 });
    }
    const allPrices = await pricesRes.json();

    // Group prices per ticker (adatta dal codice client)
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

    // Fetch o inizializza sentAlerts da Supabase (tabella alerts_sent: ticker, level, sent)
    const { data: sentData, error: sentError } = await supabase.from('alerts_sent').select('*');
    if (sentError) {
        console.error('Errore fetch sentAlerts:', sentError);
        return new Response(JSON.stringify({ error: 'Failed to fetch sent alerts' }), { status: 500 });
    }
    const sentAlerts: SentAlerts = sentData.reduce((acc: SentAlerts, { ticker, level, sent }: { ticker: string; level: string; sent: boolean }) => {
        if (!acc[ticker]) acc[ticker] = {};
        acc[ticker][level] = sent;
        return acc;
    }, {});

    // Logica alert
    for (const item of updatedOptionsData) {
        if (!alertsEnabled[item.ticker]) continue;
        if (item.spot <= 0) continue;
        const spotData = spots[item.ticker] || { price: 0, changePercent: 0 };
        const changePercent = spotData.changePercent;
        const changeSign = changePercent >= 0 ? '+' : '';
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

        // Alert per low delta
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
                sentAlerts[item.ticker][level] = true;
                // Upsert in Supabase
                await supabase.from('alerts_sent').upsert([{ ticker: item.ticker, level: level.toString(), sent: true }]);
                const f1Label = f1.label.replace(/C(\d+)/, '$1 CALL');
                const f2Label = f2.label.replace(/C(\d+)/, '$1 CALL');
                const currLabelFormatted = currentLabel.replace(/C(\d+)/, '$1 CALL');
                const alertMessage = `🔴 ${item.ticker} – DELTA: ${delta.toFixed(2)}% – Rollare\n\nSpot: ${item.spot}\nDelta Spot: ${item.spot} (${changeSign}${changePercent.toFixed(2)}%)\nStrike: ${item.strike}\nCurrent Call: ${currLabelFormatted} - ${currentPrice.toFixed(2)}\n\n#Future 1: ${f1Label} - ${f1Price.toFixed(2)}\n#Future 2: ${f2Label} - ${f2Price.toFixed(2)}`;
                sendTelegramMessage(alertMessage);
            }
        }

        // Alert per earlier fattibile
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
            sentAlerts[item.ticker]['fattibile_high'] = true;
            // Upsert in Supabase
            await supabase.from('alerts_sent').upsert([{ ticker: item.ticker, level: 'fattibile_high', sent: true }]);
            const e1Label = e1.label.replace(/C(\d+)/, '$1 CALL');
            const e2Label = e2.label.replace(/C(\d+)/, '$1 CALL');
            const currLabelFormatted = currentLabel.replace(/C(\d+)/, '$1 CALL');
            const alertMessage = `🟢 ${item.ticker} – DELTA: ${delta.toFixed(2)}% (Earlier fattibile disponibile)\n\nSpot: ${item.spot}\nDelta Spot: ${item.spot} (${changeSign}${changePercent.toFixed(2)}%)\nCurrent Call: ${currLabelFormatted} - ${currentPrice.toFixed(2)}\n\n#Earlier 1: ${e1Label} - ${e1Price.toFixed(2)}\n#Earlier 2: ${e2Label} - ${e2Price.toFixed(2)}`;
            sendTelegramMessage(alertMessage);
        }
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
}