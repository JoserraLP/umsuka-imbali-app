import Image from "next/image";
import { cn } from "@/lib/utils";

interface AvatarProps {
  src?: string | null;
  alt?: string;
  fallback?: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const sizeClasses = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
  xl: "h-16 w-16 text-lg",
};

export function Avatar({ src, alt = "", fallback, size = "md", className }: AvatarProps) {
  if (src) {
    return (
      <Image
        src={src}
        alt={alt || fallback || "Avatar"}
        width={64}
        height={64}
        className={cn("rounded-full object-cover ring-2 ring-background", sizeClasses[size], className)}
      />
    );
  }

  const initial = (fallback || "?").charAt(0).toUpperCase();

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground ring-2 ring-background",
        sizeClasses[size],
        className,
      )}
    >
      {initial}
    </div>
  );
}
