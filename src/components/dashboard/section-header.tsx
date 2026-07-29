import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface SectionHeaderProps {
  title: string;
  icon?: LucideIcon;
  action?: ReactNode;
}

/**
 * Reusable section header for dashboard widgets.
 * Displays a title with an optional icon and an optional action element
 * (e.g., "Ver todas" link or button).
 */
export function SectionHeader({ title, icon: Icon, action }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-3">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
