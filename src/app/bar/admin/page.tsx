import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentProfile } from "@/lib/auth/session";
import { canManageBar } from "@/lib/bar/authorization";
import { getAllBarItems } from "@/lib/bar/menus";
import { getShoppingLists, getShoppingListWithItems } from "@/lib/bar/shopping";
import { BarItemsTable } from "@/components/bar/admin/bar-items-table";
import { BarItemFormDialog } from "@/components/bar/admin/bar-item-form-dialog";
import { ShoppingLists } from "@/components/bar/admin/shopping-lists";

export const metadata = { title: "Gestión Barra" };

interface PageProps {
  searchParams: Promise<{ listId?: string }>;
}

export default async function BarAdminPage({ searchParams }: PageProps) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/auth/login");
  if (!canManageBar(profile)) redirect("/bar");

  const params = await searchParams;
  const [items, lists] = await Promise.all([getAllBarItems(), getShoppingLists()]);
  const detail = params.listId ? await getShoppingListWithItems(params.listId) : null;

  const barItemsForSelect = items.map((i) => ({ id: i.id, name: i.name, stock_quantity: i.stockQuantity }));

  return (
    <AppShell profile={profile}>
      <div className="space-y-4">
        <div className="border-b pb-4">
          <h1 className="text-xl font-bold">Gestión Barra</h1>
          <p className="text-sm text-muted-foreground">Precios, stock, visibilidad y lista de la compra. Solo responsable de barra y super_admin.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Precios e Inventario</CardTitle>
            <CardDescription>Tabla por categorías con edición inline y toggles.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <BarItemFormDialog />
            <BarItemsTable items={items} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lista de la Compra</CardTitle>
            <CardDescription>Checklist privada: crea listas, añade items de inventario o libres, marca comprados.</CardDescription>
          </CardHeader>
          <CardContent>
            <ShoppingLists lists={lists} detail={detail} barItems={barItemsForSelect} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
