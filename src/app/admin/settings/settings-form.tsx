"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateSettingAction } from "@/app/admin/actions";
import { SETTING_KEYS, SETTING_KEY_LABELS, type SettingsItem } from "@/lib/admin/schema";

/**
 * Global settings editor (Sprint 21). Renders one field per known
 * setting key, saving all of them through updateSettingAction on submit.
 * Client-side guard mirrors the zod rule: app_name cannot be cleared.
 */
export function SettingsForm({ initialSettings }: { initialSettings: SettingsItem[] }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialSettings.map((setting) => [setting.key, setting.value])),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleChange(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setError(null);
    setSaved(false);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isLoading) return;

    const appName = (values.app_name ?? "").trim();
    if (!appName) {
      setError("El nombre de la app no puede estar vacío.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setSaved(false);

    // All-or-nothing visual result: every key is sent in parallel and a
    // single failure surfaces the error; partial writes are unavoidable
    // server-side but the UI never claims success in that case.
    const results = await Promise.all(
      SETTING_KEYS.map((key) => updateSettingAction({ key, value: values[key] ?? "" })),
    );
    const failed = results.find((result) => !result.success);

    if (failed) {
      setError(failed.error ?? "Error desconocido al guardar la configuración.");
      setIsLoading(false);
      return;
    }

    setSaved(true);
    setIsLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {saved && !error && (
        <p role="status" className="text-sm text-emerald-600 dark:text-emerald-400">
          Configuración guardada correctamente.
        </p>
      )}

      {SETTING_KEYS.map((key) => (
        <div key={key} className="space-y-2">
          <Label htmlFor={key}>{SETTING_KEY_LABELS[key]}</Label>
          <Input
            id={key}
            name={key}
            value={values[key] ?? ""}
            onChange={(e) => handleChange(key, e.target.value)}
            disabled={isLoading}
          />
        </div>
      ))}

      <Button type="submit" disabled={isLoading}>
        {isLoading ? "Guardando…" : "Guardar cambios"}
      </Button>
    </form>
  );
}