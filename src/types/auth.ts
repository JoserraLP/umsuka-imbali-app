import type { AppRole, ComponentType, Workgroup, UserStatus, AuthMethod } from "@/types/database.types";

export interface AuthenticatedProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  avatarUrl: string | null;
  role: AppRole;
  componentType: ComponentType;
  workgroup: Workgroup;
  isWorkgroupLead: boolean;
  birthDate: string | null;
  isActive: boolean;
  status: UserStatus;
  username: string | null;
  authMethod: AuthMethod;
  createdAt: string;
}

export type { AppRole, ComponentType, Workgroup, UserStatus, AuthMethod };
