"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createInstrumentAction,
  updateInstrumentAction,
} from "@/app/instruments/actions";

interface InstrumentFormProps {
  mode: "create" | "edit";
  instrumentId?: string;
  defaultValues?: {
    name: string;
    category: string;
    description: string;
  };
}

export function InstrumentForm({
  mode,
  instrumentId,
  defaultValues,
}: InstrumentFormProps) {
  const router = useRouter();
  const [name, setName] = useState(defaultValues?.name ?? "");
  const [category, setCategory] = useState(defaultValues?.category ?? "");
  const [description, setDescription] = useState(
    defaultValues?.description ?? "",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    setIsSubmitting(true);
    setError(null);

    const input = {
      name: name.trim(),
      category: category.trim(),
      description: description.trim(),
    };

    const result =
      mode === "create"
        ? await createInstrumentAction(input)
        : await updateInstrumentAction({ id: instrumentId!, ...input });

    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error ?? "No se pudo guardar el instrumento.");
      return;
    }

    if (mode === "create") {
      router.push(result.id ? `/instruments/${result.id}` : "/instruments");
    }
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="instrument-name">Nombre</Label>
        <Input
          id="instrument-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej: Tambor mayor"
          required
          maxLength={200}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="instrument-category">Categoría (opcional)</Label>
        <Input
          id="instrument-category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Ej: Percusión"
          maxLength={100}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="instrument-description">Descripción (opcional)</Label>
        <textarea
          id="instrument-description"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Estado, historia o notas del instrumento..."
          maxLength={2000}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div>
        <Button type="submit" disabled={isSubmitting || !name.trim()}>
          {isSubmitting
            ? "Guardando…"
            : mode === "create"
              ? "Crear instrumento"
              : "Guardar cambios"}
        </Button>
      </div>
    </form>
  );
}