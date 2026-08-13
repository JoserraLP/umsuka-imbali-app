"use client";

import { useState, useTransition } from "react";
import { Select } from "@/components/ui/select";
import { setComponentLeadAction } from "@/app/admin/users/actions";

interface MemberComponentLeadSelectProps {
  userId: string;
  currentLead: string | null;
  disableSelf: boolean;
}

const COMPONENT_LEAD_OPTIONS: { value: "music" | "dance" | "none"; label: string }[] = [
  { value: "none", label: "Sin cargo" },
  { value: "music", label: "Música" },
  { value: "dance", label: "Baile" },
];

export function MemberComponentLeadSelect({
  userId,
  currentLead,
  disableSelf,
}: MemberComponentLeadSelectProps) {
  const initialLead: "music" | "dance" | "none" =
    currentLead === "music" || currentLead === "dance" ? currentLead : "none";
  const [lead, setLead] = useState<"music" | "dance" | "none">(initialLead);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(next: "music" | "dance" | "none") {
    if (next === lead) return;

    setError(null);
    startTransition(async () => {
      const result = await setComponentLeadAction(userId, next === "none" ? null : next);

      if (!result.success) {
        console.error("Error al actualizar el responsable del componente:", result.error);
        setError(result.error ?? "No se pudo actualizar el responsable del componente.");
        return;
      }

      setLead(next);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Select
        value={lead}
        disabled={disableSelf || isPending}
        onChange={(event) => handleChange(event.target.value as "music" | "dance" | "none")}
        className="w-32"
      >
        {COMPONENT_LEAD_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      {disableSelf && (
        <span className="text-xs text-muted-foreground">No puedes cambiarte tu propio cargo.</span>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
