"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addOptionAction } from "@/app/votings/actions";

interface AddOptionFormProps {
  votingId: string;
}

export function AddOptionForm({ votingId }: AddOptionFormProps) {
  const router = useRouter();
  const [optionText, setOptionText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!optionText.trim()) return;

    setIsSubmitting(true);
    setError(null);

    const result = await addOptionAction({
      voting_id: votingId,
      option_text: optionText.trim(),
    });

    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error ?? "No se pudo añadir la opción.");
      return;
    }

    setOptionText("");
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <Input
          value={optionText}
          onChange={(e) => setOptionText(e.target.value)}
          placeholder="Nueva opción..."
          className="flex-1"
        />
        <Button
          type="submit"
          size="sm"
          disabled={isSubmitting || !optionText.trim()}
        >
          {isSubmitting ? "Añadiendo…" : "Añadir"}
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