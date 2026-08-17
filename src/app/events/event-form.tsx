"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  eventFormSchema,
  type EventFormValues,
  type EventTypeValue,
  type EventWorkgroup,
} from "@/lib/events/schema";
import { createEventWithAudienceAction } from "@/app/events/audience-actions";
import { updateEventAction } from "@/app/events/actions";
import { AudienceSelector } from "@/app/events/audience-selector";
import type { AudienceMemberOption, AudienceUser } from "@/lib/events/audience-shared";
import type { Workgroup } from "@/types/database.types";

const EVENT_TYPE_LABELS: Record<EventTypeValue, string> = {
  general: "General",
  meeting: "Reunión",
  carnival: "Carnaval",
  work_shift: "Asistencia a turno de trabajo",
};

const EVENT_WORKGROUP_LABELS: Record<EventWorkgroup, string> = {
  telas: "Telas",
  barra: "Barra",
  estandarte: "Estandarte",
  limpieza: "Limpieza",
};

interface EventFormProps {
  mode: "create" | "edit";
  eventId?: string;
  defaultValues: EventFormValues;
  /**
   * Workgroup of a non-management lead. When set, the form only allows
   * creating/editing work_shift events for that group (type selector
   * hidden, workgroup selector locked).
   */
  leadWorkgroup?: Workgroup | null;
  /** Active members available for the specific_users selector (Sprint 18). */
  audienceMembers: AudienceMemberOption[];
  /** Preloaded audience users in edit mode (Sprint 18). */
  selectedAudienceUsers?: AudienceUser[];
  /**
   * True when the acting user may configure the audience (management;
   * leads always see the section hidden with audience forced to 'all').
   */
  canConfigureAudience: boolean;
}

export function EventForm({
  mode,
  eventId,
  defaultValues,
  leadWorkgroup,
  audienceMembers,
  selectedAudienceUsers,
  canConfigureAudience,
}: EventFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues,
  });

  const isLead = leadWorkgroup !== undefined;
  const eventType = useWatch({ control, name: "eventType" }) as EventTypeValue | undefined;

  const showWorkgroupField = isLead || eventType === "work_shift";

  async function onSubmit(values: EventFormValues) {
    setServerError(null);

    // datetime-local has no timezone info; convert to an unambiguous ISO
    // string here, in the browser, using the user's own local timezone.
    // Doing this conversion server-side instead would use the server's
    // timezone (typically UTC on Vercel) rather than the user's.
    const isoEventDate = new Date(values.eventDate).toISOString();
    const payload = {
      ...values,
      eventDate: isoEventDate,
      registrationDeadline: values.registrationDeadline
        ? new Date(values.registrationDeadline).toISOString()
        : null,
    };

    const result =
      mode === "create"
        ? await createEventWithAudienceAction(payload)
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
          {isLead ? (
            <>
              <input type="hidden" value="work_shift" {...register("eventType")} />
              <Select id="eventType" disabled value="work_shift">
                <option value="work_shift">{EVENT_TYPE_LABELS.work_shift}</option>
              </Select>
              <p className="text-xs text-muted-foreground">
                Como responsable de grupo solo puedes crear turnos de trabajo de tu grupo.
              </p>
            </>
          ) : (
            <Select id="eventType" {...register("eventType")}>
              {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
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
          {errors.capacity && <p className="text-xs text-destructive">{errors.capacity.message}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="location">Lugar (opcional)</Label>
          <Input
            id="location"
            type="text"
            placeholder="Ej. Plaza Mayor, 1"
            {...register("location")}
          />
          {errors.location && <p className="text-xs text-destructive">{errors.location.message}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="registrationDeadline">Fecha límite de inscripción (opcional)</Label>
          <Input
            id="registrationDeadline"
            type="datetime-local"
            {...register("registrationDeadline")}
          />
          {errors.registrationDeadline && (
            <p className="text-xs text-destructive">{errors.registrationDeadline.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="imageUrl">Imagen (URL, opcional)</Label>
          <Input id="imageUrl" type="url" placeholder="https://…" {...register("imageUrl")} />
          {errors.imageUrl && <p className="text-xs text-destructive">{errors.imageUrl.message}</p>}
        </div>

        {showWorkgroupField && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="workgroup">Grupo de trabajo</Label>
            <Select
              id="workgroup"
              disabled={isLead}
              value={isLead ? (leadWorkgroup ?? "ninguno") : undefined}
              {...register("workgroup")}
            >
              {Object.entries(EVENT_WORKGROUP_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              El evento de trabajo solo será visible para los miembros de este grupo.
            </p>
            {errors.workgroup && (
              <p className="text-xs text-destructive">{errors.workgroup.message}</p>
            )}
          </div>
        )}

        {canConfigureAudience && (
          <div className="sm:col-span-2">
            <AudienceSelector
              control={control}
              disabled={eventType === "work_shift"}
              members={audienceMembers}
              selectedMembers={selectedAudienceUsers ?? []}
            />
          </div>
        )}
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
