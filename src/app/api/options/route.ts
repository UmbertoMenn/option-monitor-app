import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '../../../utils/supabase/server';  // Usa il wrapper standardizzato
import type { Database } from '../../../types/supabase';  // Importa tipi generati per tipizzare upsert

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const POLYGON_API_KEY = process.env.POLYGON_API_KEY!;
const CONTRACTS_URL = 'https://api.polygon.io/v3/reference/options/contracts';

function isThirdFriday(dateStr: string): boolean {
  const date = new Date(dateStr);
  return date.getDay() === 5 && date.getDate() >= 15 && date.getDate() <= 21;
}

function formatExpiryLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const mesi = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
  const mese = mesi[date.getMonth()];
  const anno = date.getFullYear().toString().slice(2);
  return `${mese} ${anno}`;
}

function normalizeExpiry(expiry: string | null): string {
  if (!expiry || expiry.length !== 7) return '';  // Guardia per null o formato invalido
  const [year, month] = expiry.split('-').map(Number);
  return getThirdFriday(year, month).toISOString().split('T')[0];
}

function getThirdFriday(year: number, month: number): Date {
  const firstDay = new Date(year, month - 1, 1);
  const firstFriday = new Date(firstDay);
  while (firstFriday.getDay() !== 5) firstFriday.setDate(firstFriday.getDate() + 1);
  firstFriday.setDate(firstFriday.getDate() + 14);
  return firstFriday;
}

async function fetchContracts(ticker: string): Promise<any[]> {
  let contracts: any[] = [];
  let url: string | null = `${CONTRACTS_URL}?underlying_ticker=${ticker}&contract_type=call&limit=1000&apiKey=${POLYGON_API_KEY}`;

  while (url) {
    const res: Response = await fetch(url);
    if (!res.ok) throw new Error(`Errore fetch contracts per ${ticker}: ${res.status}`);
    const json: any = await res.json();
    if (json.results) contracts.push(...json.results);
    url = json.next_url ? `${json.next_url}&apiKey=${POLYGON_API_KEY}` : null;
  }
  return contracts;
}

