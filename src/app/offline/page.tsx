import type { Metadata } from "next";
import { OfflineContent } from "./offline-content";

/**
 * Offline fallback page. Built statically (no auth, no data) and served by
 * the service worker via `navigateFallback` when a navigation fails offline.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Sin conexión",
};

export default function OfflinePage() {
  return <OfflineContent />;
}