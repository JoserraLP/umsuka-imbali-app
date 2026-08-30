import { describe, it, expect } from "vitest";
import { createCarnivalYearSchema, startNewYearSchema, SNAPSHOT_TYPES, isCarnivalYearStatus } from "@/lib/carnival/schema";

describe("carnival/schema", () => {
  it("acepta año válido", () => {
    const res = createCarnivalYearSchema.safeParse({ year: 2027, label: "Carnaval 2027", start_date: "2027-01-01" });
    expect(res.success).toBe(true);
  });
  it("rechaza año fuera de rango", () => {
    expect(createCarnivalYearSchema.safeParse({ year: 1999, label: "X", start_date: "2027-01-01" }).success).toBe(false);
    expect(createCarnivalYearSchema.safeParse({ year: 2101, label: "X", start_date: "2027-01-01" }).success).toBe(false);
  });
  it("valida startNewYear confirmación AÑO", () => {
    expect(startNewYearSchema.safeParse({ label: "Carnaval 2027", start_date: "2027-01-01", confirmText: "AÑO" }).success).toBe(true);
    expect(startNewYearSchema.safeParse({ label: "Carnaval 2027", start_date: "2027-01-01", confirmText: "NO" }).success).toBe(true); // schema solo valida presencia, lógica de comparación en mutation
  });
  it("SNAPSHOT_TYPES incluye todas las secciones", () => {
    expect(SNAPSHOT_TYPES).toContain("members");
    expect(SNAPSHOT_TYPES).toContain("events");
    expect(SNAPSHOT_TYPES).toContain("payments");
    expect(SNAPSHOT_TYPES).toContain("formations");
    expect(SNAPSHOT_TYPES).toContain("transactions");
    expect(SNAPSHOT_TYPES.length).toBeGreaterThanOrEqual(12);
  });
  it("isCarnivalYearStatus funciona", () => {
    expect(isCarnivalYearStatus("active")).toBe(true);
    expect(isCarnivalYearStatus("archived")).toBe(true);
    expect(isCarnivalYearStatus("other")).toBe(false);
  });
});
