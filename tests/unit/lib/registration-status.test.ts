import { describe, expect, it } from "vitest";
import { computeRegistrationStatus } from "@/lib/events/queries";

const NOW = new Date("2026-08-13T12:00:00Z");
const FUTURE_DEADLINE = "2026-09-01T12:00:00Z";
const PAST_DEADLINE = "2026-01-01T12:00:00Z";

const baseInput = {
  capacity: null as number | null,
  registeredCount: 0,
  registrationDeadline: null as string | null,
  viewerRegistered: false,
  viewerWaitlistPosition: null as number | null,
  now: NOW,
};

describe("computeRegistrationStatus", () => {
  it("is open when there is no capacity and no deadline", () => {
    const status = computeRegistrationStatus(baseInput);

    expect(status.isFull).toBe(false);
    expect(status.isDeadlinePassed).toBe(false);
    expect(status.registrationOpen).toBe(true);
  });

  it("marks the event as full when the registered count reaches capacity", () => {
    const status = computeRegistrationStatus({
      ...baseInput,
      capacity: 10,
      registeredCount: 10,
    });

    expect(status.isFull).toBe(true);
    expect(status.registrationOpen).toBe(false);
  });

  it("leaves the event open when capacity is not reached", () => {
    const status = computeRegistrationStatus({
      ...baseInput,
      capacity: 10,
      registeredCount: 9,
    });

    expect(status.isFull).toBe(false);
    expect(status.registrationOpen).toBe(true);
  });

  it("treats a null deadline as never passed", () => {
    const status = computeRegistrationStatus(baseInput);

    expect(status.isDeadlinePassed).toBe(false);
  });

  it("detects a passed registration deadline", () => {
    const status = computeRegistrationStatus({
      ...baseInput,
      registrationDeadline: PAST_DEADLINE,
    });

    expect(status.isDeadlinePassed).toBe(true);
    expect(status.registrationOpen).toBe(false);
  });

  it("keeps the event open when the deadline is still in the future", () => {
    const status = computeRegistrationStatus({
      ...baseInput,
      registrationDeadline: FUTURE_DEADLINE,
    });

    expect(status.isDeadlinePassed).toBe(false);
    expect(status.registrationOpen).toBe(true);
  });

  it("closes registration when both capacity and deadline conditions fail", () => {
    const status = computeRegistrationStatus({
      ...baseInput,
      capacity: 5,
      registeredCount: 5,
      registrationDeadline: PAST_DEADLINE,
    });

    expect(status.isFull).toBe(true);
    expect(status.isDeadlinePassed).toBe(true);
    expect(status.registrationOpen).toBe(false);
  });

  it("reports the viewer as registered before anything else", () => {
    const status = computeRegistrationStatus({
      ...baseInput,
      viewerRegistered: true,
      viewerWaitlistPosition: 2,
    });

    expect(status.viewerStatus).toBe("registered");
  });

  it("reports the viewer as waitlisted with their position", () => {
    const status = computeRegistrationStatus({
      ...baseInput,
      viewerWaitlistPosition: 3,
    });

    expect(status.viewerStatus).toBe("waitlisted");
    expect(status.viewerWaitlistPosition).toBe(3);
  });

  it("reports the viewer as none when neither registered nor waitlisted", () => {
    const status = computeRegistrationStatus(baseInput);

    expect(status.viewerStatus).toBe("none");
  });

  it("passes through capacity, count, deadline and waitslist position", () => {
    const status = computeRegistrationStatus({
      ...baseInput,
      capacity: 20,
      registeredCount: 7,
      registrationDeadline: FUTURE_DEADLINE,
      viewerWaitlistPosition: null,
    });

    expect(status.capacity).toBe(20);
    expect(status.registeredCount).toBe(7);
    expect(status.registrationDeadline).toBe(FUTURE_DEADLINE);
  });
});
