"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Avatar } from "@/components/feed/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  isAllowedAvatarUrl,
  updateMemberProfileSchema,
  type UpdateMemberProfileInput,
} from "@/lib/profiles/schema";
import { updateMemberProfileAction } from "@/app/admin/users/actions";
import { getSkillsErrorMessages, SkillsInput } from "@/app/profile/skills-input";
import type { Workgroup } from "@/types/database.types";

interface MemberEditFormProps {
  defaultValues: UpdateMemberProfileInput;
}

const COMPONENT_TYPE_LABELS: Record<UpdateMemberProfileInput["componentType"], string> = {
  music: "Música",
  dance: "Baile",
  member: "Socio/a",
};

const WORKGROUP_LABELS: Record<Workgroup, string> = {
  telas: "Telas",
  barra: "Barra",
  estandarte: "Estandarte",
  limpieza: "Limpieza",
  ninguno: "Ninguno",
};

export function MemberEditForm({ defaultValues }: MemberEditFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<UpdateMemberProfileInput>({
    resolver: zodResolver(updateMemberProfileSchema),
    defaultValues,
  });

  const componentType = useWatch({ control, name: "componentType" });
  const requiresWorkgroup = componentType === "music" || componentType === "dance";

  const skills = useWatch({ control, name: "skills" }) ?? [];
  const avatarUrl = useWatch({ control, name: "avatarUrl" }) ?? "";
  const showAvatarPreview = Boolean(avatarUrl.trim()) && isAllowedAvatarUrl(avatarUrl.trim());

  async function onSubmit(values: UpdateMemberProfileInput) {
    setServerError(null);

    if (requiresWorkgroup && (!values.workgroup || values.workgroup === "ninguno")) {
      setServerError(
        "Música y baile requieren un grupo de trabajo obligatoriamente. Asigna un grupo antes de guardar.",
      );
      return;
    }

    const result = await updateMemberProfileAction(values);

    if (!result.success) {
      console.error("Error al actualizar el perfil del miembro:", result.error);
      setServerError(result.error ?? "No se pudo guardar el perfil.");
      return;
    }

    setSavedAt(Date.now());
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <input type="hidden" {...register("userId")} />

      <div className="flex items-center gap-4">
        <Avatar
          src={showAvatarPreview ? avatarUrl : null}
          fallback={`${defaultValues.firstName.charAt(0)}${defaultValues.lastName.charAt(0)}`}
          size="lg"
        />
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="avatarUrl">Foto de perfil (URL)</Label>
          <Input id="avatarUrl" placeholder="https://…" {...register("avatarUrl")} />
          {errors.avatarUrl && (
            <p className="text-xs text-destructive">{errors.avatarUrl.message}</p>
          )}
        </div>
      </div>

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
          {errors.lastName && <p className="text-xs text-destructive">{errors.lastName.message}</p>}
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

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="workgroup">Grupo de trabajo</Label>
          <Select id="workgroup" {...register("workgroup")}>
            {Object.entries(WORKGROUP_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          {requiresWorkgroup && (
            <p className="text-xs text-muted-foreground">
              Música y baile requieren un grupo de trabajo obligatoriamente.
            </p>
          )}
          {errors.workgroup && (
            <p className="text-xs text-destructive">{errors.workgroup.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phone">Teléfono</Label>
          <Input id="phone" placeholder="+34 600 000 000" {...register("phone")} />
          {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="joinedAt">Fecha de incorporación a la comparsa</Label>
          <Input id="joinedAt" type="date" {...register("joinedAt")} />
          {errors.joinedAt && <p className="text-xs text-destructive">{errors.joinedAt.message}</p>}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="bio">Biografía</Label>
        <textarea
          id="bio"
          rows={4}
          placeholder="Cuéntanos quién es este miembro…"
          {...register("bio")}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {errors.bio && <p className="text-xs text-destructive">{errors.bio.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="skills">Habilidades</Label>
        <SkillsInput
          value={skills}
          onChange={(next) => setValue("skills", next, { shouldValidate: true })}
        />
        {getSkillsErrorMessages(errors.skills).map((message) => (
          <p key={message} className="text-xs text-destructive">
            {message}
          </p>
        ))}
      </div>

      {serverError && (
        <p role="alert" className="text-sm text-destructive">
          {serverError}
        </p>
      )}
      {savedAt && !serverError && (
        <p role="status" className="text-sm text-emerald-600 dark:text-emerald-400">
          Cambios guardados correctamente.
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
