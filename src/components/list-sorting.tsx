"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/ui/select";
import { saveListOrderingAction } from "@/lib/ordering/actions";
import type { ListId, SortDirection } from "@/lib/ordering/schema";

interface ListSortingControlProps {
  listId: ListId;
  /** Currently persisted sort field (server-rendered value). */
  sortBy: string;
  /** Currently persisted direction (server-rendered value). */
  direction: SortDirection;
  /** Labeled options for the field select (from ordering/schema). */
  sortOptions: ReadonlyArray<{ value: string; label: string }>;
}

/**
 * Persistent sort control for a listing (Sprint 25). Fully controlled by
 * props — the server render is the single source of truth; there is no
 * local state. Each change sends the COMPLETE pair (the untouched value
 * is taken from the current props) and refreshes the server components.
 */
export function ListSortingControl({
  listId,
  sortBy,
  direction,
  sortOptions,
}: ListSortingControlProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function persist(next: { sortBy: string; direction: SortDirection }): void {
    startTransition(async () => {
      await saveListOrderingAction({ listId, sortBy: next.sortBy, direction: next.direction });
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Select
        aria-label="Ordenar por"
        className="h-8 w-auto text-xs"
        value={sortBy}
        disabled={isPending}
        onChange={(e) => persist({ sortBy: e.target.value, direction })}
      >
        {sortOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Dirección de ordenación"
        className="h-8 w-auto text-xs"
        value={direction}
        disabled={isPending}
        onChange={(e) => persist({ sortBy, direction: e.target.value as SortDirection })}
      >
        <option value="asc">Ascendente</option>
        <option value="desc">Descendente</option>
      </Select>
    </div>
  );
}
