"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteEventAction } from "@/app/events/actions";

export function DeleteEventButton({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    const confirmed = window.confirm(
      "¿Seguro que quieres eliminar este evento? Esta acción no se puede deshacer.",
    );
    if (!confirmed) {
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await deleteEventAction({ id: eventId });

      if (!result.success) {
        console.error("Error al eliminar el evento:", result.error);
        setError(result.error ?? "No se pudo eliminar el evento.");
        return;
      }

      router.push("/events");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant="destructive" size="sm" disabled={isPending} onClick={handleDelete}>
        {isPending ? "Eliminando…" : "Eliminar evento"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
