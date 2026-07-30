import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { NewsForm } from "@/app/news/news-form";

export const metadata: Metadata = {
  title: "Nueva noticia",
};

export default async function NewNewsPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  if (!isManagementRole(profile.role)) {
    redirect("/news");
  }

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">Nueva noticia</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Crea una noticia o anuncio para todos los miembros.
          </p>
        </div>

        <NewsForm
          mode="create"
          defaultValues={{
            title: "",
            content: "",
            image_url: null,
            published: true,
            pinned: false,
          }}
        />
      </div>
    </AppShell>
  );
}
