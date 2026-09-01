"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
    setTimeout(() => {
      setOpen(false);
      router.refresh();
    }, 1200);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Pasar a cuenta local
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convertir pendiente a cuenta local</DialogTitle>
          <DialogDescription>
            El perfil pasará de <b>pendiente de Gmail</b> a <b>cuenta local</b> (usuario/contraseña). El super_admin gestiona el cambio. El histórico se conserva.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium">Username (3-30, solo letras/números/_)</label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={30} pattern="^[a-zA-Z0-9_]+$" />
          </div>
          <div>
            <label className="text-xs font-medium">Contraseña (8+, may, min, número, especial)</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            <p className="mt-1 text-xs text-muted-foreground">Ej: Umsuka2026!</p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && <p className="text-sm text-green-600">{success}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Convirtiendo..." : "Convertir"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
