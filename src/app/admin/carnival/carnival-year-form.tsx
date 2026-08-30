"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { startNewCarnivalYearAction } from "@/lib/carnival/actions";

export function CarnivalYearForm() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await startNewCarnivalYearAction(formData);
      if (!res.success) setError(res.error ?? "Error.");
      else {
        setSuccess(`Nuevo año iniciado. ID: ${res.newYearId}`);
        setConfirmText("");
        (e.target as HTMLFormElement).reset();
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="label">Etiqueta del nuevo año</Label>
        <Input id="label" name="label" placeholder="Carnaval 2027" required maxLength={200} disabled={isPending} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="start_date">Fecha de inicio</Label>
        <Input id="start_date" name="start_date" type="date" required disabled={isPending} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirmText">Escribe AÑO para confirmar</Label>
        <Input
          id="confirmText"
          name="confirmText"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="AÑO"
          required
          disabled={isPending}
        />
        <p className="text-xs text-muted-foreground">
          Se archivará el año activo, se creará una copia completa (estadísticas, formaciones, preguntas, miembros, pagos, asistencias, votaciones, eventos, instrumentos, dinero) y se reiniciarán los contadores del nuevo año a 0. Los perfiles no se borran.
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && <p className="text-sm text-green-600">{success}</p>}
      <Button type="submit" disabled={isPending || confirmText.toUpperCase() !== "AÑO"} variant="destructive">
        {isPending ? "Iniciando..." : "Iniciar nuevo año de carnaval"}
      </Button>
    </form>
  );
}
