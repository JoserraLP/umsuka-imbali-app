"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  questionFormSchema,
  QUESTION_CATEGORIES,
  QUESTION_PRIORITIES,
  type QuestionFormValues,
} from "@/lib/questions/schema";
import { createQuestionAction } from "@/app/questions/actions";

const CATEGORY_LABELS: Record<string, string> = {
  general: "General",
  ensayo: "Ensayo",
  evento: "Evento",
  vestuario: "Vestuario",
  musica: "Música",
  otro: "Otro",
};

const PRIORITY_LABELS: Record<string, string> = {
  baja: "Baja",
  media: "Media",
  alta: "Alta",
};

interface QuestionFormProps {
  defaultValues: QuestionFormValues;
}

export function QuestionForm({ defaultValues }: QuestionFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<QuestionFormValues>({
    resolver: zodResolver(questionFormSchema),
    defaultValues,
  });

  async function onSubmit(values: QuestionFormValues) {
    setServerError(null);

    const result = await createQuestionAction(values);

    if (!result.success) {
      console.error("Error al crear la pregunta:", result.error);
      setServerError(result.error ?? "No se pudo crear la pregunta.");
      return;
    }

    router.push(result.id ? `/questions/${result.id}` : "/questions");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      {/* Title */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="title">Título</Label>
        <Input
          id="title"
          placeholder="Ej: ¿Cuándo es el próximo ensayo?"
          {...register("title")}
        />
        {errors.title && (
          <p className="text-xs text-destructive">{errors.title.message}</p>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="content">Descripción</Label>
        <textarea
          id="content"
          rows={8}
          placeholder="Explica tu pregunta con el mayor detalle posible..."
          {...register("content")}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {errors.content && (
          <p className="text-xs text-destructive">
            {errors.content.message}
          </p>
        )}
      </div>

      {/* Category */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="category">Categoría</Label>
        <select
          id="category"
          {...register("category")}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {QUESTION_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {CATEGORY_LABELS[cat] ?? cat}
            </option>
          ))}
        </select>
        {errors.category && (
          <p className="text-xs text-destructive">
            {errors.category.message}
          </p>
        )}
      </div>

      {/* Priority */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="priority">Prioridad</Label>
        <select
          id="priority"
          {...register("priority")}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {QUESTION_PRIORITIES.map((pri) => (
            <option key={pri} value={pri}>
              {PRIORITY_LABELS[pri] ?? pri}
            </option>
          ))}
        </select>
        {errors.priority && (
          <p className="text-xs text-destructive">
            {errors.priority.message}
          </p>
        )}
      </div>

      {serverError && (
        <p role="alert" className="text-sm text-destructive">
          {serverError}
        </p>
      )}

      <div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Publicando…" : "Publicar pregunta"}
        </Button>
      </div>
    </form>
  );
}
