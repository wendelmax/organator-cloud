"use client";

import { useState, useEffect, useTransition } from "react";
import { Button, Card } from "@organator/ui";
import { useSession } from "next-auth/react";
import { publicApiUrl } from "../../../../lib/public-env";
import { streamSse } from "../../../../lib/sse";
import { triggerDeploy } from "../actions";

const STATUS_STYLES: Record<string, string> = {
  SUCCESS: "bg-green-900 text-green-300",
  FAILED: "bg-red-900 text-red-300",
};

interface Deployment {
  id: string;
  status: string;
  logs: string | null;
  createdAt: string;
}

const API_URL = publicApiUrl();

export function ServiceDetailsClient({ serviceId, initialDeployments }: { serviceId: string; initialDeployments: Deployment[] }) {
  const [deployments, setDeployments] = useState<Deployment[]>(initialDeployments);
  const [selectedDeployment, setSelectedDeployment] = useState<Deployment | null>(initialDeployments[0] || null);

  const selectedDeploymentId = selectedDeployment?.id;
  const [environment, setEnvironment] = useState("production");
  const [deployError, setDeployError] = useState<string | null>(null);
  const [isDeploying, startDeploy] = useTransition();

  const handleDeploy = () => {
    setDeployError(null);
    startDeploy(async () => {
      const result = await triggerDeploy(serviceId, environment);
      if (!result.success) {
        setDeployError(result.error);
        return;
      }
      // Novo deploy no topo e selecionado: o stream de logs passa a segui-lo.
      setDeployments((prev) => [result.deployment, ...prev]);
      setSelectedDeployment(result.deployment);
    });
  };
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;

  useEffect(() => {
    if (!selectedDeploymentId || !token) return;

    const onData = (data: string) => {
      try {
        const payload = JSON.parse(data);
        const logLine = payload.logLine || (typeof payload === 'string' ? payload : '');
        const newStatus = payload.status;
        const targetId = payload.deploymentId || selectedDeploymentId;

        if (logLine || newStatus) {
          setSelectedDeployment((prev) => {
            if (!prev || prev.id !== targetId) return prev;
            return {
              ...prev,
              logs: (prev.logs || '') + (logLine || ''),
              status: newStatus || prev.status,
            };
          });

          setDeployments((prevList) =>
            prevList.map((d) =>
              d.id === targetId
                ? {
                    ...d,
                    logs: (d.logs || '') + (logLine || ''),
                    status: newStatus || d.status,
                  }
                : d
            )
          );
        }
      } catch (err) {
        console.error("Error processing log event:", err);
      }
    };

    // O stream exige autenticação: EventSource não envia o token.
    return streamSse(
      `${API_URL}/v1/services/deployments/${selectedDeploymentId}/stream`,
      token,
      onData,
    );
  }, [selectedDeploymentId, token]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Serviço: {serviceId}</h1>
          <p className="text-neutral-400 mt-1">Histórico de Deploys e Logs de Execução</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Ambiente"
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
            className="h-10 rounded-md border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-200"
          >
            <option value="production">production</option>
            <option value="staging">staging</option>
            <option value="development">development</option>
          </select>
          <Button onClick={handleDeploy} disabled={isDeploying}>
            {isDeploying ? "Iniciando..." : "Fazer deploy"}
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Atualizar
          </Button>
        </div>
      </div>
      {deployError && (
        <p role="status" className="rounded-lg border border-red-800/60 bg-red-950/40 p-3 text-sm text-red-300">
          {deployError}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-4 bg-neutral-900 border-neutral-800">
          <h2 className="text-lg font-bold text-white mb-4">Histórico de Deploys</h2>
          <div className="space-y-2">
            {deployments.length === 0 ? (
              <p className="text-sm text-neutral-500">Nenhum deploy registrado.</p>
            ) : (
              deployments.map((d) => (
                <div
                  key={d.id}
                  onClick={() => setSelectedDeployment(d)}
                  className={`p-3 rounded-lg border cursor-pointer ${
                    selectedDeployment?.id === d.id ? "bg-neutral-800 border-blue-500" : "bg-neutral-950 border-neutral-800"
                  }`}
                >
                  <div className="flex justify-between items-center text-sm font-mono text-white">
                    <span>{new Date(d.createdAt).toLocaleTimeString()}</span>
                    <span className={`px-2 py-0.5 rounded text-xs ${STATUS_STYLES[d.status] ?? "bg-yellow-900 text-yellow-300"}`}>
                      {d.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="md:col-span-2 p-4 bg-neutral-950 border-neutral-800">
          <h2 className="text-lg font-bold text-white mb-4">Terminal Logs</h2>
          <pre className="p-4 bg-black border border-neutral-800 rounded-lg text-green-400 font-mono text-xs overflow-x-auto min-h-[300px]">
            {selectedDeployment?.logs || "[Sem logs disponíveis]"}
          </pre>
        </Card>
      </div>
    </div>
  );
}

export { ServiceDetailsClient as ServiceLogsClient };
