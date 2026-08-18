"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  type AuditLogFilters,
  type AuditLogItem,
} from "@/lib/admin/schema";

/**
 * Audit log explorer (Sprint 21). Server component feeds it one page of
 * items; filters are submitted as a GET form (kept in the URL so the
 * page is shareable/refreshable) and pagination is plain links that
 * preserve the active filters. The `user` filter exists in the schema
 * but has no field here yet — it can be supplied via the URL.
 */

export function buildPageHref(filters: AuditLogFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.user) params.set("user", filters.user);
  if (filters.action) params.set("action", filters.action);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (page > 1) params.set("page", String(page));

  const query = params.toString();
  return query ? `/admin/audit?${query}` : "/admin/audit";
}

/**
 * Formatea fecha y hora del registro (ej. "18 ago 2026, 14:30"). La hora
 * es clave para un trail de auditoría (m6).
 */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AuditLogView({
  items,
  total,
  hasMore,
  initialFilters,
}: {
  items: AuditLogItem[];
  total: number;
  hasMore: boolean;
  initialFilters: AuditLogFilters;
}) {
  const page = initialFilters.page;
  const hasPrevious = page > 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{total} registros</p>
        <div className="flex items-center gap-2">
          <Link
            href={buildPageHref(initialFilters, page - 1)}
            aria-disabled={!hasPrevious}
            className={
              hasPrevious
                ? "inline-flex items-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
                : "pointer-events-none inline-flex items-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-muted-foreground opacity-50"
            }
          >
            Anterior
          </Link>
          <Link
            href={buildPageHref(initialFilters, page + 1)}
            aria-disabled={!hasMore}
            className={
              hasMore
                ? "inline-flex items-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
                : "pointer-events-none inline-flex items-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-muted-foreground opacity-50"
            }
          >
            Siguiente
          </Link>
        </div>
      </div>

      <form method="GET" action="/admin/audit" className="flex flex-wrap items-end gap-4">
        <div className="space-y-2">
          <Label htmlFor="action">Acción</Label>
          <select
            id="action"
            name="action"
            defaultValue={initialFilters.action ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
          >
            <option value="">Todas</option>
            {AUDIT_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {AUDIT_ACTION_LABELS[action]}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="from">Desde</Label>
          <Input id="from" name="from" type="date" defaultValue={initialFilters.from ?? ""} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="to">Hasta</Label>
          <Input id="to" name="to" type="date" defaultValue={initialFilters.to ?? ""} />
        </div>

        <Button type="submit" size="sm">
          Filtrar
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/audit">Limpiar</Link>
        </Button>
      </form>

      {items.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Sin registros de auditoría para los filtros seleccionados.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Acción</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Entidad</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  {formatDate(item.createdAt)}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{AUDIT_ACTION_LABELS[item.action]}</Badge>
                </TableCell>
                <TableCell className="font-medium">{item.actorName}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {item.entityType}
                  {item.entityId ? ` · ${item.entityId}` : ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}