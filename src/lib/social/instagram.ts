import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env.server";

// ── Types ───────────────────────────────────────────────

export interface InstagramPost {
  id: number;
  postId: string;
  caption: string | null;
  mediaUrl: string;
  permalink: string;
  mediaType: "image" | "video" | "carousel";
  timestamp: string;
}

export interface InstagramApiResponse {
  data?: Array<{
    id: string;
    caption?: string;
    media_url?: string;
    permalink?: string;
    media_type?: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
    timestamp?: string;
  }>;
  error?: { message: string };
}

// ── Mock Data ──────────────────────────────────────────

const MOCK_POSTS: InstagramPost[] = [
  {
    id: 1,
    postId: "mock_001",
    caption: "¡Ensayo general de carnaval! 🎭 La comparsa Umsuka Imbali al completo preparando el repertorio para este fin de semana.",
    mediaUrl: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&h=600&fit=crop",
    permalink: "https://www.instagram.com/umsuka",
    mediaType: "image",
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 2,
    postId: "mock_002",
    caption: "Nuevos trajes para la batucada. ¡Gracias al equipo de telas por su dedicación! ✨",
    mediaUrl: "https://images.unsplash.com/photo-1578594311157-5a5ed16b2f76?w=600&h=600&fit=crop",
    permalink: "https://www.instagram.com/umsuka",
    mediaType: "image",
    timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 3,
    postId: "mock_003",
    caption: "Resumen del taller de percusión brasileña. ¡Gran energía y muchas ganas de aprender! 🥁",
    mediaUrl: "https://images.unsplash.com/photo-1519892300165-cb5542fb47c7?w=600&h=600&fit=crop",
    permalink: "https://www.instagram.com/umsuka",
    mediaType: "video",
    timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 4,
    postId: "mock_004",
    caption: "Preparando el estandarte para la próxima actuación. El arte y la tradición se encuentran. 🎨",
    mediaUrl: "https://images.unsplash.com/photo-1551024601-bec78aea704b?w=600&h=600&fit=crop",
    permalink: "https://www.instagram.com/umsuka",
    mediaType: "image",
    timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 5,
    postId: "mock_005",
    caption: "Noche de samba en la sede. ¡Cada viernes es una fiesta! 🎵",
    mediaUrl: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=600&h=600&fit=crop",
    permalink: "https://www.instagram.com/umsuka",
    mediaType: "image",
    timestamp: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 6,
    postId: "mock_006",
    caption: "Asamblea general extraordinaria. Puntos importantes a tratar: planificación del próximo evento y renovación de cargos. 📋",
    mediaUrl: "https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=600&h=600&fit=crop",
    permalink: "https://www.instagram.com/umsuka",
    mediaType: "image",
    timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 7,
    postId: "mock_007",
    caption: "El grupo de barra ofreciendo lo mejor de sí en la última actuación. ¡Orgullosos de nuestro equipo! 🥤",
    mediaUrl: "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=600&h=600&fit=crop",
    permalink: "https://www.instagram.com/umsuka",
    mediaType: "image",
    timestamp: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 8,
    postId: "mock_008",
    caption: "Detalle del bordado del estandarte. Semanas de trabajo minucioso. 🧵",
    mediaUrl: "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=600&h=600&fit=crop",
    permalink: "https://www.instagram.com/umsuka",
    mediaType: "image",
    timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 9,
    postId: "mock_009",
    caption: "¡Gracias a todos por hacer posible este evento! La unión hace la fuerza. 🙌",
    mediaUrl: "https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?w=600&h=600&fit=crop",
    permalink: "https://www.instagram.com/umsuka",
    mediaType: "image",
    timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

// ── Helpers ─────────────────────────────────────────────

function mapMediaType(raw: string | undefined): "image" | "video" | "carousel" {
  switch (raw) {
    case "VIDEO":
      return "video";
    case "CAROUSEL_ALBUM":
      return "carousel";
    default:
      return "image";
  }
}

interface InstagramPostRow {
  id: number;
  post_id: string;
  caption: string | null;
  media_url: string;
  permalink: string;
  media_type: "image" | "video" | "carousel";
  timestamp: string;
}

function mapRowToPost(row: InstagramPostRow): InstagramPost {
  return {
    id: row.id,
    postId: row.post_id,
    caption: row.caption,
    mediaUrl: row.media_url,
    permalink: row.permalink,
    mediaType: row.media_type,
    timestamp: row.timestamp,
  };
}

// ── Instagram API Fetch ───────────────────────────────

const INSTAGRAM_API_BASE = "https://graph.instagram.com/v12.0";

/**
 * Fetches the latest posts from the Instagram Basic Display API and
 * upserts them into the `umsuka.instagram_posts` cache table.
 *
 * Uses the admin client to bypass RLS for writes.
 * In development/test environments where no real token is configured,
 * this function returns false and falls back to mock data.
 */
export async function fetchAndCacheInstagramPosts(): Promise<boolean> {
  const token = serverEnv.INSTAGRAM_ACCESS_TOKEN;
  const userId = serverEnv.INSTAGRAM_USER_ID;

  if (!token || !userId) {
    // No real credentials configured — will use mock data instead
    return false;
  }

  try {
    const url = `${INSTAGRAM_API_BASE}/${userId}/media?fields=id,caption,media_url,permalink,media_type,timestamp&access_token=${token}&limit=9`;
    const response = await fetch(url, { next: { revalidate: 3600 } });

    if (!response.ok) {
      console.warn("[Instagram API] HTTP error:", response.status, response.statusText);
      return false;
    }

    const result: InstagramApiResponse = await response.json();

    if (result.error) {
      console.warn("[Instagram API] API error:", result.error.message);
      return false;
    }

    if (!result.data || result.data.length === 0) {
      return false;
    }

    const supabase = createAdminClient();
    const posts = result.data.map((post) => ({
      post_id: post.id,
      caption: post.caption ?? null,
      media_url: post.media_url ?? "",
      permalink: post.permalink ?? "",
      media_type: mapMediaType(post.media_type),
      timestamp: post.timestamp ?? new Date().toISOString(),
    }));

    // Upsert each post (insert or update by post_id)
    for (const post of posts) {
      const { error } = await supabase.from("instagram_posts").upsert(post, {
        onConflict: "post_id",
        ignoreDuplicates: false,
      });

      if (error) {
        console.warn("[Instagram API] DB upsert error:", error.message);
      }
    }

    return true;
  } catch (err) {
    console.warn("[Instagram API] Fetch error:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

// ── Read Cached Posts ─────────────────────────────────

/**
 * Reads cached Instagram posts from the database, ordered by timestamp
 * descending. Returns up to `limit` posts (default 9).
 *
 * If the cache is empty (no real credentials, first deploy, etc.), falls
 * back to mock data for development purposes.
 */
export async function getCachedInstagramPosts(limit = 9): Promise<InstagramPost[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("instagram_posts")
    .select("id, post_id, caption, media_url, permalink, media_type, timestamp")
    .order("timestamp", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn("[Instagram] DB read error:", error.message);
    // Fall back to mock data in case of DB issues
    return MOCK_POSTS.slice(0, limit);
  }

  if (!data || data.length === 0) {
    // Cache is empty — use mock data for development
    return MOCK_POSTS.slice(0, limit);
  }

  return data.map(mapRowToPost);
}

/**
 * Public convenience function that returns Instagram posts.
 * In production with a configured cache, reads from the DB.
 * Falls back to mock data when no cached posts exist.
 */
export async function getInstagramPosts(limit = 9): Promise<InstagramPost[]> {
  return getCachedInstagramPosts(limit);
}

/**
 * Returns mock posts for development/testing purposes.
 */
export function getMockInstagramPosts(limit = 9): InstagramPost[] {
  return MOCK_POSTS.slice(0, limit);
}
