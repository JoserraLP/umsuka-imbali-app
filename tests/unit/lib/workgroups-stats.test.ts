import { describe, expect, it } from "vitest";
import {
  canViewGroupStats,
  computeEffectiveHours,
  computeGroupStats,
  computeMemberStatsDetail,
  shiftDurationHours,
  type StatsActor,
} from "@/lib/workgroups/stats";

const VALID_UUID = "123e4567-e89b-12d3-a456-426614174000";
const USER_ANA = "223e4567-e89b-12d3-a456-426614174001";
const USER_LUIS = "323e4567-e89b-12d3-a456-426614174002";
const SHIFT_MORNING = "423e4567-e89b-12d3-a456-426614174003";
const SHIFT_NIGHT = "523e4567-e89b-12d3-a456-426614174004";

const telasLead: StatsActor = {
  role: "member",
  isWorkgroupLead: true,
  workgroup: "telas",
};

describe("shiftDurationHours", () => {
  it("computes fractional hours between start and end", () => {
    expect(
      shiftDurationHours("2026-03-01T10:00:00Z", "2026-03-01T14:30:00Z"),
    ).toBe(4.5);
  });

  it("handles shifts crossing midnight", () => {
    expect(
      shiftDurationHours("2026-03-01T23:00:00Z", "2026-03-02T02:00:00Z"),
    ).toBe(3);
  });

  it("returns 0 when end equals start", () => {
    expect(
      shiftDurationHours("2026-03-01T10:00:00Z", "2026-03-01T10:00:00Z"),
    ).toBe(0);
  });

  it("returns 0 when end is before start", () => {
    expect(
      shiftDurationHours("2026-03-01T14:00:00Z", "2026-03-01T10:00:00Z"),
    ).toBe(0);
  });

  it("returns 0 for invalid dates", () => {
    expect(shiftDurationHours("not-a-date", "2026-03-01T14:00:00Z")).toBe(0);
    expect(shiftDurationHours("2026-03-01T10:00:00Z", "not-a-date")).toBe(0);
  });
});

describe("computeEffectiveHours", () => {
  it("uses hoursWorked when attended and hours are present", () => {
    expect(
      computeEffectiveHours({
        attended: true,
        hoursWorked: 3.5,
        startTime: "2026-03-01T10:00:00Z",
        endTime: "2026-03-01T14:00:00Z",
      }),
    ).toBe(3.5);
  });

  it("falls back to shift duration when attended with null hours", () => {
    expect(
      computeEffectiveHours({
        attended: true,
        hoursWorked: null,
        startTime: "2026-03-01T10:00:00Z",
        endTime: "2026-03-01T14:00:00Z",
      }),
    ).toBe(4);
  });

  it("returns 0 when not attended even with hoursWorked present", () => {
    expect(
      computeEffectiveHours({
        attended: false,
        hoursWorked: 5,
        startTime: "2026-03-01T10:00:00Z",
        endTime: "2026-03-01T14:00:00Z",
      }),
    ).toBe(0);
  });
});

describe("canViewGroupStats", () => {
  it("allows super_admin for any workgroup", () => {
    const actor: StatsActor = { role: "super_admin", isWorkgroupLead: false, workgroup: "ninguno" };
    expect(canViewGroupStats(actor, "telas")).toBe(true);
    expect(canViewGroupStats(actor, "limpieza")).toBe(true);
  });

  it("allows a lead viewing their own workgroup", () => {
    expect(canViewGroupStats(telasLead, "telas")).toBe(true);
  });

  it("denies a lead viewing a different workgroup", () => {
    expect(canViewGroupStats(telasLead, "barra")).toBe(false);
  });

  it("denies admin (not super_admin) even with matching group", () => {
    const admin: StatsActor = { role: "admin", isWorkgroupLead: false, workgroup: "telas" };
    expect(canViewGroupStats(admin, "telas")).toBe(false);
  });

  it("denies a plain member even of the matching group", () => {
    const member: StatsActor = { role: "member", isWorkgroupLead: false, workgroup: "telas" };
    expect(canViewGroupStats(member, "telas")).toBe(false);
  });

  it("denies a lead whose workgroup is ninguno", () => {
    const noGroupLead: StatsActor = { role: "member", isWorkgroupLead: true, workgroup: "ninguno" };
    expect(canViewGroupStats(noGroupLead, "telas")).toBe(false);
  });

  it("denies null or undefined actors", () => {
    expect(canViewGroupStats(null, "telas")).toBe(false);
    expect(canViewGroupStats(undefined, "telas")).toBe(false);
  });
});

