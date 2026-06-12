"use client";

import { useState, useEffect } from "react";
import { Button, Card, CardContent } from "@navant/ui";

const SIMULATED_LOGS = [
  "[provisioner] Iniciando rotina de provisionamento...",
  "[provisioner] Conectando ao host VPS docker-node-01...",
  "[ssh] Autenticação bem sucedida.",
  "[docker] Verificando se a rede 'tenant-acme-network' existe...",
  "[docker] Criando rede 'tenant-acme-network'...",
  "[docker] Baixando imagem ghcr.io/org/payment-api:latest...",
  "[docker] Extraindo camadas da imagem (54%)...",
  "[docker] Extraindo camadas da imagem (100%)...",
  "[docker] Imagem baixada com sucesso.",
  "[provisioner] Injetando variáveis de ambiente do Tenant...",
  "[docker] Iniciando contêiner payment-api-acme...",
  "[docker] Contêiner iniciado com ID a8f4b23c.",
  "[traefik] Atualizando regras de roteamento (Rule=Host(`payment.acme.organator.io`))...",
  "[healthcheck] Aguardando ping em /health...",
  "[healthcheck] 200 OK. Serviço operante.",
  "[provisioner] Deploy concluído com sucesso!"
];

export function ServiceLogsClient({ serviceId }: { serviceId: string }) {
  const [logs, setLogs] = useState<string[]>([]);
  const [isDeploying, setIsDeploying] = useState(false);

  const simulateDeploy = () => {
    setIsDeploying(true);
    setLogs([]);
    
    let currentLog = 0;
    const interval = setInterval(() => {
      if (currentLog < SIMULATED_LOGS.length) {
        setLogs(prev => [...prev, SIMULATED_LOGS[currentLog]]);
        currentLog++;
      } else {
        clearInterval(interval);
        setIsDeploying(false);
      }
    }, 400); // Adiciona uma nova linha a cada 400ms
  };

  useEffect(() => {
    // Inicia um deploy automático para demonstração ao abrir a página
    simulateDeploy();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Detalhes do Serviço</h1>
          <p className="text-neutral-400 mt-1">Monitoramento e Deploy Logs em Tempo Real</p>
        </div>
        <Button onClick={simulateDeploy} disabled={isDeploying} variant={isDeploying ? "outline" : "default"}>
          {isDeploying ? "Deploy em Andamento..." : "Forçar Re-deploy"}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <div className="p-6">
              <h3 className="font-semibold text-lg mb-4">Informações</h3>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-neutral-500">Nome</p>
                  <p className="font-medium">Payment API</p>
                </div>
                <div>
                  <p className="text-sm text-neutral-500">ID Interno</p>
                  <p className="font-mono text-xs">{serviceId}</p>
                </div>
                <div>
                  <p className="text-sm text-neutral-500">Provedor Cloud</p>
                  <p className="font-mono text-xs text-blue-400">VPS DOCKER</p>
                </div>
                <div>
                  <p className="text-sm text-neutral-500">Status Geral</p>
                  <div className="flex items-center gap-2 mt-1">
                    <div className={`h-2 w-2 rounded-full ${isDeploying ? "bg-yellow-500 animate-pulse" : "bg-green-500"}`}></div>
                    <span className="text-sm font-medium">{isDeploying ? "Provisionando" : "Operante"}</span>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card className="h-[500px] flex flex-col bg-neutral-950 border-neutral-800">
            <div className="flex items-center px-4 py-2 border-b border-neutral-800 bg-neutral-900 rounded-t-xl">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50"></div>
                <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50"></div>
              </div>
              <p className="ml-4 text-xs font-mono text-neutral-500">Terminal (provisioner-worker)</p>
            </div>
            
            <CardContent className="flex-1 overflow-auto p-4 font-mono text-xs sm:text-sm">
              <div className="space-y-1">
                {logs.map((log, i) => (
                  <div key={i} className="flex">
                    <span className="text-neutral-600 mr-4 select-none">
                      {new Date().toISOString().split("T")[1].substring(0, 8)}
                    </span>
                    <span className={
                      log.includes("Erro") || log.includes("Falha") ? "text-red-400" :
                      log.includes("sucesso") || log.includes("OK") ? "text-green-400" :
                      log.includes("[provisioner]") ? "text-blue-400" :
                      "text-neutral-300"
                    }>
                      {log}
                    </span>
                  </div>
                ))}
                {isDeploying && (
                  <div className="flex animate-pulse">
                    <span className="text-neutral-600 mr-4">--:--:--</span>
                    <span className="text-neutral-500">_</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
