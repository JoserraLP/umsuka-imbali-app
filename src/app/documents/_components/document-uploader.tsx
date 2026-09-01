"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createDocumentAction, createDocumentCategoryAction } from "@/lib/documents/actions";
import { Upload, Loader2, FolderPlus } from "lucide-react";

interface Props {
  categories: { id: string; name: string }[];
}

export function DocumentUploader({ categories }: Props) {
  const router = useRouter();
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");

  // Category creation inline
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);

  async function handleCreateCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    setCreatingCategory(true);
    setError(null);
    const fd = new FormData();
    fd.set("name", newCategoryName.trim());
    const res = await createDocumentCategoryAction(fd);
    setCreatingCategory(false);
    if (!res.success) {
      setError(res.error ?? "Error al crear categoría.");
      return;
    }
    setNewCategoryName("");
    setShowCategoryForm(false);
    setSuccess("Categoría creada.");
    router.refresh();
    setTimeout(() => setSuccess(null), 3000);
  }

  async function doUpload(file: File, displayName: string, catId: string) {
    setUploading(true);
    setError(null);
    setSuccess(null);
    setProgress("Subiendo...");
    const fd = new FormData();
    fd.set("name", displayName || file.name);
    if (catId) fd.set("categoryId", catId);
    fd.set("file", file);
    const res = await createDocumentAction(fd);
    setUploading(false);
    setProgress(null);
    if (!res.success) {
      setError(res.error ?? "Error al subir documento.");
      return;
    }
    setSuccess("Documento subido correctamente.");
    setSelectedFile(null);
    setName("");
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
    setTimeout(() => setSuccess(null), 3000);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    setSelectedFile(file);
    if (!name) setName(file.name);
  }

  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Upload className="h-4 w-4" /> Subir documento
      </h2>
      <p className="text-sm text-muted-foreground">
        Arrastra un fichero o selecciónalo. Máx 20 MB. Tipos: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, PNG, JPG, TXT, CSV.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/20"}`}
      >
        <Upload className="mb-2 h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">Arrastra y suelta aquí</p>
        <p className="text-xs text-muted-foreground">o</p>
        <Label htmlFor="doc-file" className="mt-2 cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          Seleccionar fichero
        </Label>
        <Input ref={fileRef} id="doc-file" type="file" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setSelectedFile(f);
          if (f && !name) setName(f.name);
        }} />
        {selectedFile && <p className="mt-3 text-xs text-muted-foreground">{selectedFile.name} · {(selectedFile.size / 1024).toFixed(1)} KB</p>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="doc-name" className="text-xs">Nombre</Label>
          <Input id="doc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del documento" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="doc-category" className="text-xs">Categoría</Label>
          <select id="doc-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm">
            <option value="">Sin categoría</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!selectedFile || uploading} onClick={() => selectedFile && doUpload(selectedFile, name, categoryId)}>
          {uploading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Subiendo...</> : "Subir"}
        </Button>
        {progress && <span className="text-xs text-muted-foreground">{progress}</span>}
        <Button variant="outline" size="sm" onClick={() => setShowCategoryForm((v) => !v)}>
          <FolderPlus className="mr-1 h-4 w-4" /> Nueva categoría
        </Button>
      </div>

      {showCategoryForm && (
        <form onSubmit={handleCreateCategory} className="flex gap-2">
          <Input value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="Nombre categoría (1-100)" maxLength={100} />
          <Button type="submit" disabled={creatingCategory}>{creatingCategory ? <Loader2 className="h-4 w-4 animate-spin" /> : "Crear"}</Button>
        </form>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && <p className="text-sm text-green-600">{success}</p>}
    </div>
  );
}
