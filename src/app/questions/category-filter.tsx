"use client";

import { useRouter } from "next/navigation";
import { QUESTION_CATEGORIES } from "@/lib/questions/schema";

const CATEGORY_LABELS: Record<string, string> = {
  general: "General",
  ensayo: "Ensayo",
  evento: "Evento",
  vestuario: "Vestuario",
  musica: "Música",
  otro: "Otro",
};

interface CategoryFilterProps {
  category: string;
  status: string;
  mine: boolean;
}

export function CategoryFilter({ category, status, mine }: CategoryFilterProps) {
  const router = useRouter();

  function filterUrl(categoryValue: string): string {
    const sp = new URLSearchParams();
    if (status && status !== "all") sp.set("status", status);
    if (categoryValue && categoryValue !== "todas") sp.set("category", categoryValue);
    if (mine) sp.set("mine", "true");
    const qs = sp.toString();
    return `/questions${qs ? `?${qs}` : ""}`;
  }

  return (
    <select
      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
      onChange={(e) => router.push(filterUrl(e.target.value))}
      value={category}
    >
      <option value="todas">Todas las categorías</option>
      {QUESTION_CATEGORIES.map((cat) => (
        <option key={cat} value={cat}>
          {CATEGORY_LABELS[cat] ?? cat}
        </option>
      ))}
    </select>
  );
}
