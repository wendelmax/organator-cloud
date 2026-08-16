"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@organator/ui";
import { TenantInfraStepper } from "../tenants/infra-stepper";

interface DataIsolationView {
  tenantId: string;
  desiredMode: 'SHARED' | 'SCHEMA' | 'DATABASE';
  activeMode: 'SHARED' | 'SCHEMA' | 'DATABASE' | null;
  overridden: boolean;
  status: 'PENDING' | 'RECONCILING' | 'READY' | 'FAILED';
  phase: string;
  lastError: string | null;
  updatedAt: string;
}

const PHASES = [
  'PREPARE',
  'PROVISION_TARGET',
  'APPLY_MIGRATIONS',
  'COPY',
  'VALIDATE',
  'CUTOVER',
  'READY',
];

export function DataIsolationCard({ token }: { token?: string }) {
  const [data, setData] = useState<DataIsolationView | null>(null);
  const [loading, setLoading] = useState(true);

  const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001").replace(/\/v1$/, "");

  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/v1/tenants/data-isolation`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (res) setData(res);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [token]);

  if (loading || !data) return null;

  const currentPhaseIndex = PHASES.indexOf(data.phase);

  return (
    <Card className="bg-neutral-900 border-neutral-800">
      <CardHeader>
        <CardTitle className="text-lg flex items-center justify-between">
          <span>Isolamento do Data Plane</span>
          <span className="text-xs font-normal text-neutral-400">Read-Only</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between text-sm">
          <div>
            <span className="text-neutral-400">Modo Desejado: </span>
            <span className="font-semibold text-neutral-100">{data.desiredMode}</span>
          </div>
          <div>
            <span className="text-neutral-400">Modo Ativo: </span>
            <span className="font-semibold text-neutral-100">{data.activeMode || 'Nenhum'}</span>
          </div>
          <div>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              data.status === 'READY' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
              data.status === 'FAILED' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
              'bg-amber-500/10 text-amber-400 border border-amber-500/20'
            }`}>
              {data.status}
            </span>
          </div>
        </div>

        {/* Infra Provisioning Stepper */}
        <TenantInfraStepper 
          currentPhase={data.phase} 
          status={data.status} 
        />

        {data.status === 'FAILED' && (
          <div className="p-3 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs space-y-1">
            <div className="font-semibold">Falha na Reconciliação:</div>
            <div>{data.lastError || 'Entre em contato com o suporte para assistência.'}</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
