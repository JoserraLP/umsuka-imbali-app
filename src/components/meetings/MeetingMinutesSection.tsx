"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { deleteMeetingMinutesAction, uploadMeetingMinutesAction } from "@/lib/meetings/actions";
import { formatFileSize } from "@/lib/meetings/schema";
import { FileText, Upload, Trash2, FileCheck, AlertCircle } from "lucide-react";

interface MinutesData {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  eventId: string;
  eventTitle: string;
  minutes: MinutesData | null;
  canManage: boolean;
}

export function MeetingMinutesSection({ eventId, eventTitle, minutes, canManage }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleUpload = () => {
    if (!selectedFile) {
      setError("Selecciona un fichero PDF, DOC o DOCX.");
      return;
    }
    setError(null);
    setSuccess(null);
    const formData = new FormData();
    formData.set("eventId", eventId);
    formData.set("file", selectedFile);
    startTransition(async () => {
      const res = await uploadMeetingMinutesAction(formData);
      if (!res.success) setError(res.error ?? "Error al subir acta.");
      else {
        setSuccess(minutes ? "Acta reemplazada correctamente." : "Acta subida correctamente.");
        setSelectedFile(null);
        // Reset file input via reload? keep state
      }
    });
  };

  const handleDelete = () => {
    if (!confirm(`¿Eliminar el acta de "${eventTitle}"? Esta acción no se puede deshacer.`)) return;
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await deleteMeetingMinutesAction(eventId);
      if (!res.success) setError(res.error ?? "Error al eliminar acta.");
      else setSuccess("Acta eliminada correctamente.");
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" /> Acta de la reunión
        </CardTitle>
        <CardDescription>
          {minutes
            ? "Esta reunión tiene acta disponible (sin descarga en esta fase)."
            : "Esta reunión aún no tiene acta. La directiva puede subir el fichero PDF/DOC/DOCX."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {minutes ? (
          <div className="flex items-start justify-between rounded-lg border bg-muted/30 p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-primary/10 p-2">
                <FileCheck className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">{minutes.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(minutes.fileSize)} · {minutes.mimeType.split("/").pop()?.toUpperCase()} ·{" "}
                  {new Date(minutes.updatedAt).toLocaleDateString("es-ES", { dateStyle: "medium" })}
                </p>
                <Badge variant="secondary" className="mt-1">
                  Acta disponible
                </Badge>
                <p className="mt-1 text-xs text-muted-foreground">La descarga se habilitará próximamente.</p>
              </div>
            </div>
            {canManage && (
              <Button variant="ghost" size="icon" onClick={handleDelete} disabled={isPending} aria-label="Eliminar acta">
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center">
            <FileText className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Sin acta</p>
            <p className="text-xs text-muted-foreground/60">Cuando la directiva suba el acta aparecerá aquí.</p>
          </div>
        )}

        {canManage && (
          <div className="space-y-3 rounded-lg border p-4">
            <p className="text-sm font-medium">
              {minutes ? "Reemplazar acta" : "Subir acta"} <span className="text-muted-foreground font-normal">(PDF/DOC/DOCX, máx. 10 MB)</span>
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                type="file"
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setSelectedFile(f);
                  setError(null);
                  setSuccess(null);
                }}
                disabled={isPending}
                className="flex-1"
              />
              <Button onClick={handleUpload} disabled={isPending || !selectedFile} className="shrink-0">
                <Upload className="mr-2 h-4 w-4" />
                {isPending ? "Subiendo..." : minutes ? "Reemplazar" : "Subir"}
              </Button>
            </div>
            {selectedFile && (
              <p className="text-xs text-muted-foreground">
                Seleccionado: {selectedFile.name} ({formatFileSize(selectedFile.size)})
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="flex items-center gap-1.5 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" /> {error}
          </p>
        )}
        {success && <p className="text-sm text-green-600">{success}</p>}
      </CardContent>
    </Card>
  );
}
