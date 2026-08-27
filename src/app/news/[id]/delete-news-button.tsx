"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteNewsAction } from "@/app/news/actions";

interface DeleteNewsButtonProps {
  newsId: string;
}

export function DeleteNewsButton({ newsId }: DeleteNewsButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (!confirm("¿Estás seguro de eliminar esta noticia?")) return;

    setError(null);
    startTransition(async () => {
      const result = await deleteNewsAction({ id: newsId });

      if (!result.success) {
        console.error("Error al eliminar noticia:", result.error);
        setError(result.error ?? "No se pudo eliminar la noticia.");
        return;
      }

      // Ir al menú principal de noticias (evita 404 en /news/[id] ya borrado)
      router.push("/news");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant="destructive" size="sm" disabled={isPending} onClick={handleDelete}>
        <Trash2 className="h-4 w-4" />
        {isPending ? "Eliminando…" : "Eliminar"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
