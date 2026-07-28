import type { AppRole, ComponentType } from "@/types/database.types";

export interface AuthenticatedProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  avatarUrl: string | null;
  role: AppRole;
  componentType: ComponentType;
  birthDate: string | null;
  isActive: boolean;
  createdAt: string;
}

export type { AppRole, ComponentType };
