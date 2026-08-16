"use client";

import { Card, CardHeader, CardTitle, CardContent, Button } from "@organator/ui";

export function EnvironmentsCard({ tenantId }: { tenantId: string }) {
  return (
    <Card className="bg-neutral-900 border-neutral-800 text-xs text-neutral-200 mt-6">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold">Ambientes da Organização (Staging & Production)</CardTitle>
        <Button size="sm" variant="outline">Promover Staging -&gt; Produção</Button>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between border-b border-neutral-800 pb-2 mb-2">
          <span>Production</span>
          <span className="font-mono text-green-400 text-xs">Ativo</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Staging</span>
          <span className="font-mono text-amber-400 text-xs">Sandbox</span>
        </div>
      </CardContent>
    </Card>
  );
}
