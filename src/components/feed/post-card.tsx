import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PostCardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}

export function PostCard({ children, className, onClick }: PostCardProps) {
  return (
    <div
      className={cn(
        "border-b border-border px-4 py-3 transition-colors last:border-b-0",
        onClick && "cursor-pointer hover:bg-accent/50",
        className,
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") onClick(); } : undefined}
    >
      {children}
    </div>
  );
}

interface PostCardHeaderProps {
  avatar: ReactNode;
  name: string;
  subtitle?: string;
  timestamp?: string;
  action?: ReactNode;
}

export function PostCardHeader({ avatar, name, subtitle, timestamp, action }: PostCardHeaderProps) {
  return (
    <div className="flex items-start gap-3">
      {avatar}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{name}</span>
          {subtitle && (
            <span className="truncate text-sm text-muted-foreground">{subtitle}</span>
          )}
          {timestamp && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="shrink-0 text-sm text-muted-foreground">{timestamp}</span>
            </>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

interface PostCardContentProps {
  children: ReactNode;
  className?: string;
}

export function PostCardContent({ children, className }: PostCardContentProps) {
  return <div className={cn("mt-2 text-sm leading-relaxed", className)}>{children}</div>;
}

interface PostCardActionsProps {
  children: ReactNode;
  className?: string;
}

export function PostCardActions({ children, className }: PostCardActionsProps) {
  return (
    <div className={cn("mt-3 flex items-center gap-6", className)}>
      {children}
    </div>
  );
}
