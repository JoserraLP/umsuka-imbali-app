"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  useFieldArray,
  useForm,
  type FieldError,
  type FieldErrors,
} from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  votingFormSchema,
  type VotingFormValues,
} from "@/lib/votings/schema";
import { normalizeDeadlineInput } from "@/lib/votings/logic";
import { createVotingAction } from "@/app/votings/actions";
import { Plus, Trash2 } from "lucide-react";

interface VotingFormProps {
  defaultValues: VotingFormValues;
}

/**
 * RHF's useFieldArray requires non-primitive array items, but the voting
 * schema models options as plain strings. The form keeps options as
 * `{ value: string }[]` and this resolver bridges the field-array shape
 * to the string-array schema, so zod validation (quantity, duplicates,
 * lengths) still runs on the real values.
 */
type VotingFormFields = Omit<VotingFormValues, "options"> & {
  options: { value: string }[];
};

function toFormFields(values: VotingFormValues): VotingFormFields {
  return {
    title: values.title,
    description: values.description,
    voting_deadline: values.voting_deadline,
    options: values.options.map((value) => ({ value })),
  };
}

async function votingFormResolver(values: VotingFormFields) {
  const parsed = votingFormSchema.safeParse({
    title: values.title,
    description: values.description,
    // datetime-local produces values without timezone info (e.g.
    // "2026-03-01T23:59"); normalize to a full ISO string (user's local
    // timezone) BEFORE validating, otherwise the ISO-8601 schema check
    // always rejects the deadline.
    voting_deadline: normalizeDeadlineInput(values.voting_deadline),
    options: values.options.map((option) => option.value),
  });

  if (parsed.success) {
    return { values: parsed.data, errors: {} };
  }

  const errors: FieldErrors<VotingFormFields> = {};
  for (const issue of parsed.error.issues) {
    const [fieldName, index] = issue.path as (string | number)[];
    if (fieldName === "options") {
      errors.options = errors.options ?? [];
      if (typeof index === "number") {
        errors.options[index] = { type: "validate", message: issue.message };
      } else {
        // Array-level issue (min/max options, duplicate texts).
        (errors.options as { root?: FieldError }).root = {
          type: "validate",
          message: issue.message,
        };
      }
    } else if (
      fieldName === "title" ||
      fieldName === "description" ||
      fieldName === "voting_deadline"
    ) {
      (errors as Record<string, FieldError>)[fieldName] = {
        type: "validate",
        message: issue.message,
      };
    }
  }

  return { values: {}, errors };
}

function getOptionsRootError(
  error: FieldErrors<VotingFormFields>["options"],
): string | undefined {
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return undefined;
  }
  if (!("root" in error)) return undefined;
  return (error as { root?: { message?: string } }).root?.message;
}

export function VotingForm({ defaultValues }: VotingFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<VotingFormFields, unknown, VotingFormValues>({
    resolver: votingFormResolver,
    defaultValues: toFormFields(defaultValues),
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "options",
  });

  async function onSubmit(values: VotingFormValues) {
    setServerError(null);

    // The resolver already normalized the deadline to ISO (or null);
    // pass it through unchanged — the schema re-validates server-side.
    const result = await createVotingAction(values);

    if (!result.success) {
      console.error("Error al crear la votación:", result.error);
      setServerError(result.error ?? "No se pudo crear la votación.");
      return;
    }

    router.push(result.id ? `/votings/${result.id}` : "/votings");
    router.refresh();
  }

  const optionsRootError = getOptionsRootError(errors.options);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      {/* Title */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="title">Título</Label>
        <Input
          id="title"
          placeholder="Ej: ¿Dónde celebramos el próximo ensayo general?"
          {...register("title")}
        />
        {errors.title && (
          <p className="text-xs text-destructive">{errors.title.message}</p>
        )}
      </div>

      {/* Description */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Descripción</Label>
        <textarea
          id="description"
          rows={4}
          placeholder="Explica el contexto de la votación (opcional)..."
          {...register("description")}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {errors.description && (
          <p className="text-xs text-destructive">
            {errors.description.message}
          </p>
        )}
      </div>

      {/* Voting deadline */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="voting_deadline">Fecha límite (opcional)</Label>
        <Input
          id="voting_deadline"
          type="datetime-local"
          {...register("voting_deadline", {
            setValueAs: (value: string) => (value ? value : null),
          })}
        />
        <p className="text-xs text-muted-foreground">
          Si la fijas, la votación cerrará automáticamente a esa hora.
        </p>
        {errors.voting_deadline && (
          <p className="text-xs text-destructive">
            {errors.voting_deadline.message}
          </p>
        )}
      </div>

      {/* Options */}
      <div className="flex flex-col gap-2">
        <Label>Opciones (2 a 20)</Label>
        {fields.map((field, index) => (
          <div key={field.id} className="flex flex-col gap-1">
            <div className="flex items-start gap-2">
              <Input
                placeholder={`Opción ${index + 1}`}
                {...register(`options.${index}.value` as const)}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => remove(index)}
                disabled={fields.length <= 2}
                aria-label={`Eliminar opción ${index + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {errors.options?.[index]?.message && (
              <p className="text-xs text-destructive">
                {errors.options?.[index]?.message}
              </p>
            )}
          </div>
        ))}
        {optionsRootError && (
          <p className="text-xs text-destructive">{optionsRootError}</p>
        )}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ value: "" })}
            disabled={fields.length >= 20}
          >
            <Plus className="h-4 w-4" />
            Añadir opción
          </Button>
        </div>
      </div>

      {serverError && (
        <p role="alert" className="text-sm text-destructive">
          {serverError}
        </p>
      )}

      <div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creando…" : "Crear votación"}
        </Button>
      </div>
    </form>
  );
}