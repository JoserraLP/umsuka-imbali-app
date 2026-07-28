import { loadEnvConfig } from "@next/env";

const projectDir = process.cwd();

// Carga .env, .env.local, .env.development, etc. como lo hace Next.js
loadEnvConfig