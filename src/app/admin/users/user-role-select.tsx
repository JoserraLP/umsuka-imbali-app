"use client";

import { useState, useTransition } from "react";
import { Select } from "@/components/ui/select";
import { APP_ROLES, getRoleLabel } from "@/lib/auth/roles";
import { updateMemberRoleAction } from "@/app/admin/users/actions";
import type { AppRole } from "@/types/database.types";

interface UserRoleSelectProps {
  userId: string;
  currentRole: AppRole;
  actorRole: AppRole;
  disableSelf: boolean;
}

/**
 * Client-side mirror of the server-side canAssignRole() check. This is a
 * UX convenience only (hides options the request would be rejected for);
 * the Server Action re-validates with the authoritative check, and RLS is
 * the final backstop regardless of what this component renders.
 */
function isAssignableByActor(actorRole: AppRole, targetRole: AppRole): boolean {
  if (actorRole === "super_admin") return true;
  if (actorRole !== "admin") return false;
  return targetRole !== "super_admin" && targetRole !== "admin";
}

export function UserRoleSelect({ userId, currentRole, actorRole, disableSelf }: UserRoleSelectProps) {
  const [role, setRole] = useState<AppRole>(currentRole);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const assignableRoles = APP_ROLES.filter(
    (candidate) => candidate === currentRole || isAssignableByActor(actorRole, candidate),
  );

  function handleChange(nextRole: AppRole) {
    setError(null);
    startTransition(async () => {
      const result = await updateMemberRoleAction({ userId, role: nextRole });

      if (!result.success) {
        console.error("Error al actualizar el rol del miembro:", result.error);
        setError(result.error ?? "No se pudo actualizar el rol.");
        return;
      }

      setRole(nextRole);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Select
        value={role}
        disabled={disableSelf || isPending}
        onChange={(event) => handleChange(event.target.value as AppRole)}
        className="w-40"
      >
        {assignableRoles.map((candidate) => (
          <option key={candidate} value={candidate}>
            {getRoleLabel(candidate)}
          </option>
        ))}
      </Select>
      {disableSelf && (
        <span className="text-xs text-muted-foreground">No puedes cambiar tu propio rol.</span>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
