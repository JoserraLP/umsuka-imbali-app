/**
 * Hand-authored to match supabase/migrations exactly for the foundation
 * phase. Once business modules are implemented, regenerate with:
 *   npm run supabase:gen-types
 * and this file will be overwritten with the CLI-generated equivalent.
 */
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type ComponentType = "music" | "dance" | "member";
export type EventType = "general" | "meeting" | "carnival";
export type AppRole =
  | "super_admin"
  | "admin"
  | "board_member"
  | "event_manager"
  | "member"
  | "guest";

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
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          first_name: string;
          last_name: string;
          birth_date?: string | null;
          component_type?: ComponentType;
          role?: string;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          first_name?: string;
          last_name?: string;
          birth_date?: string | null;
          component_type?: ComponentType;
          role?: string;
          is_active?: boolean;
          created_at?: string;
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
          created_by?: string | null;
          created_at?: string;
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
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id?: string | null;
          name: string;
          start_time: string;
          end_time: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string | null;
          name?: string;
          start_time?: string;
          end_time?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      shift_assignments: {
        Row: {
          id: string;
          shift_id: string | null;
          user_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          shift_id?: string | null;
          user_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          shift_id?: string | null;
          user_id?: string | null;
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
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          content: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          content?: string;
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
          resolved: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          title: string;
          content: string;
          resolved?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          title?: string;
          content?: string;
          resolved?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      votings: {
        Row: {
          id: string;
          title: string;
          description: string | null;
          event_id: string | null;
          is_open: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          description?: string | null;
          event_id?: string | null;
          is_open?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          description?: string | null;
          event_id?: string | null;
          is_open?: boolean;
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
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
