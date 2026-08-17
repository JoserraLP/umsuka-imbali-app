import type { AppRole, ComponentType, Workgroup, UserStatus, AuthMethod } from "@/types/database.types";

export interface AuthenticatedProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  /** umsuka.profiles.avatar_url, falling back to the OAuth provider metadata. */
  avatarUrl: string | null;
  role: AppRole;
  componentType: ComponentType;
  workgroup: Workgroup;
  isWorkgroupLead: boolean;
  componentLeadFor: ComponentType | null;
  birthDate: string | null;
  isActive: boolean;
  status: UserStatus;
  username: string | null;
  authMethod: AuthMethod;
  bio: string | null;
  phone: string | null;
  skills: string[];
  joinedAt: string | null;
  createdAt: string;
}

export type { AppRole, ComponentType, Workgroup, UserStatus, AuthMethod };
