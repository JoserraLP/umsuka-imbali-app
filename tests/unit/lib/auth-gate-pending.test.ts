import { describe, it, expect } from "vitest";
import { isPendingGmail } from "@/lib/supabase/auth-gate";

describe("isPendingGmail", () => {
  it("returns true for pending_gmail", () => {
    expect(isPendingGmail("pending_gmail")).toBe(true);
  });
  it("returns false for linked", () => {
    expect(isPendingGmail("linked")).toBe(false);
  });
  it("returns false for null", () => {
    expect(isPendingGmail(null)).toBe(false);
  });
});
