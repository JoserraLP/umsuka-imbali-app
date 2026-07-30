import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { getNewsById } from "@/lib/news/queries";
import { NewsForm } from "@/app/news/news-form";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = {
  title: "Editar noticia",
};

export default async function EditNewsPage({ params }: PageProps) {
  const { id } = await params;
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  if (!isManagementRole(profile.role)) {
    redirect("/news");
  }

  const news = await getNewsById(id);

  if (!news) {
    notFound();
  }

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">Editar noticia</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Modifica los campos de la noticia.
          </p>
        </div>

        <NewsForm
          mode="edit"
          newsId={id}
          defaultValues={{
            title: news.title,
            content: news.content,
            image_url: news.imageUrl,
            published: news.published,
            pinned: news.pinned,
          }}
        />
      </div>
    </AppShell>
  );
}
