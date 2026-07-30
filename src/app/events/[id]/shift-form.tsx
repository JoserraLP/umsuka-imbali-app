"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  shiftFormSchema,
  type ShiftFormValues,
} from "@/lib/shifts/schema";


const WORKGROUP_LABELS: Record<string, string> = {
  telas: "Telas",
  barra: "Barra",
  estandarte: "Estandarte",
  limpieza: "Limpieza",
  ninguno: "Sin filtro",
};

interface ShiftFormProps {
  mode: "create" | "edit";
  eventId: string;
  defaultValues?: Partial<ShiftFormValues>;
  shiftId?: string;
  onSubmit: (
    values: ShiftFormValues & { eventId: string; id?: string },
  ) => Promise<{ success: boolean; error?: string }>;
  onCancel?: () => void;
}

export function ShiftForm({
  mode,
  eventId,
  defaultValues,
  shiftId,
  onSubmit,
  onCancel,
}: ShiftFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ShiftFormValues>({
    resolver: zodResolver(shiftFormSchema),
    defaultValues: {
      name: "",
      startTime: "",
      endTime: "",
      maxAssignees: null,
      workgroup: null,
      notes: "",
      ...defaultValues,
    },
  });

  async function handleFormSubmit(values: ShiftFormValues) {
    setServerError(null);

    // Convert local datetime to ISO
    const isoStartTime = new Date(values.startTime).toISOString();
    const isoEndTime = new Date(values.endTime).toISOString();

    const result = await onSubmit({
      ...values,
      startTime: isoStartTime,
      endTime: isoEndTime,
      eventId,
      ...(mode === "edit" && shiftId ? { id: shiftId } : {}),
    });

    if (!result.success) {
      setServerError(result.error ?? "No se pudo guardar el turno.");
      return;
    }

    router.refresh();
    onCancel?.();
  }

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
      <h4 className="text-sm font-semibold">
        {mode === "create" ? "Nuevo turno" : "Editar turno"}
      </h4>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="shift-name">Nombre</Label>
          <Input id="shift-name" {...register("name")} placeholder="Ej: Montaje de barra" />
          {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="shift-workgroup">Grupo de trabajo (opcional)</Label>
          <Select id="shift-workgroup" {...register("workgroup")}>
            {Object.entries(WORKGROUP_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="shift-start">Inicio</Label>
          <Input id="shift-start" type="datetime-local" {...register("startTime")} />
          {errors.startTime && <p className="text-xs text-destructive">{errors.startTime.message}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="shift-end">Fin</Label>
          <Input id="shift-end" type="datetime-local" {...register("endTime")} />
          {errors.endTime && <p className="text-xs text-destructive">{errors.endTime.message}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="shift-max">Máx. asignados (opcional)</Label>
          <Input
            id="shift-max"
            type="number"
            min={1}
            placeholder="Sin límite"
            {...register("maxAssignees", { valueAsNumber: true })}
          />
          {errors.maxAssignees && (
            <p className="text-xs text-destructive">{errors.maxAssignees.message}</p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="shift-notes">Notas internas (opcional)</Label>
        <textarea
          id="shift-notes"
          rows={2}
          {...register("notes")}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder="Instrucciones internas para este turno..."
        />
        {errors.notes && <p className="text-xs text-destructive">{errors.notes.message}</p>}
      </div>

      {serverError && (
        <p role="alert" className="text-sm text-destructive">
          {serverError}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={isSubmitting}>
          {isSubmitting ? "Guardando…" : mode === "create" ? "Crear turno" : "Guardar cambios"}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}
