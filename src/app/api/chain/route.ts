import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';  // Usa helper coerente con middleware
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';  // Forza dynamic per auth

const POLYGON_API_KEY = process.env.POLYGON_API_KEY!;
const CONTRACTS_URL = 'https://api.polygon.io/v3/reference/options/contracts';

function isThirdFriday(dateStr: string): boolean {
  const date = new Date(dateStr);
  return date.getDay() === 5 && date.getDate() >= 15 && date.getDate() <= 21;
}

function formatMonthName(month: number): string {
  const mesi = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
  return mesi[month];
}

async function fetchFullChain(ticker: string): Promise<any[]> {
  let contracts: any[] = [];
  let url: string | null = `${CONTRACTS_URL}?underlying_ticker=${ticker}&contract_type=call&limit=1000&apiKey=${POLYGON_API_KEY}`;

  while (url) {
    const res: Response = await fetch(url);
    const json: { results?: any[]; next_url?: string } = await res.json();
    if (json.results) contracts.push(...json.results);
    url = json.next_url ? `${json.next_url}&apiKey=${POLYGON_API_KEY}` : null;
  }

  if (contracts.length === 0) {
    console.warn(`No contracts found for ticker ${ticker}`);
  }

  return contracts;
}

export async function GET(req: Request) {
  const cookieStore = cookies();
  const supabase = createRouteHandlerClient({
    cookies: () => cookieStore
  });

  try {
    // Controllo autenticazione utente server-side
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      console.error('Sessione non valida in GET /api/chain:', sessionError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = session.user;

    const { searchParams } = new URL(req.url);
    const ticker = searchParams.get('ticker')?.toUpperCase();
    if (!ticker) return NextResponse.json({ error: 'Missing ticker' }, { status: 400 });

    // Verifica se il ticker appartiene all'utente
    const { data: userTickers, error: tickError } = await supabase.from('options').select('ticker').eq('ticker', ticker).eq('user_id', user.id);
    if (tickError || !userTickers || userTickers.length === 0) {
      console.error(`Ticker ${ticker} not found for user ${user.id}`);
      return NextResponse.json({ error: 'Ticker not found for user' }, { status: 404 });
    }

    // Procedi con fetch chain se valido
    const contracts = await fetchFullChain(ticker);

    const result: Record<string, Record<string, number[]>> = {};

    for (const c of contracts) {
      const expiry = c.expiration_date;
      if (!isThirdFriday(expiry)) continue;

      const date = new Date(expiry);
      const year = date.getFullYear();
      const month = date.getMonth();

      if (year > 2030) continue;

      const yearStr = year.toString();
      const monthStr = formatMonthName(month);

      if (!result[yearStr]) result[yearStr] = {};
      if (!result[yearStr][monthStr]) result[yearStr][monthStr] = [];

      result[yearStr][monthStr].push(c.strike_price);
    }

    for (const year of Object.keys(result)) {
      for (const month of Object.keys(result[year])) {
        result[year][month].sort((a, b) => a - b);
      }
    }

    if (Object.keys(result).length === 0) {
      console.error(`No chain data generated for ticker ${ticker}`);
    }

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('❌ Errore /api/chain:', err.message);
    return NextResponse.json({}, { status: 500 });
  }
}