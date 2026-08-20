import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import {
  getInstrumentById,
  getAssignments,
  getAssignableMembers,
  type AssignmentRecord,
} from "@/lib/instruments/queries";
import { InstrumentForm } from "@/app/instruments/instrument-form";
import { ToggleActiveButton } from "@/app/instruments/toggle-active-button";
import { AssignResponsableForm } from "@/app/instruments/assign-responsable-form";
import {
  ArrowLeft,
  History,
  Music,
  User,
} from "lucide-react";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const instrument = await getInstrumentById(id);

  return {
    title: instrument ? instrument.name : "Instrumento no encontrado",
  };
}

const DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "long",
  timeStyle: "short",
});

function formatDate(dateStr: string): string {
  return DATE_FORMATTER.format(new Date(dateStr));
}

function AssignmentRow({ record }: { record: AssignmentRecord }) {
  return (
    <li className="flex items-start justify-between gap-4 rounded-lg border bg-card p-4">
      <div className="flex items-center gap-3">
        <User className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">
            {record.firstName} {record.lastName}
          </p>
          <p className="text-xs text-muted-foreground">
            <time dateTime={record.assignedAt}>
              Desde {formatDate(record.assignedAt)}
            </time>
            {record.unassignedAt && (
              <>
                {" · "}
                <time dateTime={record.unassignedAt}>
                  hasta {formatDate(record.unassignedAt)}
                </time>
              </>
            )}
          </p>
        </div>
      </div>
      {!record.unassignedAt && (
        <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
          Actual
        </Badge>
      )}
    </li>
  );
}

export default async function InstrumentDetailPage({ params }: PageProps) {
  const { id } = await params;
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  const instrument = await getInstrumentById(id);

  if (!instrument) {
    notFound();
  }

  const canManage = isManagementRole(profile.role);
  const assignments = await getAssignments(id);
  const assignableMembers = canManage ? await getAssignableMembers() : [];

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-6">
        {/* Back link */}
        <Link
          href="/instruments"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a instrumentos
        </Link>

        {/* Instrument detail */}
        <article className="rounded-xl border bg-card">
          <div className="p-5 sm:p-8">
            {/* Badges */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {instrument.isActive ? (
                <Badge
                  variant="outline"
                  className="gap-1 text-muted-foreground"
                >
                  <Music className="h-3 w-3" />
                  Activo
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1">
                  Inactivo
                </Badge>
              )}
              {instrument.category && (
                <Badge variant="secondary">{instrument.category}</Badge>
              )}
            </div>

            {/* Name */}
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {instrument.name}
            </h1>

            {/* Current responsable */}
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <User className="h-4 w-4" />
              {instrument.currentAssignee ? (
                <span>
                  Responsable actual: {instrument.currentAssignee.firstName}{" "}
                  {instrument.currentAssignee.lastName}
                </span>
              ) : (
                <span>Sin responsable asignado</span>
              )}
            </div>

            {/* Description */}
            {instrument.description && (
              <div className="mt-6 whitespace-pre-line text-sm leading-relaxed text-foreground/90 sm:text-base">
                {instrument.description}
              </div>
            )}
          </div>
        </article>

        {/* Management block */}
        {canManage && (
          <section className="space-y-6 rounded-xl border bg-card p-5 sm:p-8">
            <h2 className="text-sm font-semibold">Gestión</h2>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  Editar instrumento
                </p>
                <InstrumentForm
                  mode="edit"
                  instrumentId={instrument.id}
                  defaultValues={{
                    name: instrument.name,
                    category: instrument.category ?? "",
                    description: instrument.description ?? "",
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  {instrument.isActive
                    ? "Desactivar el instrumento lo oculta de los listados de asignación."
                    : "Activar el instrumento lo devuelve al inventario."}
                </p>
                <ToggleActiveButton
                  instrumentId={instrument.id}
                  isActive={instrument.isActive}
                />
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  Responsable (una persona a la vez)
                </p>
                <AssignResponsableForm
                  instrumentId={instrument.id}
                  instrumentActive={instrument.isActive}
                  currentAssigneeId={instrument.currentAssignee?.id ?? null}
                  assignableMembers={assignableMembers}
                />
              </div>
            </div>
          </section>
        )}

        {/* Assignment history (visible to every authenticated member) */}
        <section className="space-y-3 rounded-xl border bg-card p-5 sm:p-8">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <History className="h-4 w-4" />
            Historial de responsables
          </h2>
          {assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Este instrumento todavía no ha tenido responsables asignados.
            </p>
          ) : (
            <ul className="space-y-2">
              {assignments.map((record) => (
                <AssignmentRow key={record.id} record={record} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}