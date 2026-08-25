"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  TRANSACTION_CATEGORIES,
  TRANSACTION_CATEGORY_LABELS,
  TRANSACTION_TYPES,
  TRANSACTION_TYPE_LABELS,
} from "@/lib/finances/schema";

export function TransactionFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [type, setType] = useState(searchParams.get("type") ?? "");
  const [category, setCategory] = useState(searchParams.get("category") ?? "");
  const [from, setFrom] = useState(searchParams.get("from") ?? "");
  const [to, setTo] = useState(searchParams.get("to") ?? "");

  function applyFilters() {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (category) params.set("category", category);
    if (from) params.set("from", from);
    if (to) params.set("to", to);

    const query = params.toString();
    startTransition(() => {
      router.push(query ? `/finances?${query}` : "/finances");
    });
  }

  function clearFilters() {
    setType("");
    setCategory("");
    setFrom("");
    setTo("");
    startTransition(() => {
      router.push("/finances");
    });
  }

  const hasFilters = type || category || from || to;

  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="text-sm font-semibold">Filtros</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-type">Tipo</Label>
          <select
            id="filter-type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">Todos</option>
            {TRANSACTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {TRANSACTION_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-category">Categoría</Label>
          <select
            id="filter-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">Todas</option>
            {TRANSACTION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {TRANSACTION_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-from">Desde</Label>
          <Input id="filter-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-to">Hasta</Label>
          <Input id="filter-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <Button type="button" size="sm" onClick={applyFilters} disabled={isPending}>
          {isPending ? "Aplicando…" : "Aplicar"}
        </Button>
        {hasFilters && (
          <Button type="button" size="sm" variant="outline" onClick={clearFilters} disabled={isPending}>
            Limpiar
          </Button>
        )}
      </div>
    </div>
  );
}
