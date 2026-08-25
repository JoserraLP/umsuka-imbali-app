"use client";

import { Button } from "@/components/ui/button";

interface ExportPaymentsButtonProps {
  eligible: { userId: string; displayName?: string }[];
  pending: { userId: string; displayName?: string }[];
}

export function ExportPaymentsButton({ eligible, pending }: ExportPaymentsButtonProps) {
  function handleExport() {
    const header = "estado,nombre,user_id\n";
    const rows = [
      ...eligible.map((e) => `elegible,"${(e.displayName ?? "").replace(/"/g, '""')}",${e.userId}`),
      ...pending.map((p) => `pendiente,"${(p.displayName ?? "").replace(/"/g, '""')}",${p.userId}`),
    ].join("\n");
    const csv = header + rows;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reparto-material-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handlePrint() {
    window.print();
  }

  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={handleExport}>
        Exportar CSV
      </Button>
      <Button variant="outline" size="sm" onClick={handlePrint}>
        Imprimir
      </Button>
    </div>
  );
}
