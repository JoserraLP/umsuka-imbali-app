"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteFormationAction } from "@/lib/formation/actions";

interface Props {
  formationId: string;
  formationName: string;
  variant?: "list" | "detail";
}

export function DeleteFormationButton({ formationId, formationName, variant = "list" }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    const confirmed = window.confirm(
      `¿Seguro que quieres eliminar la formación "${formationName}"? Se borrarán todas sus posiciones e instrumentos asignados. Esta acción no se puede deshacer.`,
    );
    if (!confirmed) return;

    setError(null);
    startTransition(async () => {
      const result = await deleteFormationAction({ formationId });

      if (!result.success) {
        console.error("Error al eliminar formación:", result.error);
        setError(result.error ?? "No se pudo eliminar la formación.");
        return;
      }

      // Si estamos en detalle, volver al listado
      if (variant === "detail") {
        router.push("/formation");
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={isPending}
        onClick={handleDelete}
        className={variant === "list" ? "h-7 px-2 text-xs" : ""}
      >
        {isPending ? "Eliminando…" : "Eliminar"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
