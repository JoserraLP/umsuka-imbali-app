"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  assignInstrumentAction,
  unassignInstrumentAction,
} from "@/app/instruments/actions";
import type { AssignableMember } from "@/lib/instruments/queries";

interface AssignResponsableFormProps {
  instrumentId: string;
  /** Hidden entirely while the instrument is deactivated. */
  instrumentActive: boolean;
  currentAssigneeId: string | null;
  assignableMembers: AssignableMember[];
}

export function AssignResponsableForm({
  instrumentId,
  instrumentActive,
  currentAssigneeId,
  assignableMembers,
}: AssignResponsableFormProps) {
  const router = useRouter();
  const [selectedUserId, setSelectedUserId] = useState(currentAssigneeId ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!instrumentActive) return null;

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedUserId) return;

    setIsSubmitting(true);
    setError(null);

    const result = await assignInstrumentAction({
      instrument_id: instrumentId,
      user_id: selectedUserId,
    });

    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error ?? "No se pudo asignar el responsable.");
      return;
    }

    router.refresh();
  }

  async function handleUnassign(e: React.FormEvent) {
    e.preventDefault();

    setIsSubmitting(true);
    setError(null);

    const result = await unassignInstrumentAction({ instrument_id: instrumentId });

    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error ?? "No se pudo desasignar el responsable.");
      return;
    }

    router.refresh();
  }

  return (
    <div className="space-y-3">
      <form onSubmit={handleAssign} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="assign-responsable">Responsable</Label>
          <div className="flex items-center gap-2">
            <Select
              id="assign-responsable"
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
            >
              <option value="">Selecciona un miembro...</option>
              {assignableMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.firstName} {member.lastName}
                </option>
              ))}
            </Select>
            <Button
              type="submit"
              size="sm"
              disabled={isSubmitting || !selectedUserId}
            >
              {isSubmitting ? "Asignando…" : "Asignar"}
            </Button>
          </div>
        </div>
        {currentAssigneeId && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleUnassign}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Desasignando…" : "Desasignar responsable"}
          </Button>
        )}
      </form>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}