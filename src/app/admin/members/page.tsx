import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { PreRegisterForm } from "@/app/admin/members/pre-register-form";
import { LinkGmailDialog } from "@/app/admin/members/link-gmail-dialog";
import { ConvertToLocalDialog } from "@/app/admin/members/convert-to-local-dialog";
import { MemberFilters as MemberFiltersControl } from "@/app/members/member-filters";
import { memberFiltersSchema } from "@/lib/members/schema";

export const metadata: Metadata = { title: "Administración de miembros — Pre-registro" };

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminMembersPage({ searchParams }: PageProps) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/auth/login");
  if (profile.role !== "super_admin") redirect("/dashboard");

  const rawParams = await searchParams;
  const linkStatusRaw = typeof rawParams.linkStatus === "string" ? rawParams.linkStatus : undefined;
  const parsed = memberFiltersSchema.safeParse({
    linkStatus: linkStatusRaw,
  });
  const linkStatusFilter = parsed.success ? (parsed.data.linkStatus ?? "all") : "all";
  // Also parse other filters for reuse of MemberFilters component (defaults to all)
  const parsedAll = memberFiltersSchema.safeParse({
    workgroup: typeof rawParams.workgroup === "string" ? rawParams.workgroup : undefined,
    componentType: typeof rawParams.componentType === "string" ? rawParams.componentType : undefined,
    status: typeof rawParams.status === "string" ? rawParams.status : undefined,
    linkStatus: linkStatusRaw,
    q: typeof rawParams.q === "string" ? rawParams.q : undefined,
  });
  const filters = parsedAll.success ? parsedAll.data : {};

  const admin = createAdminClient();
  const { data: members } = await admin
    .from("profiles")
    .select("id, first_name, last_name, component_type, workgroup, auth_method, link_status, invite_token, pending_email, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const filtered = (members ?? []).filter((m) => {
    if (linkStatusFilter !== "all" && (m as { link_status: string }).link_status !== linkStatusFilter) return false;
    // Apply additional memberFilters for consistency if needed
    if (filters.workgroup && (m as { workgroup: string }).workgroup !== filters.workgroup) return false;
    if (filters.componentType && (m as { component_type: string }).component_type !== filters.componentType) return false;
    return true;
  });

  return (
    <AppShell profile={profile}>
      <div className="space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold">Miembros — Pre-registro sin Gmail</h1>
          <p className="text-sm text-muted-foreground">Solo super_admin puede dar de alta sin Gmail y vincular posteriormente.</p>
        </div>

        <PreRegisterForm />

        <Card>
          <CardHeader>
            <CardTitle>Listado ({filtered.length} / {members?.length ?? 0})</CardTitle>
            <CardDescription>Filtros: Pendientes de Gmail / Vinculados a Gmail via link_status — usa ?linkStatus=pending_gmail|linked. Cuentas locales (sin Gmail) aparecen como &quot;Cuenta local&quot;.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <MemberFiltersControl
              workgroup={(filters.workgroup ?? "all") as string}
              componentType={(filters.componentType ?? "all") as string}
              status={(filters.status ?? "all") as string}
              linkStatus={linkStatusFilter}
              q={filters.q ?? ""}
              basePath="/admin/members"
            />
            {filtered.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3">
                <div>
                  <p className="font-medium">{m.first_name} {m.last_name} {(m as { auth_method?: string }).auth_method === "email_alias" ? <Badge variant="outline">Cuenta local</Badge> : <Badge variant={m.link_status === "pending_gmail" ? "secondary" : "default"}>{m.link_status === "pending_gmail" ? "Pendiente de Gmail" : "Vinculado a Gmail"}</Badge>}</p>
                  <p className="text-xs text-muted-foreground">{m.component_type} — {m.workgroup} — {m.pending_email ?? "sin email"}</p>
                  {m.invite_token && <p className="text-xs">Invite: /invite/{m.invite_token}</p>}
                </div>
                <div className="flex gap-2">
                  {m.link_status === "pending_gmail" && (
                    <>
                      {m.invite_token && <LinkGmailDialog profileId={m.id} inviteToken={m.invite_token} />}
                      <ConvertToLocalDialog profileId={m.id} defaultName={`${m.first_name} ${m.last_name}`} />
                    </>
                  )}
                </div>
              </div>
            ))}
            {filtered.length === 0 && <p className="text-sm text-muted-foreground">Sin miembros para el filtro seleccionado.</p>}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
