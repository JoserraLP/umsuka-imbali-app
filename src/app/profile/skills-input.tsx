"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { normalizeSkills } from "@/lib/profiles/schema";

interface SkillsInputProps {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  /** Hard cap shared with the zod schema and the DB CHECK. */
  max?: number;
  /** Per-item length cap, mirroring the zod schema (1–50 chars). */
  maxLength?: number;
}

/**
 * Extracts every message from a react-hook-form skills field error:
 * the array-level message (e.g. "Máximo 10 habilidades.") and any
 * per-item messages (e.g. a skill over 50 characters), which RHF shapes
 * as an index-keyed object. Ensures a blocked submit always has visible
 * feedback.
 */
export function getSkillsErrorMessages(error: unknown): string[] {
  if (!error || typeof error !== "object") return [];
  const messages: string[] = [];
  const root = (error as { message?: unknown }).message;
  if (typeof root === "string") messages.push(root);
  for (const [key, value] of Object.entries(error)) {
    if (key === "message") continue;
    if (
      value &&
      typeof value === "object" &&
      typeof (value as { message?: unknown }).message === "string"
    ) {
      messages.push((value as { message: string }).message);
    }
  }
  return [...new Set(messages)];
}

/**
 * Chip-style input for skill tags: existing tags render as outline
 * badges with a remove button, and typing + Enter (or comma) adds a new
 * one. Values are normalized with the same normalizeSkills used by the
 * server schema (trim, drop empty, case-insensitive dedupe, cap 10).
 */
export function SkillsInput({
  value,
  onChange,
  disabled,
  max = 10,
  maxLength = 50,
}: SkillsInputProps) {
  const [draft, setDraft] = useState("");

  function addDraft() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange(normalizeSkills([...value, draft]));
    setDraft("");
  }

  function removeSkill(skill: string) {
    onChange(value.filter((item) => item !== skill));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {value.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            Sin habilidades todavía. Añade la primera con el campo de abajo.
          </span>
        ) : (
          value.map((skill) => (
            <Badge key={skill} variant="outline" className="gap-1">
              {skill}
              <button
                type="button"
                aria-label={`Eliminar habilidad ${skill}`}
                disabled={disabled}
                onClick={() => removeSkill(skill)}
                className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
              >
                ×
              </button>
            </Badge>
          ))
        )}
      </div>

      <Input
        aria-label="Nueva habilidad"
        placeholder={
          value.length >= max
            ? `Máximo ${max} habilidades`
            : `Escribe y pulsa Enter… (máx. ${maxLength} caracteres)`
        }
        value={draft}
        maxLength={maxLength}
        disabled={disabled || value.length >= max}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            if (draft.trim()) addDraft();
          }
        }}
      />
    </div>
  );
}
