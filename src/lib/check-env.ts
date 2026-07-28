import { loadEnvConfig } from "@next/env";

const _projectDir = process.cwd();

// Carga .env, .env.local, .env.development, etc. como lo hace Next.js
loadEnvConfig(_projectDir);

const requiredVars = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
];

function maskValue(value: string) {
  if (value.length <= 12) return "***";
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

let hasError = false;

console.warn("\nComprobando variables de entorno...\n");

for (const key of requiredVars) {
  const value = process.env[key];

  if (!value) {
    console.error(`❌ ${key}: NO definida`);
    hasError = true;
  } else {
    console.warn(`✅ ${key}: ${maskValue(value)}`);
  }
}

if (hasError) {
  console.error("\nFaltan variables obligatorias en el entorno.\n");
  process.exit(1);
}

console.warn("\n✅ Todas las variables requeridas están cargadas correctamente.\n");