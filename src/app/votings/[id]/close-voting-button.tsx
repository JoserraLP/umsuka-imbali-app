"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { closeVotingAction } from "@/app/votings/actions";
import { Lock } from "lucide-react";

interface CloseVotingButtonProps {
  votingId: string;
}

export function CloseVotingButton({ votingId }: CloseVotingButtonProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    setIsSubmitting(true);
    setError(null);

    const result = await closeVotingAction({ voting_id: votingId });

    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error ?? "No se pudo cerrar la votación.");
      return;
    }

    router.refresh();
  }

  return (
    <div className="space-y-2">
      <form onSubmit={handleSubmit}>
        <Button
          type="submit"
          variant="destructive"
          size="sm"
          disabled={isSubmitting}
        >
          <Lock className="h-4 w-4" />
          {isSubmitting ? "Cerrando…" : "Cerrar votación"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}