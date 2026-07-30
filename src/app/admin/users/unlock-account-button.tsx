"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { unlockAccountAction } from "@/app/admin/users/actions";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";

interface UnlockAccountButtonProps {
  profileId: string;
  username: string;
}

export function UnlockAccountButton({
  profileId,
  username,
}: UnlockAccountButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  async function handleUnlock() {
    if (!confirm(`¿Desbloquear la cuenta de "${username}"? Se eliminarán todos los intentos fallidos de login.`)) {
      return;
    }

    setIsLoading(true);
    setResult(null);

    const res = await unlockAccountAction(profileId);

    if (res.success) {
      setResult({ success: true, message: "Cuenta desbloqueada." });
    } else {
      setResult({
        success: false,
        message: res.error ?? "Error al desbloquear.",
      });
    }

    setIsLoading(false);

    // Limpiar el mensaje después de 3 segundos
    setTimeout(() => setResult(null), 3000);
  }

  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        onClick={handleUnlock}
        disabled={isLoading}
        className="text-amber-600 hover:text-amber-700"
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            Desbloqueando…
          </>
        ) : (
          <>
            <ShieldAlert className="mr-1 h-3 w-3" />
            Desbloquear cuenta
          </>
        )}
      </Button>

      {result && (
        <p
          className={`mt-1 text-xs ${
            result.success ? "text-emerald-600" : "text-destructive"
          }`}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
