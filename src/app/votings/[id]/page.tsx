import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { getVotingById, getResults } from "@/lib/votings/queries";
import { canViewResults } from "@/lib/votings/logic";
import { VoteForm } from "@/app/votings/[id]/vote-form";
import { AddOptionForm } from "@/app/votings/[id]/add-option-form";
import { CloseVotingButton } from "@/app/votings/[id]/close-voting-button";
import { ResultsChart } from "@/app/votings/[id]/results-chart";
import { ArrowLeft, CalendarClock, CheckCircle2, Lock, Vote } from "lucide-react";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const voting = await getVotingById(id);

  if (!voting) {
    return { title: "Votación no encontrada" };
  }

  return {
    title: voting.title,
    description: voting.description?.slice(0, 160),
  };
}

const DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "long",
  timeStyle: "short",
});

function formatDate(dateStr: string): string {
  return DATE_FORMATTER.format(new Date(dateStr));
}

export default async function VotingDetailPage({ params }: PageProps) {
  const { id } = await params;
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  const voting = await getVotingById(id, profile.id);

  if (!voting) {
    notFound();
  }

  const canManage = isManagementRole(profile.role);
  const now = new Date();
  const revealResults = canViewResults(
    { is_open: voting.isOpen, voting_deadline: voting.votingDeadline },
    voting.hasVoted,
    canManage,
    now,
  );

  const chosenOption = voting.options.find(
    (option) => option.id === voting.chosenOptionId,
  );

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-6">
        {/* Back link */}
        <Link
          href="/votings"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a votaciones
        </Link>

        {/* Voting detail */}
        <article className="rounded-xl border bg-card">
          <div className="p-5 sm:p-8">
            {/* Badges */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {voting.isOpen ? (
                <Badge
                  variant="outline"
                  className="gap-1 text-muted-foreground"
                >
                  <Vote className="h-3 w-3" />
                  Abierta
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1">
                  <Lock className="h-3 w-3" />
                  Cerrada
                </Badge>
              )}
              {voting.votingDeadline && (
                <Badge variant="outline" className="gap-1 text-muted-foreground">
                  <CalendarClock className="h-3 w-3" />
                  Fecha límite: {formatDate(voting.votingDeadline)}
                </Badge>
              )}
            </div>

            {/* Title */}
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {voting.title}
            </h1>

            {/* Created date */}
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <span>Creada el</span>
              <time dateTime={voting.createdAt}>
                {formatDate(voting.createdAt)}
              </time>
            </div>

            {/* Description */}
            {voting.description && (
              <div className="mt-6 whitespace-pre-line text-sm leading-relaxed text-foreground/90 sm:text-base">
                {voting.description}
              </div>
            )}
          </div>
        </article>

        {/* Vote form (open + not voted yet) */}
        {voting.isOpen && !voting.hasVoted && (
          <section className="rounded-xl border bg-card p-5 sm:p-8">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Vote className="h-4 w-4" />
              Tu voto
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Selecciona una opción. Solo puedes votar una vez.
            </p>
            <div className="mt-4">
              <VoteForm votingId={voting.id} options={voting.options} />
            </div>
          </section>
        )}

        {/* Already voted notice */}
        {voting.hasVoted && (
          <div className="flex items-center gap-2 rounded-xl border bg-card p-4 text-sm">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
            <span>
              Ya has votado
              {chosenOption ? ` por la opción “${chosenOption.optionText}”` : ""}.
            </span>
          </div>
        )}

        {/* Results */}
        {revealResults ? (
          <section className="space-y-4">
            <ResultsChart results={await getResults(id)} />
          </section>
        ) : (
          <div className="rounded-xl border bg-card p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Los resultados se muestran después de votar o al cerrar la
              votación.
            </p>
          </div>
        )}

        {/* Management actions — based on the raw is_open flag so management can
            still close a voting whose deadline already passed (the close
            action only needs is_open, while addOption re-checks the
            effective state and rejects closed votings itself). */}
        {canManage && voting.isOpenRaw && (
          <section className="space-y-4 rounded-xl border bg-card p-5 sm:p-8">
            <h2 className="text-sm font-semibold">Gestión</h2>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  Añadir opción
                </p>
                <AddOptionForm votingId={voting.id} />
              </div>
              <CloseVotingButton votingId={voting.id} />
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}