"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setMemberActiveAction } from "@/app/admin/users/actions";

interface MemberActiveToggleProps {
  userId: string;
  isActive: boolean;
  disableSelf: boolean;
}

export function MemberActiveToggle({ userId, isActive, disableSelf }: MemberActiveToggleProps) {
  const [active, setActive] = useState(isActive);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    setError(null);
    const nextValue = !active;

    startTransition(async () => {
      const result = await setMemberActiveAction({ userId, isActive: nextValue });

      if (!result.success) {
        console.error("Error al cambiar el estado del miembro:", result.error);
        setError(result.error ?? "No se pudo actualizar el estado.");
        return;
      }

      setActive(nextValue);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant={active ? "outline" : "secondary"}
        size="sm"
        disabled={disableSelf || isPending}
        onClick={handleToggle}
      >
        {isPending ? "Guardando…" : active ? "Dar de baja" : "Dar de alta"}
      </Button>
      {disableSelf && (
        <span className="text-xs text-muted-foreground">No puedes darte de baja a ti mismo.</span>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
