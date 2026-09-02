"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { BarPriceHistoryEntry } from "@/lib/bar/menus";

export function PriceHistoryDrawer({ history }: { history: BarPriceHistoryEntry[] }) {
  const [open, setOpen] = useState(false);
  if (!open) return <Button variant="outline" size="sm" onClick={() => setOpen(true)}>Histórico</Button>;
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-semibold">Histórico de precios</h4>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cerrar</Button>
      </div>
      {history.length === 0 ? <p className="text-sm text-muted-foreground">Sin cambios.</p> : (
        <ul className="space-y-1 text-sm">
          {history.map((h) => (
            <li key={h.id} className="flex justify-between">
              <span>{h.oldPrice ?? "—"} → {h.newPrice} €</span>
              <span className="text-muted-foreground">{new Date(h.changedAt).toLocaleDateString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
