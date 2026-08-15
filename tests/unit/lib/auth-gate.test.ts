import { describe, expect, it } from "vitest";
import { requiresWorkgroupOnboarding } from "@/lib/supabase/auth-gate";

describe("requiresWorkgroupOnboarding", () => {
  it("requires onboarding when the workgroup is null", () => {
    expect(requiresWorkgroupOnboarding(null)).toBe(true);
  });

  it("requires onboarding when the workgroup is explicitly 'ninguno'", () => {
    expect(requiresWorkgroupOnboarding("ninguno")).toBe(true);
  });

  it("does not require onboarding for a real workgroup", () => {
    expect(requiresWorkgroupOnboarding("telas")).toBe(false);
    expect(requiresWorkgroupOnboarding("barra")).toBe(false);
    expect(requiresWorkgroupOnboarding("estandarte")).toBe(false);
    expect(requiresWorkgroupOnboarding("limpieza")).toBe(false);
  });

  it("does not treat an unexpected value as missing (defensive pass-through)", () => {
    expect(requiresWorkgroupOnboarding("")).toBe(false);
  });
});
