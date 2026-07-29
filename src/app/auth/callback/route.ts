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
        "exactamente con el dominio desde el que se está probando.\n" +
        "  Origen actual del callback: " + origin + "\n" +
        "  NEXT_PUBLIC_SITE_URL: " + (process.env.NEXT_PUBLIC_SITE_URL ?? "(no definido)") + "\n" +
        "  Sugerencia: Añade '" + origin + "/auth/callback' a la lista de 'Redirect URLs' " +
        "en Supabase Dashboard → Authentication → URL Configuration.",
    );
    return NextResponse.redirect(`${origin}/auth/auth-code-error?reason=missing_code`);
  }

  // Build the redirect response up front so the Supabase client can
  // attach Set-Cookie headers directly to it.
  const response = NextResponse.redirect(`${origin}${safeRedirectPath}`);

  const cookieNamesBefore = request.cookies.getAll().map((c) => c.name);
  console.log(
    "[/auth/callback] Cookies presentes ANTES del exchange:",
    { count: cookieNamesBefore.length, names: cookieNamesBefore },
  );

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
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
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

  // Verify that the session was persisted after the exchange
  try {
    const { data: { session: postSession }, error: sessionError } =
      await supabase.auth.getSession();
    if (sessionError || !postSession) {
      console.error(
        "[/auth/callback] INTERCAMBIO EXITOSO pero getSession() post-exchange no encontró la sesión.",
        { sessionError: sessionError?.message ?? "(ninguno)", hasSession: !!postSession },
      );
    } else {
      console.log(
        "[/auth/callback] Sesión verificada post-exchange:",
        { expiresAt: postSession.expires_at, userId: postSession.user?.id },
      );
    }
  } catch (verificationError) {
    console.error(
      "[/auth/callback] Error inesperado al verificar la sesión post-exchange:",
      verificationError,
    );
  }

  const cookieNamesAfter = response.cookies.getAll().map((c) => ({
    name: c.name,
    hasValue: !!c.value,
  }));
  console.log(
    "[/auth/callback] Cookies puestas en la response redirect:",
    { count: cookieNamesAfter.length, cookies: cookieNamesAfter },
  );

  return response;
}
