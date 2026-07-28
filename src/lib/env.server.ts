import "server-only";
import { z } from "zod";

/**
 * Server-only environment schema. The `server-only` import above makes it
 * a build-time error for any "use client" file to import this module,
 * so it can never end up evaluated in the browser bundle.
 *
 * This intentionally does NOT re-export the client schema's fields — it
 * only validates what it itself needs (the service role key). If server
 * code also needs the public values, it should import them from
 * env.client.ts directly.
 */
const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY es obligatoria"),
});

function readServerEnv() {
  const parsed = serverEnvSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });

  if (!parsed.success) {
    throw new Error(
      `Configuración de variables de entorno del servidor inválida: ${parsed.error.issues
        .map((issue) => issue.message)
        .join(", ")}. Comprueba que SUPABASE_SERVICE_ROLE_KEY esté definida en .env.local ` +
        `(desarrollo) o en las Variables de Entorno de tu proyecto de Vercel (producción/preview).`,
    );
  }

  return parsed.data;
}

export const serverEnv = readServerEnv();
