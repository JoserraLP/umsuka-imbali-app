"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { updateOwnProfileSchema, type UpdateOwnProfileInput } from "@/lib/profiles/schema";
import { updateOwnProfileAction } from "@/app/profile/actions";

interface ProfileFormProps {
  defaultValues: UpdateOwnProfileInput;
}

const COMPONENT_TYPE_LABELS: Record<UpdateOwnProfileInput["componentType"], string> = {
  music: "Música",
  dance: "Baile",
  member: "Socio/a",
};

export function ProfileForm({ defaultValues }: ProfileFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpdateOwnProfileInput>({
    resolver: zodResolver(updateOwnProfileSchema),
    defaultValues,
  });

  async function onSubmit(values: UpdateOwnProfileInput) {
    setServerError(null);
    const result = await updateOwnProfileAction(values);

    if (!result.success) {
      console.error("Error al actualizar el perfil:", result.error);
      setServerError(result.error ?? "No se pudo guardar el perfil.");
      return;
    }

    setSavedAt(Date.now());
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="firstName">Nombre</Label>
          <Input id="firstName" {...register("firstName")} />
          {errors.firstName && (
            <p className="text-xs text-destructive">{errors.firstName.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lastName">Apellidos</Label>
          <Input id="lastName" {...register("lastName")} />
          {errors.lastName && (
            <p className="text-xs text-destructive">{errors.lastName.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="birthDate">Fecha de nacimiento</Label>
          <Input id="birthDate" type="date" {...register("birthDate")} />
          {errors.birthDate && (
            <p className="text-xs text-destructive">{errors.birthDate.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="componentType">Componente</Label>
          <Select id="componentType" {...register("componentType")}>
            {Object.entries(COMPONENT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          {errors.componentType && (
            <p className="text-xs text-destructive">{errors.componentType.message}</p>
          )}
        </div>
      </div>

      {serverError && (
        <p role="alert" className="text-sm text-destructive">
          {serverError}
        </p>
      )}
      {savedAt && !serverError && (
        <p role="status" className="text-sm text-emerald-600 dark:text-emerald-400">
          Perfil guardado correctamente.
        </p>
      )}

      <div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Guardando…" : "Guardar cambios"}
        </Button>
      </div>
    </form>
  );
}
