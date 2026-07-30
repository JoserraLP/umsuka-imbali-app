import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { getNewsById } from "@/lib/news/queries";
import { togglePinAction } from "@/app/news/actions";
import { DeleteNewsButton } from "@/app/news/[id]/delete-news-button";
import { ArrowLeft, Pin, EyeOff, Edit3 } from "lucide-react";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const news = await getNewsById(id);

  if (!news) {
    return { title: "Noticia no encontrada" };
  }

  return {
    title: news.title,
    description: news.content.slice(0, 160),
  };
}

const DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "long",
  timeStyle: "short",
});

function formatDate(dateStr: string): string {
  return DATE_FORMATTER.format(new Date(dateStr));
}

export default async function NewsDetailPage({ params }: PageProps) {
  const { id } = await params;
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  const canManage = isManagementRole(profile.role);
  const news = await getNewsById(id, canManage);

  if (!news) {
    notFound();
  }

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-6">
        {/* Back link */}
        <Link
          href="/news"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a noticias
        </Link>

        {/* Article */}
        <article className="rounded-xl border bg-card">
          {/* Featured image */}
          {news.imageUrl && (
            <div className="relative h-56 w-full overflow-hidden rounded-t-xl sm:h-72 md:h-96">
              <Image
                src={news.imageUrl}
                alt={news.title}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 100vw, 800px"
                priority
              />
            </div>
          )}

          <div className="p-5 sm:p-8">
            {/* Badges */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {news.pinned && (
                <Badge variant="default" className="gap-1">
                  <Pin className="h-3 w-3" />
                  Destacada
                </Badge>
              )}
              {!news.published && (
                <Badge variant="outline" className="gap-1 text-muted-foreground">
                  <EyeOff className="h-3 w-3" />
                  Borrador
                </Badge>
              )}
            </div>

            {/* Title */}
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {news.title}
            </h1>

            {/* Author + date */}
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <span>
                Por <strong>{news.authorFirstName} {news.authorLastName}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <time dateTime={news.createdAt}>{formatDate(news.createdAt)}</time>
            </div>

            {/* Content */}
            <div className="mt-6 whitespace-pre-line text-sm leading-relaxed text-foreground/90 sm:text-base">
              {news.content}
            </div>
          </div>
        </article>

        {/* Management actions */}
        {canManage && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-4">
            <span className="mr-2 text-xs font-medium text-muted-foreground">
              Administrar:
            </span>

            <Button asChild variant="outline" size="sm">
              <Link href={`/news/${id}/edit`}>
                <Edit3 className="h-4 w-4" />
                Editar
              </Link>
            </Button>

            <form
              action={async () => {
                "use server";
                await togglePinAction({ id });
              }}
            >
              <Button type="submit" variant="outline" size="sm">
                <Pin className="h-4 w-4" />
                {news.pinned ? "Quitar destacada" : "Fijar como destacada"}
              </Button>
            </form>

            <DeleteNewsButton newsId={id} />
          </div>
        )}
      </div>
    </AppShell>
  );
}
