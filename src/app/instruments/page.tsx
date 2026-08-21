import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { getInstruments, type InstrumentItem } from "@/lib/instruments/queries";
import { InstrumentForm } from "@/app/instruments/instrument-form";
import { Music, PackageOpen, User } from "lucide-react";

export const metadata: Metadata = {
  title: "Instrumentos",
};

function InstrumentCard({ item }: { item: InstrumentItem }) {
  return (
    <Link
      href={`/instruments/${item.id}`}
      className="group block overflow-hidden rounded-xl border bg-card transition-all hover:shadow-md"
    >
      <div className="p-4 sm:p-5">
        {/* Status badge */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {item.isActive ? (
            <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
              <Music className="h-3 w-3" />
              Activo
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1 text-[10px]">
              Inactivo
            </Badge>
          )}
          {item.category && (
            <Badge variant="secondary" className="text-[10px]">
              {item.category}
            </Badge>
          )}
        </div>

        {/* Name */}
        <h2 className="text-base font-semibold leading-tight transition-colors group-hover:text-primary">
          {item.name}
        </h2>

        {/* Current responsable */}
        <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <User className="h-3.5 w-3.5" />
          {item.currentAssignee ? (
            <span>
              Responsable: {item.currentAssignee.firstName}{" "}
              {item.currentAssignee.lastName}
            </span>
          ) : (
            <span>Sin responsable asignado</span>
          )}
        </div>
      </div>
    </Link>
  );
}

export default async function InstrumentsPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  const canManage = isManagementRole(profile.role);
  const instruments = await getInstruments({ includeInactive: canManage });

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Instrumentos</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Inventario de la comparsa y responsables de cada instrumento.
            </p>
          </div>
        </div>

        {/* Create (management only) */}
        {canManage && (
          <section className="rounded-xl border bg-card p-5 sm:p-8">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Music className="h-4 w-4" />
              Nuevo instrumento
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Da de alta un instrumento en el inventario.
            </p>
            <div className="mt-4">
              <InstrumentForm mode="create" />
            </div>
          </section>
        )}

        {/* Listing */}
        {instruments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <PackageOpen className="mb-2 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              No hay instrumentos todavía.
            </p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              {canManage
                ? "Da de alta el primer instrumento del inventario."
                : "La directiva dará de alta los instrumentos cuando los necesite."}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {instruments.map((item) => (
              <InstrumentCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}