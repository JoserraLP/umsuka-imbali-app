import { createClient } from "@/lib/supabase/server";

// ── Types ─────────────────────────────────────────────

export interface QuestionItem {
  id: string;
  title: string;
  content: string;
  category: string | null;
  priority: string | null;
  resolved: boolean;
  createdBy: string;
  createdAt: string;
  authorFirstName: string;
  authorLastName: string;
}

export interface QuestionComment {
  id: string;
  questionId: string;
  /**
   * null when the author's account was permanently deleted (migration
   * 0054 sets question_comments.user_id to null on auth.users delete).
   */
  userId: string | null;
  content: string;
  createdAt: string;
  authorFirstName: string;
  authorLastName: string;
}

export interface QuestionsFilters {
  status?: "open" | "resolved" | "all";
  category?: string;
  mine?: boolean;
  userId?: string;
}

// ── Helpers ───────────────────────────────────────────

/**
 * Given a list of user IDs, fetches their profile names and returns
 * a Map<userId, { first_name, last_name }>.
 */
async function fetchProfileNames(
  userIds: string[],
): Promise<Map<string, { first_name: string; last_name: string }>> {
  const uniqueIds = [...new Set(userIds)].filter(Boolean);
  if (uniqueIds.length === 0) return new Map();

  const supabase = await createClient();
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name")
    .in("id", uniqueIds);

  if (error) {
    console.error("Error fetching profile names:", error.message);
    return new Map();
  }

  const map = new Map<string, { first_name: string; last_name: string }>();
  for (const profile of profiles ?? []) {
    map.set(profile.id, {
      first_name: profile.first_name,
      last_name: profile.last_name,
    });
  }
  return map;
}

interface RawQuestionRow {
  id: string;
  title: string;
  content: string;
  category: string | null;
  priority: string | null;
  resolved: boolean;
  user_id: string | null;
  created_at: string;
}

function enrichWithProfiles(
  rows: RawQuestionRow[],
  profilesMap: Map<string, { first_name: string; last_name: string }>,
): QuestionItem[] {
  return rows.map((item) => {
    const profile = item.user_id
      ? profilesMap.get(item.user_id)
      : undefined;
    return {
      id: item.id,
      title: item.title,
      content: item.content,
      category: item.category,
      priority: item.priority,
      resolved: item.resolved,
      createdBy: item.user_id ?? "",
      createdAt: item.created_at,
      authorFirstName: profile?.first_name ?? "Miembro",
      authorLastName: profile?.last_name ?? "",
    };
  });
}

// ── Queries ───────────────────────────────────────────

/**
 * Returns a list of questions with optional filters.
 *
 * Supported filters:
 * - `status`: "open" (resolved=false), "resolved" (resolved=true), "all" (default)
 * - `category`: filter by category value
 * - `mine`: when true, filter by userId
 * - `userId`: the current user's ID (required when mine=true)
 */
export async function getQuestions(
  filters: QuestionsFilters = {},
): Promise<QuestionItem[]> {
  const supabase = await createClient();

  let query = supabase
    .from("questions")
    .select(
      "id, title, content, category, priority, resolved, user_id, created_at",
    )
    .order("created_at", { ascending: false });

  // Status filter
  if (filters.status === "open") {
    query = query.eq("resolved", false);
  } else if (filters.status === "resolved") {
    query = query.eq("resolved", true);
  }

  // Category filter
  if (filters.category && filters.category !== "todas") {
    query = query.eq("category", filters.category);
  }

  // Mine filter
  if (filters.mine && filters.userId) {
    query = query.eq("user_id", filters.userId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Error al obtener preguntas: ${error.message}`);
  }

  const rows = (data ?? []) as RawQuestionRow[];
  const userIds = rows.map((r) => r.user_id).filter(Boolean) as string[];
  const profilesMap = await fetchProfileNames(userIds);

  return enrichWithProfiles(rows, profilesMap);
}

/**
 * Returns a single question by ID, including author profile data.
 * Returns null when the item doesn't exist.
 */
export async function getQuestionById(
  id: string,
): Promise<QuestionItem | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("questions")
    .select(
      "id, title, content, category, priority, resolved, user_id, created_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al obtener pregunta: ${error.message}`);
  }

  if (!data) return null;

  const row = data as RawQuestionRow;
  const profilesMap = row.user_id
    ? await fetchProfileNames([row.user_id])
    : new Map();
  const enriched = enrichWithProfiles([row], profilesMap);
  return enriched[0] ?? null;
}

/**
 * Returns all comments for a question, ordered by creation date ascending.
 */
export async function getQuestionComments(
  questionId: string,
): Promise<QuestionComment[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("question_comments")
    .select("id, question_id, user_id, content, created_at")
    .eq("question_id", questionId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(
      `Error al obtener comentarios: ${error.message}`,
    );
  }

  const rows = data ?? [];
  const userIds = rows.map((r) => r.user_id).filter(Boolean) as string[];
  const profilesMap = await fetchProfileNames(userIds);

  return rows.map((item) => {
    const profile = item.user_id
      ? profilesMap.get(item.user_id)
      : undefined;
    return {
      id: item.id,
      questionId: item.question_id,
      userId: item.user_id,
      content: item.content,
      createdAt: item.created_at,
      authorFirstName: profile?.first_name ?? "Miembro",
      authorLastName: profile?.last_name ?? "",
    };
  });
}
