"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { deleteAccountPermanentlyAction } from "@/app/admin/users/actions";
import { Loader2, Trash2 } from "lucide-react";

interface DeleteAccountButtonProps {
  userId: string;
  memberName: string;
}

/**
 * Super-admin only: destructive, double-step permanent account deletion.
 * The dialog requires typing the word ELIMINAR before the confirm button
 * is enabled; on success the list is refreshed via router.refresh().
 */
export function DeleteAccountButton({ userId, memberName }: DeleteAccountButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isConfirmed = confirmation.trim().toUpperCase() === "ELIMINAR";

  function handleConfirm() {
    setError(null);

    startTransition(async () => {
      const result = await deleteAccountPermanentlyAction({ userId, confirmation });

      if (!result.success) {
        setError(result.error ?? "Error al eliminar la cuenta.");
        return;
      }

      setOpen(false);
      setConfirmation("");
      router.refresh();
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        // While the deletion is running server-side, ignore close attempts
        // (Escape / overlay click) so the user keeps seeing the feedback
        // (pending label + eventual error) instead of a silently closed
        // dialog that leaves the page with a half-run operation.
        if (isPending) return;
        setOpen(nextOpen);
        if (!nextOpen) {
          // Al cancelar o cerrar se limpia el estado del formulario.
          setConfirmation("");
          setError(null);
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" disabled={isPending}>
          <Trash2 className="mr-1 h-3 w-3" />
          Eliminar permanentemente
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar la cuenta de {memberName}?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción no se puede deshacer. Se eliminarán el acceso, el perfil y todos los datos
            asociados a la cuenta. Para confirmar, escribe ELIMINAR.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder="Escribe ELIMINAR para confirmar"
          autoFocus
        />
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={!isConfirmed || isPending}
            onClick={(event) => {
              event.preventDefault();
              handleConfirm();
            }}
            className="bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
          >
            {isPending ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                Eliminando…
              </>
            ) : (
              "Eliminar definitivamente"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
