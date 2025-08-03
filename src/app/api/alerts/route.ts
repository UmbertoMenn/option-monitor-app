import { NextResponse } from 'next/server';
import { supabaseClient } from '../../../lib/supabaseClient'; // Adatta path, usa client condiviso per auth

export const runtime = 'edge';

export async function GET() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseClient.from('alerts').select('*').eq('user_id', user.id);
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json(data.reduce((acc: Record<string, boolean>, row) => { acc[row.ticker] = row.enabled; return acc; }, {}));
}

export async function POST(req: Request) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { ticker, enabled } = await req.json();
  const { error } = await supabaseClient.from('alerts').upsert({ ticker, enabled, user_id: user.id }, { onConflict: 'ticker,user_id' });
  if (error) return NextResponse.json({ error }, { status: 500 });
  if (!enabled) {
    // Pulisci alert-sent su disable, filtrato per user
    const { error: deleteErr } = await supabaseClient.from('alerts_sent').delete().eq('ticker', ticker).eq('user_id', user.id);
    if (deleteErr) console.error('Errore pulizia alert-sent su toggle off:', deleteErr);
  }
  return NextResponse.json({ success: true });
}