"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { generateResetTokenAction } from "@/app/admin/users/actions";
import { Copy, Check, Loader2 } from "lucide-react";

interface ResetPasswordButtonProps {
  profileId: string;
  username: string;
}

export function ResetPasswordButton({
  profileId,
  username,
}: ResetPasswordButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    setIsLoading(true);
    setError(null);
    setToken(null);

    const result = await generateResetTokenAction({ profileId });

    if (!result.success) {
      setError(result.error ?? "Error al generar el token.");
      setIsLoading(false);
      return;
    }

    setToken(result.token!);
    setIsLoading(false);
  }

  async function copyLink() {
    if (!token) return;
    const link = `${window.location.origin}/auth/reset-password?token=${token}`;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Show generated token inline
  if (token) {
    return (
      <div className="mt-2 rounded-md border border-border bg-muted/50 p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Token generado para {username} (válido 24h, un solo uso):
        </p>
        <code className="block break-all rounded bg-background px-2 py-1 text-xs">
          {window.location.origin}/auth/reset-password?token={token}
        </code>
        <div className="mt-2 flex gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={copyLink}
          >
            {copied ? (
              <>
                <Check className="mr-1 h-3 w-3" /> Copiado
              </>
            ) : (
              <>
                <Copy className="mr-1 h-3 w-3" /> Copiar enlace
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setToken(null)}
          >
            Cerrar
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Entrega este enlace al usuario. No podrás volver a verlo.
        </p>
      </div>
    );
  }

  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        onClick={handleGenerate}
        disabled={isLoading}
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            Generando…
          </>
        ) : (
          "Restablecer contraseña"
        )}
      </Button>
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
