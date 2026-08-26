import { describe, expect, it } from "vitest";
import {
  createFormationSchema,
  assignDancerSchema,
  moveDancerSchema,
  assignInstrumentSchema,
  unassignInstrumentSchema,
  MAX_SEATS_PER_ROW,
  SEAT_NUMBERS,
  isValidSeat,
} from "@/lib/formation/schema";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const UUID2 = "123e4567-e89b-12d3-a456-426614174001";

describe("formation schema — Sprint 33", () => {
  describe("constants", () => {
    it("MAX_SEATS_PER_ROW is 6", () => {
      expect(MAX_SEATS_PER_ROW).toBe(6);
    });
    it("SEAT_NUMBERS contains 1-6", () => {
      expect(SEAT_NUMBERS).toEqual([1, 2, 3, 4, 5, 6]);
    });
    it("isValidSeat validates 1-6", () => {
      expect(isValidSeat(1)).toBe(true);
      expect(isValidSeat(6)).toBe(true);
      expect(isValidSeat(0)).toBe(false);
      expect(isValidSeat(7)).toBe(false);
      expect(isValidSeat(3.5)).toBe(false);
    });
  });

  describe("createFormationSchema", () => {
    it("accepts valid name", () => {
      const res = createFormationSchema.safeParse({ name: " Desfile 2026 ", eventId: null });
      expect(res.success).toBe(true);
      if (res.success) expect(res.data.name).toBe("Desfile 2026");
    });
    it("rejects empty name", () => {
      const res = createFormationSchema.safeParse({ name: "   " });
      expect(res.success).toBe(false);
    });
    it("rejects name >200", () => {
      const res = createFormationSchema.safeParse({ name: "a".repeat(201) });
      expect(res.success).toBe(false);
    });
    it("accepts valid eventId uuid", () => {
      const res = createFormationSchema.safeParse({ name: "Test", eventId: UUID });
      expect(res.success).toBe(true);
    });
    it("rejects invalid eventId", () => {
      const res = createFormationSchema.safeParse({ name: "Test", eventId: "not-uuid" });
      expect(res.success).toBe(false);
    });
    it("accepts null eventId (formación base)", () => {
      const res = createFormationSchema.safeParse({ name: "Base", eventId: null });
      expect(res.success).toBe(true);
    });
    it("mensajes en español", () => {
      const res = createFormationSchema.safeParse({ name: "" });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]!.message).toMatch(/obligatorio/i);
      }
    });
  });

  describe("assignDancerSchema", () => {
    it("accepts valid assignment", () => {
      const res = assignDancerSchema.safeParse({
        formationId: UUID,
        rowNumber: 1,
        seatNumber: 3,
        memberId: UUID2,
      });
      expect(res.success).toBe(true);
    });
    it("rejects row 0", () => {
      const res = assignDancerSchema.safeParse({
        formationId: UUID,
        rowNumber: 0,
        seatNumber: 3,
        memberId: UUID2,
      });
      expect(res.success).toBe(false);
    });
    it("rejects seat 0 and 7", () => {
      expect(
        assignDancerSchema.safeParse({ formationId: UUID, rowNumber: 1, seatNumber: 0, memberId: UUID2 }).success,
      ).toBe(false);
      expect(
        assignDancerSchema.safeParse({ formationId: UUID, rowNumber: 1, seatNumber: 7, memberId: UUID2 }).success,
      ).toBe(false);
    });
    it("accepts seats 1-6", () => {
      for (const seat of [1, 2, 3, 4, 5, 6]) {
        const res = assignDancerSchema.safeParse({
          formationId: UUID,
          rowNumber: 2,
          seatNumber: seat,
          memberId: UUID2,
        });
        expect(res.success).toBe(true);
      }
    });
    it("rejects invalid uuid", () => {
      const res = assignDancerSchema.safeParse({
        formationId: "bad",
        rowNumber: 1,
        seatNumber: 1,
        memberId: UUID2,
      });
      expect(res.success).toBe(false);
    });
  });

  describe("moveDancerSchema", () => {
    it("accepts valid move", () => {
      const res = moveDancerSchema.safeParse({
        formationId: UUID,
        fromRowNumber: 1,
        fromSeatNumber: 2,
        toRowNumber: 2,
        toSeatNumber: 5,
      });
      expect(res.success).toBe(true);
    });
    it("rejects invalid seat", () => {
      const res = moveDancerSchema.safeParse({
        formationId: UUID,
        fromRowNumber: 1,
        fromSeatNumber: 0,
        toRowNumber: 1,
        toSeatNumber: 1,
      });
      expect(res.success).toBe(false);
    });
  });

  describe("assignInstrumentSchema", () => {
    it("accepts valid instrument assignment", () => {
      const res = assignInstrumentSchema.safeParse({
        userId: UUID,
        instrumentId: UUID2,
        formationId: UUID,
      });
      expect(res.success).toBe(true);
    });
    it("accepts null formationId (global)", () => {
      const res = assignInstrumentSchema.safeParse({
        userId: UUID,
        instrumentId: UUID2,
        formationId: null,
      });
      expect(res.success).toBe(true);
    });
    it("rejects invalid uuid", () => {
      const res = assignInstrumentSchema.safeParse({
        userId: "bad",
        instrumentId: UUID2,
      });
      expect(res.success).toBe(false);
    });
  });

  describe("unassignInstrumentSchema", () => {
    it("accepts valid unassign", () => {
      const res = unassignInstrumentSchema.safeParse({ userId: UUID, formationId: null });
      expect(res.success).toBe(true);
    });
  });
});
