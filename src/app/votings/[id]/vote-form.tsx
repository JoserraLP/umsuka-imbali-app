"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { castVoteAction } from "@/app/votings/actions";
import type { VotingOption } from "@/lib/votings/queries";

interface VoteFormProps {
  votingId: string;
  options: VotingOption[];
}

export function VoteForm({ votingId, options }: VoteFormProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!selected) {
      setError("Selecciona una opción.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const result = await castVoteAction({
      voting_id: votingId,
      option_id: selected,
    });

    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error ?? "No se pudo registrar el voto.");
      return;
    }

    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-2">
        {options.map((option) => {
          const isSelected = selected === option.id;
          return (
            <label
              key={option.id}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-colors ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/50"
              }`}
            >
              <input
                type="radio"
                name="voting-option"
                value={option.id}
                checked={isSelected}
                onChange={() => setSelected(option.id)}
                className="h-4 w-4 accent-primary"
              />
              <span className="font-medium">{option.optionText}</span>
            </label>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      <Button
        type="submit"
        disabled={isSubmitting || selected === null}
      >
        {isSubmitting ? "Enviando…" : "Votar"}
      </Button>
    </form>
  );
}