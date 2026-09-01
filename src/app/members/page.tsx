import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AppShell } from "@/components/layout/app-shell";
import { ListSortingControl } from "@/components/list-sorting";
import { getCurrentProfile } from "@/lib/auth/session";
import { canViewMembers, resolveMemberLocks } from "@/lib/members/authorization";
import { getMembersAction } from "@/app/members/actions";
import { memberFiltersSchema, type MemberFilters } from "@/lib/members/schema";
import { MemberFilters as MemberFiltersControl } from "@/app/members/member-filters";
import type { MemberListItem } from "@/lib/members/schema";
import { getListOrdering } from "@/lib/ordering/queries";
import { sortMembers } from "@/lib/ordering/sorting";
import {
  DEFAULT_SORT,
  MEMBER_SORT_OPTIONS,
} from "@/lib/ordering/schema";

export const metadata: Metadata = {
  title: "Miembros",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const WORKGROUP_LABELS: Record<string, string> = {
  telas: "Telas",
  barra: "Barra",
  estandarte: "Estandarte",
  limpieza: "Limpieza",
  ninguno: "Ninguno",
};

const COMPONENT_TYPE_LABELS: Record<string, string> = {
  music: "Música",
  dance: "Baile",
  member: "Socio/a",
};

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  board_member: "Directiva",
  event_manager: "Eventos",
  member: "Miembro",
  guest: "Invitado",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  active: "Activo",
  suspended: "Suspendido",
};

const DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" });

/** Lower-cases and strips accents so "Álvaro" matches "alvaro". */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function filterMembers(members: MemberListItem[], filters: MemberFilters): MemberListItem[] {
  return members.filter((member) => {
    if (filters.workgroup && member.workgroup !== filters.workgroup) return false;
    if (filters.componentType && member.componentType !== filters.componentType) return false;
    if (filters.status && member.status !== filters.status) return false;
    if (filters.linkStatus && member.linkStatus !== filters.linkStatus) return false;
    if (filters.q) {
      const needle = normalize(filters.q);
      const fullName = normalize(`${member.firstName} ${member.lastName}`);
      if (!fullName.includes(needle)) return false;
    }
    return true;
  });
}

export default async function MembersPage({ searchParams }: PageProps) {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  // Leads scope the directory to their own workgroup (app-layer check).
  if (!canViewMembers(profile)) {
    redirect("/dashboard");
  }

  // Sprint 25: persisted ordering of the caller ({} → defaults below).
  const ordering = await getListOrdering(profile.id);

  const result = await getMembersAction();

  const rawParams = await searchParams;
  const parsed = memberFiltersSchema.safeParse({
    workgroup: typeof rawParams.workgroup === "string" ? rawParams.workgroup : undefined,
    componentType:
      typeof rawParams.componentType === "string" ? rawParams.componentType : undefined,
    status: typeof rawParams.status === "string" ? rawParams.status : undefined,
    linkStatus: typeof rawParams.linkStatus === "string" ? rawParams.linkStatus : undefined,
    q: typeof rawParams.q === "string" ? rawParams.q : undefined,
  });
  const filters: MemberFilters = parsed.success ? parsed.data : {};

  // Filter locks derive from the resolved scope ONLY (management >
  // component > workgroup precedence), so a dual workgroup+component
  // lead locks the component select and keeps the workgroup filter free.
  const { lockedWorkgroup, lockedComponent } = resolveMemberLocks(profile);
  const scopeKind = lockedComponent ? "component" : lockedWorkgroup ? "workgroup" : null;

  const filtered = result.success ? filterMembers(result.data, filters) : [];

  // Sprint 25 contract: sort the FULL filtered set before rendering
  // (there is no pagination today, but any future slicing must come
  // after this step).
  const sortSelection = ordering.members ?? DEFAULT_SORT.members;
  const members = sortMembers(filtered, sortSelection.sortBy, sortSelection.direction);

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">Miembros</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {scopeKind === "component"
              ? "Miembros de tu componente."
              : scopeKind === "workgroup"
                ? "Miembros de tu grupo de trabajo."
                : "Listado de los miembros dados de alta en la comparsa."}
          </p>
        </div>

        {scopeKind === "component" && lockedComponent && (
          <div className="rounded-lg border border-brand/30 bg-brand/5 px-4 py-3 text-sm">
            Mostrando solo los miembros del componente:{" "}
            <span className="font-semibold">{COMPONENT_TYPE_LABELS[lockedComponent]}</span>
          </div>
        )}

        {scopeKind === "workgroup" && lockedWorkgroup && (
          <div className="rounded-lg border border-brand/30 bg-brand/5 px-4 py-3 text-sm">
            Mostrando solo los miembros de tu grupo:{" "}
            <span className="font-semibold">{WORKGROUP_LABELS[lockedWorkgroup]}</span>
          </div>
        )}

        {!result.success && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {result.error}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Miembros</CardTitle>
            <CardDescription>
              Filtra por grupo, componente, estado o nombre.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <MemberFiltersControl
                workgroup={parsed.success ? (filters.workgroup ?? "all") : "all"}
                componentType={parsed.success ? (filters.componentType ?? "all") : "all"}
                status={parsed.success ? (filters.status ?? "all") : "all"}
                linkStatus={parsed.success ? (filters.linkStatus ?? "all") : "all"}
                q={filters.q ?? ""}
                lockedWorkgroup={lockedWorkgroup}
                lockedComponent={lockedComponent}
              />
              <ListSortingControl
                listId="members"
                sortBy={sortSelection.sortBy}
                direction={sortSelection.direction}
                sortOptions={MEMBER_SORT_OPTIONS}
              />
            </div>
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay miembros que coincidan con los filtros.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Componente</TableHead>
                    <TableHead>Grupo de trabajo</TableHead>
                    <TableHead>Rol</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Vinculación</TableHead>
                    <TableHead>Fecha de alta</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/members/${member.id}`}
                          className="hover:underline hover:text-primary"
                        >
                          {member.firstName} {member.lastName}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {COMPONENT_TYPE_LABELS[member.componentType] ?? member.componentType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {WORKGROUP_LABELS[member.workgroup] ?? member.workgroup}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {ROLE_LABELS[member.role] ?? member.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            member.status === "active"
                              ? "default"
                              : member.status === "pending"
                                ? "secondary"
                                : "destructive"
                          }
                        >
                          {STATUS_LABELS[member.status] ?? member.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {member.authMethod === "email_alias" ? (
                          <Badge variant="outline">Cuenta local</Badge>
                        ) : (
                          <Badge variant={member.linkStatus === "pending_gmail" ? "secondary" : "outline"}>
                            {member.linkStatus === "pending_gmail" ? "Pendiente de Gmail" : "Vinculado a Gmail"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {DATE_FORMATTER.format(new Date(member.createdAt))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
