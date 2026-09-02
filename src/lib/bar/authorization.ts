import type { AppRole, Workgroup } from "@/types/database.types";

export interface BarActor {
  role: AppRole;
  isWorkgroupLead: boolean;
  workgroup: Workgroup;
}

export function isBarLead(actor: BarActor): boolean {
  return actor.isWorkgroupLead && actor.workgroup === "barra";
}

export function canManageBar(actor: BarActor): boolean {
  return isBarLead(actor) || actor.role === "super_admin";
}
