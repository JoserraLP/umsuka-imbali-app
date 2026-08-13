"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { COMPONENT_TYPE_OPTIONS, STATUS_OPTIONS, WORKGROUP_OPTIONS } from "@/lib/members/schema";
import type { ComponentType, Workgroup } from "@/types/database.types";

const WORKGROUP_LABELS: Record<string, string> = {
  telas: "Telas",
  barra: "Barra",
  estandarte: "Estandarte",
  limpieza: "Limpieza",
  ninguno: "Ninguno",
};

const COMPONENT_TYPE_LABELS: Record<string, string> = {
  music: "Música",
  dance: "Baile",
  member: "Socio/a",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  active: "Activo",
  suspended: "Suspendido",
};

interface MemberFiltersProps {
  workgroup: string;
  componentType: string;
  status: string;
  q: string;
  /** When set (workgroup leads), the group select is hidden and the list
   *  is locked to that group. */
  lockedWorkgroup?: Workgroup | null;
  /** When set (component leads), the component select is hidden and the
   *  list is locked to that component. */
  lockedComponent?: ComponentType | null;
}

export function MemberFilters({
  workgroup,
  componentType,
  status,
  q,
  lockedWorkgroup,
  lockedComponent,
}: MemberFiltersProps) {
  const router = useRouter();
  const [qInput, setQInput] = useState(q);

  function filterUrl(params: Record<string, string | undefined>): string {
    const sp = new URLSearchParams();
    const effectiveWorkgroup = lockedWorkgroup ?? params.workgroup ?? workgroup;
    const effectiveComponentType = lockedComponent ?? params.componentType ?? componentType;
    const effectiveStatus = params.status ?? status;
    const effectiveQ = params.q ?? q;
    if (effectiveWorkgroup && effectiveWorkgroup !== "all") sp.set("workgroup", effectiveWorkgroup);
    if (effectiveComponentType && effectiveComponentType !== "all") {
      sp.set("componentType", effectiveComponentType);
    }
    if (effectiveStatus && effectiveStatus !== "all") sp.set("status", effectiveStatus);
    if (effectiveQ) sp.set("q", effectiveQ);
    const qs = sp.toString();
    return `/members${qs ? `?${qs}` : ""}`;
  }

  function clearAll(): void {
    setQInput("");
    router.push("/members");
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      {!lockedWorkgroup && (
        <Select
          aria-label="Filtrar por grupo de trabajo"
          className="h-8 w-auto text-xs"
          value={workgroup}
          onChange={(e) => router.push(filterUrl({ workgroup: e.target.value }))}
        >
          <option value="all">Todos los grupos</option>
          {WORKGROUP_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {WORKGROUP_LABELS[option]}
            </option>
          ))}
        </Select>
      )}

      {!lockedComponent && (
        <Select
          aria-label="Filtrar por componente"
          className="h-8 w-auto text-xs"
          value={componentType}
          onChange={(e) => router.push(filterUrl({ componentType: e.target.value }))}
        >
          <option value="all">Todos los componentes</option>
          {COMPONENT_TYPE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {COMPONENT_TYPE_LABELS[option]}
            </option>
          ))}
        </Select>
      )}

      <Select
        aria-label="Filtrar por estado"
        className="h-8 w-auto text-xs"
        value={status}
        onChange={(e) => router.push(filterUrl({ status: e.target.value }))}
      >
        <option value="all">Todos los estados</option>
        {STATUS_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {STATUS_LABELS[option]}
          </option>
        ))}
      </Select>

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(filterUrl({ q: qInput.trim() || undefined }));
        }}
      >
        <Input
          aria-label="Buscar por nombre"
          className="h-8 w-44 text-xs"
          placeholder="Buscar por nombre…"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
        />
        <Button type="submit" variant="outline" size="sm">
          Buscar
        </Button>
      </form>

      {(workgroup !== "all" || componentType !== "all" || status !== "all" || q) && (
        <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
          Limpiar filtros
        </Button>
      )}
    </div>
  );
}
