import { describe, it, expect } from "vitest";
import { isBarLead, canManageBar } from "@/lib/bar/menus";
import { suggestQuantity as shoppingSuggest, suggestQuantityByCategory } from "@/lib/bar/shopping";

describe("suggestQuantity", () => {
  it.each<[number | null, number]>([
    [-1, 20], [0, 20], [1, 15], [5, 15], [6, 10], [10, 10], [11, 5], [20, 5], [21, 0], [null, 10],
  ])("stock %s -> %s", (stock, expected) => {
    expect(shoppingSuggest(stock)).toBe(expected);
  });
  it("drink suggests +5", () => {
    expect(suggestQuantityByCategory(5, "drink")).toBe(20);
  });
});

describe("isBarLead / canManageBar", () => {
  it("bar lead true", () => {
    expect(isBarLead({ role: "member", isWorkgroupLead: true, workgroup: "barra" })).toBe(true);
  });
  it("other workgroup false", () => {
    expect(isBarLead({ role: "member", isWorkgroupLead: true, workgroup: "telas" })).toBe(false);
  });
  it("not lead false", () => {
    expect(isBarLead({ role: "member", isWorkgroupLead: false, workgroup: "barra" })).toBe(false);
  });
  it("super_admin can manage", () => {
    expect(canManageBar({ role: "super_admin", isWorkgroupLead: false, workgroup: "ninguno" })).toBe(true);
  });
  it("admin cannot manage (only super_admin+bar lead)", () => {
    expect(canManageBar({ role: "admin", isWorkgroupLead: false, workgroup: "ninguno" })).toBe(false);
  });
});
