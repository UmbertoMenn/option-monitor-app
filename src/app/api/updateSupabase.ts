import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_ANON_KEY as string;
const supabase = createClient(supabaseUrl, supabaseKey);
const polygonApiKey = process.env.POLYGON_API_KEY as string;

export const handler = async () => {
  try {
    // Fetch tickers esistenti da Supabase
    const { data: optionsData, error: fetchError } = await supabase.from('options').select('ticker');
    if (fetchError) throw new Error(`Errore fetch tickers: ${fetchError.message}`);

    const tickers = optionsData.map(item => item.ticker);
    if (tickers.length === 0) return { statusCode: 200, body: JSON.stringify({ message: 'No tickers to update' }) };

    // Fetch spots da Polygon.io
    const tickersStr = tickers.join(',');
    const spotsRes = await fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickersStr}&apiKey=${polygonApiKey}`);
    if (!spotsRes.ok) throw new Error(`Errore Polygon: ${await spotsRes.text()}`);
    const spotsData = await spotsRes.json();
    const spots: { [ticker: string]: { price: number; changePercent: number } } = {};
    spotsData.tickers?.forEach((result: any) => {
      const price = result.lastTrade?.p || result.day?.c || result.prevDay?.c || 0;
      const changePercent = result.todaysChangePerc || 0;
      spots[result.ticker] = { price, changePercent };
    });

    // Aggiorna Supabase con nuovi spot
    for (const ticker of tickers) {
      const spotData = spots[ticker] || { price: 0, changePercent: 0 };
      const { error } = await supabase.from('options').update({
        spot: spotData.price,
        changePercent: spotData.changePercent,
        updated_at: new Date().toISOString()  // Nuovo: Traccia update
      }).eq('ticker', ticker);
      if (error) console.error(`Errore update ${ticker}:`, error);
    }

    return { statusCode: 200, body: JSON.stringify({ message: 'Supabase updated successfully' }) };
  } catch (error) {
    const err = error as Error;  
    console.error('Errore in Lambda:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};