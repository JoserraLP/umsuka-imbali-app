import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";

interface Props { params: Promise<{ token: string }> }

export default async function InvitePage({ params }: Props) {
  const { token } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/auth/login?redirectTo=/invite/${token}`);
  }

  const profile = await getCurrentProfile();
  const admin = createAdminClient();
  const { data: target } = await admin.from("profiles").select("id, first_name, last_name, link_status, invite_token").eq("invite_token", token).maybeSingle();

  if (!target) {
    return (
      <AppShell profile={profile!}>
        <Card><CardHeader><CardTitle>Token no válido</CardTitle><CardDescription>El enlace de invitación no existe o ya fue usado.</CardDescription></CardHeader></Card>
      </AppShell>
    );
  }

  if ((target as { link_status: string }).link_status !== "pending_gmail") {
    return (
      <AppShell profile={profile!}>
        <Card><CardHeader><CardTitle>Ya vinculado</CardTitle><CardDescription>Este perfil ya está vinculado.</CardDescription></CardHeader></Card>
      </AppShell>
    );
  }

  // Auto-vinculación: vincular Gmail del usuario actual
  const gmail = user.email;
  if (!gmail) {
    return (
      <AppShell profile={profile!}>
        <Card><CardHeader><CardTitle>Sin Gmail</CardTitle><CardDescription>Tu cuenta no tiene un email asociado.</CardDescription></CardHeader></Card>
      </AppShell>
    );
  }

  const { data: collision } = await admin.from("profiles").select("id").eq("pending_email", gmail).eq("link_status", "linked").maybeSingle();
  if (collision) {
    return (
      <AppShell profile={profile!}>
        <Card><CardHeader><CardTitle>Colisión</CardTitle><CardDescription>Este Gmail ya pertenece a otro perfil.</CardDescription></CardHeader></Card>
      </AppShell>
    );
  }

  // Vinculación LÓGICA: mantiene el id original del perfil pre-registrado
  // para conservar histórico (pagos, asistencia, formación). NO se hace
  // UPDATE id = auth.uid(). Se guarda el Gmail en pending_email
  // (profiles no tiene columna email dedicada; pending_email es fuente
  // autoritativa tras vincular). Login futuro: WHERE pending_email=gmail
  // AND link_status='linked'. Si se añade columna email, usar
  // WHERE email=gmail OR pending_email=gmail.
  await admin.from("profiles").update({ link_status: "linked", invite_token: null, pending_email: gmail } as never).eq("id", (target as { id: string }).id);

  return (
    <AppShell profile={profile!}>
      <Card>
        <CardHeader>
          <CardTitle>¡Vinculación completada!</CardTitle>
          <CardDescription>Tu Gmail {gmail} ha sido vinculado al perfil {(target as { first_name: string }).first_name} {(target as { last_name: string }).last_name}. Ya puedes acceder normalmente.</CardDescription>
        </CardHeader>
        <CardContent><a href="/dashboard" className="text-sm text-primary underline">Ir al dashboard</a></CardContent>
      </Card>
    </AppShell>
  );
}
