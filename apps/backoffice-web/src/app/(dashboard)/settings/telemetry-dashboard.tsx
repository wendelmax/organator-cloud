"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Card, CardHeader, CardTitle, CardContent, Button } from "@organator/ui";
import { publicApiUrl } from "../../../lib/public-env";

const API_URL = publicApiUrl();

interface Telemetry {
  queueAvailable: boolean;
  waitingJobs: number;
  activeJobs: number;
  delayedJobs: number;
  completedJobs: number;
  failedJobs: number;
  circuitBreakers: { provider: string; state: string; failureCount: number }[];
}

/** Fila do provisioner e circuit breakers (só admin da plataforma). */
export function TelemetryDashboard() {
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;
  const isPlatformAdmin = (session?.user as any)?.role === "PLATFORM_ADMIN";
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`${API_URL}/v1/tenants/provisioner/telemetry`, {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null);
    if (!res?.ok) {
      setError("Não foi possível carregar a telemetria do provisioner.");
      return;
    }
    setError(null);
    setTelemetry(await res.json());
  }, [token]);

  useEffect(() => {
    if (isPlatformAdmin) void load();
  }, [isPlatformAdmin, load]);

  async function reset(provider: string) {
    await fetch(`${API_URL}/v1/tenants/provisioner/circuit-breaker/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ provider }),
    });
    await load();
  }

  if (!isPlatformAdmin) return null;

  const counters: [string, number | undefined][] = [
    ["Na fila", telemetry?.waitingJobs],
    ["Em execução", telemetry?.activeJobs],
    ["Agendados", telemetry?.delayedJobs],
    ["Concluídos", telemetry?.completedJobs],
    ["Falharam", telemetry?.failedJobs],
  ];

  return (
    <Card className="bg-neutral-900 border-neutral-800 text-xs text-neutral-200 mb-6">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold">Fila do provisioner</CardTitle>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          Atualizar
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-red-300">{error}</p>}
        {telemetry && !telemetry.queueAvailable && (
          <p className="text-amber-300">Fila não configurada nesta API.</p>
        )}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {counters.map(([label, value]) => (
            <div key={label} className="p-3 bg-neutral-950 rounded border border-neutral-800">
              <div className="text-neutral-400">{label}</div>
              <div className="text-base font-bold text-white mt-1">{value ?? "—"}</div>
            </div>
          ))}
        </div>
        <div>
          <div className="text-neutral-400 mb-2">Circuit breakers dos provedores</div>
          {!telemetry?.circuitBreakers?.length ? (
            <p className="text-neutral-500">Nenhum circuit breaker registrado.</p>
          ) : (
            <ul className="space-y-2">
              {telemetry.circuitBreakers.map((cb) => (
                <li
                  key={cb.provider}
                  className="flex items-center justify-between p-3 bg-neutral-950 rounded border border-neutral-800"
                >
                  <span>
                    {cb.provider} ·{" "}
                    <span className={cb.state === "CLOSED" ? "text-green-400" : "text-amber-400"}>
                      {cb.state}
                    </span>{" "}
                    · {cb.failureCount} falha(s)
                  </span>
                  {cb.state !== "CLOSED" && (
                    <Button size="sm" variant="outline" onClick={() => void reset(cb.provider)}>
                      Resetar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
