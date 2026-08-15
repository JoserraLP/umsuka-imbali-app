"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { setMyWorkgroupAction } from "@/app/profile/actions";
import type { Workgroup } from "@/types/database.types";

interface WorkgroupSectionProps {
  currentWorkgroup: Workgroup;
}

type SelectableWorkgroup = Exclude<Workgroup, "ninguno">;

const WORKGROUP_OPTIONS: { value: SelectableWorkgroup; label: string }[] = [
  { value: "telas", label: "Telas" },
  { value: "barra", label: "Barra" },
  { value: "estandarte", label: "Estandarte" },
  { value: "limpieza", label: "Limpieza" },
];

const WORKGROUP_LABELS: Record<Workgroup, string> = {
  telas: "Telas",
  barra: "Barra",
  estandarte: "Estandarte",
  limpieza: "Limpieza",
  ninguno: "Ninguno",
};

/**
 * "Mi grupo de trabajo" section on /profile: shows the current group and
 * lets the member change it. Anyone can change their own group; the super
 * admin can additionally change it from the admin panel.
 */
export function WorkgroupSection({ currentWorkgroup }: WorkgroupSectionProps) {
  const router = useRouter();
  const [workgroup, setWorkgroup] = useState<Workgroup>(currentWorkgroup);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(nextWorkgroup: SelectableWorkgroup) {
    if (nextWorkgroup === workgroup) return;

    setError(null);
    startTransition(async () => {
      const result = await setMyWorkgroupAction({ workgroup: nextWorkgroup });

      if (!result.success) {
        console.error("Error al cambiar el grupo de trabajo:", result.error);
        setError(result.error ?? "No se pudo cambiar el grupo de trabajo.");
        return;
      }

      setWorkgroup(nextWorkgroup);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Label htmlFor="my-workgroup" className="text-sm text-muted-foreground">
          Grupo actual:
        </Label>
        <Select
          id="my-workgroup"
          value={workgroup}
          disabled={isPending}
          onChange={(event) => handleChange(event.target.value as SelectableWorkgroup)}
          className="w-44"
        >
          {currentWorkgroup === "ninguno" && (
            <option value="ninguno" disabled>
              Sin asignar
            </option>
          )}
          {WORKGROUP_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        {currentWorkgroup === "ninguno"
          ? "Aún no tienes un grupo asignado. Elígelo para poder acceder a la aplicación."
          : `Perteneces a ${WORKGROUP_LABELS[currentWorkgroup]}. Puedes cambiarlo cuando quieras; el super admin también puede cambiarlo desde el panel de administración.`}
      </p>
    </div>
  );
}
