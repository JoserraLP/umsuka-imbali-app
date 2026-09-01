"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatFileSize } from "@/lib/documents/schema";
import { deleteDocumentAction, updateDocumentAction } from "@/lib/documents/actions";
import { Trash2, Download, Pencil, Loader2, Save, X } from "lucide-react";
import { Input } from "@/components/ui/input";

interface Doc {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  name: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  documents: Doc[];
  categories: { id: string; name: string }[];
  canManage: boolean;
}

export function DocumentTable({ documents, categories, canManage }: Props) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(id: string) {
    if (!confirm("¿Eliminar este documento? Se borrará el fichero y no se puede deshacer.")) return;
    setDeletingId(id);
    setError(null);
    const res = await deleteDocumentAction(id);
    setDeletingId(null);
    if (!res.success) {
      setError(res.error ?? "Error al eliminar.");
      return;
    }
    router.refresh();
  }

  async function handleUpdate(id: string) {
    setSaving(true);
    setError(null);
    const fd = new FormData();
    fd.set("id", id);
    fd.set("name", editName);
    if (editCategoryId) fd.set("categoryId", editCategoryId);
    const res = await updateDocumentAction(fd);
    setSaving(false);
    if (!res.success) {
      setError(res.error ?? "Error al actualizar.");
      return;
    }
    setEditingId(null);
    router.refresh();
  }

  if (documents.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No hay documentos con esos filtros.</p>;
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Nombre</th>
              <th className="px-3 py-2 text-left font-medium">Categoría</th>
              <th className="px-3 py-2 text-left font-medium">Tipo</th>
              <th className="px-3 py-2 text-left font-medium">Tamaño</th>
              <th className="px-3 py-2 text-left font-medium">Fecha</th>
              <th className="px-3 py-2 text-right font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {documents.map((doc) => (
              <tr key={doc.id} className="hover:bg-muted/20">
                <td className="px-3 py-2">
                  {editingId === doc.id ? (
                    <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8" />
                  ) : (
                    <span className="font-medium">{doc.name}</span>
                  )}
                  <div className="text-xs text-muted-foreground">{doc.filePath.split("/").pop()}</div>
                </td>
                <td className="px-3 py-2">
                  {editingId === doc.id ? (
                    <select value={editCategoryId} onChange={(e) => setEditCategoryId(e.target.value)} className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs">
                      <option value="">Sin categoría</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  ) : doc.categoryName ? (
                    <Badge variant="secondary" className="text-[10px]">{doc.categoryName}</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">{doc.mimeType.split("/").pop()}</td>
                <td className="px-3 py-2 text-xs">{formatFileSize(doc.fileSize)}</td>
                <td className="px-3 py-2 text-xs">{new Date(doc.createdAt).toLocaleDateString("es-ES")}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    {canManage && editingId === doc.id ? (
                      <>
                        <Button size="sm" variant="default" disabled={saving} onClick={() => handleUpdate(doc.id)}>
                          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </>
                    ) : (
                      <>
                        {/* Download via storage public URL? For private bucket, signed URL needed; placeholder link */}
                        <a
                          href={`/api/documents/${doc.id}/download`}
                          className="inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-2 text-xs hover:bg-accent"
                          title="Descargar"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </a>
                        {canManage && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditingId(doc.id);
                                setEditName(doc.name);
                                setEditCategoryId(doc.categoryId ?? "");
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" disabled={deletingId === doc.id} onClick={() => handleDelete(doc.id)}>
                              {deletingId === doc.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3 text-destructive" />}
                            </Button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
