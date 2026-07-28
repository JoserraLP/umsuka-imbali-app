import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { clientEnv } from "@/lib/env.client";
import { SERVER_AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";
import type { Database } from "@/types/database.types";

/**
 * Creates a Supabase client for use in Server Components, Route Handlers,
 * and Server Actions. Reads/writes the auth session via Next.js cookies().
 *
 * Note: `set`/`remove` will throw when called from a Server Component
 * render (cookies are read-only there). That is expected and safe — the
 * middleware is responsible for refreshing the session cookie on every
 * request. The try/catch below prevents that expected error from
 * bubbling up and breaking the render.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database, "umsuka">(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      db: { schema: "umsuka" },
      cookieOptions: SERVER_AUTH_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component — safe to ignore because
            // the middleware refreshes the session on every request.
          }
        },
      },
    },
  );
}
