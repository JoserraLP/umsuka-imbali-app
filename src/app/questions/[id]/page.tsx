import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import {
  getQuestionById,
  getQuestionComments,
} from "@/lib/questions/queries";
import { ResolveButton } from "@/app/questions/[id]/resolve-button";
import { DeleteQuestionButton } from "@/app/questions/[id]/delete-question-button";
import { AddCommentForm } from "@/app/questions/[id]/add-comment-form";
import {
  ArrowLeft,
  CheckCircle2,
  MessageSquare,
  User,
} from "lucide-react";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const question = await getQuestionById(id);

  if (!question) {
    return { title: "Pregunta no encontrada" };
  }

  return {
    title: question.title,
    description: question.content.slice(0, 160),
  };
}

const DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "long",
  timeStyle: "short",
});

function formatDate(dateStr: string): string {
  return DATE_FORMATTER.format(new Date(dateStr));
}

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

const PRIORITY_VARIANTS: Record<
  string,
  "default" | "secondary" | "destructive"
> = {
  baja: "secondary",
  media: "default",
  alta: "destructive",
};

export default async function QuestionDetailPage({
  params,
}: PageProps) {
  const { id } = await params;
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  const question = await getQuestionById(id);

  if (!question) {
    notFound();
  }

  const comments = await getQuestionComments(id);
  const canManage = isManagementRole(profile.role);
  const isCreator = profile.id === question.createdBy;
  const canModify = canManage || isCreator;

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-6">
        {/* Back link */}
        <Link
          href="/questions"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a preguntas
        </Link>

        {/* Question detail */}
        <article className="rounded-xl border bg-card">
          <div className="p-5 sm:p-8">
            {/* Badges */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {question.resolved ? (
                <Badge variant="secondary" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Resuelta
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="gap-1 text-muted-foreground"
                >
                  Abierta
                </Badge>
              )}
              {question.category && (
                <Badge variant="outline" className="text-muted-foreground">
                  {CATEGORY_LABELS[question.category] ??
                    question.category}
                </Badge>
              )}
              {question.priority && (
                <Badge
                  variant={
                    PRIORITY_VARIANTS[question.priority] ?? "outline"
                  }
                >
                  {PRIORITY_LABELS[question.priority] ??
                    question.priority}
                </Badge>
              )}
            </div>

            {/* Title */}
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {question.title}
            </h1>

            {/* Author + date */}
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <span>
                Por{" "}
                <strong>
                  {question.authorFirstName} {question.authorLastName}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <time dateTime={question.createdAt}>
                {formatDate(question.createdAt)}
              </time>
            </div>

            {/* Content */}
            <div className="mt-6 whitespace-pre-line text-sm leading-relaxed text-foreground/90 sm:text-base">
              {question.content}
            </div>
          </div>
        </article>

        {/* Management actions */}
        {canModify && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-4">
            <span className="mr-2 text-xs font-medium text-muted-foreground">
              Acciones:
            </span>

            <ResolveButton
              questionId={question.id}
              resolved={question.resolved}
            />

            <DeleteQuestionButton questionId={question.id} />
          </div>
        )}

        {/* Comments section */}
        <div className="rounded-xl border bg-card">
          <div className="border-b border-border px-5 py-4 sm:px-8">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <MessageSquare className="h-4 w-4" />
              Comentarios ({comments.length})
            </h2>
          </div>

          {comments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <MessageSquare className="mb-2 h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                No hay comentarios todavía.
              </p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                Sé el primero en comentar.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {comments.map((comment) => (
                <div
                  key={comment.id}
                  className="px-5 py-4 sm:px-8"
                >
                  <div className="flex items-start gap-3">
                    {/* Avatar placeholder */}
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                      <User className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {comment.authorFirstName}{" "}
                          {comment.authorLastName}
                        </span>
                        <span aria-hidden="true">·</span>
                        <time dateTime={comment.createdAt}>
                          {formatDate(comment.createdAt)}
                        </time>
                      </div>
                      <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">
                        {comment.content}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add comment form */}
          <div className="border-t border-border px-5 py-4 sm:px-8">
            <AddCommentForm questionId={id} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
