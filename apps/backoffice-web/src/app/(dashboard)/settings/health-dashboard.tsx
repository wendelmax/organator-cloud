"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@organator/ui";

export function HealthDashboard() {
  return (
    <Card className="bg-neutral-900 border-neutral-800 text-xs text-neutral-200 mb-6">
      <CardHeader>
        <CardTitle className="text-sm font-semibold flex items-center justify-between">
          <span>Saúde & Indicadores de Recursos da Plataforma</span>
          <span className="text-green-400 font-mono text-xs">● Todos Sistemas Operacionais</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-4 gap-4">
        <div className="p-3 bg-neutral-950 rounded border border-neutral-800">
          <div className="text-neutral-400">Database Engine</div>
          <div className="text-base font-bold text-green-400 mt-1">HEALTHY</div>
        </div>
        <div className="p-3 bg-neutral-950 rounded border border-neutral-800">
          <div className="text-neutral-400">Overlay Network</div>
          <div className="text-base font-bold text-green-400 mt-1">HEALTHY</div>
        </div>
        <div className="p-3 bg-neutral-950 rounded border border-neutral-800">
          <div className="text-neutral-400">DNS & TLS Gateway</div>
          <div className="text-base font-bold text-green-400 mt-1">HEALTHY</div>
        </div>
        <div className="p-3 bg-neutral-950 rounded border border-neutral-800">
          <div className="text-neutral-400">CPU Global Média</div>
          <div className="text-base font-bold text-neutral-100 mt-1">12.4%</div>
        </div>
      </CardContent>
    </Card>
  );
}
