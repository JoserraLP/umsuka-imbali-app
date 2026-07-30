"use client";

import { useState } from "react";
import { GoogleSignInButton } from "@/components/layout/google-signin-button";
import { UsernameLoginForm } from "@/app/auth/login/username-login-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface LoginTabsProps {
  redirectTo?: string;
}

type TabId = "google" | "username";

export function LoginTabs({ redirectTo }: LoginTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>("google");

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="items-center text-center">
        <CardTitle className="text-2xl">Umsuka Imbali</CardTitle>
        <CardDescription>
          {activeTab === "google"
            ? "Inicia sesión con tu cuenta de Google de la asociación."
            : "Inicia sesión con tu usuario y contraseña."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Tab switcher */}
        <div className="flex rounded-md border border-border p-0.5" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "google"}
            onClick={() => setActiveTab("google")}
            className={`flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === "google"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Google
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "username"}
            onClick={() => setActiveTab("username")}
            className={`flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === "username"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Usuario
          </button>
        </div>

        {activeTab === "google" ? (
          <GoogleSignInButton redirectTo={redirectTo} />
        ) : (
          <UsernameLoginForm redirectTo={redirectTo} />
        )}
      </CardContent>
    </Card>
  );
}