describe("computeGroupStats", () => {
  const members = [
    { userId: USER_LUIS, firstName: "Luis", lastName: "García" },
    { userId: USER_ANA, firstName: "Ana", lastName: "López" },
  ];

  it("computes counters, rounded hours and percentage per member", () => {
    const stats = computeGroupStats("telas", {
      members,
      attendance: [
        { userId: USER_ANA, shiftId: SHIFT_MORNING, attended: true, hoursWorked: 3.5 },
        { userId: USER_ANA, shiftId: SHIFT_NIGHT, attended: true, hoursWorked: null },
        { userId: USER_ANA, shiftId: SHIFT_MORNING, attended: false, hoursWorked: null },
        { userId: USER_LUIS, shiftId: SHIFT_MORNING, attended: true, hoursWorked: null },
        { userId: "999e4567-e89b-12d3-a456-426614174099", shiftId: SHIFT_MORNING, attended: true, hoursWorked: 1 },
      ],
      shiftTimes: new Map([
        [SHIFT_MORNING, { start: "2026-03-01T10:00:00Z", end: "2026-03-01T14:00:00Z" }],
        [SHIFT_NIGHT, { start: "2026-03-01T20:00:00Z", end: "2026-03-01T23:30:00Z" }],
      ]),
      assignmentsByUser: new Map([
        [USER_ANA, 4],
        [USER_LUIS, 2],
      ]),
    });

    expect(stats.workgroup).toBe("telas");
    expect(stats.members).toHaveLength(2);

    const ana = stats.members.find((m) => m.userId === USER_ANA)!;
    expect(ana.assignedShifts).toBe(4);
    expect(ana.markedShifts).toBe(3);
    expect(ana.attendedShifts).toBe(2);
    // 3.5 (worked) + 3.5 (duration 20:00-23:30) + 0 (absent)
    expect(ana.totalHours).toBe(7);
    expect(ana.attendanceRate).toBe(66.7);

    const luis = stats.members.find((m) => m.userId === USER_LUIS)!;
    expect(luis.assignedShifts).toBe(2);
    expect(luis.markedShifts).toBe(1);
    expect(luis.attendedShifts).toBe(1);
    expect(luis.totalHours).toBe(4);
    expect(luis.attendanceRate).toBe(100);
  });

  it("sorts members by firstName then lastName ascending", () => {
    const stats = computeGroupStats("barra", {
      members: [
        { userId: USER_LUIS, firstName: "Luis", lastName: "García" },
        { userId: "a23e4567-e89b-12d3-a456-42661417400a", firstName: "Ana", lastName: "Zamora" },
        { userId: USER_ANA, firstName: "Ana", lastName: "López" },
      ],
      attendance: [],
      shiftTimes: new Map(),
      assignmentsByUser: new Map(),
    });

    expect(stats.members.map((m) => `${m.firstName} ${m.lastName}`)).toEqual([
      "Ana López",
      "Ana Zamora",
      "Luis García",
    ]);
  });

  it("sets attendanceRate to null when the member has no marked shifts", () => {
    const stats = computeGroupStats("estandarte", {
      members,
      attendance: [],
      shiftTimes: new Map(),
      assignmentsByUser: new Map(),
    });

    for (const member of stats.members) {
      expect(member.markedShifts).toBe(0);
      expect(member.attendedShifts).toBe(0);
      expect(member.totalHours).toBe(0);
      expect(member.attendanceRate).toBeNull();
    }
  });

  it("includes members without any records with zero counters", () => {
    const stats = computeGroupStats("limpieza", {
      members,
      attendance: [{ userId: USER_ANA, shiftId: SHIFT_MORNING, attended: true, hoursWorked: 2.25 }],
      shiftTimes: new Map([[SHIFT_MORNING, { start: "2026-03-01T10:00:00Z", end: "2026-03-01T14:00:00Z" }]]),
      assignmentsByUser: new Map([[USER_ANA, 1]]),
    });

    const luis = stats.members.find((m) => m.userId === USER_LUIS)!;
    expect(luis.assignedShifts).toBe(0);
    expect(luis.markedShifts).toBe(0);
    expect(luis.attendedShifts).toBe(0);
    expect(luis.totalHours).toBe(0);
    expect(luis.attendanceRate).toBeNull();
  });

  it("rounds total hours to two decimals", () => {
    const stats = computeGroupStats("telas", {
      members: [members[1]!],
      attendance: [
        { userId: USER_ANA, shiftId: SHIFT_MORNING, attended: true, hoursWorked: null },
        { userId: USER_ANA, shiftId: SHIFT_NIGHT, attended: true, hoursWorked: null },
      ],
      shiftTimes: new Map([
        [SHIFT_MORNING, { start: "2026-03-01T10:00:00Z", end: "2026-03-01T13:40:00Z" }],
        [SHIFT_NIGHT, { start: "2026-03-01T20:00:00Z", end: "2026-03-01T22:40:00Z" }],
      ]),
      assignmentsByUser: new Map(),
    });

    const ana = stats.members[0]!;
    // 3.6666... + 2.6666... = 6.3333... -> 6.33
    expect(ana.totalHours).toBe(6.33);
  });
});

