"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { resolveUsernameForLogin } from "@/app/auth/login/actions";

interface UsernameLoginFormProps {
  redirectTo?: string;
}

export function UsernameLoginForm({ redirectTo }: UsernameLoginFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasStartedRef = useRef(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;
    setIsLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const username = (formData.get("username") as string) ?? "";
    const password = (formData.get("password") as string) ?? "";

    // 1. Resolve username → email alias via server action
    const resolveResult = await resolveUsernameForLogin({ username });

    if (!resolveResult.success) {
      setError(resolveResult.error ?? "Error al verificar el usuario.");
      setIsLoading(false);
      hasStartedRef.current = false;
      return;
    }

    // 2. Sign in with email alias + password (client-side)
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: resolveResult.emailAlias!,
      password,
    });

    if (signInError) {
      setError("Usuario o contraseña incorrectos.");
      setIsLoading(false);
      hasStartedRef.current = false;
      return;
    }

    // 3. Success — redirect (full page navigation to refresh middleware state)
    window.location.href = redirectTo ?? "/dashboard";
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="space-y-2">
        <Label htmlFor="username">Nombre de usuario</Label>
        <Input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          required
          disabled={isLoading}
          placeholder="Tu nombre de usuario"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Contraseña</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={isLoading}
          placeholder="Tu contraseña"
        />
      </div>

      <Button type="submit" disabled={isLoading} className="w-full" size="lg">
        {isLoading ? "Iniciando sesión…" : "Iniciar sesión"}
      </Button>
    </form>
  );
}
