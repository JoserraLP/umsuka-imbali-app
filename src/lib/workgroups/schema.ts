import { z } from "zod";

/** All possible workgroup values including "ninguno" (no assignment). */
export const WORKGROUPS = ["telas", "barra", "estandarte", "limpieza", "ninguno"] as const;
export type WorkgroupType = (typeof WORKGROUPS)[number];

/** Workgroups that have actual responsibilities (excludes "ninguno"). */
export const ACTIVE_WORKGROUPS = ["telas", "barra", "estandarte", "limpieza"] as const;
export type ActiveWorkgroup = (typeof ACTIVE_WORKGROUPS)[number];

export const activeWorkgroupSchema = z.enum(ACTIVE_WORKGROUPS);

export const markWorkgroupAttendanceSchema = z.object({
  shiftId: z.string().uuid("shiftId must be a valid UUID."),
  userId: z.string().uuid("userId must be a valid UUID."),
  workgroup: activeWorkgroupSchema,
  attended: z.boolean({ required_error: "attended is required." }),
});
export type MarkWorkgroupAttendanceInput = z.infer<typeof markWorkgroupAttendanceSchema>;

export const updateWorkgroupAttendanceSchema = z.object({
  id: z.string().uuid("id must be a valid UUID."),
  attended: z.boolean({ required_error: "attended is required." }),
});
export type UpdateWorkgroupAttendanceInput = z.infer<typeof updateWorkgroupAttendanceSchema>;

export interface WorkgroupLeadInfo {
  isLead: boolean;
  workgroup: ActiveWorkgroup | null;
}

export interface WorkgroupAttendanceRecord {
  id: string;
  shiftId: string;
  userId: string;
  workgroup: ActiveWorkgroup;
  attended: boolean;
  markedBy: string | null;
  createdAt: string;
  updatedAt: string;
  firstName: string;
  lastName: string;
}

export interface WorkgroupAttendanceSummary {
  workgroup: ActiveWorkgroup;
  present: number;
  absent: number;
  unchecked: number;
}
