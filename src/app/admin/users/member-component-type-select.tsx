"use client";

import { useState, useTransition } from "react";
import { Select } from "@/components/ui/select";
import { updateMemberComponentTypeAction } from "@/app/admin/users/actions";
import type { ComponentType } from "@/types/database.types";

interface MemberComponentTypeSelectProps {
  userId: string;
  currentType: ComponentType;
  disableSelf: boolean;
}

const COMPONENT_TYPE_OPTIONS: { value: ComponentType; label: string }[] = [
  { value: "music", label: "Música" },
  { value: "dance", label: "Baile" },
  { value: "member", label: "Socio/a" },
];

export function MemberComponentTypeSelect({
  userId,
  currentType,
  disableSelf,
}: MemberComponentTypeSelectProps) {
  const [componentType, setComponentType] = useState<ComponentType>(currentType);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(nextType: ComponentType) {
    if (nextType === componentType) return;

    setError(null);
    startTransition(async () => {
      const result = await updateMemberComponentTypeAction({ userId, componentType: nextType });

      if (!result.success) {
        console.error("Error al actualizar el tipo de componente:", result.error);
        setError(result.error ?? "No se pudo actualizar el tipo de componente.");
        return;
      }

      setComponentType(nextType);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Select
        value={componentType}
        disabled={disableSelf || isPending}
        onChange={(event) => handleChange(event.target.value as ComponentType)}
        className="w-28"
      >
        {COMPONENT_TYPE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      {disableSelf && (
        <span className="text-xs text-muted-foreground">No puedes cambiar tu propio tipo.</span>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
