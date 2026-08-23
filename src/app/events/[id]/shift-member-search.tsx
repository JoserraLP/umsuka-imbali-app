"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { searchShiftMembersAction } from "@/app/events/[id]/shift-member-search-actions";
import { markWorkgroupAttendanceAction } from "@/app/events/[id]/workgroup-actions";
import type { ShiftMemberSearchRow } from "@/lib/shifts/search";
import type { ActiveWorkgroup, BarraTask } from "@/lib/workgroups/schema";

interface ShiftMemberSearchProps {
  shiftId: string;
  /** Groups the current viewer may mark attendance for (empty → read-only). */
  manageableWorkgroups: ActiveWorkgroup[];
}

const SEARCH_DEBOUNCE_MS = 300;

/** Monotonic request id counter lives in a ref; server actions cannot be aborted. */

const WORKGROUP_LABELS: Record<ActiveWorkgroup, string> = {
  telas: "Telas",
  barra: "Barra",
  estandarte: "Estandarte",
  limpieza: "Limpieza",
};

const GENERIC_SEARCH_ERROR = "No se pudo completar la búsqueda.";
const GENERIC_SAVE_ERROR = "No se pudo guardar la asistencia.";

function attendanceLabel(attended: boolean | null): string {
  if (attended === true) return "Presente";
  if (attended === false) return "Ausente";
  return "Sin marcar";
}

