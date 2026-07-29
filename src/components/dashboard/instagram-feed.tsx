import { Instagram } from "lucide-react";
import { getInstagramPosts } from "@/lib/social/instagram";
import { SectionHeader } from "@/components/dashboard/section-header";
import { InstagramPostCard } from "@/components/dashboard/instagram-post-card";

/**
 * Server component that fetches cached Instagram posts and renders
 * them in a responsive grid layout.
 *
 * Falls back to mock data when no cached posts exist.
 */
export async function InstagramFeed() {
  const posts = await getInstagramPosts(9);

  return (
    <section>
      <SectionHeader
        title="Instagram"
        icon={Instagram}
      />

      {posts.length === 0 ? (
        <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center">
          <Instagram className="mb-3 h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            No hay publicaciones de Instagram disponibles.
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Vuelve más tarde o sigue a @umsuka en Instagram.
          </p>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <InstagramPostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </section>
  );
}
