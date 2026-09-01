import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { getCategories, getDocuments } from "@/lib/documents/queries";
import { DocumentUploader } from "@/app/documents/_components/document-uploader";
import { DocumentTable } from "@/app/documents/_components/document-table";
import { FileText, Search, Folder } from "lucide-react";

export const metadata: Metadata = { title: "Documentos" };

interface PageProps {
  searchParams: Promise<{ q?: string; category?: string; mime?: string }>;
}

export default async function DocumentsPage({ searchParams }: PageProps) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/auth/login");

  const params = await searchParams;
  const q = params.q?.trim() || undefined;
  const category = params.category || undefined;
  const mime = params.mime || undefined;

  const canManage = isManagementRole(profile.role);

  const [categories, documents] = await Promise.all([
    getCategories(),
    getDocuments({ search: q, categoryId: category, mimeType: mime }),
  ]);

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <FileText className="h-6 w-6" /> Documentos
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gestión documental por categorías. Todos los miembros pueden listar y descargar; solo la directiva puede subir y eliminar.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="h-4 w-4" /> Filtros
            </CardTitle>
            <CardDescription>Filtra por nombre, categoría o tipo de fichero.</CardDescription>
          </CardHeader>
          <CardContent>
            <form method="GET" className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label htmlFor="q" className="text-xs font-medium text-muted-foreground">Buscar por nombre</label>
                <Input id="q" name="q" defaultValue={q} placeholder="Ej. Estatutos..." className="mt-1" />
              </div>
              <div>
                <label htmlFor="category" className="text-xs font-medium text-muted-foreground">Categoría</label>
                <select id="category" name="category" defaultValue={category} className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm">
                  <option value="">Todas</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="mime" className="text-xs font-medium text-muted-foreground">Tipo</label>
                <select id="mime" name="mime" defaultValue={mime} className="mt-1 flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm">
                  <option value="">Todos</option>
                  <option value="application/pdf">PDF</option>
                  <option value="application/msword">DOC</option>
                  <option value="application/vnd.openxmlformats-officedocument.wordprocessingml.document">DOCX</option>
                  <option value="image/png">PNG</option>
                  <option value="image/jpeg">JPEG</option>
                  <option value="text/plain">TXT</option>
                  <option value="text/csv">CSV</option>
                </select>
              </div>
              <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                Filtrar
              </button>
              {(q || category || mime) && (
                <Link href="/documents" className="text-sm text-muted-foreground hover:text-foreground">Limpiar</Link>
              )}
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Folder className="h-4 w-4" /> Categorías ({categories.length})
            </CardTitle>
            <CardDescription>Organización jerárquica opcional. Crea categorías desde el uploader si eres directiva.</CardDescription>
          </CardHeader>
          <CardContent>
            {categories.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay categorías todavía.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {categories.map((c) => (
                  <Link key={c.id} href={`/documents?category=${c.id}`} className="hover:opacity-80">
                    <Badge variant={category === c.id ? "default" : "secondary"} className="gap-1">
                      <Folder className="h-3 w-3" /> {c.name}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {canManage && <DocumentUploader categories={categories} />}

        <Card>
          <CardHeader>
            <CardTitle>Documentos ({documents.length})</CardTitle>
            <CardDescription>Listado filtrable. Descarga disponible para todos los miembros autenticados.</CardDescription>
          </CardHeader>
          <CardContent>
            {documents.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <FileText className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {q || category || mime ? "No hay documentos con esos filtros." : "No hay documentos todavía."}
                </p>
                {!canManage && !q && !category && !mime && (
                  <p className="text-xs text-muted-foreground/60">La directiva subirá los documentos cuando estén disponibles.</p>
                )}
              </div>
            ) : (
              <DocumentTable documents={documents} categories={categories} canManage={canManage} />
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