export function ShiftMemberSearch({ shiftId, manageableWorkgroups }: ShiftMemberSearchProps) {
  const router = useRouter();
  const listboxId = useId();

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedWorkgroup, setSelectedWorkgroup] = useState<ActiveWorkgroup | "">("");
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<ShiftMemberSearchRow[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  /** Chosen barra task per member (required by the schema before saving). */
  const [barraTasks, setBarraTasks] = useState<Record<string, BarraTask>>({});
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  const requestIdRef = useRef(0);

  // Debounce the raw query (~300 ms) so typing does not flood the server.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Fetch whenever the debounced term, workgroup filter or page changes.
  // Responses are discarded when a newer request has been issued.
  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (trimmed === "") {
      // Invalidate any in-flight response so it cannot repopulate the
      // (now empty) list after a clear, e.g. via the Escape key.
      requestIdRef.current += 1;
      setRows([]);
      setTotal(0);
      setHasMore(false);
      setLoading(false);
      return;
    }

    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    setLoading(true);

    searchShiftMembersAction({
      shiftId,
      query: trimmed,
      workgroup: selectedWorkgroup || null,
      page,
    })
      .then((result) => {
        if (requestId !== requestIdRef.current) return;
        if (!result.success) {
          setError(result.error ?? GENERIC_SEARCH_ERROR);
          setRows([]);
          setTotal(0);
          setHasMore(false);
          return;
        }
        setError(null);
        setRows(result.data.rows);
        setTotal(result.data.total);
        setHasMore(result.data.hasMore);
        setHighlightedIndex(-1);
      })
      .catch(() => {
        if (requestId !== requestIdRef.current) return;
        setError(GENERIC_SEARCH_ERROR);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, [debouncedQuery, selectedWorkgroup, page, shiftId]);

  function handleQueryChange(value: string) {
    setQuery(value);
    setPage(1);
    setHighlightedIndex(-1);
  }

  function handleWorkgroupFilterChange(value: string) {
    setSelectedWorkgroup(value === "" ? "" : (value as ActiveWorkgroup));
    setPage(1);
    setHighlightedIndex(-1);
  }

  function clearSearch() {
    setQuery("");
    setDebouncedQuery("");
    setPage(1);
    setRows([]);
    setTotal(0);
    setHasMore(false);
    setHighlightedIndex(-1);
  }

  function canEditRow(row: ShiftMemberSearchRow): boolean {
    return manageableWorkgroups.includes(row.workgroup);
  }

  function patchRow(userId: string, attended: boolean | null) {
    setRows((prev) =>
      prev.map((row) => (row.userId === userId ? { ...row, attended } : row)),
    );
  }

  /**
   * Optimistically flips the attendance state and rolls it back when the
   * server rejects the change, restoring the previous value verbatim
   * (`null` = "Sin marcar" must not degrade to `false` = "Ausente").
   * The existing mutation action encapsulates validation, guards and the
   * idempotent upsert.
   */
  async function applyAttendance(
    row: ShiftMemberSearchRow,
    nextAttended: boolean,
    barraTask: BarraTask | null,
  ) {
    const previousAttended = row.attended;
    patchRow(row.userId, nextAttended);
    setPendingUserId(row.userId);
    try {
      const result = await markWorkgroupAttendanceAction({
        shiftId,
        userId: row.userId,
        workgroup: row.workgroup,
        attended: nextAttended,
        hoursWorked: null,
        barraTask: row.workgroup === "barra" ? barraTask : null,
      });

      if (!result.success) {
        patchRow(row.userId, previousAttended);
        setError(result.error ?? GENERIC_SAVE_ERROR);
        return;
      }

      setError(null);
      router.refresh();
    } finally {
      setPendingUserId(null);
    }
  }

  function handleSimpleToggle(row: ShiftMemberSearchRow) {
    void applyAttendance(row, row.attended !== true, null);
  }

  function getBarraTask(userId: string): BarraTask | null {
    return barraTasks[userId] ?? null;
  }

  function handleBarraSave(row: ShiftMemberSearchRow) {
    const barraTask = getBarraTask(row.userId);
    if (!barraTask) return;
    void applyAttendance(row, row.attended !== true, barraTask);
  }

  /** Primary action for the highlighted row (Enter key). */
  function handlePrimaryAction(row: ShiftMemberSearchRow) {
    if (row.workgroup === "barra") {
      handleBarraSave(row);
    } else {
      handleSimpleToggle(row);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.min(index + 1, rows.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[highlightedIndex];
      if (row && canEditRow(row)) handlePrimaryAction(row);
    } else if (event.key === "Escape") {
      event.preventDefault();
      clearSearch();
    }
  }

  let liveMessage = "";
  if (loading) {
    liveMessage = "Buscando…";
  } else if (debouncedQuery.trim() === "") {
    liveMessage = "Escribe para buscar miembros asignados.";
  } else {
    liveMessage = `${total} resultado${total === 1 ? "" : "s"}`;
  }

  const isOpen = rows.length > 0;

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-sm font-semibold">Buscar miembro en el turno</p>
      <p className="text-xs text-muted-foreground">
        Busca por nombre o apellido y marca la asistencia sin salir de los resultados.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input
          type="search"
          role="combobox"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Nombre o apellido…"
          aria-label="Buscar miembros asignados al turno"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listboxId : undefined}
          aria-activedescendant={
            isOpen && highlightedIndex >= 0 ? `${listboxId}-opt-${highlightedIndex}` : undefined
          }
          aria-busy={loading}
          className="h-8 max-w-xs flex-1 text-sm"
        />
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Grupo:
          <select
            value={selectedWorkgroup}
            onChange={(e) => handleWorkgroupFilterChange(e.target.value)}
            aria-label="Filtrar por grupo de trabajo"
            className="h-8 rounded-md border border-input bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Todos</option>
            {manageableWorkgroups.map((workgroup) => (
              <option key={workgroup} value={workgroup}>
                {WORKGROUP_LABELS[workgroup]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p role="status" aria-live="polite" className="mt-1 text-xs text-muted-foreground">
        {liveMessage}
      </p>

      {error && (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
      )}

      {isOpen && (
        <ul role="listbox" id={listboxId} aria-label="Resultados de búsqueda" className="mt-2 divide-y divide-border overflow-hidden rounded-md border bg-background">
          {rows.map((row, index) => {
            const highlighted = index === highlightedIndex;
            const editable = canEditRow(row);
            const barraTask = getBarraTask(row.userId);
            const pending = pendingUserId === row.userId;

            return (
              <li
                key={row.userId}
                id={`${listboxId}-opt-${index}`}
                role="option"
                aria-selected={highlighted}
                className={`flex items-center justify-between gap-2 px-3 py-2 text-sm ${
                  highlighted ? "bg-accent" : ""
                }`}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {row.firstName} {row.lastName}
                  </span>
                  <Badge variant="secondary">{WORKGROUP_LABELS[row.workgroup] ?? row.workgroup}</Badge>
                  <Badge
                    variant="outline"
                    className={
                      row.attended === true ? "bg-green-100 text-green-700" : undefined
                    }
                  >
                    {attendanceLabel(row.attended)}
                  </Badge>
                </div>

                {editable && row.workgroup !== "barra" && (
                  <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={row.attended === true}
                      disabled={pending}
                      onChange={() => handleSimpleToggle(row)}
                      aria-label={`Cambiar asistencia de ${row.firstName} ${row.lastName}`}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                  </label>
                )}

                {editable && row.workgroup === "barra" && (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <label className="flex cursor-pointer items-center gap-1 text-xs">
                      <input
                        type="radio"
                        name={`barra-task-${row.userId}`}
                        value="cocina"
                        checked={barraTask === "cocina"}
                        disabled={pending}
                        onChange={() =>
                          setBarraTasks((prev) => ({ ...prev, [row.userId]: "cocina" }))
                        }
                        className="h-3.5 w-3.5"
                      />
                      Cocina
                    </label>
                    <label className="flex cursor-pointer items-center gap-1 text-xs">
                      <input
                        type="radio"
                        name={`barra-task-${row.userId}`}
                        value="bebidas"
                        checked={barraTask === "bebidas"}
                        disabled={pending}
                        onChange={() =>
                          setBarraTasks((prev) => ({ ...prev, [row.userId]: "bebidas" }))
                        }
                        className="h-3.5 w-3.5"
                      />
                      Bebidas
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={!barraTask || pending}
                      onClick={() => handleBarraSave(row)}
                      aria-label={
                        row.attended === true
                          ? `Desmarcar a ${row.firstName} ${row.lastName}`
                          : `Marcar presente a ${row.firstName} ${row.lastName}`
                      }
                    >
                      {row.attended === true ? "Desmarcar" : "Marcar presente"}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {debouncedQuery.trim() !== "" && (
        <div className="mt-2 flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={page <= 1 || loading}
            onClick={() => setPage((current) => current - 1)}
          >
            Anterior
          </Button>
          <span className="text-xs text-muted-foreground">Página {page}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={!hasMore || loading}
            onClick={() => setPage((current) => current + 1)}
          >
            Siguiente
          </Button>
        </div>
      )}
    </div>
  );
}
