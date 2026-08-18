import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { hasPermission } from "@/lib/admin/permissions";
import { auditLogFiltersSchema } from "@/lib/admin/schema";
import { listAuditLogs } from "@/lib/admin/queries";
import { AuditLogView } from "@/app/admin/audit/audit-log-view";

export const metadata: Metadata = {
  title: "Registro de auditoría",
};

interface AdminAuditPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminAuditPage({ searchParams }: AdminAuditPageProps) {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  if (!hasPermission(profile.role, "audit.read")) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const parsed = auditLogFiltersSchema.safeParse({
    user: params.user ?? "",
    action: params.action ?? "",
    from: params.from ?? "",
    to: params.to ?? "",
    page: params.page ?? "1",
  });
  const filters = parsed.success ? parsed.data : { offset: 0, page: 1 };

  const { items, total, hasMore } = await listAuditLogs(filters);

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">Registro de auditoría</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Historial de las acciones administrativas: altas, bajas, roles, aprobaciones,
            suspensiones y cambios de configuración.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Acciones registradas</CardTitle>
            <CardDescription>
              Registro de solo lectura y a prueba de manipulaciones: cada fila se crea en el
              momento de la acción y nunca se modifica.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AuditLogView
              items={items}
              total={total}
              hasMore={hasMore}
              initialFilters={filters}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}