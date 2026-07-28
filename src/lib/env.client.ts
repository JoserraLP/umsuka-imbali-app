import { z } from "zod";

/**
 * Public environment schema. These are the only three variables that may
 * ever be imported from a "use client" module — Next.js inlines
 * NEXT_PUBLIC_* variables into the browser bundle at build time, so this
 * schema (and only this schema) is safe to evaluate in the browser.
 *
 * IMPORTANT: do not add non-NEXT_PUBLIC_ variables to this file. Doing so
 * would make any client-side import of this module throw, because that
 * value is never sent to the browser. Server-only variables belong in
 * env.server.ts instead.
 */
const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url({ message: "NEXT_PUBLIC_SUPABASE_URL debe ser una URL válida" }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY es obligatoria"),
  NEXT_PUBLIC_SITE_URL: z.string().url({ message: "NEXT_PUBLIC_SITE_URL debe ser una URL válida" }),
});

function readClientEnv() {
  const parsed = clientEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });

  if (!parsed.success) {
    throw new Error(
      `Configuración de variables de entorno públicas inválida: ${parsed.error.issues
        .map((issue) => issue.message)
        .join(", ")}. Comprueba que estén definidas en .env.local (desarrollo) o en las ` +
        `Variables de Entorno de tu proyecto de Vercel (producción/preview) — .env.local ` +
        `nunca se sube a Vercel.`,
    );
  }

  return parsed.data;
}

export const clientEnv = readClientEnv();
