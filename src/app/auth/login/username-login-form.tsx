"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import {
  resolveUsernameForLogin,
  checkLoginRateLimitAction,
  recordFailedAttemptAction,
  recordSuccessfulAttemptAction,
} from "@/app/auth/login/actions";

interface UsernameLoginFormProps {
  redirectTo?: string;
}

export function UsernameLoginForm({ redirectTo }: UsernameLoginFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBlocked, setIsBlocked] = useState(false);
  const hasStartedRef = useRef(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;
    setIsLoading(true);
    setError(null);
    setIsBlocked(false);

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

    // 2. Check rate limit (server-side)
    const rateLimitResult = await checkLoginRateLimitAction(username);

    if (!rateLimitResult.allowed) {
      setError(rateLimitResult.error);
      setIsBlocked(true);
      setIsLoading(false);
      hasStartedRef.current = false;
      return;
    }

    // 3. Login real desde el cliente (el único que funciona correctamente)
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: resolveResult.emailAlias!,
      password,
    });

    if (signInError) {
      // Mostrar el error real de Supabase para diagnóstico
      console.error("SignIn error:", signInError);

      // 4. Registrar intento fallido y verificar bloqueo
      const failResult = await recordFailedAttemptAction(username);

      if (failResult.blocked) {
        setError(failResult.error ?? "Cuenta bloqueada temporalmente.");
        setIsBlocked(true);
      } else if (
        signInError.message?.includes("Email not confirmed") ||
        signInError.message?.includes("email_not_confirmed")
      ) {
        setError("El correo electrónico no está confirmado. Contacta al administrador.");
      } else if (
        signInError.message?.includes("Invalid login credentials") ||
        signInError.code === "invalid_credentials"
      ) {
        setError("Usuario o contraseña incorrectos.");
      } else {
        // Error inesperado — lo mostramos para depurar
        setError(`Error al iniciar sesión: ${signInError.message}`);
      }

      setIsLoading(false);
      hasStartedRef.current = false;
      return;
    }

    // 5. Registrar intento exitoso
    await recordSuccessfulAttemptAction(username);

    // 6. Redirigir (navegación completa para refrescar middleware)
    window.location.href = redirectTo ?? "/dashboard";
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
      {error && (
        <div role="alert" className="space-y-1">
          <p className="text-sm text-destructive">{error}</p>
          {isBlocked && (
            <p className="text-xs text-muted-foreground">
              La cuenta se desbloqueará automáticamente. Si necesitas acceso
              urgente, contacta con un administrador.
            </p>
          )}
        </div>
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
