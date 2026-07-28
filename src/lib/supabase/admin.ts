import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { clientEnv } from "@/lib/env.client";
import { serverEnv } from "@/lib/env.server";
import type { Database } from "@/types/database.types";

/**
 * Privileged Supabase client using the service role key.
 *
 * SECURITY: This client BYPASSES Row Level Security. It must only be
 * imported from trusted server-only code (Route Handlers, Server Actions,
 * background jobs) that performs its own authorization checks explicitly.
 * The `server-only` import guarantees a build-time failure if this module
 * is ever pulled into a Client Component bundle.
 */
export function createAdminClient() {
  return createSupabaseClient<Database, "umsuka">(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    {
      db: { schema: "umsuka" },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
