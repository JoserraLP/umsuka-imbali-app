import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Avatar } from "@/components/feed/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { getProfileHistorySummary } from "@/lib/profiles/queries";
import { getMinorWithGuardian, getMinorsByGuardian } from "@/lib/guardians/queries";
import { computeParticipationFromCounts } from "@/lib/rehearsals/stats";
import { ProfileForm } from "@/app/profile/profile-form";
import { ChangePasswordForm } from "@/app/profile/change-password-form";
import { WorkgroupSection } from "@/app/profile/workgroup-section";

export const metadata: Metadata = {
  title: "Mi perfil",
};

const COMPONENT_TYPE_LABELS: Record<string, string> = {
  music: "Música",
  dance: "Baile",
  member: "Socio/a",
};

const WORKGROUP_LABELS: Record<string, string> = {
  telas: "Telas",
  barra: "Barra",
  estandarte: "Estandarte",
  limpieza: "Limpieza",
  ninguno: "Ninguno",
};

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  board_member: "Directiva",
  event_manager: "Eventos",
  member: "Miembro",
  guest: "Invitado",
};

const DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" });

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return DATE_FORMATTER.format(date);
}

export default async function ProfilePage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  const history = await getProfileHistorySummary(profile.id);
  const rehearsalParticipation = computeParticipationFromCounts(
    history.rehearsalsAttended,
    history.rehearsalsMarked,
  );
  const initials = `${profile.firstName.charAt(0)}${profile.lastName.charAt(0)}`;
  const joinedAtLabel = formatDate(profile.joinedAt);
  const createdAtLabel = formatDate(profile.createdAt);

  const [minorWithGuardian, minorsInCharge] = await Promise.all([
    getMinorWithGuardian(profile.id).catch(() => null),
    getMinorsByGuardian(profile.id).catch(() => []),
  ]);

  const isMinor = minorWithGuardian?.profile.isMinor ?? false;
  const guardian = minorWithGuardian?.guardian ?? null;

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">Mi perfil</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Consulta y edita tu información personal.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Perfil</CardTitle>
            <CardDescription>Tu información pública y de contacto.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <Avatar src={profile.avatarUrl} fallback={initials} size="xl" />
              <div className="min-w-0">
                <p className="text-lg font-semibold">
                  {profile.firstName} {profile.lastName}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">{ROLE_LABELS[profile.role] ?? profile.role}</Badge>
                  <Badge variant="outline">
                    {COMPONENT_TYPE_LABELS[profile.componentType] ?? profile.componentType}
                  </Badge>
                  <Badge variant="outline">
                    {WORKGROUP_LABELS[profile.workgroup] ?? profile.workgroup}
                  </Badge>
                </div>
              </div>
            </div>

            {profile.bio && <p className="text-sm text-muted-foreground">{profile.bio}</p>}

            {isMinor && (
              <div className="flex flex-col gap-1.5 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
                <p className="font-medium">Representante legal</p>
                {guardian ? (
                  <>
                    <p className="text-muted-foreground">
                      <span className="text-foreground">{guardian.fullName}</span>
                      {guardian.relationship ? ` · ${guardian.relationship}` : ""}
                    </p>
                    {guardian.email && <p className="text-muted-foreground">Email: {guardian.email}</p>}
                    {guardian.phone && <p className="text-muted-foreground">Tel: {guardian.phone}</p>}
                    {guardian.isMember && <Badge variant="outline" className="mt-1 w-fit">Miembro</Badge>}
                  </>
                ) : (
                  <p className="text-muted-foreground">Sin representante asignado.</p>
                )}
                <Badge variant="secondary" className="mt-1 w-fit">Menor de edad</Badge>
              </div>
            )}

            {minorsInCharge.length > 0 && (
              <div className="flex flex-col gap-1.5 rounded-md border bg-card p-3 text-sm">
                <p className="font-medium">Menores a cargo</p>
                <p className="text-muted-foreground">Representas a {minorsInCharge.length} menor(es).</p>
                <div className="flex flex-col gap-1">
                  {minorsInCharge.map((m) => (
                    <a key={m.id} href={`/members/${m.id}`} className="text-primary hover:underline">
                      {m.firstName} {m.lastName}
                    </a>
                  ))}
                </div>
                <a href="/guardians/mis-menores" className="text-xs text-muted-foreground hover:text-foreground">
                  Ver todos →
                </a>
              </div>
            )}

            <div className="flex flex-col gap-1.5 text-sm">
              <p className="font-medium">Contacto</p>
              {profile.email && (
                <p className="text-muted-foreground">
                  <span className="text-foreground">Correo:</span> {profile.email}
                </p>
              )}
              {profile.phone && (
                <p className="text-muted-foreground">
                  <span className="text-foreground">Teléfono:</span> {profile.phone}
                </p>
              )}
              {!profile.email && !profile.phone && (
                <p className="text-muted-foreground">Sin datos de contacto.</p>
              )}
            </div>

            {profile.skills.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-sm font-medium">Habilidades</p>
                <div className="flex flex-wrap gap-1.5">
                  {profile.skills.map((skill) => (
                    <Badge key={skill} variant="outline">
                      {skill}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1 text-sm text-muted-foreground">
              {joinedAtLabel && (
                <p>
                  <span className="text-foreground">En la comparsa desde:</span> {joinedAtLabel}
                </p>
              )}
              <p>
                <span className="text-foreground">Alta de cuenta:</span>{" "}
                {createdAtLabel ?? profile.createdAt}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Estadísticas</CardTitle>
            <CardDescription>
              Tu participación de un vistazo: asistencia, ensayos y turnos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
              <Link
                href="/events"
                className="flex flex-col items-center gap-1 rounded-md border border-border p-4 text-center transition-colors hover:bg-muted"
              >
                <span className="text-2xl font-bold">{history.events}</span>
                <span className="text-xs text-muted-foreground">Eventos apuntados</span>
              </Link>
              <Link
                href="/profile/stats"
                className="flex flex-col items-center gap-1 rounded-md border border-border p-4 text-center transition-colors hover:bg-muted"
              >
                <span className="text-2xl font-bold">{history.attendancePresent}</span>
                <span className="text-xs text-muted-foreground">Asistencias</span>
              </Link>
              <Link
                href="/profile/stats"
                className="flex flex-col items-center gap-1 rounded-md border border-border p-4 text-center transition-colors hover:bg-muted"
              >
                <span className="text-2xl font-bold">{history.attendanceAbsent}</span>
                <span className="text-xs text-muted-foreground">Faltas sin asistir</span>
              </Link>
              <Link
                href="/profile/stats"
                className="flex flex-col items-center gap-1 rounded-md border border-border p-4 text-center transition-colors hover:bg-muted"
              >
                <span className="text-2xl font-bold">{history.absences}</span>
                <span className="text-xs text-muted-foreground">Ausencias</span>
              </Link>
              <Link
                href="/profile/shifts"
                className="flex flex-col items-center gap-1 rounded-md border border-border p-4 text-center transition-colors hover:bg-muted"
              >
                <span className="text-2xl font-bold">{history.shifts}</span>
                <span className="text-xs text-muted-foreground">Turnos</span>
              </Link>
              <Link
                href="/profile/stats"
                className="flex flex-col items-center gap-1 rounded-md border border-border p-4 text-center transition-colors hover:bg-muted"
              >
                <span className="text-2xl font-bold">{history.rehearsalsAttended}</span>
                <span className="text-xs text-muted-foreground">
                  Ensayos{" "}
                  {rehearsalParticipation !== null
                    ? `(${history.rehearsalsAttended}/${history.rehearsalsMarked} · ${rehearsalParticipation}%)`
                    : ""}
                </span>
              </Link>
            </div>
            <div className="mt-4">
              <Link
                href="/profile/stats"
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Ver estadísticas completas →
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Datos personales</CardTitle>
            <CardDescription className="flex items-center gap-2">
              Edita tu información: foto, biografía, habilidades y más.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm
              defaultValues={{
                firstName: profile.firstName,
                lastName: profile.lastName,
                birthDate: profile.birthDate ?? "",
                componentType: profile.componentType,
                bio: profile.bio ?? "",
                phone: profile.phone ?? "",
                skills: profile.skills,
                avatarUrl: profile.avatarUrl ?? "",
                joinedAt: profile.joinedAt ?? "",
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mi grupo de trabajo</CardTitle>
            <CardDescription>
              El grupo al que perteneces determina los turnos de trabajo y las tareas que ves.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WorkgroupSection currentWorkgroup={profile.workgroup} />
          </CardContent>
        </Card>

        {profile.authMethod === "email_alias" && (
          <Card>
            <CardHeader>
              <CardTitle>Contraseña</CardTitle>
              <CardDescription>
                Cambia tu contraseña de acceso. Se recomienda actualizarla periódicamente.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChangePasswordForm />
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
