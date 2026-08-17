"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { AudienceSelector } from "@/app/events/audience-selector";
import { updateEventAudienceAction } from "@/app/events/audience-actions";
import {
  audienceSchema,
  type AudienceMemberOption,
  type AudienceValues,
  type EventAudience,
} from "@/lib/events/audience-shared";
import type { EventTypeValue } from "@/lib/events/schema";

interface AudienceEditorProps {
  eventId: string;
  eventType: EventTypeValue;
  initial: EventAudience | null;
  members: AudienceMemberOption[];
}

/**
 * Compact inline audience editor for the event detail page (Sprint 18),
 * shown to management/creators. Reuses AudienceSelector and backs on
 * updateEventAudienceAction. work_shift events cannot be reconfigured —
 * they are always shown to their workgroup (static note instead).
 */
export function AudienceEditor({ eventId, eventType, initial, members }: AudienceEditorProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const { control, handleSubmit } = useForm<AudienceValues>({
    resolver: zodResolver(audienceSchema),
    defaultValues: {
      audienceType: initial?.audienceType ?? "all",
      audienceWorkgroup: (initial?.audienceWorkgroup ?? null) as AudienceValues["audienceWorkgroup"],
      audienceMemberType: initial?.audienceMemberType ?? null,
      audienceUserIds: (initial?.users ?? []).map((user) => user.id),
    },
  });

  if (eventType === "work_shift") {
    return (
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Audiencia</h3>
        <p className="text-xs text-muted-foreground">
          Los eventos de trabajo solo se muestran a su grupo de trabajo.
        </p>
      </div>
    );
  }

  function onSubmit(values: AudienceValues) {
    setServerError(null);

    startTransition(async () => {
      const result = await updateEventAudienceAction({ eventId, ...values });

      if (!result.success) {
        console.error("Error al actualizar la audiencia:", result.error);
        setServerError(result.error ?? "No se pudo actualizar la audiencia.");
        return;
      }

      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">Audiencia</h3>
      <AudienceSelector
        control={control}
        members={members}
        selectedMembers={initial?.users ?? []}
      />
      {serverError && (
        <p role="alert" className="text-sm text-destructive">
          {serverError}
        </p>
      )}
      <div>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Guardando…" : "Guardar audiencia"}
        </Button>
      </div>
    </form>
  );
}