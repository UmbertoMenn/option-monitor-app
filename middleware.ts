import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';  // Import corretto
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  const supabase = createMiddlewareClient({ req, res });

  // Log cookies in entrata per debug
  console.log('Middleware: Cookies in request:', req.cookies.getAll());

  // Ottieni e refresh sessione (importante per sync)
  await supabase.auth.getSession();  // Prima chiama get per caricare
  const { data: { session } } = await supabase.auth.refreshSession();  // Refresh esplicito per settare cookies se expired

  // Log sessione per debug
  console.log('Middleware: Sessione:', session ? 'Valida (user: ' + session.user.id + ')' : 'Null');

  if (session) {
    // Se sessione valida, assicura cookies settati in response
    res.cookies.set('sb-access-token', session.access_token, { path: '/', httpOnly: true, secure: true, sameSite: 'strict' });
    res.cookies.set('sb-refresh-token', session.refresh_token, { path: '/', httpOnly: true, secure: true, sameSite: 'strict' });
    console.log('Middleware: Cookies auth settati in response');
  } else if (req.nextUrl.pathname.startsWith('/api/')) {
    // Blocca API se no sessione
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  } else if (req.nextUrl.pathname !== '/login') {
    // Redirect a login per pages
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