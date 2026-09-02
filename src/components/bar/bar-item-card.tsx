import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { BarItem } from "@/lib/bar/menus";

export function BarItemCard({ item }: { item: BarItem }) {
  return (
    <Card className={item.isAvailable ? "" : "opacity-60"}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span>{item.name}</span>
          <span className="text-sm font-mono">{item.price.toFixed(2)} €</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {item.description && <p className="text-sm text-muted-foreground">{item.description}</p>}
        <div className="flex gap-1.5">
          <Badge variant="secondary">{item.category}</Badge>
          {!item.isAvailable && <Badge variant="outline">No disponible</Badge>}
        </div>
      </CardContent>
    </Card>
  );
}
