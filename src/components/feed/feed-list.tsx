import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FeedListProps {
  children: ReactNode;
  className?: string;
  emptyMessage?: string;
}

export function FeedList({ children, className, emptyMessage }: FeedListProps) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : !!children;

  if (!hasChildren && emptyMessage) {
    return (
      <div className={cn("flex items-center justify-center py-16 text-sm text-muted-foreground", className)}>
        {emptyMessage}
      </div>
    );
  }

  return <div className={cn("divide-y divide-border rounded-xl border bg-card", className)}>{children}</div>;
}
