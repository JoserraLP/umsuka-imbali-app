"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { resetPasswordAction } from "@/app/auth/reset-password/actions";
import { Loader2 } from "lucide-react";

interface ResetPasswordFormProps {
  token: string;
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const password = formData.get("password") as string;
    const confirmPassword = formData.get("confirmPassword") as string;

    const result = await resetPasswordAction({
      token,
      password,
      confirmPassword,
    });

    if (!result.success) {
      setError(result.error ?? "Error al restablecer la contraseña.");
      setIsLoading(false);
      return;
    }

    setSuccess(true);
    setIsLoading(false);
  }

  if (success) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Contraseña restablecida</CardTitle>
          <CardDescription>
            Tu contraseña se ha cambiado correctamente. Ahora puedes iniciar
            sesión con tu nueva contraseña.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => router.push("/auth/login")}
            className="w-full"
            size="lg"
          >
            Iniciar sesión
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Restablecer contraseña</CardTitle>
        <CardDescription>
          Introduce tu nueva contraseña. Debe tener al menos 8 caracteres,
          incluir mayúsculas, minúsculas, números y un carácter especial.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="password">Nueva contraseña</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              disabled={isLoading}
              placeholder="Nueva contraseña"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirmar contraseña</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              disabled={isLoading}
              placeholder="Repite la contraseña"
            />
          </div>

          <Button
            type="submit"
            disabled={isLoading}
            className="w-full"
            size="lg"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Restableciendo…
              </>
            ) : (
              "Restablecer contraseña"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
