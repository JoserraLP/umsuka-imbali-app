import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { clientEnv } from "@/lib/env.client";
import { SERVER_AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";
import type { Database } from "@/types/database.types";

/**
 * Google OAuth callback. Exchanges the authorization code for a Supabase
 * session and redirects the user to the originally requested route (or
 * the dashboard by default). On failure, redirects to a dedicated error
 * page rather than leaking provider error details into the URL shown to
 * the user. The real failure cause is logged server-side (visible in
 * Vercel → Deployments → Logs, or the terminal in local dev) in Spanish
 * so it can be diagnosed without exposing it to the end user.
 *
 * IMPORTANT: the Supabase client here writes cookies directly onto the
 * `response` object this handler returns, instead of going through the
 * ambient next/headers cookie store (as src/lib/supabase/server.ts does
 * for Server Components). This removes any ambiguity about whether a
 * Set-Cookie header actually ends up on the response the browser
 * receives for this specific request — which is exactly what was
 * failing: the code exchange succeeded, but the session cookie never
 * reached the browser, so the very next request (to /dashboard) looked
 * unauthenticated and bounced back to /auth/login.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const redirectTo = searchParams.get("redirectTo");
  const providerError = searchParams.get("error");
  const providerErrorDescription = searchParams.get("error_description");

  const safeRedirectPath =
    redirectTo && redirectTo.startsWith("/") && !redirectTo.startsWith("//")
      ? redirectTo
      : "/dashboard";

  if (providerError) {
    console.error(
      "El proveedor de OAuth (Google/Supabase) devolvió un error antes de emitir el código:",
      { providerError, providerErrorDescription },
    );
    return NextResponse.redirect(`${origin}/auth/auth-code-error?reason=provider`);
  }

  if (!code) {
    console.error(
      "Callback de OAuth recibido sin parámetro 'code'. Revisa que la Redirect URL " +
        "configurada en Supabase (Authentication → URL Configuration) coincida " +
        "exactamente con el dominio desde el que se está probando.",
    );
    return NextResponse.redirect(`${origin}/auth/auth-code-error?reason=missing_code`);
  }

  // Build the redirect response up front so the Supabase client can
  // attach Set-Cookie headers directly to it.
  const response = NextResponse.redirect(`${origin}${safeRedirectPath}`);

  const supabase = createServerClient<Database, "umsuka">(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      db: { schema: "umsuka" },
      cookieOptions: SERVER_AUTH_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error(
      "Falló el intercambio del código de autorización por una sesión de Supabase:",
      { message: error.message, status: error.status },
    );
    return NextResponse.redirect(`${origin}/auth/auth-code-error?reason=exchange_failed`);
  }

  return response;
}
