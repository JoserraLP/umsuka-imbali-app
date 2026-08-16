import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { getVotings, type VotingItem } from "@/lib/votings/queries";
import { Lock, Plus, Vote } from "lucide-react";

export const metadata: Metadata = {
  title: "Votaciones",
};

const DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "long",
});

function formatDate(dateStr: string): string {
  return DATE_FORMATTER.format(new Date(dateStr));
}

function VotingCard({ item }: { item: VotingItem }) {
  return (
    <Link
      href={`/votings/${item.id}`}
      className="group block overflow-hidden rounded-xl border bg-card transition-all hover:shadow-md"
    >
      <div className="p-4 sm:p-5">
        {/* Status badge */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {item.isOpen ? (
            <Badge
              variant="outline"
              className="gap-1 text-[10px] text-muted-foreground"
            >
              <Vote className="h-3 w-3" />
              Abierta
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <Lock className="h-3 w-3" />
              Cerrada
            </Badge>
          )}
        </div>

        {/* Title */}
        <h2 className="text-base font-semibold leading-tight transition-colors group-hover:text-primary">
          {item.title}
        </h2>

        {/* Description preview */}
        {item.description && (
          <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {item.description}
          </p>
        )}

        {/* Footer: options + date */}
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {item.optionCount}{" "}
            {item.optionCount === 1 ? "opción" : "opciones"}
          </span>
          <span aria-hidden="true">·</span>
          <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
        </div>
      </div>
    </Link>
  );
}

function EmptyState({
  icon,
  message,
  hint,
}: {
  icon: React.ReactNode;
  message: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      {icon}
      <p className="text-sm text-muted-foreground">{message}</p>
      <p className="mt-1 text-xs text-muted-foreground/60">{hint}</p>
    </div>
  );
}

export default async function VotingsPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  const votings = await getVotings();
  const activeVotings = votings.filter((item) => item.isOpen);
  const closedVotings = votings.filter((item) => !item.isOpen);
  const canCreate = isManagementRole(profile.role);

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Votaciones</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Decide en comunidad: cada miembro tiene un voto.
            </p>
          </div>
          {canCreate && (
            <Button asChild size="sm">
              <Link href="/votings/new">
                <Plus className="h-4 w-4" />
                Nueva votación
              </Link>
            </Button>
          )}
        </div>

        {votings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Vote className="mb-2 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              No hay votaciones todavía.
            </p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              {canCreate
                ? "Crea la primera votación para la comunidad."
                : "La directiva creará votaciones cuando las necesite."}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Active votings */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">
                Activas
              </h2>
              {activeVotings.length === 0 ? (
                <EmptyState
                  icon={<Vote className="mb-2 h-8 w-8 text-muted-foreground/40" />}
                  message="No hay votaciones abiertas."
                  hint="Las votaciones activas aparecerán aquí."
                />
              ) : (
                <div className="space-y-3">
                  {activeVotings.map((item) => (
                    <VotingCard key={item.id} item={item} />
                  ))}
                </div>
              )}
            </section>

            {/* Closed votings */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">
                Cerradas
              </h2>
              {closedVotings.length === 0 ? (
                <EmptyState
                  icon={<Lock className="mb-2 h-8 w-8 text-muted-foreground/40" />}
                  message="No hay votaciones cerradas."
                  hint="Las votaciones cerradas con sus resultados aparecerán aquí."
                />
              ) : (
                <div className="space-y-3">
                  {closedVotings.map((item) => (
                    <VotingCard key={item.id} item={item} />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}