"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MessageSquare, Trash2, User } from "lucide-react";
import {
  addEventCommentAction,
  deleteEventCommentAction,
} from "@/app/events/[id]/comments-actions";
import type { EventComment } from "@/lib/events/queries";

const DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "long",
  timeStyle: "short",
});

interface CommentsSectionProps {
  eventId: string;
  comments: EventComment[];
  /** The current viewer's profile id, used to allow authors to delete their own comment. */
  viewerId: string;
  /** Management can delete any comment (moderation). */
  canManage: boolean;
}

export function CommentsSection({ eventId, comments, viewerId, canManage }: CommentsSectionProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;

    setIsSubmitting(true);
    setError(null);

    const result = await addEventCommentAction({ eventId, body: body.trim() });

    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error ?? "No se pudo agregar el comentario.");
      return;
    }

    setBody("");
    router.refresh();
  }

  async function handleDelete(commentId: string) {
    setError(null);

    const result = await deleteEventCommentAction({ eventId, commentId });

    if (!result.success) {
      setError(result.error ?? "No se pudo eliminar el comentario.");
      return;
    }

    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {comments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <MessageSquare className="mb-2 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No hay comentarios todavía.</p>
          <p className="mt-1 text-xs text-muted-foreground/60">Sé el primero en comentar.</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {comments.map((comment) => {
            const canDelete = canManage || comment.userId === viewerId;

            return (
              <li key={comment.id} className="flex items-start gap-3 py-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                  <User className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {comment.authorFirstName} {comment.authorLastName}
                    </span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={comment.createdAt}>
                      {DATE_FORMATTER.format(new Date(comment.createdAt))}
                    </time>
                  </div>
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{comment.body}</p>
                </div>
                {canDelete && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Eliminar comentario"
                    onClick={() => handleDelete(comment.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2 border-t pt-4">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Escribe un comentario..."
          rows={3}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <div>
          <Button type="submit" size="sm" disabled={isSubmitting || !body.trim()}>
            {isSubmitting ? "Enviando…" : "Comentar"}
          </Button>
        </div>
      </form>
    </div>
  );
}
