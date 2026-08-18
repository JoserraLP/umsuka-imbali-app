"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { approveUserActionAdmin, suspendUserActionAdmin } from "@/app/admin/actions";
import { Check, Ban } from "lucide-react";

interface UserStatusActionsProps {
  userId: string;
  /** "pending" | "active" | "suspended" — drives which buttons render. */
  status: string;
  disableSelf: boolean;
}

/**
 * Approve/Suspend actions for the admin member directory (Sprint 21).
 * "Aprobar" only for pending members; "Suspender" for active or pending
 * members — never for the caller's own row. Both delegate to the admin
 * lib wrappers (audited once server-side) and refresh the directory
 * after success.
 */
export function UserStatusActions({ userId, status, disableSelf }: UserStatusActionsProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const canApprove = status === "pending";
  const canSuspend = status === "pending" || status === "active";

  function run(action: "approve" | "suspend") {
    setError(null);

    startTransition(async () => {
      const result =
        action === "approve"
          ? await approveUserActionAdmin({ userId })
          : await suspendUserActionAdmin({ userId });

      if (!result.success) {
        console.error(`Error al ${action === "approve" ? "aprobar" : "suspender"} el miembro:`, {
          message: result.error,
        });
        setError(result.error ?? "No se pudo completar la acción.");
        return;
      }

      router.refresh();
    });
  }

  if (!canApprove && !canSuspend) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        {canApprove && (
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={disableSelf || isPending}
            onClick={() => run("approve")}
          >
            <Check className="mr-1 h-4 w-4" />
            {isPending ? "Aprobando…" : "Aprobar"}
          </Button>
        )}
        {canSuspend && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={disableSelf || isPending}
            onClick={() => run("suspend")}
          >
            <Ban className="mr-1 h-4 w-4" />
            {isPending ? "Suspendiendo…" : "Suspender"}
          </Button>
        )}
      </div>
      {disableSelf && (
        <span className="text-xs text-muted-foreground">
          No puedes aprobarte o suspenderte a ti mismo.
        </span>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}