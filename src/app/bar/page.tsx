import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getCurrentProfile } from "@/lib/auth/session";
import { canManageBar } from "@/lib/bar/authorization";
import { getVisibleBarItems } from "@/lib/bar/menus";
import type { BarCategory } from "@/lib/bar/menus";
import { BarCategorySection } from "@/components/bar/bar-category-section";
import { BarFilters } from "@/components/bar/bar-filters";
import { Beer } from "lucide-react";

export const metadata: Metadata = { title: "Barra — Menús y Precios" };

interface PageProps {
  searchParams: Promise<{ q?: string; category?: string; available?: string }>;
}

export default async function BarPage({ searchParams }: PageProps) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/auth/login");

  const params = await searchParams;
  const q = params.q?.trim() || undefined;
  const category = (params.category as BarCategory | undefined) || undefined;
  const isAvailable = params.available === "true" ? true : params.available === "false" ? false : undefined;

  const canManage = canManageBar(profile);

  const items = await getVisibleBarItems({ q, category, isAvailable });

  const menus = items.filter((i) => i.category === "menu");
  const foods = items.filter((i) => i.category === "food");
  const drinks = items.filter((i) => i.category === "drink");

  return (
    <AppShell profile={profile}>
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold">
              <Beer className="h-6 w-6" /> Barra — Menús y Precios
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Consulta los precios por categorías.</p>
          </div>
          {canManage && (
            <Link href="/bar/admin">
              <Button>Gestionar</Button>
            </Link>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filtros</CardTitle>
            <CardDescription>Busca por nombre y filtra por categoría.</CardDescription>
          </CardHeader>
          <CardContent>
            <form method="GET" className="space-y-2">
              <BarFilters q={q} category={category} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="available" value="true" defaultChecked={isAvailable === true} />
                Solo disponibles
              </label>
            </form>
          </CardContent>
        </Card>

        {items.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">No hay productos disponibles.</CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <BarCategorySection category="menu" items={menus} />
            <BarCategorySection category="food" items={foods} />
            <BarCategorySection category="drink" items={drinks} />
          </div>
        )}
      </div>
    </AppShell>
  );
}
