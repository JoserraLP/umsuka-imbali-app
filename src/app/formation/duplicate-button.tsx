"use client";

import { useTransition, useState } from "react";
import { Button } from "@/components/ui/button";
import { duplicateFormationAction } from "@/lib/formation/actions";
import { useRouter } from "next/navigation";

export function DuplicateButton({ formationId }: { formationId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handle = () => {
    startTransition(async () => {
      const res = await duplicateFormationAction(formationId);
      if (!res.success) setError(res.error ?? "Error al duplicar.");
      else {
        setError(null);
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <Button variant="outline" size="sm" onClick={handle} disabled={isPending}>
        {isPending ? "Duplicando…" : "Duplicar"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
