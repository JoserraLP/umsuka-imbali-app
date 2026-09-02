import type { BarItem, BarCategory } from "@/lib/bar/menus";
import { BarItemCard } from "@/components/bar/bar-item-card";

const LABELS: Record<BarCategory, string> = { menu: "Menús", food: "Comidas", drink: "Bebidas" };

export function BarCategorySection({ category, items }: { category: BarCategory; items: BarItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={`cat-${category}`}>
      <h2 id={`cat-${category}`} className="mb-3 text-lg font-semibold">{LABELS[category]} ({items.length})</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <BarItemCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
