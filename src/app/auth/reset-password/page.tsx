import type { Metadata } from "next";
import { ResetPasswordForm } from "@/app/auth/reset-password/reset-password-form";

export const metadata: Metadata = {
  title: "Restablecer contraseña",
};

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
        <p className="text-destructive">Token no proporcionado.</p>
      </main>
    );
  }

  // Basic UUID validation on the server before rendering the form
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(token)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
        <p className="text-destructive">Token inválido.</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <ResetPasswordForm token={token} />
    </main>
  );
}
