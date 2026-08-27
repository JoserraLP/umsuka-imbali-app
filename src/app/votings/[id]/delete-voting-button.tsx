"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { deleteVotingAction } from "@/app/votings/actions";
import { Trash2 } from "lucide-react";

interface DeleteVotingButtonProps {
  votingId: string;
}

export function DeleteVotingButton({ votingId }: DeleteVotingButtonProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!confirm("¿Seguro que quieres eliminar esta votación? Se borrarán todas las opciones y votos. Esta acción no se puede deshacer.")) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const result = await deleteVotingAction({ voting_id: votingId });

    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error ?? "No se pudo eliminar la votación.");
      return;
    }

    router.push("/votings");
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={isSubmitting}
        onClick={handleDelete}
      >
        <Trash2 className="h-4 w-4" />
        {isSubmitting ? "Eliminando…" : "Eliminar votación"}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
