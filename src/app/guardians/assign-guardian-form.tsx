"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { assignGuardianAction, unassignGuardianAction, setMinorStatusAction } from "@/lib/guardians/actions";

interface MinorOption {
  id: string;
  firstName: string;
  lastName: string;
  legalGuardianId: string | null;
}

interface GuardianOption {
  id: string;
  fullName: string;
}

export function AssignGuardianForm({
  minors,
  guardians,
}: {
  minors: MinorOption[];
  guardians: GuardianOption[];
}) {
  const router = useRouter();
  const [minorId, setMinorId] = useState("");
  const [guardianId, setGuardianId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!minorId || !guardianId) {
      setError("Selecciona menor y representante.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    const result = await assignGuardianAction({ minor_id: minorId, guardian_id: guardianId });
    setIsSubmitting(false);
    if (!result.success) {
      setError(result.error ?? "No se pudo asignar.");
      return;
    }
    setSuccess("Representante asignado correctamente.");
    router.refresh();
  }

  return (
    <form onSubmit={handleAssign} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="assign-minor">Menor</Label>
          <select
            id="assign-minor"
            value={minorId}
            onChange={(e) => setMinorId(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">Selecciona menor</option>
            {minors.map((m) => (
              <option key={m.id} value={m.id}>
                {m.firstName} {m.lastName}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="assign-guardian">Representante</Label>
          <select
            id="assign-guardian"
            value={guardianId}
            onChange={(e) => setGuardianId(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">Selecciona representante</option>
            {guardians.map((g) => (
              <option key={g.id} value={g.id}>
                {g.fullName}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {success && <p className="text-sm text-green-600">{success}</p>}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Asignando…" : "Asignar representante"}
      </Button>
    </form>
  );
}

export function UnassignGuardianForm({ minors }: { minors: MinorOption[] }) {
  const router = useRouter();
  const [minorId, setMinorId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUnassign(e: React.FormEvent) {
    e.preventDefault();
    if (!minorId) {
      setError("Selecciona un menor.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    const result = await unassignGuardianAction({ minor_id: minorId });
    setIsSubmitting(false);
    if (!result.success) {
      setError(result.error ?? "No se pudo desasignar.");
      return;
    }
    router.refresh();
  }

  const minorsWithGuardian = minors.filter((m) => m.legalGuardianId);

  return (
    <form onSubmit={handleUnassign} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="unassign-minor">Menor con representante</Label>
        <select
          id="unassign-minor"
          value={minorId}
          onChange={(e) => setMinorId(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">Selecciona menor</option>
          {minorsWithGuardian.map((m) => (
            <option key={m.id} value={m.id}>
              {m.firstName} {m.lastName}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" variant="outline" disabled={isSubmitting}>
        {isSubmitting ? "Quitando…" : "Quitar representante"}
      </Button>
    </form>
  );
}

export function SetMinorStatusForm({
  members,
}: {
  members: Array<{ id: string; firstName: string; lastName: string; isMinor: boolean }>;
}) {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [isMinor, setIsMinor] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) {
      setError("Selecciona un miembro.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    const result = await setMinorStatusAction({ user_id: userId, is_minor: isMinor });
    setIsSubmitting(false);
    if (!result.success) {
      setError(result.error ?? "No se pudo actualizar.");
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="minor-status-user">Miembro</Label>
        <select
          id="minor-status-user"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">Selecciona miembro</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.firstName} {m.lastName} {m.isMinor ? "(menor)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <input
          id="minor-status-check"
          type="checkbox"
          checked={isMinor}
          onChange={(e) => setIsMinor(e.target.checked)}
          className="h-4 w-4 rounded border-input"
        />
        <Label htmlFor="minor-status-check" className="cursor-pointer">
          Marcar como menor de edad
        </Label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Guardando…" : "Actualizar estado"}
      </Button>
    </form>
  );
}
