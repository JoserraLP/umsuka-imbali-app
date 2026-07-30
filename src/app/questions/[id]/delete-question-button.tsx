"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteQuestionAction } from "@/app/questions/actions";

interface DeleteQuestionButtonProps {
  questionId: string;
}

export function DeleteQuestionButton({
  questionId,
}: DeleteQuestionButtonProps) {
  return (
    <form
      action={async () => {
        if (!confirm("¿Estás seguro de eliminar esta pregunta?")) return;
        await deleteQuestionAction({ id: questionId });
      }}
    >
      <Button type="submit" variant="destructive" size="sm">
        <Trash2 className="h-4 w-4" />
        Eliminar
      </Button>
    </form>
  );
}
