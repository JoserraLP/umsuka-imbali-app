/**
 * Hand-authored to match supabase/migrations exactly for the foundation
 * phase. Once business modules are implemented, regenerate with:
 *   npm run supabase:gen-types
 * and this file will be overwritten with the CLI-generated equivalent.
 */
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type ComponentType = "music" | "dance" | "member";
export type EventType = "general" | "meeting" | "carnival" | "work_shift" | "rehearsal";
export type RehearsalSession = "morning" | "afternoon";
export type Workgroup = "telas" | "barra" | "estandarte" | "limpieza" | "ninguno";
export type UserStatus = "pending" | "active" | "suspended";
export type AuthMethod = "google" | "email_alias" | "phone";
export type AppRole =
  | "super_admin"
  | "admin"
  | "board_member"
  | "event_manager"
  | "member"
  | "guest";
export type WaitlistStatus = "waiting" | "promoted" | "declined" | "removed";
export type AudienceType = "all" | "workgroup" | "member_type" | "specific_users";
export type NotificationType =
  | "event_created"
  | "news_created"
  | "voting_created"
  | "shift_assigned"
  | "profile_approved";
export type Permission =
  | "users.read"
  | "users.manage"
  | "settings.read"
  | "settings.write"
  | "audit.read";

export interface Database {
  umsuka: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          first_name: string;
          last_name: string;
          birth_date: string | null;
          component_type: ComponentType;
          role: string;
          workgroup: Workgroup;
          is_workgroup_lead: boolean;
          component_lead_for: string | null;
          is_active: boolean;
          status: UserStatus;
          auth_method: AuthMethod;
          username: string | null;
          avatar_url: string | null;
          bio: string | null;
          phone: string | null;
          skills: string[];
          joined_at: string | null;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id: string;
          first_name: string;
          last_name: string;
          birth_date?: string | null;
          component_type?: ComponentType;
          role?: string;
          workgroup?: Workgroup;
          is_workgroup_lead?: boolean;
          component_lead_for?: string | null;
          is_active?: boolean;
          status?: UserStatus;   // default 'pending' in DB
          auth_method?: AuthMethod;  // default 'google' in DB
          username?: string | null;
          avatar_url?: string | null;
          bio?: string | null;
          phone?: string | null;
          skills?: string[];   // default '{}' in DB
          joined_at?: string | null;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          first_name?: string;
          last_name?: string;
          birth_date?: string | null;
          component_type?: ComponentType;
          role?: string;
          workgroup?: Workgroup;
          is_workgroup_lead?: boolean;
          component_lead_for?: string | null;
          is_active?: boolean;
          status?: UserStatus;
          auth_method?: AuthMethod;
          username?: string | null;
          avatar_url?: string | null;
          bio?: string | null;
          phone?: string | null;
          skills?: string[];
          joined_at?: string | null;
          created_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      events: {
        Row: {
          id: string;
          title: string;
          description: string | null;
          event_type: EventType;
          event_date: string;
          capacity: number | null;
          registration_deadline: string | null;
          location: string | null;
          image_url: string | null;
          morning_session: boolean;   // default false in DB (rehearsal only)
          afternoon_session: boolean; // default false in DB (rehearsal only)
          visible_to_group: Workgroup | null;
          created_by_workgroup: Workgroup | null;
          audience_type: AudienceType;
          audience_workgroup: Workgroup | null;
          audience_member_type: ComponentType | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          description?: string | null;
          event_type: EventType;
          event_date: string;
          capacity?: number | null;
          registration_deadline?: string | null;
          location?: string | null;
          image_url?: string | null;
          morning_session?: boolean;   // default false in DB
          afternoon_session?: boolean; // default false in DB
          visible_to_group?: Workgroup | null;
          created_by_workgroup?: Workgroup | null;
          audience_type?: AudienceType;   // default 'all' in DB
          audience_workgroup?: Workgroup | null;
          audience_member_type?: ComponentType | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          description?: string | null;
          event_type?: EventType;
          event_date?: string;
          capacity?: number | null;
          registration_deadline?: string | null;
          location?: string | null;
          image_url?: string | null;
          morning_session?: boolean;
          afternoon_session?: boolean;
          visible_to_group?: Workgroup | null;
          created_by_workgroup?: Workgroup | null;
          audience_type?: AudienceType;
          audience_workgroup?: Workgroup | null;
          audience_member_type?: ComponentType | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      event_audience_users: {
        Row: {
          event_id: string;
          user_id: string;
        };
        Insert: {
          event_id: string;
          user_id: string;
        };
        Update: {
          event_id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      shifts: {
        Row: {
          id: string;
          event_id: string | null;
          name: string;
          start_time: string;
          end_time: string;
          max_assignees: number | null;
          workgroup: Workgroup | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id?: string | null;
          name: string;
          start_time: string;
          end_time: string;
          max_assignees?: number | null;
          workgroup?: Workgroup | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string | null;
          name?: string;
          start_time?: string;
          end_time?: string;
          max_assignees?: number | null;
          workgroup?: Workgroup | null;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      shift_assignments: {
        Row: {
          id: string;
          shift_id: string | null;
          user_id: string | null;
          confirmed: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          shift_id?: string | null;
          user_id?: string | null;
          confirmed?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          shift_id?: string | null;
          user_id?: string | null;
          confirmed?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      attendance: {
        Row: {
          id: string;
          event_id: string | null;
          user_id: string | null;
          attended: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id?: string | null;
          user_id?: string | null;
          attended: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string | null;
          user_id?: string | null;
          attended?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      absences: {
        Row: {
          id: string;
          user_id: string | null;
          event_id: string | null;
          reason: string | null;
          justified: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          event_id?: string | null;
          reason?: string | null;
          justified?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          event_id?: string | null;
          reason?: string | null;
          justified?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      news: {
        Row: {
          id: string;
          title: string;
          content: string;
          image_url: string | null;
          published: boolean;
          pinned: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          content: string;
          image_url?: string | null;
          published?: boolean;
          pinned?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          content?: string;
          image_url?: string | null;
          published?: boolean;
          pinned?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      questions: {
        Row: {
          id: string;
          user_id: string | null;
          title: string;
          content: string;
          category: string | null;
          priority: string | null;
          resolved: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          title: string;
          content: string;
          category?: string | null;
          priority?: string | null;
          resolved?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          title?: string;
          content?: string;
          category?: string | null;
          priority?: string | null;
          resolved?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      question_comments: {
        Row: {
          id: string;
          question_id: string;
          user_id: string | null;
          content: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          question_id: string;
          user_id?: string | null;
          content: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          question_id?: string;
          user_id?: string | null;
          content?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "question_comments_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
        ];
      };
      votings: {
        Row: {
          id: string;
          title: string;
          description: string | null;
          event_id: string | null;
          is_open: boolean;
          voting_deadline: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          description?: string | null;
          event_id?: string | null;
          is_open?: boolean;
          voting_deadline?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          description?: string | null;
          event_id?: string | null;
          is_open?: boolean;
          voting_deadline?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      voting_options: {
        Row: {
          id: string;
          voting_id: string | null;
          option_text: string;
        };
        Insert: {
          id?: string;
          voting_id?: string | null;
          option_text: string;
        };
        Update: {
          id?: string;
          voting_id?: string | null;
          option_text?: string;
        };
        Relationships: [];
      };
      voting_votes: {
        Row: {
          id: string;
          voting_id: string | null;
          option_id: string | null;
          user_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          voting_id?: string | null;
          option_id?: string | null;
          user_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          voting_id?: string | null;
          option_id?: string | null;
          user_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      event_registrations: {
        Row: {
          id: string;
          event_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          user_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          user_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      event_comments: {
        Row: {
          id: string;
          event_id: string;
          user_id: string;
          body: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          user_id: string;
          body: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          user_id?: string;
          body?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      event_waitlist: {
        Row: {
          id: string;
          event_id: string;
          user_id: string;
          position: number;
          status: WaitlistStatus;
          joined_at: string;
          promoted_at: string | null;
        };
        Insert: {
          id?: string;
          event_id: string;
          user_id: string;
          position?: number;
          status?: WaitlistStatus;
          joined_at?: string;
          promoted_at?: string | null;
        };
        Update: {
          id?: string;
          event_id?: string;
          user_id?: string;
          position?: number;
          status?: WaitlistStatus;
          joined_at?: string;
          promoted_at?: string | null;
        };
        Relationships: [];
      };
      rehearsal_attendance: {
        Row: {
          id: string;
          event_id: string;
          user_id: string;
          session: RehearsalSession;
          attended: boolean;
          marked_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;   // default gen_random_uuid() in DB
          event_id: string;
          user_id: string;
          session: RehearsalSession;
          attended: boolean;
          marked_by?: string | null;
          created_at?: string;   // default now() in DB
          updated_at?: string;   // default now() in DB
        };
        Update: {
          id?: string;
          event_id?: string;
          user_id?: string;
          session?: RehearsalSession;
          attended?: boolean;
          marked_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      workgroup_attendance: {
        Row: {
          id: string;
          shift_id: string;
          user_id: string;
          workgroup: Workgroup;
          attended: boolean;
          hours_worked: number | null;
          barra_task: string | null;
          marked_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          shift_id: string;
          user_id: string;
          workgroup: Workgroup;
          attended: boolean;
          hours_worked?: number | null;
          barra_task?: string | null;
          marked_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          shift_id?: string;
          user_id?: string;
          workgroup?: Workgroup;
          attended?: boolean;
          hours_worked?: number | null;
          barra_task?: string | null;
          marked_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      instagram_posts: {
        Row: {
          id: number;
          post_id: string;
          caption: string | null;
          media_url: string;
          permalink: string;
          media_type: "image" | "video" | "carousel";
          timestamp: string;
          cached_at: string;
        };
        Insert: {
          id?: number;
          post_id: string;
          caption?: string | null;
          media_url: string;
          permalink: string;
          media_type?: "image" | "video" | "carousel";
          timestamp: string;
          cached_at?: string;
        };
        Update: {
          id?: number;
          post_id?: string;
          caption?: string | null;
          media_url?: string;
          permalink?: string;
          media_type?: "image" | "video" | "carousel";
          timestamp?: string;
          cached_at?: string;
        };
        Relationships: [];
      };
      instrument_assignments: {
        Row: {
          id: string;
          instrument_id: string;
          user_id: string;
          assigned_at: string;
          unassigned_at: string | null;
        };
        Insert: {
          id?: string;
          instrument_id: string;
          user_id: string;
          assigned_at?: string;   // default now() in DB
          unassigned_at?: string | null;
        };
        Update: {
          id?: string;
          instrument_id?: string;
          user_id?: string;
          assigned_at?: string;
          unassigned_at?: string | null;
        };
        Relationships: [];
      };
      instruments: {
        Row: {
          id: string;
          name: string;
          category: string | null;
          description: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          category?: string | null;
          description?: string | null;
          is_active?: boolean;   // default true in DB
          created_at?: string;   // default now() in DB
          updated_at?: string;   // default now() in DB
        };
        Update: {
          id?: string;
          name?: string;
          category?: string | null;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      email_aliases: {
        Row: {
          id: string;
          profile_id: string;
          alias_email: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          alias_email: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          profile_id?: string;
          alias_email?: string;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          message: string | null;
          type: NotificationType;
          is_read: boolean;
          link: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          message?: string | null;
          type: NotificationType;
          is_read?: boolean;   // default false in DB
          link?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          message?: string | null;
          type?: NotificationType;
          is_read?: boolean;
          link?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      notification_preferences: {
        Row: {
          user_id: string;
          types: NotificationType[];   // '{}' = receive every type
        };
        Insert: {
          user_id: string;
          types?: NotificationType[];   // default '{}' in DB
        };
        Update: {
          user_id?: string;
          types?: NotificationType[];
        };
        Relationships: [];
      };
      settings: {
        Row: {
          key: string;
          value: string;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          key: string;
          value: string;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: {
          key?: string;
          value?: string;
          updated_by?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          user_id: string | null;
          action: string;
          entity_type: string;
          entity_id: string | null;
          details: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          action: string;
          entity_type: string;
          entity_id?: string | null;
          details?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          action?: string;
          entity_type?: string;
          entity_id?: string | null;
          details?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      role_permissions: {
        Row: {
          role: string;
          permission: string;
        };
        Insert: {
          role: string;
          permission: string;
        };
        Update: {
          role?: string;
          permission?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      current_user_role: {
        Args: Record<string, never>;
        Returns: string;
      };
      is_workgroup_lead: {
        Args: { check_workgroup: string };
        Returns: boolean;
      };
      is_component_lead: {
        Args: { check_component: string };
        Returns: boolean;
      };
      current_user_workgroup: {
        Args: Record<string, never>;
        Returns: string;
      };
      current_user_component: {
        Args: Record<string, never>;
        Returns: string;
      };
      is_super_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      is_active_member: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      current_user_status: {
        Args: Record<string, never>;
        Returns: string;
      };
      create_emailless_profile: {
        Args: {
          p_id: string;
          p_first_name: string;
          p_last_name: string;
          p_username: string;
          p_component_type: string;
          p_alias_email: string;
          p_created_by: string;
          p_workgroup?: string | null;
        };
        Returns: void;
      };
      get_voting_results: {
        Args: { p_voting_id: string };
        Returns: Array<{
          option_id: string;
          option_text: string;
          votes: number;
          total_votes: number;
          percentage: number;
        }>;
      };
      get_user_emails: {
        Args: { p_user_ids: string[] };
        Returns: Array<{
          id: string;
          email: string | null;
        }>;
      };
    };
    Enums: {
      workgroup: Workgroup;
      event_type: EventType;
      user_status: UserStatus;
      auth_method: AuthMethod;
      waitlist_status: WaitlistStatus;
      audience_type: AudienceType;
    };
    CompositeTypes: Record<string, never>;
  };
}
