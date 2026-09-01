"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { convertPendingToLocal } from "@/app/admin/members/convert-actions";

interface Props {
  profileId: string;
  defaultName: string;
}

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/__+/g, "_")
    .slice(0, 30);
}

export function ConvertToLocalDialog({ profileId, defaultName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState(() => slugify(defaultName));
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    const res = await convertPendingToLocal({ profileId, username: username.trim(), password });
    setLoading(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setSuccess(`Convertido: ${res.data?.username}. Ya puede entrar con usuario/contraseña.`);
    setTimeout(() => router.refresh(), 800);
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Pasar a cuenta local
      </Button>
    );
  }

  return (
    <Card className="mt-2">
      <CardHeader>
        <CardTitle className="text-sm">Convertir a cuenta local</CardTitle>
        <p className="text-xs text-muted-foreground">
          El perfil pasará de pendiente de Gmail a cuenta local (usuario/contraseña). El histórico se conserva.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-2">
          <div>
            <label className="text-xs font-medium">Username (3-30, solo letras/números/_)</label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={30} pattern="^[a-zA-Z0-9_]+$" />
          </div>
          <div>
            <label className="text-xs font-medium">Contraseña (8+, may, min, número, especial)</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            <p className="mt-1 text-xs text-muted-foreground">Ej: Umsuka2026!</p>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          {success && <p className="text-xs text-green-600">{success}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={loading}>
              {loading ? "..." : "Convertir"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={loading}>
              Cerrar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
