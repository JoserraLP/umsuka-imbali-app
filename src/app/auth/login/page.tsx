import type { Metadata } from "next";
import { LoginTabs } from "@/app/auth/login/login-tabs";

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
      <LoginTabs redirectTo={redirectTo} />
    </main>
  );
}
