"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createEmaillessAccountAction } from "@/app/admin/users/actions";
import type { CreateEmaillessAccountInput } from "@/lib/auth/emailless-schema";
import { Copy, Check } from "lucide-react";

const COMPONENT_TYPE_OPTIONS = [
  { value: "music", label: "Música" },
  { value: "dance", label: "Danza" },
  { value: "member", label: "Socio/a" },
] as const;

const WORKGROUP_OPTIONS = [
  { value: "ninguno", label: "Ninguno" },
  { value: "telas", label: "Telas" },
  { value: "barra", label: "Barra" },
  { value: "estandarte", label: "Estandarte" },
  { value: "limpieza", label: "Limpieza" },
] as const;

// ── Credentials display after successful creation ────────

function CredentialsDisplay({
  credentials,
  onDone,
}: {
  credentials: { username: string; password: string };
  onDone: () => void;
}) {
  const [copiedField, setCopiedField] = useState<"username" | "password" | null>(null);

  async function copyToClipboard(text: string, field: "username" | "password") {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }

  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950">
      <div className="mb-3 flex items-center gap-2">
        <Check className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        <h4 className="font-medium text-emerald-800 dark:text-emerald-200">
          Cuenta creada correctamente
        </h4>
      </div>
      <p className="mb-3 text-sm text-emerald-700 dark:text-emerald-300">
        Comparte estas credenciales con el nuevo miembro. No podrás volver a ver la contraseña.
      </p>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <dt className="min-w-20 text-sm font-medium text-emerald-800 dark:text-emerald-200">
            Usuario:
          </dt>
          <dd className="rounded bg-emerald-100 px-2 py-1 font-mono text-sm text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
            {credentials.username}
          </dd>
          <button
            type="button"
            onClick={() => copyToClipboard(credentials.username, "username")}
            className="rounded p-1 text-emerald-600 hover:bg-emerald-200 dark:text-emerald-400 dark:hover:bg-emerald-800"
            title="Copiar usuario"
          >
            <Copy className="h-4 w-4" />
            <span className="sr-only">Copiar usuario</span>
          </button>
          {copiedField === "username" && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">Copiado</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <dt className="min-w-20 text-sm font-medium text-emerald-800 dark:text-emerald-200">
            Contraseña:
          </dt>
          <dd className="rounded bg-emerald-100 px-2 py-1 font-mono text-sm text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
            {credentials.password}
          </dd>
          <button
            type="button"
            onClick={() => copyToClipboard(credentials.password, "password")}
            className="rounded p-1 text-emerald-600 hover:bg-emerald-200 dark:text-emerald-400 dark:hover:bg-emerald-800"
            title="Copiar contraseña"
          >
            <Copy className="h-4 w-4" />
            <span className="sr-only">Copiar contraseña</span>
          </button>
          {copiedField === "password" && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">Copiado</span>
          )}
        </div>
      </div>

      <div className="mt-4 rounded bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
        <strong>Recomendación de seguridad:</strong> El usuario debe cambiar su contraseña en el
        primer inicio de sesión desde la opción &quot;Cambiar contraseña&quot; en su perfil.
      </div>

      <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onDone}>
        Crear otra cuenta
      </Button>
    </div>
  );
}

// ── Main form ────────────────────────────────────────────

export function EmaillessAccountForm() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<{
    username: string;
    password: string;
  } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isLoading) return;

    setIsLoading(true);
    setError(null);
    setCredentials(null);

    const formData = new FormData(e.currentTarget);
    const workgroupValue = formData.get("workgroup") as string;

    const input: CreateEmaillessAccountInput = {
      firstName: (formData.get("firstName") as string) ?? "",
      lastName: (formData.get("lastName") as string) ?? "",
      username: (formData.get("username") as string) ?? "",
      password: (formData.get("password") as string) ?? "",
      componentType: (formData.get("componentType") as "music" | "dance" | "member") ?? "member",
    };

    if (workgroupValue && workgroupValue !== "ninguno") {
      input.workgroup = workgroupValue as CreateEmaillessAccountInput["workgroup"];
    }

    const result = await createEmaillessAccountAction(input);

    if (result.success && result.credentials) {
      setCredentials(result.credentials);
      formRef.current?.reset();
    } else {
      setError(result.error ?? "Error desconocido al crear la cuenta.");
    }

    setIsLoading(false);
  }

  if (credentials) {
    return (
      <CredentialsDisplay
        credentials={credentials}
        onDone={() => setCredentials(null)}
      />
    );
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName">Nombre</Label>
          <Input id="firstName" name="firstName" required disabled={isLoading} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="lastName">Apellidos</Label>
          <Input id="lastName" name="lastName" required disabled={isLoading} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="username">Nombre de usuario</Label>
        <Input
          id="username"
          name="username"
          required
          minLength={3}
          pattern="[a-zA-Z0-9_]+"
          disabled={isLoading}
          placeholder="ej: maria_12"
        />
        <p className="text-xs text-muted-foreground">
          Solo letras, números y guiones bajos. Mínimo 3 caracteres.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Contraseña</Label>
        <Input
          id="password"
          name="password"
          type="text"
          required
          minLength={8}
          disabled={isLoading}
          placeholder="Mínimo 8 caracteres"
        />
        <p className="text-xs text-muted-foreground">
          La contraseña se muestra en texto plano para que puedas compartirla. El usuario debería
          cambiarla en su primer inicio de sesión.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="componentType">Componente</Label>
          <Select id="componentType" name="componentType" required disabled={isLoading}>
            <option value="">Seleccionar…</option>
            {COMPONENT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="workgroup">Grupo de trabajo</Label>
          <Select id="workgroup" name="workgroup" disabled={isLoading}>
            {WORKGROUP_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Button type="submit" disabled={isLoading} className="w-full sm:w-auto">
        {isLoading ? "Creando cuenta…" : "Crear cuenta"}
      </Button>
    </form>
  );
}
