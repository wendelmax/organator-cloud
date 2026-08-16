"use client";

import { Button, Card, CardHeader, CardTitle, CardContent } from "@organator/ui";

export function BackupsTab({ tenantId }: { tenantId: string }) {
  return (
    <Card className="bg-neutral-900 border-neutral-800 text-xs mt-6">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold">Backups da Organização</CardTitle>
        <Button size="sm" variant="outline">Criar Backup Manual</Button>
      </CardHeader>
      <CardContent>
        <div className="text-neutral-400">Nenhum backup disponível.</div>
      </CardContent>
    </Card>
  );
}
