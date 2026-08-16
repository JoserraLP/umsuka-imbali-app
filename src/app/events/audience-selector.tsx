"use client";

import { useState } from "react";
import { useController, useFormState, useWatch, type Control } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  AUDIENCE_MEMBER_TYPE_LABELS,
  AUDIENCE_TYPE_LABELS,
  AUDIENCE_WORKGROUP_LABELS,
  type AudienceMemberOption,
  type AudienceMemberType,
  type AudienceTypeValue,
  type AudienceWorkgroupValue,
} from "@/lib/events/audience";

/**
 * Minimal shape the selector needs from the parent form values: the four
 * audience fields. Both EventFormValues (event-form) and AudienceValues
 * (audience-editor) extend it, so the component is generic over them.
 */
interface AudienceFieldShape {
  audienceType: AudienceTypeValue;
  audienceWorkgroup: AudienceWorkgroupValue | null;
  audienceMemberType: AudienceMemberType | null;
  audienceUserIds: string[];
}

export interface AudienceSelectorProps<TFieldValues extends AudienceFieldShape> {
  /** RHF control of the parent form (the audience fields live on it). */
  control: Control<TFieldValues>;
  /** Locks the selector (work_shift events always target 'all'). */
  disabled?: boolean;
  /** Active members available for the specific_users multi-select. */
  members: AudienceMemberOption[];
  /**
   * Currently selected users (edit preload) — rendered as badges. Kept
   * separate from `members` because a selected user may no longer be an
   * active profile.
   */
  selectedMembers: Array<{
    id: string;
    firstName: string;
    lastName: string;
    username: string | null;
  }>;
}

/**
 * Section "¿A quién se muestra?" of the event form (Sprint 18): audience
 * type selector plus the type-specific selector (workgroup, member type
 * or a searchable multi-select of concrete users).
 */
export function AudienceSelector<TFieldValues extends AudienceFieldShape>({
  control,
  disabled = false,
  members,
  selectedMembers,
}: AudienceSelectorProps<TFieldValues>) {
  // Bind the audience fields concretely: TFieldValues only constrains
  // the parent form, while the paths below are those of AudienceFieldShape.
  const selectorControl = control as unknown as Control<AudienceFieldShape>;
  const { errors } = useFormState({ control: selectorControl });
  const audienceTypeField = useController({ control: selectorControl, name: "audienceType" });
  const audienceWorkgroupField = useController({ control: selectorControl, name: "audienceWorkgroup" });
  const audienceMemberTypeField = useController({ control: selectorControl, name: "audienceMemberType" });
  const audienceUserIdsField = useController({ control: selectorControl, name: "audienceUserIds" });

  const audienceType = useWatch({ control: selectorControl, name: "audienceType" }) as AudienceTypeValue | undefined;
  const [search, setSearch] = useState("");

  const selectedIds = audienceUserIdsField.field.value ?? [];
  const selectedSet = new Set(selectedIds);

  /** Type change clears the companion values of the other types. */
  function handleTypeChange(value: string) {
    audienceTypeField.field.onChange(value as AudienceTypeValue);
    if (value !== "workgroup") {
      audienceWorkgroupField.field.onChange(null);
    }
    if (value !== "member_type") {
      audienceMemberTypeField.field.onChange(null);
    }
  }

  function toggleUser(id: string, checked: boolean) {
    const next = checked
      ? [...selectedIds, id]
      : selectedIds.filter((existingId) => existingId !== id);
    audienceUserIdsField.field.onChange(next);
  }

  const query = search.trim().toLowerCase();
  const filteredMembers = query
    ? members.filter(
        (member) =>
          member.firstName.toLowerCase().includes(query) ||
          member.lastName.toLowerCase().includes(query) ||
          (member.username ?? "").toLowerCase().includes(query),
      )
    : members;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="audienceType">¿A quién se muestra?</Label>
        <Select
          id="audienceType"
          disabled={disabled}
          value={audienceType ?? "all"}
          onChange={(event) => handleTypeChange(event.target.value)}
        >
          {Object.entries(AUDIENCE_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        {disabled && (
          <p className="text-xs text-muted-foreground">
            Los eventos de trabajo solo se muestran a su grupo de trabajo.
          </p>
        )}
        {errors.audienceType && (
          <p className="text-xs text-destructive">{errors.audienceType.message}</p>
        )}
      </div>

      {!disabled && audienceType === "workgroup" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audienceWorkgroup">Grupo de trabajo</Label>
          <Select
            id="audienceWorkgroup"
            value={audienceWorkgroupField.field.value ?? ""}
            onChange={(event) =>
              audienceWorkgroupField.field.onChange(
                event.target.value === "" ? null : event.target.value,
              )
            }
          >
            <option value="">Elige un grupo…</option>
            {Object.entries(AUDIENCE_WORKGROUP_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          {errors.audienceWorkgroup && (
            <p className="text-xs text-destructive">{errors.audienceWorkgroup.message}</p>
          )}
        </div>
      )}

      {!disabled && audienceType === "member_type" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audienceMemberType">Tipo de miembro</Label>
          <Select
            id="audienceMemberType"
            value={audienceMemberTypeField.field.value ?? ""}
            onChange={(event) =>
              audienceMemberTypeField.field.onChange(
                event.target.value === "" ? null : event.target.value,
              )
            }
          >
            <option value="">Elige un tipo…</option>
            {Object.entries(AUDIENCE_MEMBER_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          {errors.audienceMemberType && (
            <p className="text-xs text-destructive">{errors.audienceMemberType.message}</p>
          )}
        </div>
      )}

      {!disabled && audienceType === "specific_users" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audienceUserSearch">Usuarios concretos</Label>
          <Input
            id="audienceUserSearch"
            type="search"
            placeholder="Buscar por nombre o usuario…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="max-h-40 overflow-y-auto rounded-md border border-input">
            {filteredMembers.map((member) => (
              <label
                key={member.id}
                className="flex cursor-pointer items-center gap-2 border-b border-border/50 px-3 py-1.5 text-sm last:border-b-0 hover:bg-accent/50"
              >
                <input
                  type="checkbox"
                  checked={selectedSet.has(member.id)}
                  onChange={(event) => toggleUser(member.id, event.target.checked)}
                />
                <span className="font-medium">
                  {member.firstName} {member.lastName}
                </span>
                {member.username !== null && (
                  <span className="text-xs text-muted-foreground">@{member.username}</span>
                )}
              </label>
            ))}
            {filteredMembers.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                No hay miembros que coincidan con la búsqueda.
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {selectedIds.length > 0
              ? `${selectedIds.length} seleccionado${selectedIds.length === 1 ? "" : "s"}`
              : "Ninguno seleccionado"}
          </p>
          {selectedMembers.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selectedMembers.map((member) => (
                <Badge key={member.id} variant="secondary">
                  {member.firstName} {member.lastName}
                </Badge>
              ))}
            </div>
          )}
          {errors.audienceUserIds && (
            <p className="text-xs text-destructive">{errors.audienceUserIds.message}</p>
          )}
        </div>
      )}
    </div>
  );
}