"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createGuardianAction,
  updateGuardianAction,
} from "@/lib/guardians/actions";

interface MemberOption {
  id: string;
  firstName: string;
  lastName: string;
}

interface GuardianFormProps {
  mode: "create" | "edit";
  guardianId?: string;
  availableMembers: MemberOption[];
  defaultValues?: {
    full_name: string;
    document_id: string;
    email: string;
    phone: string;
    relationship: string;
    is_member: boolean;
    member_user_id: string;
  };
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function GuardianForm({
  mode,
  guardianId,
  availableMembers,
  defaultValues,
  onSuccess,
  onCancel,
}: GuardianFormProps) {
  const router = useRouter();
  const [fullName, setFullName] = useState(defaultValues?.full_name ?? "");
  const [documentId, setDocumentId] = useState(defaultValues?.document_id ?? "");
  const [email, setEmail] = useState(defaultValues?.email ?? "");
  const [phone, setPhone] = useState(defaultValues?.phone ?? "");
  const [relationship, setRelationship] = useState(defaultValues?.relationship ?? "");
  const [isMember, setIsMember] = useState(defaultValues?.is_member ?? false);
  const [memberUserId, setMemberUserId] = useState(defaultValues?.member_user_id ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const input = {
      full_name: fullName,
      document_id: documentId,
      email: email,
      phone: phone,
      relationship: relationship,
      is_member: isMember,
      member_user_id: isMember ? memberUserId || null : null,
    } as {
      full_name: string;
      document_id: string | null;
      email: string | null;
      phone: string | null;
      relationship: string | null;
      is_member: boolean;
      member_user_id: string | null;
    };

    const result =
      mode === "create"
        ? await createGuardianAction(input as unknown as never)
        : await updateGuardianAction({ id: guardianId!, ...input } as unknown as never);

    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error ?? "No se pudo guardar el representante.");
      return;
    }

    if (onSuccess) onSuccess();
    router.refresh();
    if (mode === "create") {
      setFullName("");
      setDocumentId("");
      setEmail("");
      setPhone("");
      setRelationship("");
      setIsMember(false);
      setMemberUserId("");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="guardian-fullname">Nombre completo *</Label>
        <Input
          id="guardian-fullname"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Nombre y apellidos"
          maxLength={200}
          required
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          id="guardian-ismember"
          type="checkbox"
          checked={isMember}
          onChange={(e) => {
            setIsMember(e.target.checked);
            if (!e.target.checked) setMemberUserId("");
          }}
          className="h-4 w-4 rounded border-input"
        />
        <Label htmlFor="guardian-ismember" className="cursor-pointer">
          Es miembro de la comparsa
        </Label>
      </div>

      {isMember ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="guardian-member">Miembro *</Label>
          <select
            id="guardian-member"
            value={memberUserId}
            onChange={(e) => setMemberUserId(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            required={isMember}
          >
            <option value="">Selecciona un miembro</option>
            {availableMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.firstName} {m.lastName}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="guardian-doc">Documento</Label>
              <Input
                id="guardian-doc"
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
                placeholder="DNI/NIE"
                maxLength={50}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="guardian-rel">Relación</Label>
              <Input
                id="guardian-rel"
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                placeholder="Madre, padre, tutor..."
                maxLength={100}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="guardian-email">Email</Label>
              <Input
                id="guardian-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@ejemplo.com"
                maxLength={320}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="guardian-phone">Teléfono</Label>
              <Input
                id="guardian-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+34 600 000 000"
                maxLength={50}
              />
            </div>
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Guardando…" : mode === "create" ? "Crear representante" : "Guardar cambios"}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}