async function fetchSpot(ticker: string): Promise<{ price: number; change_percent: number }> {
  try {
    const res: Response = await fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${POLYGON_API_KEY}`);
    if (!res.ok) return { price: 0, change_percent: 0 };
    const json: any = await res.json();
    const price = json?.ticker?.lastTrade?.p || json?.ticker?.day?.c || json?.ticker?.prevDay?.c || 0;
    const change_percent = json?.ticker?.todaysChangePerc || 0;
    return { price, change_percent };
  } catch (err) {
    console.error(`Fallback spot error for ${ticker}:`, err);
    return { price: 0, change_percent: 0 };
  }
}

async function fetchSnapshot(symbol: string): Promise<{ bid: number; ask: number; last_trade_price: number } | null> {
  const match = /^O:([A-Z]+)\d+C\d+$/.exec(symbol);
  if (!match) return null;
  const underlying = match[1];
  const res: Response = await fetch(`https://api.polygon.io/v3/snapshot/options/${underlying}/${symbol}?apiKey=${POLYGON_API_KEY}`);
  if (!res.ok) return null;
  const json: any = await res.json();
  if (json.status !== "OK" || !json.results) return null;
  return {
    bid: json.results.last_quote?.bid ?? json.results.last_trade?.price ?? 0,
    ask: json.results.last_quote?.ask ?? json.results.last_trade?.price ?? 0,
    last_trade_price: json.results.last_trade?.price ?? 0
  };
}

function buildExpiriesMap(contracts: any[]) {
  const map: Record<string, number[]> = {};
  for (const c of contracts) {
    if (!isThirdFriday(c.expiration_date)) continue;
    if (!map[c.expiration_date]) map[c.expiration_date] = [];
    map[c.expiration_date].push(c.strike_price);
  }
  for (const exp in map) map[exp].sort((a, b) => a - b);
  return map;
}

interface OptionEntry {
  label: string;
  strike: number | null;  // Permetti null
  bid: number | null;
  ask: number | null;
  last_trade_price: number | null;
  expiry: string;
  symbol: string;
}

interface OptionData {
  ticker: string;
  spot: number | null;
  strike: number | null;  // Permetti null
  expiry: string;
  current_bid: number | null;
  current_ask: number | null;
  current_last_trade_price: number | null;
  future: OptionEntry[];
  earlier: OptionEntry[];
  invalid?: boolean;
}

export async function GET() {
  const supabase = await createSupabaseServerClient();

  try {
    // Controllo autenticazione utente server-side
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      console.error('Sessione non valida in GET /api/options:', sessionError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = session.user;

    // Fetch tickers dell'utente da 'options' (invece di 'tickers' globale)
    const { data: userOptions, error: optionsError } = await supabase.from('options').select('*').eq('user_id', user.id);
    if (optionsError || !userOptions) {
      console.error('Errore fetch user options:', optionsError);
      throw new Error('Errore fetch user data');
    }

    const output: OptionData[] = [];

    for (const saved of userOptions) {
      const ticker = saved.ticker;
      if (!saved.expiry || saved.strike === undefined || saved.strike === null) {  // Guardia estesa per undefined/null
        output.push({
          ticker,
          spot: null,
          strike: null,
          expiry: '',
          current_bid: null,
          current_ask: null,
          current_last_trade_price: null,
          earlier: [],
          future: [],
          invalid: true
        });
        continue;
      }

      const CURRENT_EXPIRY = normalizeExpiry(saved.expiry);
      const CURRENT_STRIKE = saved.strike;

      const contracts = await fetchContracts(ticker);
      contracts.sort((a, b) => a.expiration_date.localeCompare(b.expiration_date) || a.strike_price - b.strike_price);

      const current = contracts.find(c =>
        isThirdFriday(c.expiration_date) &&
        Math.abs(c.strike_price - CURRENT_STRIKE) < 0.01 &&
        normalizeExpiry(c.expiration_date) === CURRENT_EXPIRY
      );

      if (!current) {
        output.push({
          ticker,
          spot: null,
          strike: CURRENT_STRIKE,
          expiry: CURRENT_EXPIRY,
          current_bid: null,
          current_ask: null,
          current_last_trade_price: null,
          earlier: [],
          future: [],
          invalid: true
        });
        continue;
      }

      const spotData = await fetchSpot(ticker);
      const currentPrices = await fetchSnapshot(current.ticker) ?? { bid: 0, ask: 0, last_trade_price: 0 };
      const expiriesMap = buildExpiriesMap(contracts);
      const monthlyExpiries = Object.keys(expiriesMap).sort();
      const curIdx = monthlyExpiries.indexOf(CURRENT_EXPIRY);

      async function findOption(expiry: string, strikeRef: number, higher: boolean) {
        const strikes = expiriesMap[expiry];
        if (!strikes || strikes.length === 0) return null;

        let selectedStrike: number | undefined;

        if (higher) {
          selectedStrike = strikes.find((s: number) => s > strikeRef) ||
            strikes.find((s: number) => s === strikeRef) ||
            strikes[strikes.length - 1];
        } else {
          selectedStrike = [...strikes].reverse().find((s: number) => s < strikeRef) ||
            strikes.find((s: number) => s === strikeRef) ||
            strikes[0];
        }

        if (selectedStrike === undefined) return null;  // Guardia per undefined

        const match = contracts.find(c => c.expiration_date === expiry && c.strike_price === selectedStrike);
        if (!match) return null;
        const prices = await fetchSnapshot(match.ticker);
        if (!prices) return null;
        return {
          label: `${formatExpiryLabel(expiry)} C${selectedStrike}`,
          strike: selectedStrike,
          bid: prices.bid ?? null,
          ask: prices.ask ?? null,
          last_trade_price: prices.last_trade_price ?? null,
          expiry,
          symbol: match.ticker
        } as OptionEntry;
      }

      let future1: OptionEntry | null = null;
      let future2: OptionEntry | null = null;
      let earlier1: OptionEntry | null = null;
      let earlier2: OptionEntry | null = null;

      for (let i = curIdx + 1; i < monthlyExpiries.length; i++) {
        const f1 = await findOption(monthlyExpiries[i], CURRENT_STRIKE, true);
        if (f1) { future1 = f1; break; }
      }
      if (future1) {
        const idx1 = monthlyExpiries.indexOf(future1.expiry);
        for (let i = idx1 + 1; i < monthlyExpiries.length; i++) {
          const f2 = await findOption(monthlyExpiries[i], future1.strike ?? 0, true);  // Default a 0 se null
          if (f2) { future2 = f2; break; }
        }
      }

      for (let i = curIdx - 1; i >= 0; i--) {
        const e1 = await findOption(monthlyExpiries[i], CURRENT_STRIKE, false);
        if (e1) { earlier1 = e1; break; }
      }
      if (earlier1) {
        const idx1 = monthlyExpiries.indexOf(earlier1.expiry);
        for (let i = idx1 - 1; i >= 0; i--) {
          const e2 = await findOption(monthlyExpiries[i], earlier1.strike ?? 0, false);  // Default a 0 se null
          if (e2) { earlier2 = e2; break; }
        }
      }

      output.push({
        ticker,
        spot: spotData.price ?? null,
        strike: CURRENT_STRIKE ?? null,
        expiry: CURRENT_EXPIRY,
        current_bid: currentPrices.bid ?? null,
        current_ask: currentPrices.ask ?? null,
        current_last_trade_price: currentPrices.last_trade_price ?? null,
        future: [future1 || { label: 'OPZIONE INESISTENTE', strike: null, bid: null, ask: null, last_trade_price: null, expiry: '', symbol: '' },
                 future2 || { label: 'OPZIONE INESISTENTE', strike: null, bid: null, ask: null, last_trade_price: null, expiry: '', symbol: '' }],
        earlier: [earlier1 || { label: 'OPZIONE INESISTENTE', strike: null, bid: null, ask: null, last_trade_price: null, expiry: '', symbol: '' },
                  earlier2 || { label: 'OPZIONE INESISTENTE', strike: null, bid: null, ask: null, last_trade_price: null, expiry: '', symbol: '' }]
      });
    }

    // Nuovo: Calcola change_percents async prima di upsert
    const change_percents = await Promise.all(output.map(async (o) => {
      const spotData = await fetchSpot(o.ticker);
      return spotData.change_percent || 0;
    }));

    // Tipizza l'upsert per risolvere overload mismatch (usa tipo Insert diretto)
    type OptionsInsert = Database['public']['Tables']['options']['Insert'];
    const upsertData: OptionsInsert[] = output.map((o, index) => ({
      ticker: o.ticker, // always present and string
      spot: o.spot ?? 0,
      change_percent: change_percents[index],
      strike: o.strike ?? 0,
      expiry: o.expiry,
      current_bid: o.current_bid ?? 0,
      current_ask: o.current_ask ?? 0,
      current_last_trade_price: o.current_last_trade_price ?? 0,
      earlier: JSON.stringify(o.earlier),  // Serializza come JSON string
      future: JSON.stringify(o.future),    // Serializza come JSON string
      created_at: new Date().toISOString(),
      user_id: user.id
    }));

    const { error: upsertError } = await supabase.from('options').upsert(upsertData, { onConflict: 'ticker,user_id' });
    if (upsertError) console.error('❌ Errore upsert /api/options:', upsertError.message);

    return NextResponse.json(output);
  } catch (err: any) {
    console.error('❌ Errore /api/options:', err.message);
    return NextResponse.json([], { status: 500 });
  }
}