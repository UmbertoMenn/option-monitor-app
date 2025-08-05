// src/middleware.ts (o middleware.ts nella root)
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  // Create an unmodified response
  let supabaseResponse = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Aggiorna i cookie sulla request (fix per propagazione sessione)
          cookiesToSet.forEach(({ name, value, options }) => 
            request.cookies.set({ name, value, ...options })  // Usa oggetto per fix TS
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          // Aggiorna i cookie sulla response
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set({ name, value, ...options })  // Usa oggetto qui pure
          );
        },
      },
    }
  );

  // Rinfresca la sessione per mantenerla attiva e propagare i cookie correttamente
  await supabase.auth.getUser();

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Abbina tutte le route eccetto quelle che iniziano con:
     * - _next/static (file statici)
     * - _next/image (ottimizzazione immagini)
     * - favicon.ico (file icona)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};