"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteNewsAction } from "@/app/news/actions";

interface DeleteNewsButtonProps {
  newsId: string;
}

export function DeleteNewsButton({ newsId }: DeleteNewsButtonProps) {
  return (
    <form
      action={async () => {
        if (!confirm("¿Estás seguro de eliminar esta noticia?")) return;
        await deleteNewsAction({ id: newsId });
      }}
    >
      <Button type="submit" variant="destructive" size="sm">
        <Trash2 className="h-4 w-4" />
        Eliminar
      </Button>
    </form>
  );
}
