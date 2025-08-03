import { NextResponse } from 'next/server';
import { supabaseClient } from '../../../lib/supabaseClient'; // Adatta il path se necessario

export const runtime = 'edge';

export async function GET() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { data, error } = await supabaseClient.from('tickers').select('ticker').eq('user_id', user.id);
    if (error) throw error;
    return NextResponse.json(data.map(row => row.ticker));
  } catch (err: any) {
    console.error('Errore fetch tickers:', err.message);
    return NextResponse.json([], { status: 500 });
  }
}