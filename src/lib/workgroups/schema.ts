import { z } from "zod";
import type { Workgroup } from "@/types/database.types";

/** All possible workgroup values including "ninguno" (no assignment). */
export const WORKGROUPS = ["telas", "barra", "estandarte", "limpieza", "ninguno"] as const;
/** Type alias for the canonical Workgroup enum from the database schema. */
export type WorkgroupType = Workgroup;

/** Workgroups that have actual responsibilities (excludes "ninguno"). */
export const ACTIVE_WORKGROUPS = ["telas", "barra", "estandarte", "limpieza"] as const;
export type ActiveWorkgroup = (typeof ACTIVE_WORKGROUPS)[number];

export const activeWorkgroupSchema = z.enum(ACTIVE_WORKGROUPS);

export const BARRATASK_OPTIONS = ["cocina", "bebidas"] as const;
export type BarraTask = (typeof BARRATASK_OPTIONS)[number];

export const barraTaskSchema = z.enum(BARRATASK_OPTIONS);

const hoursWorkedField = z
  .union([z.number(), z.nan(), z.null()])
  .optional()
  .transform((val) => {
    if (typeof val === "number" && !Number.isNaN(val) && val > 0) return val;
    return null;
  })
  .nullable();

const barraTaskField = z
  .enum(BARRATASK_OPTIONS)
  .nullable()
  .optional()
  .transform((val) => val ?? null);

export const markWorkgroupAttendanceSchema = z
  .object({
    shiftId: z.string().uuid("El ID del turno debe ser un UUID válido."),
    userId: z.string().uuid("El ID del usuario debe ser un UUID válido."),
    workgroup: activeWorkgroupSchema,
    attended: z.boolean({ required_error: "Debes indicar si asistió.", invalid_type_error: "Debes indicar si asistió." }),
    hoursWorked: hoursWorkedField,
    barraTask: barraTaskField,
  })
  .refine(
    (data) => {
      // For barra, hoursWorked should be null and barraTask must be set
      if (data.workgroup === "barra") {
        return data.barraTask !== null;
      }
      return true;
    },
    { message: "Para barra debes indicar si fue cocina o bebidas.", path: ["barraTask"] },
  )
  .refine(
    (data) => {
      // For non-barra, barraTask should be null
      if (data.workgroup !== "barra") {
        return data.barraTask === null;
      }
      return true;
    },
    { message: "Solo barra puede tener tipo de tarea.", path: ["barraTask"] },
  );
export type MarkWorkgroupAttendanceInput = z.infer<typeof markWorkgroupAttendanceSchema>;

export const updateWorkgroupAttendanceSchema = z
  .object({
    id: z.string().uuid("El ID del registro debe ser un UUID válido."),
    attended: z.boolean({ required_error: "Debes indicar si asistió.", invalid_type_error: "Debes indicar si asistió." }),
    hoursWorked: hoursWorkedField,
    barraTask: barraTaskField,
  })
  .refine(
    (data) => {
      if (data.barraTask !== null) {
        return data.hoursWorked === null;
      }
      return true;
    },
    { message: "No puedes establecer horas para barra.", path: ["hoursWorked"] },
  );
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
  hoursWorked: number | null;
  barraTask: BarraTask | null;
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
