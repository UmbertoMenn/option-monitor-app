import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';  // Import dal pacchetto richiesto
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // Crea client Supabase per middleware con gestione cookies
  const supabase = createMiddlewareClient({ req, res });

  // Ottieni la sessione (refresh automatico se expired)
  const { data: { session } } = await supabase.auth.getSession();

  // Per API routes: se no sessione, ritorna 401 Unauthorized
  if (req.nextUrl.pathname.startsWith('/api/') && !session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Per altre routes protette: redirect a login se no sessione
  if (!session && req.nextUrl.pathname !== '/login') {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = '/login';
    return NextResponse.redirect(redirectUrl);
  }

  return res;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};