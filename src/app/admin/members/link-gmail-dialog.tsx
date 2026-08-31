"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { linkGmailAction } from "@/lib/members/pre-register-actions";

export function LinkGmailDialog({ profileId, inviteToken }: { profileId: string; inviteToken: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [gmail, setGmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const result = await linkGmailAction({ profileId, gmail, invite_token: inviteToken });
    setLoading(false);
    if (!result.success) {
      setError(result.error);
    } else {
      setSuccess("Gmail vinculado correctamente.");
      router.refresh();
    }
  }

  if (!open) {
    return <Button variant="outline" size="sm" onClick={() => setOpen(true)}>Vincular Gmail</Button>;
  }

  return (
    <Card className="mt-2">
      <CardHeader>
        <CardTitle className="text-sm">Vincular Gmail</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <Input placeholder="correo@gmail.com" value={gmail} onChange={(e) => setGmail(e.target.value)} required type="email" />
          {error && <p className="text-xs text-destructive">{error}</p>}
          {success && <p className="text-xs text-green-600">{success}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={loading}>{loading ? "..." : "Vincular"}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cerrar</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
