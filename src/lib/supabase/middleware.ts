import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { clientEnv } from "@/lib/env.client";
import { SERVER_AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";
import type { Database } from "@/types/database.types";

const PUBLIC_ROUTES = ["/auth/login", "/auth/callback", "/auth/auth-code-error"];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/**
 * Builds a redirect response while preserving any Set-Cookie headers that
 * were queued on `base` (e.g. a refreshed session token from
 * supabase.auth.getUser()). Returning a bare NextResponse.redirect()
 * instead would silently drop those cookies — the browser would never
 * receive the refreshed session, causing an apparent "session not
 * persisting" loop back to the login page.
 */
function redirectPreservingCookies(url: URL, base: NextResponse): NextResponse {
  const redirectResponse = NextResponse.redirect(url);
  base.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });
  return redirectResponse;
}

/**
 * Refreshes the Supabase auth session on every request and redirects
 * unauthenticated users away from protected routes. This is the first
 * line of defense in the authorization model — it must never be the
 * only one (RLS + server validation are enforced independently).
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookieOptions: SERVER_AUTH_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  // IMPORTANT: never remove this call. It refreshes the session token and
  // is required for the cookie to stay valid across server rendering.
  const {
    data: { user },
    error: getUserError,
  } = await supabase.auth.getUser();

  if (getUserError) {
    console.error(
      "middleware: supabase.auth.getUser() falló al validar la sesión — este es el motivo " +
        "real por el que se redirige a /auth/login aunque la cookie esté presente:",
      { name: getUserError.name, message: getUserError.message, status: getUserError.status },
    );
  }

  const { pathname } = request.nextUrl;

  if (!user && !isPublicRoute(pathname)) {
    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("redirectTo", pathname);
    return redirectPreservingCookies(loginUrl, supabaseResponse);
  }

  if (user && pathname === "/auth/login") {
    return redirectPreservingCookies(new URL("/dashboard", request.url), supabaseResponse);
  }

  return supabaseResponse;
}
