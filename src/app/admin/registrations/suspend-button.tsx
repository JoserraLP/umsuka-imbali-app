"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { suspendUserAction } from "@/app/admin/registrations/actions";
import { Ban } from "lucide-react";

interface SuspendUserButtonProps {
  userId: string;
}

export function SuspendUserButton({ userId }: SuspendUserButtonProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSuspend() {
    setError(null);

    startTransition(async () => {
      const result = await suspendUserAction({ userId });

      if (!result.success) {
        console.error("Error al suspender usuario:", result.error);
        setError(result.error ?? "No se pudo suspender el usuario.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={isPending}
        onClick={handleSuspend}
      >
        <Ban className="mr-1 h-4 w-4" />
        {isPending ? "Suspendiendo…" : "Suspender"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
