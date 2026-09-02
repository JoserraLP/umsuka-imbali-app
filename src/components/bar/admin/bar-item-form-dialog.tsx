"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createBarItemAction } from "@/app/bar/actions";

export function BarItemFormDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setError(null);
    const result = await createBarItemAction({
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? "") || null,
      category: String(formData.get("category") ?? "drink") as "menu" | "food" | "drink",
      price: Number(formData.get("price")),
      stock_quantity: Number(formData.get("stock_quantity") ?? 0),
      is_available: formData.get("is_available") === "on",
      is_visible_to_members: formData.get("is_visible_to_members") === "on",
    });
    if (!result.success) setError(result.error ?? "Error");
    else { setOpen(false); router.refresh(); }
  }

  if (!open) return <Button onClick={() => setOpen(true)}>Añadir producto</Button>;

  return (
    <form action={handleSubmit} className="space-y-3 rounded-md border p-4">
      <div>
        <Label htmlFor="name">Nombre</Label>
        <Input id="name" name="name" required maxLength={200} />
      </div>
      <div>
        <Label htmlFor="description">Descripción</Label>
        <Input id="description" name="description" maxLength={1000} />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <Label htmlFor="category">Categoría</Label>
          <select id="category" name="category" className="flex h-9 w-full rounded-md border px-3 py-1 text-sm" defaultValue="drink">
            <option value="menu">menu</option>
            <option value="food">food</option>
            <option value="drink">drink</option>
          </select>
        </div>
        <div className="flex-1">
          <Label htmlFor="price">Precio (€)</Label>
          <Input id="price" name="price" type="number" step="0.01" required />
        </div>
        <div className="flex-1">
          <Label htmlFor="stock_quantity">Stock</Label>
          <Input id="stock_quantity" name="stock_quantity" type="number" defaultValue={0} />
        </div>
      </div>
      <div className="flex gap-4">
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="is_available" defaultChecked /> Disponible</label>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="is_visible_to_members" defaultChecked /> Visible a miembros</label>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit">Guardar</Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
      </div>
    </form>
  );
}
