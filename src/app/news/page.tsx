import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { getNewsFeed } from "@/lib/news/queries";
import { CalendarDays, Pin, EyeOff } from "lucide-react";

export const metadata: Metadata = {
  title: "Noticias",
};

const DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "long",
});

function formatDate(dateStr: string): string {
  return DATE_FORMATTER.format(new Date(dateStr));
}

function truncateContent(content: string, maxLength = 200): string {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength).trimEnd() + "…";
}

export default async function NewsFeedPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  const canManage = isManagementRole(profile.role);
  const news = await getNewsFeed(canManage);

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Noticias</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Últimas novedades y anuncios de Umsuka Imbali.
            </p>
          </div>
          {canManage && (
            <Button asChild size="sm">
              <Link href="/news/new">Nueva noticia</Link>
            </Button>
          )}
        </div>

        {news.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <CalendarDays className="mb-2 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No hay noticias todavía</p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              {canManage
                ? "Crea la primera noticia usando el botón superior."
                : "Las noticias publicadas aparecerán aquí."}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {news.map((item) => (
              <Link
                key={item.id}
                href={`/news/${item.id}`}
                className={`group block overflow-hidden rounded-xl border bg-card transition-all hover:shadow-md ${
                  item.pinned ? "ring-1 ring-primary/20" : ""
                }`}
              >
                {/* Featured image */}
                {item.imageUrl && (
                  <div className="relative h-48 w-full overflow-hidden sm:h-56">
                    <Image
                      src={item.imageUrl}
                      alt={item.title}
                      fill
                      className="object-cover transition-transform group-hover:scale-105"
                      sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 800px"
                    />
                  </div>
                )}

                <div className="p-4 sm:p-5">
                  {/* Header: badges + metadata */}
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {item.pinned && (
                      <Badge variant="default" className="gap-1 text-[10px]">
                        <Pin className="h-3 w-3" />
                        Destacada
                      </Badge>
                    )}
                    {!item.published && (
                      <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
                        <EyeOff className="h-3 w-3" />
                        Borrador
                      </Badge>
                    )}
                  </div>

                  {/* Title */}
                  <h2 className="text-base font-semibold leading-tight group-hover:text-primary transition-colors">
                    {item.title}
                  </h2>

                  {/* Content preview */}
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                    {truncateContent(item.content)}
                  </p>

                  {/* Footer: author + date */}
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      {item.authorFirstName} {item.authorLastName}
                    </span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
