"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { eventFormSchema, type EventFormValues, type EventTypeValue } from "@/lib/events/schema";
import { createEventAction, updateEventAction } from "@/app/events/actions";

const EVENT_TYPE_LABELS: Record<EventTypeValue, string> = {
  general: "General",
  meeting: "Reunión",
  carnival: "Carnaval",
  work_shift: "Asistencia a turno de trabajo",
};

interface EventFormProps {
  mode: "create" | "edit";
  eventId?: string;
  defaultValues: EventFormValues;
}

export function EventForm({ mode, eventId, defaultValues }: EventFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues,
  });

  async function onSubmit(values: EventFormValues) {
    setServerError(null);

    // datetime-local has no timezone info; convert to an unambiguous ISO
    // string here, in the browser, using the user's own local timezone.
    // Doing this conversion server-side instead would use the server's
    // timezone (typically UTC on Vercel) rather than the user's.
    const isoEventDate = new Date(values.eventDate).toISOString();
    const payload = { ...values, eventDate: isoEventDate };

    const result =
      mode === "create"
        ? await createEventAction(payload)
        : await updateEventAction({ ...payload, id: eventId as string });

    if (!result.success) {
      console.error("Error al guardar el evento:", result.error);
      setServerError(result.error ?? "No se pudo guardar el evento.");
      return;
    }

    const targetId = mode === "create" ? result.id : eventId;
    router.push(targetId ? `/events/${targetId}` : "/events");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="title">Título</Label>
        <Input id="title" {...register("title")} />
        {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Descripción</Label>
        <textarea
          id="description"
          rows={4}
          {...register("description")}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {errors.description && (
          <p className="text-xs text-destructive">{errors.description.message}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="eventType">Tipo</Label>
          <Select id="eventType" {...register("eventType")}>
            {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          {errors.eventType && (
            <p className="text-xs text-destructive">{errors.eventType.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="eventDate">Fecha y hora</Label>
          <Input id="eventDate" type="datetime-local" {...register("eventDate")} />
          {errors.eventDate && (
            <p className="text-xs text-destructive">{errors.eventDate.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="capacity">Aforo (opcional)</Label>
          <Input
            id="capacity"
            type="number"
            min={1}
            placeholder="Sin límite"
            {...register("capacity", { valueAsNumber: true })}
          />
          {errors.capacity && (
            <p className="text-xs text-destructive">{errors.capacity.message}</p>
          )}
        </div>
      </div>

      {serverError && (
        <p role="alert" className="text-sm text-destructive">
          {serverError}
        </p>
      )}

      <div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Guardando…" : mode === "create" ? "Crear evento" : "Guardar cambios"}
        </Button>
      </div>
    </form>
  );
}
