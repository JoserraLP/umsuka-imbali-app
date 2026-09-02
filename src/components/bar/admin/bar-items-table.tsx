"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BarItem } from "@/lib/bar/menus";
import { toggleBarItemAvailabilityAction, toggleBarItemVisibilityAction, updateBarPriceAction, updateStockAction } from "@/app/bar/actions";

export function BarItemsTable({ items }: { items: BarItem[] }) {
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const [priceValue, setPriceValue] = useState("");
  const [editingStock, setEditingStock] = useState<string | null>(null);
  const [stockValue, setStockValue] = useState("");

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="p-2">Nombre</th>
            <th className="p-2">Cat</th>
            <th className="p-2">Precio</th>
            <th className="p-2">Stock</th>
            <th className="p-2">Disp.</th>
            <th className="p-2">Visible</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b">
              <td className="p-2">
                <div className="font-medium">{item.name}</div>
                {item.description && <div className="text-xs text-muted-foreground">{item.description}</div>}
              </td>
              <td className="p-2"><Badge variant="secondary">{item.category}</Badge></td>
              <td className="p-2">
                {editingPrice === item.id ? (
                  <span className="flex gap-1">
                    <Input value={priceValue} onChange={(e) => setPriceValue(e.target.value)} className="h-7 w-20" type="number" step="0.01" />
                    <Button size="sm" onClick={async () => { await updateBarPriceAction({ id: item.id, price: Number(priceValue) }); setEditingPrice(null); }}>OK</Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingPrice(null)}>X</Button>
                  </span>
                ) : (
                  <button className="underline" onClick={() => { setEditingPrice(item.id); setPriceValue(String(item.price)); }}>{item.price.toFixed(2)} €</button>
                )}
              </td>
              <td className="p-2">
                {editingStock === item.id ? (
                  <span className="flex gap-1">
                    <Input value={stockValue} onChange={(e) => setStockValue(e.target.value)} className="h-7 w-16" type="number" />
                    <Button size="sm" onClick={async () => { await updateStockAction({ id: item.id, stock_quantity: Number(stockValue) }); setEditingStock(null); }}>OK</Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingStock(null)}>X</Button>
                  </span>
                ) : (
                  <button className="underline" onClick={() => { setEditingStock(item.id); setStockValue(String(item.stockQuantity)); }}>
                    <Badge variant={item.stockQuantity <= 5 ? "destructive" : item.stockQuantity <= 10 ? "secondary" : "outline"}>{item.stockQuantity}</Badge>
                  </button>
                )}
              </td>
              <td className="p-2">
                <Button size="sm" variant={item.isAvailable ? "default" : "outline"} onClick={() => toggleBarItemAvailabilityAction({ id: item.id, is_available: !item.isAvailable })}>
                  {item.isAvailable ? "Sí" : "No"}
                </Button>
              </td>
              <td className="p-2">
                <Button size="sm" variant={item.isVisibleToMembers ? "default" : "outline"} onClick={() => toggleBarItemVisibilityAction({ id: item.id, is_visible_to_members: !item.isVisibleToMembers })}>
                  {item.isVisibleToMembers ? "Visible" : "Oculto"}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No hay productos. Añade el primero.</p>}
    </div>
  );
}
