import { createBrowserClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/env.client";
import { BROWSER_AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";
import type { Database } from "@/types/database.types";

/**
 * Creates a Supabase client for use in Client Components ("use client").
 * A new client is intentionally created per call site — @supabase/ssr
 * manages the underlying browser storage/session singleton internally.
 */
export function createClient() {
  return createBrowserClient<Database, "umsuka">(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      db: { schema: "umsuka" },
      cookieOptions: BROWSER_AUTH_COOKIE_OPTIONS,
    },
  );
}
