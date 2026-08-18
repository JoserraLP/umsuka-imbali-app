import { Bell, Calendar, Megaphone, UserCheck, Users, Vote, type LucideIcon } from "lucide-react";
import type { NotificationType } from "@/types/database.types";

/**
 * Icon and accent color per notification type (Sprint 20). Shared by the
 * notification bell, the dashboard widget and the /notifications list so
 * the mapping lives in exactly one place. Unknown types fail back to the
 * bell icon (defensive; the DB CHECK whitelists the 5 known types).
 */
export const NOTIFICATION_TYPE_ICONS: Record<NotificationType, LucideIcon> = {
  event_created: Calendar,
  news_created: Megaphone,
  voting_created: Vote,
  shift_assigned: Users,
  profile_approved: UserCheck,
};

export const NOTIFICATION_TYPE_COLORS: Record<NotificationType, string> = {
  event_created: "text-blue-500",
  news_created: "text-purple-500",
  voting_created: "text-indigo-500",
  shift_assigned: "text-green-500",
  profile_approved: "text-amber-500",
};

export function NotificationTypeIcon({
  type,
  className,
}: {
  type: NotificationType;
  className?: string;
}) {
  const Icon = NOTIFICATION_TYPE_ICONS[type] ?? Bell;
  return <Icon className={className} aria-hidden="true" />;
}