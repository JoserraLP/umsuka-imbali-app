import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { Clock, Ban } from "lucide-react";

export const metadata: Metadata = {
  title: "Pendiente de aprobación",
};

export default async function AuthPendingPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { data: status } = await supabase.rpc("current_user_status");

  // If already active, redirect to dashboard
  if (status === "active") {
    redirect("/dashboard");
  }

  const isSuspended = status === "suspended";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="mx-auto w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mb-4 flex justify-center">
            {isSuspended ? (
              <Ban className="h-12 w-12 text-destructive" />
            ) : (
              <Clock className="h-12 w-12 text-muted-foreground" />
            )}
          </div>
          <CardTitle className="text-xl">
            {isSuspended ? "Cuenta suspendida" : "Registro pendiente"}
          </CardTitle>
          <CardDescription>
            {isSuspended
              ? "Tu cuenta ha sido suspendida por un administrador. Si crees que se trata de un error, ponte en contacto con la directiva."
              : "Tu registro está pendiente de aprobación por un administrador. Recibirás acceso en cuanto sea aprobado."}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center text-sm text-muted-foreground">
          <p>
            {isSuspended
              ? "No puedes acceder a la aplicación mientras tu cuenta esté suspendida."
              : "Gracias por tu paciencia. Te notificaremos cuando tu cuenta esté activa."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
