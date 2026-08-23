import { describe, it, expect } from "vitest";
import {
  computeRehearsalParticipation,
  computeParticipationFromCounts,
} from "@/lib/rehearsals/stats";

describe("computeRehearsalParticipation", () => {
  it("returns null when nothing has been marked yet", () => {
    expect(computeRehearsalParticipation([])).toBeNull();
  });

  it("returns 100 when every marked session was attended", () => {
    expect(
      computeRehearsalParticipation([
        { session: "morning", attended: true },
        { session: "afternoon", attended: true },
      ]),
    ).toBe(100);
  });

  it("returns 0 when every marked session was missed", () => {
    expect(
      computeRehearsalParticipation([
        { session: "morning", attended: false },
        { session: "afternoon", attended: false },
      ]),
    ).toBe(0);
  });

  it("rounds to one decimal (2 of 3 = 66.7)", () => {
    expect(
      computeRehearsalParticipation([
        { session: "morning", attended: true },
        { session: "afternoon", attended: true },
        { session: "morning", attended: false },
      ]),
    ).toBe(66.7);
  });
});

describe("computeParticipationFromCounts", () => {
  it("returns null when marked is zero", () => {
    expect(computeParticipationFromCounts(0, 0)).toBeNull();
  });

  it("computes the percentage over the marked sessions", () => {
    expect(computeParticipationFromCounts(5, 8)).toBe(62.5);
    expect(computeParticipationFromCounts(1, 3)).toBe(33.3);
    expect(computeParticipationFromCounts(3, 3)).toBe(100);
    expect(computeParticipationFromCounts(0, 7)).toBe(0);
  });

  it("treats a negative marked count as 'nothing marked'", () => {
    expect(computeParticipationFromCounts(2, -1)).toBeNull();
  });
});
