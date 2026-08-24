import { redirect } from "next/navigation";

/**
 * The old history page moved to /profile/stats (Sprint 28); keep the
 * route alive so bookmarks and stale links keep working.
 */
export default function HistoryRedirect() {
  redirect("/profile/stats");
}
