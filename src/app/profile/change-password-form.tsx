"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

export function ChangePasswordForm() {
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);

    const formData = new FormData(e.currentTarget);
    const newPassword = (formData.get("newPassword") as string) ?? "";
    const confirmPassword = (formData.get("confirmPassword") as string) ?? "";

    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "Las contraseñas no coinciden." });
      setIsLoading(false);
      return;
    }

    if (newPassword.length < 8) {
      setMessage({
        type: "error",
        text: "La contraseña debe tener al menos 8 caracteres.",
      });
      setIsLoading(false);
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      setMessage({ type: "error", text: error.message });
    } else {
      setMessage({
        type: "success",
        text: "Contraseña actualizada correctamente.",
      });
      (e.target as HTMLFormElement).reset();
    }

    setIsLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {message && (
        <p
          role="alert"
          className={`text-sm ${
            message.type === "success" ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="newPassword">Nueva contraseña</Label>
          <Input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            disabled={isLoading}
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
            minLength={8}
            disabled={isLoading}
          />
        </div>
      </div>

      <Button type="submit" disabled={isLoading} variant="outline" size="sm">
        {isLoading ? "Actualizando…" : "Cambiar contraseña"}
      </Button>
    </form>
  );
}
