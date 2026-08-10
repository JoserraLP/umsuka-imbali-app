"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { addCommentAction } from "@/app/questions/actions";

interface AddCommentFormProps {
  questionId: string;
}

export function AddCommentForm({ questionId }: AddCommentFormProps) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;

    setIsSubmitting(true);
    setError(null);

    const result = await addCommentAction({
      question_id: questionId,
      content: content.trim(),
    });

    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error ?? "No se pudo agregar el comentario.");
      return;
    }

    setContent("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Escribe un comentario..."
        rows={3}
        className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" disabled={isSubmitting || !content.trim()}>
        {isSubmitting ? "Enviando…" : "Comentar"}
      </Button>
    </form>
  );
}
