import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GoogleSignInButton } from "@/components/layout/google-signin-button";

export const metadata: Metadata = {
  title: "Iniciar sesión",
};

interface LoginPageProps {
  searchParams: Promise<{ redirectTo?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { redirectTo } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <CardTitle className="text-2xl">Umsuka Imbali</CardTitle>
          <CardDescription>
            Inicia sesión con tu cuenta de Google de la asociación para continuar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GoogleSignInButton redirectTo={redirectTo} />
        </CardContent>
      </Card>
    </main>
  );
}
