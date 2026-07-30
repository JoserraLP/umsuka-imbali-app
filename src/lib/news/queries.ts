import { createClient } from "@/lib/supabase/server";

// ── Types ─────────────────────────────────────────────

export interface NewsItem {
  id: string;
  title: string;
  content: string;
  imageUrl: string | null;
  published: boolean;
  pinned: boolean;
  createdBy: string;
  createdAt: string;
  authorFirstName: string;
  authorLastName: string;
}

// ── Helpers ───────────────────────────────────────────

/**
 * Given a list of user IDs, fetches their profile names and returns
 * a Map<userId, { first_name, last_name }>.
 */
async function fetchProfileNames(userIds: string[]): Promise<Map<string, { first_name: string; last_name: string }>> {
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
    map.set(profile.id, { first_name: profile.first_name, last_name: profile.last_name });
  }
  return map;
}

interface RawNewsRow {
  id: string;
  title: string;
  content: string;
  image_url: string | null;
  published: boolean;
  pinned: boolean;
  created_by: string | null;
  created_at: string;
}

function enrichWithProfiles(
  rows: RawNewsRow[],
  profilesMap: Map<string, { first_name: string; last_name: string }>,
): NewsItem[] {
  return rows.map((item) => {
    const profile = item.created_by ? profilesMap.get(item.created_by) : undefined;
    return {
      id: item.id,
      title: item.title,
      content: item.content,
      imageUrl: item.image_url,
      published: item.published,
      pinned: item.pinned,
      createdBy: item.created_by ?? "",
      createdAt: item.created_at,
      authorFirstName: profile?.first_name ?? "Miembro",
      authorLastName: profile?.last_name ?? "",
    };
  });
}

// ── Queries ───────────────────────────────────────────

/**
 * Returns a feed of news items, ordered by pinned status (pinned first)
 * and then by creation date descending.
 *
 * @param includeUnpublished - When truthy, returns all news including drafts.
 *                             When false (default), returns only published news.
 */
export async function getNewsFeed(includeUnpublished = false): Promise<NewsItem[]> {
  const supabase = await createClient();

  let query = supabase
    .from("news")
    .select("id, title, content, image_url, published, pinned, created_by, created_at")
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });

  if (!includeUnpublished) {
    query = query.eq("published", true);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Error al obtener noticias: ${error.message}`);
  }

  const rows = (data ?? []) as RawNewsRow[];
  const userIds = rows.map((r) => r.created_by).filter(Boolean) as string[];
  const profilesMap = await fetchProfileNames(userIds);

  return enrichWithProfiles(rows, profilesMap);
}

/**
 * Returns a single news item by ID, including author profile data.
 * Returns null when the item doesn't exist.
 *
 * @param includeUnpublished - When truthy, returns the item even if unpublished.
 *                             When false (default), only returns published items.
 */
export async function getNewsById(id: string, includeUnpublished = false): Promise<NewsItem | null> {
  const supabase = await createClient();

  let query = supabase
    .from("news")
    .select("id, title, content, image_url, published, pinned, created_by, created_at")
    .eq("id", id);

  if (!includeUnpublished) {
    query = query.eq("published", true);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(`Error al obtener noticia: ${error.message}`);
  }

  if (!data) return null;

  const row = data as RawNewsRow;
  const profilesMap = row.created_by ? await fetchProfileNames([row.created_by]) : new Map();
  const enriched = enrichWithProfiles([row], profilesMap);
  return enriched[0] ?? null;
}

/**
 * Returns only pinned published news items.
 */
export async function getPinnedNews(): Promise<NewsItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("news")
    .select("id, title, content, image_url, published, pinned, created_by, created_at")
    .eq("published", true)
    .eq("pinned", true)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Error al obtener noticias destacadas: ${error.message}`);
  }

  const rows = (data ?? []) as RawNewsRow[];
  const userIds = rows.map((r) => r.created_by).filter(Boolean) as string[];
  const profilesMap = await fetchProfileNames(userIds);

  return enrichWithProfiles(rows, profilesMap);
}
