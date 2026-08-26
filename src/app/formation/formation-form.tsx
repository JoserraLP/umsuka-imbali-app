"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createFormationAction } from "@/lib/formation/actions";
import { useRouter } from "next/navigation";

interface Props {
  eventOptions?: Array<{ id: string; title: string }>;
}

export function FormationForm({ eventOptions = [] }: Props) {
  const [name, setName] = useState("");
  const [eventId, setEventId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createFormationAction({
        name: name.trim(),
        eventId: eventId || null,
      });
      if (!res.success) setError(res.error ?? "Error al crear formación.");
      else {
        setName("");
        setEventId("");
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="formation-name">Nombre de la formación</Label>
        <Input
          id="formation-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej. Desfile Carnaval 2026"
          maxLength={200}
          required
        />
      </div>
      {eventOptions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="formation-event">Evento asociado (opcional)</Label>
          <select
            id="formation-event"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          >
            <option value="">Sin evento (formación base)</option>
            {eventOptions.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.title}
              </option>
            ))}
          </select>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={isPending || !name.trim()} size="sm">
        {isPending ? "Creando…" : "Crear formación"}
      </Button>
    </form>
  );
}
