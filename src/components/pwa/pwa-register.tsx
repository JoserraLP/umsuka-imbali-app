"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/** localStorage key used to remember that the user declined the install banner. */
const DISMISSED_KEY = "umsuka.pwa.install.dismissed";

/**
 * `beforeinstallprompt` is a Chromium-only event shipped outside the DOM lib
 * types (and even outside the spec for browsers without installability).
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/** True when the app is already running installed (Android/PWA or iOS Safari). */
function isInstalledPwa(): boolean {
  if (typeof window === "undefined") return false;
  const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches;
  const iosStandalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || iosStandalone;
}

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

function persistDismissed(): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, "true");
  } catch {
    // Storage unavailable (private mode, quota): the banner will show again.
  }
}

/**
 * Install banner for browsers that fire `beforeinstallprompt`. Renders
 * nothing when the app is already installed, the user already declined, or
 * the browser cannot install the app.
 */
export function PwaRegister() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    if (isInstalledPwa() || readDismissed()) return;

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setShowBanner(true);
    };
    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setShowBanner(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDeferredPrompt(null);
      setShowBanner(false);
    }
  };

  const handleDismiss = () => {
    persistDismissed();
    setDeferredPrompt(null);
    setShowBanner(false);
  };

  if (!showBanner || !deferredPrompt) return null;

  return (
    <div className="fixed inset-x-0 bottom-16 z-40 mx-4 max-w-md">
      <div className="flex flex-col gap-3 rounded-xl border bg-background p-4 shadow-lg">
        <p className="text-sm font-medium">Instala la app de Umsuka Imbali</p>
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={handleInstall}>
            Instalar
          </Button>
          <Button size="sm" variant="ghost" onClick={handleDismiss}>
            No, gracias
          </Button>
        </div>
      </div>
    </div>
  );
}