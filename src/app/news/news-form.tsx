"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { newsFormSchema, type NewsFormValues } from "@/lib/news/schema";
import { createNewsAction, updateNewsAction } from "@/app/news/actions";

interface NewsFormProps {
  mode: "create" | "edit";
  newsId?: string;
  defaultValues: NewsFormValues;
}

export function NewsForm({ mode, newsId, defaultValues }: NewsFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<NewsFormValues>({
    resolver: zodResolver(newsFormSchema),
    defaultValues,
  });

  async function onSubmit(values: NewsFormValues) {
    setServerError(null);

    const result =
      mode === "create"
        ? await createNewsAction(values)
        : await updateNewsAction({ ...values, id: newsId as string });

    if (!result.success) {
      console.error("Error al guardar la noticia:", result.error);
      setServerError(result.error ?? "No se pudo guardar la noticia.");
      return;
    }

    const targetId = mode === "create" ? result.id : newsId;
    router.push(targetId ? `/news/${targetId}` : "/news");
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
        <Label htmlFor="content">Contenido</Label>
        <textarea
          id="content"
          rows={12}
          {...register("content")}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {errors.content && <p className="text-xs text-destructive">{errors.content.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="image_url">URL de imagen destacada (opcional)</Label>
        <Input id="image_url" type="url" placeholder="https://ejemplo.com/imagen.jpg" {...register("image_url")} />
        {errors.image_url && <p className="text-xs text-destructive">{errors.image_url.message}</p>}
      </div>

      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            {...register("published")}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          <span>Publicada</span>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            {...register("pinned")}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          <span>Destacada (fijada al inicio)</span>
        </label>
      </div>

      {serverError && (
        <p role="alert" className="text-sm text-destructive">
          {serverError}
        </p>
      )}

      <div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Guardando…" : mode === "create" ? "Publicar noticia" : "Guardar cambios"}
        </Button>
      </div>
    </form>
  );
}
