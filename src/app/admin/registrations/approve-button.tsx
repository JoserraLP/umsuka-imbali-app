"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { approveUserAction } from "@/app/admin/registrations/actions";
import { Check } from "lucide-react";

interface ApproveUserButtonProps {
  userId: string;
}

export function ApproveUserButton({ userId }: ApproveUserButtonProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleApprove() {
    setError(null);

    startTransition(async () => {
      const result = await approveUserAction({ userId });

      if (!result.success) {
        console.error("Error al aprobar usuario:", result.error);
        setError(result.error ?? "No se pudo aprobar el usuario.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="default"
        size="sm"
        disabled={isPending}
        onClick={handleApprove}
      >
        <Check className="mr-1 h-4 w-4" />
        {isPending ? "Aprobando…" : "Aprobar"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
