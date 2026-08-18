"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { updateNotificationPreferencesAction } from "@/app/notifications/actions";
import { NOTIFICATION_TYPES, NOTIFICATION_TYPE_LABELS } from "@/lib/notifications/schema";
import type { NotificationType } from "@/types/database.types";

/**
 * Notification preferences card (/notifications). Storage semantic:
 * `[]` = receive every type. The master toggle saves `[]`; when it is
 * off, the user picks the types they want and the last remaining type
 * cannot be unchecked (there is no meaningful "receive nothing" state in
 * this feature). Feedback via a transition + router.refresh(). The actor
 * is resolved server-side by the action (requireAuthenticatedProfile).
 */
export function NotificationPreferencesCard({
  initialTypes,
}: {
  initialTypes: NotificationType[];
}) {
  const [receiveAll, setReceiveAll] = useState(initialTypes.length === 0);
  const [types, setTypes] = useState<NotificationType[]>(
    initialTypes.length === 0 ? [...NOTIFICATION_TYPES] : initialTypes,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleSave = () => {
    setError(null);

    startTransition(async () => {
      const result = await updateNotificationPreferencesAction(receiveAll ? [] : types);
      if (result.success) {
        router.refresh();
      } else {
        setError(result.error ?? "No se pudieron guardar las preferencias.");
      }
    });
  };

  const toggleType = (type: NotificationType) => {
    setTypes((prev) => {
      if (prev.includes(type)) {
        // Master is off: at least one type must stay selected.
        if (prev.length <= 1) return prev;
        return prev.filter((selected) => selected !== type);
      }
      return [...prev, type];
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="h-4 w-4 text-muted-foreground" />
          Preferencias de notificación
        </CardTitle>
        <CardDescription className="text-sm">
          Elige qué tipos de notificaciones quieres recibir. Con &quot;Recibir todas&quot; se guarda
          la lista vacía (&quot;{"{"}
          {"}"}&quot;) — la opción por defecto.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={receiveAll}
            onChange={(event) => setReceiveAll(event.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          <span className="text-sm font-medium">Recibir todas las notificaciones</span>
        </label>

        <div className="grid gap-2 sm:grid-cols-2">
          {NOTIFICATION_TYPES.map((type) => (
            <label
              key={type}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 transition-colors",
                receiveAll ? "cursor-not-allowed opacity-60" : "hover:bg-accent/50",
              )}
            >
              <input
                type="checkbox"
                checked={receiveAll || types.includes(type)}
                disabled={receiveAll}
                onChange={() => toggleType(type)}
                className="h-4 w-4 accent-primary"
              />
              <span className="text-sm">{NOTIFICATION_TYPE_LABELS[type]}</span>
            </label>
          ))}
        </div>

        {receiveAll && (
          <p className="text-xs text-muted-foreground">
            Recibirás todos los tipos de notificaciones.
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isPending} size="sm">
            {isPending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
