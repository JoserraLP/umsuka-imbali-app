"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { preRegisterMemberAction } from "@/lib/members/pre-register-actions";

export function PreRegisterForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    component_type: "member" as "music" | "dance" | "member",
    workgroup: "ninguno" as "telas" | "barra" | "estandarte" | "limpieza" | "ninguno",
    is_minor: false,
    pending_email: "",
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    const result = await preRegisterMemberAction({
      first_name: form.first_name,
      last_name: form.last_name,
      component_type: form.component_type,
      workgroup: form.workgroup,
      role: "member",
      is_minor: form.is_minor,
      pending_email: form.pending_email || null,
    });
    setLoading(false);
    if (!result.success) {
      setError(result.error);
      setInviteLink(null);
    } else {
      const link = `/invite/${result.data.invite_token}`;
      setSuccess(`Miembro pre-registrado. Token: ${result.data.invite_token}`);
      setInviteLink(link);
      setCopied(false);
      setForm({ first_name: "", last_name: "", component_type: "member", workgroup: "ninguno", is_minor: false, pending_email: "" });
      router.refresh();
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>Alta sin Gmail</Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alta sin Gmail (pre-registro)</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Input placeholder="Nombre" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required />
          <Input placeholder="Apellidos" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} required />
          <Select value={form.component_type} onChange={(e) => setForm({ ...form, component_type: e.target.value as never })}>
            <option value="music">Música</option>
            <option value="dance">Baile</option>
            <option value="member">Socio/a</option>
          </Select>
          <Select value={form.workgroup} onChange={(e) => setForm({ ...form, workgroup: e.target.value as never })}>
            <option value="telas">Telas</option>
            <option value="barra">Barra</option>
            <option value="estandarte">Estandarte</option>
            <option value="limpieza">Limpieza</option>
            <option value="ninguno">Ninguno</option>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_minor} onChange={(e) => setForm({ ...form, is_minor: e.target.checked })} />
            Es menor de edad
          </label>
          <Input placeholder="Email pendiente (opcional)" value={form.pending_email} onChange={(e) => setForm({ ...form, pending_email: e.target.value })} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && (
            <div className="space-y-2">
              <p className="text-sm text-green-600">{success}</p>
              {inviteLink && (
                <div className="flex items-center gap-2">
                  <code className="rounded bg-muted px-2 py-1 text-xs">{inviteLink}</code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(`${window.location.origin}${inviteLink}`);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      } catch {
                        setError("No se pudo copiar al portapapeles.");
                      }
                    }}
                  >
                    {copied ? "¡Copiado!" : "Copiar enlace"}
                  </Button>
                </div>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={loading}>{loading ? "Guardando..." : "Guardar"}</Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cerrar</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
