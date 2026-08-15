"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { setMyWorkgroupAction } from "@/app/profile/actions";
import type { Workgroup } from "@/types/database.types";

type SelectableWorkgroup = Exclude<Workgroup, "ninguno">;

const WORKGROUP_OPTIONS: { value: SelectableWorkgroup; label: string }[] = [
  { value: "telas", label: "Telas" },
  { value: "barra", label: "Barra" },
  { value: "estandarte", label: "Estandarte" },
  { value: "limpieza", label: "Limpieza" },
];

export function WorkgroupSelectionForm() {
  const router = useRouter();
  const [workgroup, setWorkgroup] = useState<SelectableWorkgroup | "">("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workgroup) return;

    setError(null);
    startTransition(async () => {
      const result = await setMyWorkgroupAction({ workgroup });

      if (!result.success) {
        setError(result.error ?? "No se pudo guardar tu grupo de trabajo.");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="workgroup">Grupo de trabajo</Label>
        <Select
          id="workgroup"
          value={workgroup}
          disabled={isPending}
          onChange={(event) => setWorkgroup(event.target.value as SelectableWorkgroup)}
        >
          <option value="" disabled>
            Selecciona tu grupo…
          </option>
          {WORKGROUP_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Podrás cambiar tu grupo más adelante desde tu perfil.
      </p>

      <Button type="submit" disabled={isPending || !workgroup}>
        {isPending ? "Guardando…" : "Continuar"}
      </Button>
    </form>
  );
}
