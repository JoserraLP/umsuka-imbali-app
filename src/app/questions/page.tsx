import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { getQuestions } from "@/lib/questions/queries";
import { HelpCircle, CheckCircle2 } from "lucide-react";
import { CategoryFilter } from "@/app/questions/category-filter";

export const metadata: Metadata = {
  title: "Preguntas",
};

interface PageProps {
  searchParams: Promise<{
    status?: string;
    category?: string;
    mine?: string;
  }>;
}

const DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "long",
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

const PRIORITY_VARIANTS: Record<string, "default" | "secondary" | "destructive"> = {
  baja: "secondary",
  media: "default",
  alta: "destructive",
};

export default async function QuestionsPage({ searchParams }: PageProps) {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  const filters = await searchParams;
  const status = filters.status || "all";
  const category = filters.category || "todas";
  const mine = filters.mine === "true";

  const questions = await getQuestions({
    status: status as "open" | "resolved" | "all" | undefined,
    category: category === "todas" ? undefined : category,
    mine,
    userId: mine ? profile.id : undefined,
  });

  // Build filter URLs
  function filterUrl(params: Record<string, string | undefined>): string {
    const sp = new URLSearchParams();
    const effectiveStatus = params.status ?? status;
    const effectiveCategory = params.category ?? category;
    const effectiveMine = params.mine ?? (mine ? "true" : undefined);
    if (effectiveStatus && effectiveStatus !== "all") sp.set("status", effectiveStatus);
    if (effectiveCategory && effectiveCategory !== "todas") sp.set("category", effectiveCategory);
    if (effectiveMine === "true") sp.set("mine", "true");
    const qs = sp.toString();
    return `/questions${qs ? `?${qs}` : ""}`;
  }

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Preguntas</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Consultas, dudas y seguimiento de la comunidad.
            </p>
          </div>
          <Button asChild size="sm">
            <Link href="/questions/new">Nueva pregunta</Link>
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Status tabs */}
          <div className="flex items-center gap-1 rounded-lg border bg-muted/30 p-0.5">
            {[
              { value: "all", label: "Todas" },
              { value: "open", label: "Abiertas" },
              { value: "resolved", label: "Resueltas" },
            ].map((tab) => (
              <Link
                key={tab.value}
                href={filterUrl({ status: tab.value })}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  status === tab.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </Link>
            ))}
          </div>

          {/* Category filter */}
          <CategoryFilter category={category} status={status} mine={mine} />

          {/* Mine toggle */}
          <Link
            href={filterUrl({ mine: mine ? undefined : "true" })}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              mine
                ? "bg-primary text-primary-foreground"
                : "border border-input text-muted-foreground hover:text-foreground"
            }`}
          >
            Solo mis preguntas
          </Link>
        </div>

        {/* Questions list */}
        {questions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <HelpCircle className="mb-2 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              No hay preguntas{status !== "all" ? ` ${status === "open" ? "abiertas" : "resueltas"}` : ""} todavía
            </p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              {mine
                ? "No has creado ninguna pregunta aún."
                : "Sé el primero en hacer una pregunta a la comunidad."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {questions.map((item) => (
              <Link
                key={item.id}
                href={`/questions/${item.id}`}
                className="group block overflow-hidden rounded-xl border bg-card transition-all hover:shadow-md"
              >
                <div className="p-4 sm:p-5">
                  {/* Header: badges */}
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    {item.resolved ? (
                      <Badge
                        variant="secondary"
                        className="gap-1 text-[10px]"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Resuelta
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="gap-1 text-[10px] text-muted-foreground"
                      >
                        Abierta
                      </Badge>
                    )}
                    {item.category && (
                      <Badge
                        variant="outline"
                        className="text-[10px] text-muted-foreground"
                      >
                        {CATEGORY_LABELS[item.category] ?? item.category}
                      </Badge>
                    )}
                    {item.priority && (
                      <Badge
                        variant={PRIORITY_VARIANTS[item.priority] ?? "outline"}
                        className="text-[10px]"
                      >
                        {PRIORITY_LABELS[item.priority] ?? item.priority}
                      </Badge>
                    )}
                  </div>

                  {/* Title */}
                  <h2 className="text-base font-semibold leading-tight group-hover:text-primary transition-colors">
                    {item.title}
                  </h2>

                  {/* Content preview */}
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed line-clamp-2">
                    {item.content}
                  </p>

                  {/* Footer: author + date */}
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      {item.authorFirstName} {item.authorLastName}
                    </span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={item.createdAt}>
                      {formatDate(item.createdAt)}
                    </time>
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
