"use client";

import { useState, useEffect } from "react";
import { Button, Card } from "@organator/ui";

interface Deployment {
  id: string;
  status: string;
  logs: string | null;
  createdAt: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export function ServiceDetailsClient({ serviceId, initialDeployments }: { serviceId: string; initialDeployments: Deployment[] }) {
  const [deployments, setDeployments] = useState<Deployment[]>(initialDeployments);
  const [selectedDeployment, setSelectedDeployment] = useState<Deployment | null>(initialDeployments[0] || null);

  const selectedDeploymentId = selectedDeployment?.id;

  useEffect(() => {
    if (!selectedDeploymentId) return;

    const eventSource = new EventSource(`${API_URL}/v1/services/deployments/${selectedDeploymentId}/stream`);

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
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

    eventSource.onerror = (err) => {
      console.warn("EventSource error or closed:", err);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [selectedDeploymentId]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Serviço: {serviceId}</h1>
          <p className="text-neutral-400 mt-1">Histórico de Deploys e Logs de Execução</p>
        </div>
        <Button onClick={() => window.location.reload()}>Atualizar Logs</Button>
      </div>

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
                    <span className={`px-2 py-0.5 rounded text-xs ${d.status === "SUCCESS" ? "bg-green-900 text-green-300" : "bg-yellow-900 text-yellow-300"}`}>
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
