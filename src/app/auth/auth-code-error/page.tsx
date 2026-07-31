import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** User-facing (Spanish) message per failure reason reported by the callback route. */
const MESSAGES_BY_REASON: Record<string, string> = {
  provider: "Google no pudo completar la autenticación o cancelaste el proceso.",
  missing_code:
    "No se recibió el código de autorización. Es probable que la URL de redirección " +
    "configurada en Supabase no coincida con este dominio.\n\n" +
    "Asegúrate de que en Supabase Dashboard → Authentication → URL Configuration, " +
    "la lista de 'Redirect URLs' incluya:\n" +
    "  • http://localhost:3000/auth/callback  (para desarrollo local)\n" +
    "  • https://tu-dominio.vercel.app/auth/callback  (para producción)\n\n" +
    "También verifica que la 'Deployment Protection' de Vercel (Vercel Authentication) " +
    "esté deshabilitada o limitada, para que no intercepte /auth/callback " +
    "(Vercel → Proyecto → Settings → Deployment Protection).",
  exchange_failed: "El servidor no pudo validar la sesión con Supabase.",
};

const DEFAULT_MESSAGE =
  "No se pudo completar el inicio de sesión con Google. Por favor, inténtalo de nuevo.";

interface AuthCodeErrorPageProps {
  searchParams: Promise<{ reason?: string }>;
}

export default async function AuthCodeErrorPage({ searchParams }: AuthCodeErrorPageProps) {
  const { reason } = await searchParams;
  const message = (reason && MESSAGES_BY_REASON[reason]) || DEFAULT_MESSAGE;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <CardTitle>Fallo al iniciar sesión</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/auth/login">Volver a intentarlo</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
