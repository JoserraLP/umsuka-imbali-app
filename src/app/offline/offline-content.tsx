"use client";

import Image from "next/image";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Interactive shell for the offline page: retry button plus an auto-reload
 * that fires as soon as the browser reports the connection is back.
 */
export function OfflineContent() {
  useEffect(() => {
    const handleOnline = () => {
      window.location.reload();
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  const handleRetry = () => {
    window.location.reload();
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <Image
        src="/icons/icon-512x512.png"
        alt="Umsuka Imbali"
        width={112}
        height={112}
        unoptimized
        priority
        className="h-28 w-28 rounded-2xl"
      />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Sin conexión</h1>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          No hay conexión a internet en este momento. Comprueba tu señal y
          vuelve a intentarlo; la app se recargará automáticamente al
          recuperar la conexión.
        </p>
      </div>
      <Button onClick={handleRetry}>Reintentar</Button>
    </main>
  );
}