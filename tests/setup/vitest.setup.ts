import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mock "server-only" so server-only modules can be imported in tests
vi.mock("server-only", () => ({}));

// Mock env.client for test environment (prevents validation errors)
vi.mock("@/lib/env.client", () => ({
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "https://test-project.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  },
}));

// Mock env.server for test environment
vi.mock("@/lib/env.server", () => ({
  serverEnv: {
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    INSTAGRAM_ACCESS_TOKEN: "test-token",
    INSTAGRAM_USER_ID: "test-user-id",
  },
}));