describe("computeMemberStatsDetail", () => {
  it("orders shifts by startTime descending and computes hours", () => {
    const detail = computeMemberStatsDetail({
      workgroup: "barra",
      userId: USER_ANA,
      firstName: "Ana",
      lastName: "López",
      attendance: [
        { id: "att-1", shiftId: SHIFT_MORNING, attended: true, hoursWorked: null, barraTask: "cocina" },
        { id: "att-2", shiftId: SHIFT_NIGHT, attended: false, hoursWorked: null, barraTask: null },
        { id: "att-3", shiftId: SHIFT_MORNING, attended: true, hoursWorked: 2.5, barraTask: "bebidas" },
      ],
      shifts: new Map([
        [SHIFT_MORNING, { name: "Montaje", eventId: "event-1", start: "2026-03-01T10:00:00Z", end: "2026-03-01T14:00:00Z" }],
        [SHIFT_NIGHT, { name: "Cierre", eventId: "event-2", start: "2026-03-01T20:00:00Z", end: "2026-03-01T23:00:00Z" }],
      ]),
      events: new Map([
        ["event-1", { title: "Ensayo general", date: "2026-03-01T10:00:00Z" }],
        ["event-2", { title: "Fiesta fin de año", date: "2026-03-02T10:00:00Z" }],
      ]),
      assignedShifts: 3,
    });

    expect(detail.userId).toBe(USER_ANA);
    expect(detail.workgroup).toBe("barra");
    expect(detail.assignedShifts).toBe(3);
    expect(detail.markedShifts).toBe(3);
    expect(detail.attendedShifts).toBe(2);
    // 4 (duration) + 0 (absent) + 2.5 (worked)
    expect(detail.totalHours).toBe(6.5);
    expect(detail.attendanceRate).toBe(66.7);

    // Night shift starts later, so it comes first
    expect(detail.shifts.map((s) => s.shiftId)).toEqual([SHIFT_NIGHT, SHIFT_MORNING, SHIFT_MORNING]);
    const first = detail.shifts[0]!;
    expect(first.shiftName).toBe("Cierre");
    expect(first.eventId).toBe("event-2");
    expect(first.eventTitle).toBe("Fiesta fin de año");
    expect(first.eventDate).toBe("2026-03-02T10:00:00Z");
    expect(first.attended).toBe(false);
    expect(first.hours).toBe(0);
  });

  it("falls back to unknown event title and null date when the event is missing", () => {
    const detail = computeMemberStatsDetail({
      workgroup: "telas",
      userId: USER_LUIS,
      firstName: "Luis",
      lastName: "García",
      attendance: [
        { id: "att-1", shiftId: SHIFT_MORNING, attended: true, hoursWorked: null, barraTask: null },
      ],
      shifts: new Map([
        [SHIFT_MORNING, { name: "Montaje", eventId: "event-desconocido", start: "2026-03-01T10:00:00Z", end: "2026-03-01T12:00:00Z" }],
      ]),
      events: new Map(),
      assignedShifts: 1,
    });

    const shift = detail.shifts[0]!;
    expect(shift.eventTitle).toBe("Evento desconocido");
    expect(shift.eventDate).toBeNull();
    expect(shift.hours).toBe(2);
    expect(shift.barraTask).toBeNull();
  });

  it("propagates barraTask and sets attendanceRate to null without marks", () => {
    const detail = computeMemberStatsDetail({
      workgroup: "barra",
      userId: USER_ANA,
      firstName: "Ana",
      lastName: "López",
      attendance: [],
      shifts: new Map(),
      events: new Map(),
      assignedShifts: 2,
    });

    expect(detail.markedShifts).toBe(0);
    expect(detail.totalHours).toBe(0);
    expect(detail.attendanceRate).toBeNull();
    expect(detail.shifts).toEqual([]);
  });

  it("rounds per-shift hours to two decimals", () => {
    const detail = computeMemberStatsDetail({
      workgroup: "telas",
      userId: USER_ANA,
      firstName: "Ana",
      lastName: "López",
      attendance: [
        { id: "att-1", shiftId: SHIFT_MORNING, attended: true, hoursWorked: null, barraTask: null },
      ],
      shifts: new Map([
        [SHIFT_MORNING, { name: "Montaje", eventId: "event-1", start: "2026-03-01T10:00:00Z", end: "2026-03-01T13:20:00Z" }],
      ]),
      events: new Map([["event-1", { title: "Ensayo", date: null }]]),
      assignedShifts: 1,
    });

    // 3h20m = 3.3333... -> 3.33
    expect(detail.shifts[0]!.hours).toBe(3.33);
    expect(detail.totalHours).toBe(3.33);
  });

  it("keeps the shift reference for VALID_UUID-shaped ids", () => {
    const detail = computeMemberStatsDetail({
      workgroup: "limpieza",
      userId: USER_ANA,
      firstName: "Ana",
      lastName: "López",
      attendance: [
        { id: VALID_UUID, shiftId: VALID_UUID, attended: true, hoursWorked: 1, barraTask: null },
      ],
      shifts: new Map([[VALID_UUID, { name: "Recogida", eventId: "event-1", start: "2026-03-01T10:00:00Z", end: "2026-03-01T11:00:00Z" }]]),
      events: new Map([["event-1", { title: "Ensayo", date: "2026-03-01T10:00:00Z" }]]),
      assignedShifts: 1,
    });

    const shift = detail.shifts[0]!;
    expect(shift.attendanceId).toBe(VALID_UUID);
    expect(shift.shiftId).toBe(VALID_UUID);
    expect(shift.shiftName).toBe("Recogida");
    expect(shift.hours).toBe(1);
  });
});