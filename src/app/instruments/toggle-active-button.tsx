"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toggleInstrumentActiveAction } from "@/app/instruments/actions";
import { Archive, RotateCcw } from "lucide-react";

interface ToggleActiveButtonProps {
  instrumentId: string;
  isActive: boolean;
}

export function ToggleActiveButton({
  instrumentId,
  isActive,
}: ToggleActiveButtonProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    setIsSubmitting(true);
    setError(null);

    const result = await toggleInstrumentActiveAction({
      instrument_id: instrumentId,
    });

    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error ?? "No se pudo cambiar el estado del instrumento.");
      return;
    }

    router.refresh();
  }

  return (
    <div className="space-y-2">
      <form onSubmit={handleSubmit}>
        <Button
          type="submit"
          variant={isActive ? "outline" : "default"}
          size="sm"
          disabled={isSubmitting}
        >
          {isActive ? (
            <>
              <Archive className="h-4 w-4" />
              Desactivar
            </>
          ) : (
            <>
              <RotateCcw className="h-4 w-4" />
              Activar
            </>
          )}
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