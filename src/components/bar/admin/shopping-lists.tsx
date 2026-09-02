"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { ShoppingListSummary, ShoppingList } from "@/lib/bar/shopping";
import { createShoppingListAction, addShoppingItemAction, toggleShoppingItemAction, closeShoppingListAction } from "@/app/bar/actions";
import { suggestQuantity } from "@/lib/bar/shopping";

export function ShoppingLists({ lists, detail, barItems }: { lists: ShoppingListSummary[]; detail?: ShoppingList | null; barItems?: { id: string; name: string; stock_quantity: number }[] }) {
  const [title, setTitle] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(detail?.id ?? null);
  const [itemName, setItemName] = useState("");
  const [qty, setQty] = useState<number>(1);
  const [barItemId, setBarItemId] = useState<string>("");

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input placeholder="Título nueva lista" value={title} onChange={(e) => setTitle(e.target.value)} className="max-w-xs" />
        <Button onClick={async () => { if (!title.trim()) return; await createShoppingListAction({ title: title.trim() }); window.location.reload(); }}>Crear lista</Button>
      </div>

      {lists.length === 0 ? <p className="text-sm text-muted-foreground">No hay listas de la compra. Crea una para empezar.</p> : (
        <ul className="space-y-2">
          {lists.map((l) => (
            <li key={l.id} className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="font-medium">{l.title} <Badge variant={l.status === "open" ? "default" : "secondary"}>{l.status === "open" ? "Abierta" : "Cerrada"}</Badge></p>
                <p className="text-xs text-muted-foreground">Progreso {l.checked}/{l.total} ({l.percent}%)</p>
                <div className="h-1.5 w-32 rounded bg-muted"><div className="h-1.5 rounded bg-primary" style={{ width: `${l.percent}%` }} /></div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setSelectedId(l.id)}>{l.status === "open" ? "Abrir" : "Ver"}</Button>
                {l.status === "open" && <Button size="sm" onClick={async () => { await closeShoppingListAction({ id: l.id }); window.location.reload(); }}>Cerrar lista</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {selectedId && detail && detail.id === selectedId && (
        <div className="rounded-md border p-4 space-y-3">
          <h3 className="font-semibold">Detalle: {detail.title}</h3>
          <div className="flex gap-2 flex-wrap items-end">
            <div className="flex-1 min-w-[180px]">
              <label className="text-xs">Producto</label>
              <select value={barItemId} onChange={(e) => {
                const id = e.target.value;
                setBarItemId(id);
                const found = barItems?.find(b => b.id === id);
                if (found) { setItemName(found.name); setQty(suggestQuantity(found.stock_quantity)); }
                else { setItemName(""); }
              }} className="flex h-9 w-full rounded-md border px-3 py-1 text-sm">
                <option value="">Producto libre</option>
                {(barItems ?? []).map((b) => (
                  <option key={b.id} value={b.id}>{b.name} — stock: {b.stock_quantity}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs">Nombre</label>
              <Input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="Nombre" />
            </div>
            <div>
              <label className="text-xs">Cantidad</label>
              <Input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} className="w-20" />
            </div>
            <Button onClick={async () => {
              if (!itemName.trim()) return;
              await addShoppingItemAction({ shopping_list_id: selectedId, bar_item_id: barItemId || null, name: itemName.trim(), quantity_needed: qty, notes: null });
              window.location.reload();
            }}>Añadir</Button>
          </div>

          <ul className="space-y-1">
            {detail.items.map((it) => (
              <li key={it.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={it.isChecked} onChange={async (e) => { await toggleShoppingItemAction({ id: it.id, is_checked: e.target.checked }); window.location.reload(); }} />
                <span className={it.isChecked ? "line-through text-muted-foreground" : ""}>{it.name} x {it.quantityNeeded} {it.stockQuantity !== undefined && `(stock: ${it.stockQuantity})`}</span>
                {it.notes && <span className="text-xs text-muted-foreground">— {it.notes}</span>}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <div className="h-2 flex-1 rounded bg-muted"><div className="h-2 rounded bg-primary" style={{ width: `${detail.progress.percent}%` }} /></div>
            <span className="text-sm">{detail.progress.checked}/{detail.progress.total}</span>
          </div>
          {detail.status === "open" && <Button onClick={async () => { await closeShoppingListAction({ id: detail.id }); window.location.reload(); }}>Cerrar lista</Button>}
        </div>
      )}
    </div>
  );
}
