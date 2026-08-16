"use client";

import { Card, CardHeader, CardTitle, CardContent, Button } from "@organator/ui";

export function TelemetryDashboard() {
  return (
    <Card className="bg-neutral-900 border-neutral-800 text-xs text-neutral-200 mb-6">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold">Telemetria de Workers & Circuit Breakers dos Provedores</CardTitle>
        <Button size="sm" variant="outline">Resetar Circuit Breakers</Button>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-4">
        <div className="p-3 bg-neutral-950 rounded border border-neutral-800">
          <div className="text-neutral-400">Provedor Docker (VPS/Local)</div>
          <div className="text-base font-bold text-green-400 mt-1">CLOSED (Normal)</div>
        </div>
        <div className="p-3 bg-neutral-950 rounded border border-neutral-800">
          <div className="text-neutral-400">Provedor AWS Cloud</div>
          <div className="text-base font-bold text-green-400 mt-1">CLOSED (Normal)</div>
        </div>
        <div className="p-3 bg-neutral-950 rounded border border-neutral-800">
          <div className="text-neutral-400">Provedor Terraform Cloud</div>
          <div className="text-base font-bold text-green-400 mt-1">CLOSED (Normal)</div>
        </div>
      </CardContent>
    </Card>
  );
}
