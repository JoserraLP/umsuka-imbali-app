"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BarCategory } from "@/lib/bar/menus";

interface Props {
  q?: string;
  category?: BarCategory;
  onQueryChange?: (q: string) => void;
}

export function BarFilters({ q, category }: Props) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1">
        <Label htmlFor="bar-q" className="text-xs">Buscar</Label>
        <Input id="bar-q" name="q" defaultValue={q} placeholder="Buscar producto..." className="mt-1" />
      </div>
      <div>
        <Label htmlFor="bar-category" className="text-xs">Categoría</Label>
        <select id="bar-category" name="category" defaultValue={category ?? ""} className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm">
          <option value="">Todas</option>
          <option value="menu">Menú</option>
          <option value="food">Comida</option>
          <option value="drink">Bebida</option>
        </select>
      </div>
      <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Filtrar</button>
    </div>
  );
}
