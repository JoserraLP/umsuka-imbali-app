"use client";

import { useState, useTransition } from "react";
import { Select } from "@/components/ui/select";
import { updateMemberWorkgroupAction } from "@/app/admin/users/actions";
import type { Workgroup } from "@/types/database.types";

interface MemberWorkgroupSelectProps {
  userId: string;
  currentWorkgroup: Workgroup;
  requiresWorkgroup: boolean;
}

const WORKGROUP_OPTIONS: { value: Workgroup; label: string }[] = [
  { value: "telas", label: "Telas" },
  { value: "barra", label: "Barra" },
  { value: "estandarte", label: "Estandarte" },
  { value: "limpieza", label: "Limpieza" },
  { value: "ninguno", label: "Ninguno" },
];

export function MemberWorkgroupSelect({
  userId,
  currentWorkgroup,
  requiresWorkgroup,
}: MemberWorkgroupSelectProps) {
  const [workgroup, setWorkgroup] = useState<Workgroup>(currentWorkgroup);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(nextWorkgroup: Workgroup) {
    if (nextWorkgroup === workgroup) return;

    setError(null);
    startTransition(async () => {
      const result = await updateMemberWorkgroupAction({ userId, workgroup: nextWorkgroup });

      if (!result.success) {
        console.error("Error al actualizar el grupo de trabajo:", result.error);
        setError(result.error ?? "No se pudo actualizar el grupo de trabajo.");
        return;
      }

      setWorkgroup(nextWorkgroup);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Select
        value={workgroup}
        disabled={isPending}
        onChange={(event) => handleChange(event.target.value as Workgroup)}
        className="w-32"
      >
        {WORKGROUP_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      {requiresWorkgroup && workgroup === "ninguno" && (
        <span className="text-xs text-destructive">Obligatorio para música/baile.</span>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
