import Image from "next/image";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InstagramPost } from "@/lib/social/instagram";

interface InstagramPostCardProps {
  post: InstagramPost;
  className?: string;
}

/**
 * A card that displays a single Instagram post thumbnail.
 * On hover, shows a dark overlay with caption preview.
 * Clicking opens the Instagram post in a new tab.
 */
export function InstagramPostCard({ post, className }: InstagramPostCardProps) {
  const isVideo = post.mediaType === "video";

  return (
    <Link
      href={post.permalink}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group relative block overflow-hidden rounded-xl bg-muted",
        "aspect-square",
        "transition-shadow duration-200 hover:shadow-lg",
        className,
      )}
      aria-label={post.caption ? `Ver publicación: ${post.caption.slice(0, 80)}` : "Ver publicación de Instagram"}
    >
      <Image
        src={post.mediaUrl}
        alt={post.caption ?? "Publicación de Instagram"}
        fill
        className="object-cover transition-transform duration-300 group-hover:scale-105"
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
      />

      {/* Video indicator */}
      {isVideo && (
        <div className="absolute left-2 top-2 rounded-md bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
          VIDEO
        </div>
      )}

      {/* Hover overlay */}
      <div className="absolute inset-0 flex items-end bg-black/0 p-3 transition-colors duration-200 group-hover:bg-black/40">
        <div className="flex w-full items-center justify-between">
          {post.caption && (
            <p className="line-clamp-2 text-sm text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              {post.caption}
            </p>
          )}
          <ExternalLink className="ml-2 h-4 w-4 shrink-0 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
        </div>
      </div>
    </Link>
  );
}
