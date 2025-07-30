import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

export async function GET() {
  const { data, error } = await supabase.from('alerts').select('*');
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json(data.reduce((acc: Record<string, boolean>, row) => { acc[row.ticker] = row.enabled; return acc; }, {}));
}

export async function POST(req: NextRequest) {
  const { ticker, enabled } = await req.json();
  const { error } = await supabase.from('alerts').upsert({ ticker, enabled }, { onConflict: 'ticker' });
  if (error) return NextResponse.json({ error }, { status: 500 });
  if (!enabled) {
    // Pulisci alert-sent su disable
    const { error: deleteErr } = await supabase.from('alerts_sent').delete().eq('ticker', ticker);
    if (deleteErr) console.error('Errore pulizia alert-sent su toggle off:', deleteErr);
  }
  return NextResponse.json({ success: true });
}